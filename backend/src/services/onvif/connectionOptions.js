export function onvifConnectionOptions(camera, timeoutMs = 10_000) {
  const onvif = camera?.onvif || {};
  const options = {
    hostname: onvif.ip,
    port: Number(onvif.port || 80),
    username: camera?.username || '',
    password: camera?.password || '',
    timeout: Number(timeoutMs || 10_000),
  };
  const rawXaddr = String(onvif.xaddr || '').trim();
  if (rawXaddr) {
    try {
      const endpoint = new URL(rawXaddr);
      options.hostname = onvif.ip || endpoint.hostname;
      options.port = Number(endpoint.port || (endpoint.protocol === 'https:' ? 443 : 80));
      options.path = `${endpoint.pathname || '/onvif/device_service'}${endpoint.search || ''}`;
      options.useSecure = endpoint.protocol === 'https:';
      if (options.useSecure) options.secureOpts = { rejectUnauthorized: false };
    } catch {
      if (rawXaddr.startsWith('/')) options.path = rawXaddr;
    }
  } else if ([443, 8443].includes(Number(options.port))) {
    options.useSecure = true;
    options.secureOpts = { rejectUnauthorized: false };
  }
  return options;
}

export function onvifEndpointLabel(camera, timeoutMs = 10_000) {
  const options = onvifConnectionOptions(camera, timeoutMs);
  const scheme = options.useSecure ? 'https' : 'http';
  const defaultPort = options.useSecure ? 443 : 80;
  const portPart = Number(options.port) === defaultPort ? '' : `:${options.port}`;
  return `${scheme}://${options.hostname}${portPart}${options.path || '/onvif/device_service'}`;
}
