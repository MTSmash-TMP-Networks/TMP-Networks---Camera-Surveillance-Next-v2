#!/usr/bin/env python3
"""Build a conservative supplemental camera catalog from an extracted SPK."""

from __future__ import annotations

import argparse
from collections import Counter, defaultdict
from datetime import datetime, timezone
import json
from pathlib import Path
import re
import sqlite3
from urllib.parse import urlsplit

TEXT_SUFFIXES = {
    '.txt', '.json', '.xml', '.conf', '.cfg', '.ini', '.js', '.ts', '.lua',
    '.html', '.htm', '.php', '.py', '.sh', '.csv', '.yaml', '.yml', '.properties',
}
SQLITE_SUFFIXES = {'.db', '.sqlite', '.sqlite3'}
MAX_TEXT_FILE = 24 * 1024 * 1024
MAX_SQL_ROWS = 200_000

VENDORS = {
    'hikvision': ['hikvision', 'hilook', 'ezviz'],
    'dahua': ['dahua', 'amcrest', 'imou', 'lorex'],
    'axis': ['axis communications', 'axis'],
    'reolink': ['reolink'],
    'vivotek': ['vivotek'],
    'foscam': ['foscam'],
    'uniview': ['uniview', 'unv'],
    'tp-link': ['tp-link', 'tplink', 'vigi', 'tapo'],
    'hanwha': ['hanwha', 'wisenet', 'samsung techwin'],
    'bosch': ['bosch security', 'bosch video'],
    'ubiquiti': ['ubiquiti', 'unifi protect', 'ubnt'],
    'xiongmai': ['xiongmai', 'xmeye', 'netsurveillance'],
    'avtech': ['avtech'],
    'mobotix': ['mobotix'],
    'panasonic': ['panasonic'],
    'sony': ['sony'],
    'canon': ['canon'],
    'pelco': ['pelco'],
    'geovision': ['geovision'],
    'acti': ['acti corporation', 'acti'],
    'avigilon': ['avigilon'],
    'synology': ['synology'],
}

DISPLAY_NAMES = {
    'tp-link': 'TP-Link VIGI / Tapo',
    'hanwha': 'Hanwha / Wisenet',
    'ubiquiti': 'Ubiquiti / UniFi Protect',
    'xiongmai': 'Xiongmai / XMEye',
}

URL_RE = re.compile(r'(?P<url>(?:rtsp|rtsps|rtmp|rtmps|https?)://[^\s\"\'<>]{4,700})', re.I)
PATH_RE = re.compile(
    r'(?<![A-Za-z0-9:<])(?P<path>/(?!/)(?:[^\s\"\'<>]{0,160})'
    r'(?:stream|streaming|preview|h264|h265|live|video|media|mjpeg|snapshot|picture|image|cam|channel|axis-cgi|isapi|onvif)'
    r'[^\s\"\'<>]{0,220})',
    re.I,
)
PORT_RE = re.compile(r'(?i)(?:rtsp|rtsps|rtmp|onvif|http|https|server|media|video|sdk|command)[_\s.-]*port[^0-9]{0,14}([1-9][0-9]{1,4})')


def clean_token(value: str) -> str:
    value = value.strip().rstrip('),.;]}')
    value = value.replace('&amp;', '&')
    return value[:700]


def text_chunks(path: Path):
    try:
        size = path.stat().st_size
    except OSError:
        return
    if size <= 0 or size > MAX_TEXT_FILE:
        return
    suffix = path.suffix.lower()
    try:
        if suffix in TEXT_SUFFIXES:
            yield path.read_text(encoding='utf-8', errors='ignore')
            return
        data = path.read_bytes()
    except OSError:
        return
    if data.startswith(b'SQLite format 3\x00') or suffix in SQLITE_SUFFIXES:
        yield from sqlite_chunks(path)
        return
    printable = sum(byte in b'\t\n\r' or 32 <= byte < 127 for byte in data[:100_000])
    if data and printable / min(len(data), 100_000) >= 0.80:
        yield data.decode('utf-8', errors='ignore')


