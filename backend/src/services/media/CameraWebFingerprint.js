import DigestClient from 'digest-fetch';
import { config } from '../../config.js';
import { inferMediaSourceKind } from './MediaSource.js';
import { CAMERA_TLS_PORTS, CAMERA_WEB_PORTS } from './CameraPortCatalog.js';

const MAX_PAGE_BYTES = 1024 * 1024;
const CAMERA_USER_AGENT = `TMP-Camera-Surveillance/${config.appVersion}`;
const MEDIA_WORDS = /(rtsp|rtmp|m3u8|mjpeg|mjpg|snapshot|picture|stream|channel|realmonitor|preview|av_stream|media\.amp|\.sdp|\.264|\.h264|\.h265|\.flv)/i;
const IGNORE_EXTENSIONS = /\.(?:js|css|svg|woff2?|ttf|ico|png|gif)(?:\?|$)/i;
const VENDORS = [
  ['hikvision', /hikvision|hilook|ezviz|isapi/i],
  ['dahua', /dahua|amcrest|imou|configManager\.cgi|realmonitor/i],
  ['axis', /axis communications|axis-cgi|axis-media/i],
  ['reolink', /reolink|Preview_\d+_(?:main|sub)/i],
  ['tp-link', /\bvigi\b|\btapo\b[^\n<]{0,100}(?:network\s+camera|ip\s+camera|camera\s+login|C\d{3}|TC\d{2})/i],
  ['vivotek', /vivotek/i],
  ['uniview', /uniview|unv/i],
  ['foscam', /foscam|videostream\.cgi/i],
  ['xiongmai', /xmeye|xiongmai|hi351[068]|hisilicon|webs/i],
  ['synology', /synology camera|bc500|tc500|cc400w/i],
];

function limitedText(response) {
  return response.arrayBuffer().then((value) => {
    const buffer = Buffer.from(value);
    return buffer.subarray(0, MAX_PAGE_BYTES).toString('utf8');
  });
}

function absoluteUrl(base, candidate) {
  try { return new URL(candidate, base); } catch { return null; }
}

function sameCameraHost(url, cameraIp) {
  return url && url.hostname === cameraIp;
}

function candidateKind(url) {
  const text = `${url.protocol}//${url.host}${url.pathname}${url.search}`;
  if (/\.(?:jpg|jpeg)(?:\?|$)|snapshot|picture/i.test(text)) return 'snapshot';
  if (/mjpeg|mjpg/i.test(text)) return 'mjpeg';
  if (/\.m3u8(?:\?|$)/i.test(text)) return 'hls';
  if (url.protocol.startsWith('rtsp')) return 'rtsp';
  if (url.protocol.startsWith('rtmp')) return 'rtmp';
  return inferMediaSourceKind(url.toString(), 'auto');
}

