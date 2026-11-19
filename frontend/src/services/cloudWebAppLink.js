/**
 * Build a shareable cloud entrance for one permanent camera installation.
 * Only its UUID is included. Never attach a camera bearer token or credentials.
 */
export function cloudWebAppLink(installationId) {
  if (typeof installationId !== 'string') return '';
  const id = installationId.trim().toLowerCase();
  if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(id)) return '';
  return `https://support.tmp-networks.de/cam/index.php?server=${encodeURIComponent(id)}`;
}
