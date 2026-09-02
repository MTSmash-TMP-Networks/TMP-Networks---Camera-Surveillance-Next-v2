import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { once } from 'node:events';

const MAX_U16 = 0xffff;
const MAX_U32 = 0xffffffff;
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let crc = i;
    for (let j = 0; j < 8; j += 1) crc = (crc & 1) ? (0xedb88320 ^ (crc >>> 1)) : (crc >>> 1);
    table[i] = crc >>> 0;
  }
  return table;
})();

function updateCrc(crc, chunk) {
  let current = crc >>> 0;
  for (const byte of chunk) current = CRC_TABLE[(current ^ byte) & 0xff] ^ (current >>> 8);
  return current >>> 0;
}

function finishCrc(crc) { return (crc ^ MAX_U32) >>> 0; }
function needsZip64(value) { return Number(value) > MAX_U32; }
function writeU64(buffer, value, offset) { buffer.writeBigUInt64LE(BigInt(value), offset); }

function zip64Extra(values) {
  const payload = Buffer.alloc(values.length * 8);
  values.forEach((value, index) => writeU64(payload, value, index * 8));
  const header = Buffer.alloc(4);
  header.writeUInt16LE(0x0001, 0);
  header.writeUInt16LE(payload.length, 2);
  return Buffer.concat([header, payload]);
}

function dosDateTime(date = new Date()) {
  const year = Math.max(1980, date.getFullYear());
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const day = (date.getDate()) | ((date.getMonth() + 1) << 5) | ((year - 1980) << 9);
  return { time, day };
}

