/**
 * Minimal, dependency-free ZIP writer (STORE method).
 *
 * ARCHITECTURE.md §11.3 rule 1 forbids a new npm dependency, so this hand-rolls the
 * three structures a ZIP reader needs:
 *
 *   - one **local file header** per entry          (`PK\x03\x04`)
 *   - a **central directory** of entries           (`PK\x01\x02`)
 *   - the **end of central directory** record      (`PK\x05\x06`)
 *
 * Compression method 0 (stored) is used deliberately: every generated file is text
 * that is already small, deflate would need `zlib` plumbing, and stored entries can be
 * extracted by every ZIP implementation including Windows Explorer's built-in one.
 *
 * Timestamps are normalised to `1980-01-01 00:00:00` (the DOS epoch) so repeated
 * generations of the same project produce **byte-identical** ZIPs — handy in tests.
 */

import { crc32 } from './crc32.js';

export interface ZipEntry {
  /** Path inside the archive. Forward slashes only; no leading slash. */
  path: string;
  content: string;
}

/* --------------------------- byte assembly helpers --------------------------- */

class ByteWriter {
  private chunks: Uint8Array[] = [];
  private length = 0;

  get size(): number {
    return this.length;
  }

  push(bytes: Uint8Array): void {
    this.chunks.push(bytes);
    this.length += bytes.length;
  }

  u16(value: number): void {
    const b = new Uint8Array(2);
    b[0] = value & 0xff;
    b[1] = (value >>> 8) & 0xff;
    this.push(b);
  }

  u32(value: number): void {
    const b = new Uint8Array(4);
    // `>>> 0` keeps the value unsigned; bit-shifts on 32-bit are fine for ZIP fields.
    const v = value >>> 0;
    b[0] = v & 0xff;
    b[1] = (v >>> 8) & 0xff;
    b[2] = (v >>> 16) & 0xff;
    b[3] = (v >>> 24) & 0xff;
    this.push(b);
  }

  bytes(value: Uint8Array): void {
    this.push(value);
  }

  toUint8Array(): Uint8Array {
    const out = new Uint8Array(this.length);
    let offset = 0;
    for (const chunk of this.chunks) {
      out.set(chunk, offset);
      offset += chunk.length;
    }
    return out;
  }
}

const encoder = new TextEncoder();

function utf8(text: string): Uint8Array {
  return encoder.encode(text);
}

const DOS_TIME = 0; // 00:00:00
const DOS_DATE = 33; // 1980-01-01  (year 0, month 1, day 1)

/** Bit 11 = the filename (and comment) are UTF-8. */
const FLAG_UTF8 = 0x0800;
const METHOD_STORE = 0;

/**
 * Normalises an entry path: forward slashes, no leading slash, and `..` segments
 * resolved the way a filesystem would (`a/../b` → `b`), so two entries that point at
 * the same file collapse instead of producing an archive Windows refuses to open.
 */
export function normaliseEntryPath(raw: string): string {
  const out: string[] = [];
  for (const segment of String(raw ?? '')
    .replace(/\\/g, '/')
    .split('/')) {
    const part = segment.trim();
    if (part === '' || part === '.') continue;
    if (part === '..') {
      // Walking above the archive root is a traversal attempt: clamp at the root.
      out.pop();
      continue;
    }
    out.push(part);
  }
  return out.join('/');
}

/**
 * Builds a ZIP archive from text entries.
 * Duplicate paths are collapsed (last write wins) so a generator mistake cannot
 * produce an archive that Windows refuses to open.
 */
export function createZip(entries: ZipEntry[]): Uint8Array {
  const seen = new Map<string, ZipEntry>();
  for (const entry of entries) {
    const path = normaliseEntryPath(entry.path);
    if (!path) continue;
    seen.set(path, { path, content: typeof entry.content === 'string' ? entry.content : '' });
  }

  const unique = [...seen.values()].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

  const out = new ByteWriter();
  const central: Array<{ name: Uint8Array; crc: number; size: number; offset: number }> = [];

  for (const entry of unique) {
    const name = utf8(entry.path);
    const data = utf8(entry.content);
    const crc = crc32(data);
    const offset = out.size;

    // ---- local file header ----
    out.u32(0x04034b50); // signature "PK\x03\x04"
    out.u16(20); // version needed to extract (2.0 — stored + UTF-8 flag)
    out.u16(FLAG_UTF8);
    out.u16(METHOD_STORE);
    out.u16(DOS_TIME);
    out.u16(DOS_DATE);
    out.u32(crc);
    out.u32(data.length); // compressed size == uncompressed for STORE
    out.u32(data.length);
    out.u16(name.length);
    out.u16(0); // extra field length
    out.bytes(name);
    out.bytes(data);

    central.push({ name, crc, size: data.length, offset });
  }

  // ---- central directory ----
  const centralStart = out.size;
  for (const entry of central) {
    out.u32(0x02014b50); // signature "PK\x01\x02"
    out.u16(20); // version made by
    out.u16(20); // version needed to extract
    out.u16(FLAG_UTF8);
    out.u16(METHOD_STORE);
    out.u16(DOS_TIME);
    out.u16(DOS_DATE);
    out.u32(entry.crc);
    out.u32(entry.size);
    out.u32(entry.size);
    out.u16(entry.name.length);
    out.u16(0); // extra field length
    out.u16(0); // file comment length
    out.u16(0); // disk number start
    out.u16(0); // internal attributes
    out.u32(0); // external attributes
    out.u32(entry.offset);
    out.bytes(entry.name);
  }
  const centralSize = out.size - centralStart;

  // ---- end of central directory ----
  out.u32(0x06054b50); // signature "PK\x05\x06"
  out.u16(0); // this disk
  out.u16(0); // disk with central directory
  out.u16(central.length); // entries on this disk
  out.u16(central.length); // total entries
  out.u32(centralSize);
  out.u32(centralStart);
  out.u16(0); // comment length

  return out.toUint8Array();
}

/** Number of entries a ZIP produced by `createZip` contains (from its EOCD). */
export function zipEntryCount(zip: Uint8Array): number {
  for (let i = zip.length - 22; i >= 0; i--) {
    if (zip[i] === 0x50 && zip[i + 1] === 0x4b && zip[i + 2] === 0x05 && zip[i + 3] === 0x06) {
      return zip[i + 10]! | (zip[i + 11]! << 8);
    }
  }
  return 0;
}

/** Lists entry paths from a ZIP's central directory without decompressing. */
export function zipEntryPaths(zip: Uint8Array): string[] {
  const paths: string[] = [];
  const decoder = new TextDecoder();
  let i = 0;
  while (i + 4 <= zip.length) {
    const sig =
      (zip[i]! | (zip[i + 1]! << 8) | (zip[i + 2]! << 16) | (zip[i + 3]! << 24)) >>> 0;
    if (sig !== 0x02014b50) {
      i++;
      continue;
    }
    const view = new DataView(zip.buffer, zip.byteOffset + i, 46);
    const nameLen = view.getUint16(28, true);
    const extraLen = view.getUint16(30, true);
    const commentLen = view.getUint16(32, true);
    const nameStart = i + 46;
    paths.push(decoder.decode(zip.subarray(nameStart, nameStart + nameLen)));
    i = nameStart + nameLen + extraLen + commentLen;
  }
  return paths;
}
