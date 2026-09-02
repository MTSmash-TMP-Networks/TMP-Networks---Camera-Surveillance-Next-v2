function xmlValue(xml, tag) {
  const match = String(xml || '').match(new RegExp(`<(?:\\w+:)?${tag}[^>]*>([\\s\\S]*?)<\\/(?:\\w+:)?${tag}>`, 'i'));
  return match ? match[1].replace(/<[^>]+>/g, '').trim() : null;
}

export function parseHikvisionStreamingChannels(xml, input = {}) {
  const blocks = [...String(xml || '').matchAll(/<(?:\w+:)?StreamingChannel(?:\s[^>]*)?>([\s\S]*?)<\/(?:\w+:)?StreamingChannel>/gi)]
    .map((match) => match[1]);
  const rtspPorts = (input.openPorts || []).map(Number).filter((port) => [554, 8554, 10554].includes(port));
  const port = rtspPorts[0] || 554;
  const host = String(input.ip || '').includes(':') ? `[${input.ip}]` : input.ip;
  const seen = new Set();
  const items = [];
  for (const block of blocks) {
    const id = xmlValue(block, 'id');
    if (!/^\d{3,5}$/.test(id || '') || seen.has(id)) continue;
    seen.add(id);
    const codec = xmlValue(block, 'videoCodecType') || xmlValue(block, 'videoCodec') || null;
    const width = Number(xmlValue(block, 'videoResolutionWidth') || 0) || null;
    const height = Number(xmlValue(block, 'videoResolutionHeight') || 0) || null;
    const channelName = xmlValue(block, 'channelName') || xmlValue(block, 'name') || null;
    items.push({
      label: `Hikvision ISAPI · ${channelName || `Kanal ${id}`}${codec ? ` · ${codec}` : ''}${width && height ? ` · ${width}×${height}` : ''}`,
      kind: 'rtsp', priority: id.endsWith('01') ? 1 : 2, enabled: true, origin: 'catalog',
      url: `rtsp://${host}:${port}/Streaming/Channels/${id}`,
      confidence: 100, catalogProvider: 'Hikvision ISAPI', catalogFamily: 'StreamingChannel',
      catalogRole: id.endsWith('01') ? 'main' : id.endsWith('02') ? 'sub' : 'alternative',
      matchedBy: 'Von /ISAPI/Streaming/channels gemeldeter Kanal', declaredByDevice: true,
      forceFfprobeOnRtspFailure: true, deviceChannelId: id, detectedCodec: codec, width, height,
    });
  }
  return items;
}
