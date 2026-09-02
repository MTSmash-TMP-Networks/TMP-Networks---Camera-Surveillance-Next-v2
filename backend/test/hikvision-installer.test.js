import { describe, expect, it } from 'vitest';
import { parseHikvisionStreamingChannels } from '../src/services/HikvisionChannels.js';

describe('Hikvision-Streamkanäle', () => {
  it('erzeugt aus ISAPI-Kanälen direkt nutzbare RTSP-Pfade', () => {
    const xml = `<?xml version="1.0"?><StreamingChannelList>
      <StreamingChannel><id>101</id><channelName>MainStream</channelName><Video><videoCodecType>H.265</videoCodecType><videoResolutionWidth>3840</videoResolutionWidth><videoResolutionHeight>2160</videoResolutionHeight></Video></StreamingChannel>
      <StreamingChannel><id>102</id><channelName>SubStream</channelName><Video><videoCodecType>H.264</videoCodecType><videoResolutionWidth>640</videoResolutionWidth><videoResolutionHeight>360</videoResolutionHeight></Video></StreamingChannel>
    </StreamingChannelList>`;
    const items = parseHikvisionStreamingChannels(xml, { ip: '192.168.1.86', openPorts: [80, 554, 8000] });
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ url: 'rtsp://192.168.1.86:554/Streaming/Channels/101', declaredByDevice: true, enabled: true, detectedCodec: 'H.265' });
    expect(items[1].url).toContain('/Streaming/Channels/102');
  });
});
