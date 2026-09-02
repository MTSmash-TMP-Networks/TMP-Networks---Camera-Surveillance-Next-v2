/**
 * Prepare authenticated internal go2rtc read sources for FFmpeg.
 *
 * go2rtc HTTP reads are protected by the frontend proxy with bearer tokens.
 * Internal RTSP reads stay inside the Docker network and are not exposed through
 * the browser-facing proxy, so they are passed through without token query noise.
 */
export function prepareMediaReadSource(sourceUri, mediaToken = null) {
  const rawUri = String(sourceUri || '');
  let parsed;
  try { parsed = new URL(rawUri); }
  catch { return { uri: rawUri, inputArgs: [], displayUri: rawUri }; }

  const protocol = parsed.protocol.toLowerCase();
  const display = new URL(parsed);
  display.username = '';
  display.password = '';
  display.searchParams.delete('token');
  display.searchParams.delete('jwt');
  display.searchParams.delete('_motion');
  display.searchParams.delete('_live');
  display.searchParams.delete('_ts');

  const inputArgs = [];
  if (mediaToken && ['http:', 'https:'].includes(protocol)) {
    inputArgs.push('-headers', `Authorization: Bearer ${mediaToken}\r\n`);
  }

  return {
    uri: parsed.toString(),
    inputArgs,
    displayUri: display.toString(),
  };
}
