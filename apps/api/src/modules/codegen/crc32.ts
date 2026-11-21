/**
 * CRC-32 (IEEE 802.3 polynomial 0xEDB88320) — the checksum every ZIP entry needs.
 *
 * Implemented here rather than via `node:zlib`'s `crc32` (added in Node 20.15 but not
 * available on every runtime QATools targets) so the ZIP writer has zero runtime
 * dependencies on any Node version >= 20.
 */

const TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

/** Returns the unsigned CRC-32 of a byte buffer. */
export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = TABLE[(crc ^ bytes[i]!) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** CRC-32 of a UTF-8 string; convenience for tests and callers holding text. */
export function crc32Text(text: string): number {
  return crc32(new TextEncoder().encode(text));
}
