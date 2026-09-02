# Direct Network Streams

TMP Camera Surveillance Next can add a network video stream without discovering or registering an ONVIF camera. This is useful for public webcams, encoders, restreamers, NVR channels, media gateways and other video sources that expose a direct media URL.

## Add a stream

1. Open **Add camera**.
2. Choose **Add network stream**.
3. Enter the media URL and optionally select the protocol explicitly.
4. Enter a username and password only when the source requires HTTP/RTSP authentication.
5. Select **Test stream**. The backend validates the source with FFprobe and requires an actual video track.
6. Choose the verified source and finish the normal setup wizard.

The direct stream is then available to the same live view, recording, snapshot, motion/event and AI Event Analysis pipeline used by camera sources.

## Supported source types

- RTSP / RTSPS
- HLS (`.m3u8`) over HTTP or HTTPS
- MJPEG over HTTP or HTTPS
- General FFmpeg-readable HTTP/HTTPS video streams
- RTMP / RTMPS
- SRT

The **Auto** option infers the source type from the URL/protocol. A static JPEG snapshot is not accepted as the primary direct live stream, although snapshot sources can still be used as fallbacks where supported.

## Authentication and URL storage

URLs such as `rtsp://user:password@example.invalid/live` can be entered for convenience. The application removes embedded username/password values from the persisted media URL and stores the camera-level credentials in the encrypted credential vault instead.

For URLs that use signed query parameters or provider tokens, the query string is part of the media URL and must remain present for playback. Treat administrator access to those source settings accordingly.

## Multiple streams and failover

Multiple direct stream cameras can use the same hostname or IP address. Only an exact already-added media URL is rejected as a duplicate.

After creation, additional media URLs can be added to the source list of a direct stream camera. Unlike ONVIF camera alternatives, these URLs may point to different hosts, which makes a secondary restreamer or failover endpoint possible. Camera-level username/password credentials are shared by those sources.

## Public demo streams

For a marketplace/public demo, configure the desired public or licensed stream sources **before** enabling Public Demo Mode under **Administration → System status**. Once the administrator enables the mode, the server intentionally blocks camera and stream configuration changes for the public demo session.

Only use third-party streams whose operator/license permits the intended viewing or redistribution. TMP Camera Surveillance does not include or automatically scrape third-party webcam URLs.

## Network requirements

The backend container must be able to reach the source URL directly. Browser CORS rules are not relevant to source acquisition because TMP Camera Surveillance pulls the media server-side and publishes its own normalized WebRTC/HLS output.

Firewalls, DNS, VPN routing and outbound proxy policies must permit the selected source protocol and port.
