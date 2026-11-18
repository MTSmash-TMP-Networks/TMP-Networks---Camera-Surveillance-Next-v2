package streams

import (
 "encoding/json"
 "fmt"
 "net/http"
 "net/http/httptest"
 "sync"
 "testing"
)

// Reproduces the fleet load: multiple readers request stream inventories while
// cameras are removed/replaced. Run this test with Go's race detector.
func TestTMPConcurrentStreamsAPI(t *testing.T) {
 const streamsCount = 40
 for i := 0; i < streamsCount; i++ {
  name := fmt.Sprintf("tmp_race_%d", i)
  streamsMu.Lock()
  streams[name] = NewStream(nil)
  streamsMu.Unlock()
 }
 defer func() {
  for i := 0; i < streamsCount; i++ { Delete(fmt.Sprintf("tmp_race_%d", i)) }
 }()
 var wg sync.WaitGroup
 for reader := 0; reader < 8; reader++ {
  wg.Add(1)
  go func() {
   defer wg.Done()
   for i := 0; i < 250; i++ {
    request := httptest.NewRequest(http.MethodGet, "/api/streams", nil)
    recorder := httptest.NewRecorder()
    apiStreams(recorder, request)
    if recorder.Code != 200 {
     t.Errorf("unexpected API status: %d", recorder.Code)
     return
    }
    var output map[string]any
    if err := json.Unmarshal(recorder.Body.Bytes(), &output); err != nil {
     t.Errorf("non-JSON response: %v", err)
     return
    }
   }
  }()
 }
 for writer := 0; writer < 8; writer++ {
  wg.Add(1)
  go func(offset int) {
   defer wg.Done()
   for i := 0; i < 250; i++ {
    name := fmt.Sprintf("tmp_race_%d", (i+offset)%streamsCount)
    Delete(name)
    streamsMu.Lock()
    streams[name] = NewStream(nil)
    streamsMu.Unlock()
   }
  }(writer)
 }
 wg.Wait()
}
