function safeText(value, maxLength = 240) {
  return String(value || '').replace(/[\u0000-\u001f\u007f]/g, '').slice(0, maxLength) || null;
}

export function publicContainerImage(item) {
  const image = safeText(item?.image, 240);
  const service = String(item?.service || '').trim().toLowerCase();
  if (service === 'mediamtx' || /(?:^|\/)go2rtc(?::|@|$)/i.test(image || '')) return 'TMP-Encoder';
  return image;
}