function encodeName(name) {
  const normalized = String(name || '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (!normalized || normalized.includes('..')) throw new Error('Ungueltiger ZIP-Eintragsname');
  return Buffer.from(normalized, 'utf8');
}

async function statBuffer(buffer) {
  const data = Buffer.isBuffer(buffer) ? buffer : Buffer.from(String(buffer ?? ''), 'utf8');
  const hash = crypto.createHash('sha256').update(data).digest('hex');
  return { size: data.length, crc32: finishCrc(updateCrc(0xffffffff, data)), sha256: hash, buffer: data };
}

async function statFile(filePath) {
  const stat = await fs.promises.stat(filePath);
  const hash = crypto.createHash('sha256');
  let crc = 0xffffffff;
  const input = fs.createReadStream(filePath);
  input.on('data', (chunk) => { hash.update(chunk); crc = updateCrc(crc, chunk); });
  await once(input, 'end');
  return { size: stat.size, crc32: finishCrc(crc), sha256: hash.digest('hex') };
}

function localHeader(nameBuffer, entry) {
  const { time, day } = dosDateTime(entry.modifiedAt || new Date());
  const entryZip64 = needsZip64(entry.size);
  const extra = entryZip64 ? zip64Extra([entry.size, entry.size]) : Buffer.alloc(0);
  const buffer = Buffer.alloc(30 + nameBuffer.length + extra.length);
  buffer.writeUInt32LE(0x04034b50, 0);
  buffer.writeUInt16LE(entryZip64 ? 45 : 20, 4);
  buffer.writeUInt16LE(0x0800, 6);
  buffer.writeUInt16LE(0, 8);
  buffer.writeUInt16LE(time, 10);
  buffer.writeUInt16LE(day, 12);
  buffer.writeUInt32LE(entry.crc32 >>> 0, 14);
  buffer.writeUInt32LE(entryZip64 ? MAX_U32 : entry.size, 18);
  buffer.writeUInt32LE(entryZip64 ? MAX_U32 : entry.size, 22);
  buffer.writeUInt16LE(nameBuffer.length, 26);
  buffer.writeUInt16LE(extra.length, 28);
  nameBuffer.copy(buffer, 30);
  extra.copy(buffer, 30 + nameBuffer.length);
  return buffer;
}

function centralHeader(nameBuffer, entry, offset) {
  const { time, day } = dosDateTime(entry.modifiedAt || new Date());
  const entryZip64 = needsZip64(entry.size) || needsZip64(offset);
  const extra = entryZip64 ? zip64Extra([entry.size, entry.size, offset]) : Buffer.alloc(0);
  const buffer = Buffer.alloc(46 + nameBuffer.length + extra.length);
  buffer.writeUInt32LE(0x02014b50, 0);
  buffer.writeUInt16LE(0x031e, 4);
  buffer.writeUInt16LE(entryZip64 ? 45 : 20, 6);
  buffer.writeUInt16LE(0x0800, 8);
  buffer.writeUInt16LE(0, 10);
  buffer.writeUInt16LE(time, 12);
  buffer.writeUInt16LE(day, 14);
  buffer.writeUInt32LE(entry.crc32 >>> 0, 16);
  buffer.writeUInt32LE(entryZip64 ? MAX_U32 : entry.size, 20);
  buffer.writeUInt32LE(entryZip64 ? MAX_U32 : entry.size, 24);
  buffer.writeUInt16LE(nameBuffer.length, 28);
  buffer.writeUInt16LE(extra.length, 30);
  buffer.writeUInt16LE(0, 32);
  buffer.writeUInt16LE(0, 34);
  buffer.writeUInt16LE(0, 36);
  buffer.writeUInt32LE(0, 38);
  buffer.writeUInt32LE(entryZip64 ? MAX_U32 : offset, 42);
  nameBuffer.copy(buffer, 46);
  extra.copy(buffer, 46 + nameBuffer.length);
  return buffer;
}

function endRecord(entryCount, centralSize, centralOffset, zip64EndOffset, useZip64) {
  const parts = [];
  if (useZip64) {
    const zip64 = Buffer.alloc(56);
    zip64.writeUInt32LE(0x06064b50, 0);
    writeU64(zip64, 44, 4);
    zip64.writeUInt16LE(45, 12);
    zip64.writeUInt16LE(45, 14);
    zip64.writeUInt32LE(0, 16);
    zip64.writeUInt32LE(0, 20);
    writeU64(zip64, entryCount, 24);
    writeU64(zip64, entryCount, 32);
    writeU64(zip64, centralSize, 40);
    writeU64(zip64, centralOffset, 48);
    parts.push(zip64);
    const locator = Buffer.alloc(20);
    locator.writeUInt32LE(0x07064b50, 0);
    locator.writeUInt32LE(0, 4);
    writeU64(locator, zip64EndOffset, 8);
    locator.writeUInt32LE(1, 16);
    parts.push(locator);
  }
  const buffer = Buffer.alloc(22);
  buffer.writeUInt32LE(0x06054b50, 0);
  buffer.writeUInt16LE(0, 4);
  buffer.writeUInt16LE(0, 6);
  buffer.writeUInt16LE(useZip64 || entryCount > MAX_U16 ? MAX_U16 : entryCount, 8);
  buffer.writeUInt16LE(useZip64 || entryCount > MAX_U16 ? MAX_U16 : entryCount, 10);
  buffer.writeUInt32LE(useZip64 || needsZip64(centralSize) ? MAX_U32 : centralSize, 12);
  buffer.writeUInt32LE(useZip64 || needsZip64(centralOffset) ? MAX_U32 : centralOffset, 16);
  buffer.writeUInt16LE(0, 20);
  parts.push(buffer);
  return Buffer.concat(parts);
}

async function writeBuffer(output, buffer) { if (!output.write(buffer)) await once(output, 'drain'); }
async function writeFile(output, filePath) { const input = fs.createReadStream(filePath); for await (const chunk of input) await writeBuffer(output, chunk); }

export async function describeZipEntry(entry) {
  const nameBuffer = encodeName(entry.name);
  const kind = entry.buffer !== undefined ? 'buffer' : 'file';
  const stats = kind === 'buffer' ? await statBuffer(entry.buffer) : await statFile(entry.filePath);
  return { ...entry, ...stats, kind, nameBuffer };
}

export async function createStoredZip(entries, outputPath) {
  const prepared = [];
  for (const entry of entries) prepared.push(entry.nameBuffer ? entry : await describeZipEntry(entry));
  await fs.promises.mkdir(path.dirname(outputPath), { recursive: true });
  const output = fs.createWriteStream(outputPath, { flags: 'w', mode: 0o600 });
  const written = { bytes: 0 };
  const central = [];
  let requiresZip64 = prepared.length > MAX_U16;
  for (const entry of prepared) {
    const offset = written.bytes;
    if (needsZip64(entry.size) || needsZip64(offset)) requiresZip64 = true;
    const local = localHeader(entry.nameBuffer, entry);
    await writeBuffer(output, local); written.bytes += local.length;
    if (entry.kind === 'buffer') { await writeBuffer(output, entry.buffer); written.bytes += entry.buffer.length; }
    else { await writeFile(output, entry.filePath); written.bytes += entry.size; }
    central.push(centralHeader(entry.nameBuffer, entry, offset));
  }
  const centralOffset = written.bytes;
  let centralSize = 0;
  for (const header of central) { await writeBuffer(output, header); centralSize += header.length; }
  if (needsZip64(centralOffset) || needsZip64(centralSize)) requiresZip64 = true;
  const zip64EndOffset = centralOffset + centralSize;
  const end = endRecord(prepared.length, centralSize, centralOffset, zip64EndOffset, requiresZip64);
  await writeBuffer(output, end);
  output.end();
  await once(output, 'finish');
  return { outputPath, entryCount: prepared.length, sizeBytes: (await fs.promises.stat(outputPath)).size, zip64: requiresZip64, entries: prepared.map((entry) => ({ name: entry.name, sizeBytes: entry.size, sha256: entry.sha256, crc32: entry.crc32.toString(16).padStart(8, '0') })) };
}