function normalizeEmbeddedUrl(raw, base, cameraIp) {
  let text = String(raw || '').replace(/\\\//g, '/').replace(/&amp;/gi, '&').trim();
  text = text.replace(/^["'`]|["'`]$/g, '');
  if (!text || IGNORE_EXTENSIONS.test(text) || !MEDIA_WORDS.test(text)) return null;
  if (/^(?:javascript|data):/i.test(text)) return null;
  let parsed;
  if (/^(?:rtsp|rtsps|rtmp|rtmps|http|https):\/\//i.test(text)) parsed = absoluteUrl(base, text);
  else if (text.startsWith('/')) parsed = absoluteUrl(base, text);
  else return null;
  if (!sameCameraHost(parsed, cameraIp)) return null;
  parsed.username = '';
  parsed.password = '';
  return parsed;
}

export function parseWebFingerprint({ body = '', headers = {}, baseUrl, cameraIp }) {
  const text = String(body || '');
  const combined = `${Object.entries(headers).map(([key, value]) => `${key}:${value}`).join('\n')}\n${text}`;
  const manufacturerHint = VENDORS.find(([, pattern]) => pattern.test(combined))?.[0] || null;
  const title = text.match(/<title[^>]*>([^<]{1,180})<\/title>/i)?.[1]?.replace(/\s+/g, ' ').trim() || null;
  const server = headers.server || null;
  const candidates = [];
  const seen = new Set();
  const expressions = [
    /(?:rtsp|rtsps|rtmp|rtmps|https?):\\?\/\\?\/[A-Za-z0-9_.:\-\[\]]+(?:\\?\/[A-Za-z0-9_~!$&'()*+,;=:@%./?\-]*)?/gi,
    /["'`]((?:\/[^"'`\s<>]{1,500})(?:m3u8|mjpg|mjpeg|snapshot|picture|stream|channel|realmonitor|preview|av_stream|media\.amp|\.sdp|\.264|\.h264|\.h265|\.flv)[^"'`\s<>]*)["'`]/gi,
  ];
  for (const expression of expressions) {
    for (const match of text.matchAll(expression)) {
      const raw = match[1] || match[0];
      const parsed = normalizeEmbeddedUrl(raw, baseUrl, cameraIp);
      if (!parsed) continue;
      const key = parsed.toString();
      if (seen.has(key)) continue;
      seen.add(key);
      candidates.push({
        label: `Weboberfläche · ${parsed.pathname}${parsed.search}`.slice(0, 160),
        kind: candidateKind(parsed),
        priority: 55 + candidates.length,
        enabled: true,
        origin: 'discovered',
        url: key,
        confidence: 76,
        catalogProvider: 'Kamera-Weboberfläche',
        catalogFamily: title || server || 'Web-Fingerprint',
        matchedBy: 'In HTML oder JavaScript gefundener Medienpfad',
      });
      if (candidates.length >= 50) break;
    }
  }
  const scripts = [...text.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/gi)]
    .map((match) => absoluteUrl(baseUrl, match[1]))
    .filter((url) => sameCameraHost(url, cameraIp))
    .slice(0, 6)
    .map((url) => url.toString());
  return { manufacturerHint, title, server, candidates, scripts };
}

async function fetchCameraPage(client, url, timeoutMs = 4500) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await client.fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: { 'User-Agent': CAMERA_USER_AGENT, Accept: 'text/html,application/javascript,*/*;q=0.3' },
    });
    const contentType = response.headers.get('content-type') || '';
    if (!response.ok || (!contentType.includes('text') && !contentType.includes('javascript') && !contentType.includes('json'))) return null;
    return { body: await limitedText(response), headers: Object.fromEntries(response.headers.entries()), url: response.url || url };
  } finally { clearTimeout(timer); }
}

export async function inspectCameraWeb(camera, openPorts = []) {
  const ports = [...new Set(openPorts.map(Number).filter((port) => CAMERA_WEB_PORTS.includes(port)))];
  const client = new DigestClient(camera.username || '', camera.password || '', { basic: true });
  const pages = [];
  const candidates = [];
  const warnings = [];
  let manufacturerHint = null;
  let title = null;
  let server = null;
  for (const port of ports) {
    const scheme = CAMERA_TLS_PORTS.includes(port) ? 'https' : 'http';
    const base = `${scheme}://${camera.onvif.ip.includes(':') ? `[${camera.onvif.ip}]` : camera.onvif.ip}:${port}/`;
    try {
      const page = await fetchCameraPage(client, base);
      if (!page) continue;
      const parsed = parseWebFingerprint({ ...page, baseUrl: page.url, cameraIp: camera.onvif.ip });
      pages.push({ url: page.url, title: parsed.title, server: parsed.server });
      manufacturerHint ||= parsed.manufacturerHint;
      title ||= parsed.title;
      server ||= parsed.server;
      candidates.push(...parsed.candidates);
      for (const script of parsed.scripts) {
        try {
          const scriptPage = await fetchCameraPage(client, script, 3500);
          if (!scriptPage) continue;
          const scriptParsed = parseWebFingerprint({ ...scriptPage, baseUrl: script, cameraIp: camera.onvif.ip });
          manufacturerHint ||= scriptParsed.manufacturerHint;
          candidates.push(...scriptParsed.candidates);
        } catch { /* einzelnes JavaScript darf die Suche nicht abbrechen */ }
      }
    } catch (error) {
      warnings.push(`${scheme.toUpperCase()} ${port}: ${String(error.message || error).slice(0, 160)}`);
    }
  }
  const unique = [...new Map(candidates.map((item) => [item.url, item])).values()];
  return { manufacturerHint, title, server, pages, candidates: unique, warnings };
}