def sqlite_chunks(path: Path):
    connection = None
    try:
        connection = sqlite3.connect(f'file:{path}?mode=ro', uri=True)
        tables = [row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")]
        remaining = MAX_SQL_ROWS
        for table in tables:
            safe = table.replace('"', '""')
            cursor = connection.execute(f'SELECT * FROM "{safe}"')
            for row in cursor:
                values = [str(value) for value in row if value is not None]
                if values:
                    yield '\n'.join(values)
                remaining -= 1
                if remaining <= 0:
                    return
    except sqlite3.Error:
        return
    finally:
        if connection is not None:
            connection.close()


def vendor_positions(text: str):
    lowered = text.lower()
    positions = []
    for vendor, needles in VENDORS.items():
        for needle in needles:
            for match in re.finditer(rf'(?<![a-z0-9]){re.escape(needle)}(?![a-z0-9])', lowered):
                positions.append((match.start(), match.end(), vendor))
    return positions


def nearest_vendors(positions, start: int, end: int, max_distance: int = 1500) -> list[str]:
    preceding = [(start - right, vendor) for left, right, vendor in positions if right <= start and start - right <= max_distance]
    if preceding:
        best = min(distance for distance, _ in preceding)
        return sorted({vendor for distance, vendor in preceding if distance == best})
    following = [(left - end, vendor) for left, right, vendor in positions if left >= end and left - end <= max_distance]
    if following:
        best = min(distance for distance, _ in following)
        return sorted({vendor for distance, vendor in following if distance == best})
    return []


def media_kind(protocol: str, path: str) -> tuple[str, str | None]:
    lowered = path.lower()
    if any(token in lowered for token in ('snapshot', 'picture', '.jpg', '.jpeg', 'image.cgi')):
        return 'snapshot', 'snapshot'
    if 'mjpeg' in lowered or 'mjpg' in lowered:
        return 'mjpeg', 'sub'
    role = 'sub' if any(token in lowered for token in ('subtype=1', 'substream', 'stream2', 'channel2', '/102', '_sub')) else 'main'
    if protocol.startswith('rtmp'):
        return 'rtmp', role
    if protocol.startswith('http') and any(token in lowered for token in ('.m3u8', 'hls')):
        return 'hls', role
    return 'rtsp', role


def normalize_candidate(raw: str) -> tuple[str, str, int | None] | None:
    value = clean_token(raw)
    if value.lower().startswith(('rtsp://', 'rtsps://', 'rtmp://', 'rtmps://', 'http://', 'https://')):
        try:
            parsed = urlsplit(value)
        except ValueError:
            return None
        protocol = parsed.scheme.lower()
        path = parsed.path or '/'
        if parsed.query:
            path += '?' + parsed.query
        return protocol, path, parsed.port
    if not value.startswith('/'):
        return None
    return 'rtsp', value, None


def plausible_path(path: str) -> bool:
    lowered = path.lower()
    if len(path) < 5 or len(path) > 600 or path.startswith('//'):
        return False
    if any(token in lowered for token in ('.css', '.woff', '.ttf', '.png', '.svg', 'node_modules', '/assets/', '/static/')):
        return False
    structural = '?' in path or '.' in path or path.count('/') >= 2 or any(token in lowered for token in ('preview', 'h264', 'h265')) or lowered in {'/live', '/live0', '/live1', '/stream1', '/stream2'}
    if not structural:
        return False
    return any(token in lowered for token in (
        'stream', 'preview', 'h264', 'h265', 'live', 'video', 'media', 'mjpeg', 'mjpg', 'snapshot', 'picture',
        'image.cgi', 'cam/', 'channel', 'axis-cgi', 'isapi', 'onvif', '.m3u8',
    ))


def label_for(path: str, kind: str, role: str | None) -> str:
    if role == 'snapshot':
        return 'Device-Pack Snapshot'
    if kind == 'mjpeg':
        return 'Device-Pack MJPEG'
    if role == 'sub':
        return 'Device-Pack Substream'
    return 'Device-Pack Hauptstream'


def analyze(root: Path, source_name: str, source_version: str | None):
    findings = defaultdict(dict)
    ports = Counter()
    scanned_files = 0
    scanned_chunks = 0

    for path in sorted(item for item in root.rglob('*') if item.is_file()):
        chunks = text_chunks(path)
        if chunks is None:
            continue
        used = False
        for text in chunks:
            if not text:
                continue
            used = True
            scanned_chunks += 1
            text = text.replace('&amp;', '&')
            positions = vendor_positions(text)
            for match in PORT_RE.finditer(text):
                port = int(match.group(1))
                if port <= 65535:
                    context_vendors = nearest_vendors(positions, match.start(), match.end())
                    for vendor in context_vendors or ['unassigned']:
                        ports[(vendor, port)] += 1

            url_matches = list(URL_RE.finditer(text))
            occupied = [(match.start(), match.end()) for match in url_matches]
            candidate_matches = [(match, 'url') for match in url_matches]
            for match in PATH_RE.finditer(text):
                if any(match.start() < right and match.end() > left for left, right in occupied):
                    continue
                candidate_matches.append((match, 'path'))

            for match, match_type in candidate_matches:
                raw = match.group('url' if match_type == 'url' else 'path')
                normalized = normalize_candidate(raw)
                if not normalized:
                    continue
                protocol, media_path, explicit_port = normalized
                if not plausible_path(media_path):
                    continue
                context_vendors = nearest_vendors(positions, match.start(), match.end())
                if not context_vendors:
                    continue
                kind, role = media_kind(protocol, media_path)
                for vendor in context_vendors:
                    key = (protocol, media_path)
                    item = findings[vendor].setdefault(key, {
                        'kind': kind,
                        'path': media_path,
                        'label': label_for(media_path, kind, role),
                        'role': role,
                        'confidence': 76 if raw.lower().startswith(('rtsp://', 'rtsps://', 'rtmp://', 'rtmps://')) else 64,
                        'protocol': protocol if protocol not in ('rtsp',) else None,
                        'sources': set(),
                        'ports': set(),
                    })
                    item['sources'].add(str(path.relative_to(root)))
                    if explicit_port:
                        item['ports'].add(explicit_port)
        if used:
            scanned_files += 1

    families = []
    for vendor, entries in sorted(findings.items()):
        paths = []
        for item in sorted(entries.values(), key=lambda entry: (-entry['confidence'], entry['path']))[:160]:
            output = {key: value for key, value in item.items() if key not in ('sources', 'ports') and value is not None}
            output['sourceFiles'] = sorted(item['sources'])[:8]
            if item['ports']:
                output['observedPorts'] = sorted(item['ports'])
            paths.append(output)
        if not paths:
            continue
        families.append({
            'id': f'tmp-device-pack-{vendor}',
            'name': f"{DISPLAY_NAMES.get(vendor, vendor.title())} (TMP Device Pack)",
            'manufacturers': VENDORS[vendor],
            'modelPatterns': [],
            'generic': False,
            'source': 'TMP Device Pack',
            'paths': paths,
        })

    port_rows = [
        {'manufacturer': vendor, 'port': port, 'occurrences': count}
        for (vendor, port), count in ports.most_common()
        if vendor != 'unassigned'
    ]
    return {
        'version': 1,
        'updatedAt': datetime.now(timezone.utc).isoformat(),
        'source': {
            'name': source_name,
            'version': source_version,
            'root': str(root),
        },
        'statistics': {
            'scannedFiles': scanned_files,
            'scannedChunks': scanned_chunks,
            'familyCount': len(families),
            'pathCount': sum(len(family['paths']) for family in families),
        },
        'ports': port_rows[:500],
        'families': families,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description='Analyze an extracted TMP Device Pack source archive')
    parser.add_argument('input', type=Path, help='Extracted device-pack directory')
    parser.add_argument('output', type=Path, help='Output JSON for the additional catalog')
    parser.add_argument('--source-name', default='TMP Device Pack Source')
    parser.add_argument('--source-version')
    args = parser.parse_args()

    root = args.input.expanduser().resolve()
    output = args.output.expanduser().resolve()
    if not root.is_dir():
        parser.error(f'Directory not found: {root}')
    result = analyze(root, args.source_name, args.source_version)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    stats = result['statistics']
    print(f"Catalog written: {output}")
    print(f"Manufacturer families: {stats['familyCount']}; media paths: {stats['pathCount']}; analyzed files: {stats['scannedFiles']}")
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
