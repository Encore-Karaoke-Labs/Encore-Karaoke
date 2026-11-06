import fs from "node:fs";

// Pre-compute CRC32 table for maximum performance
const crcTable = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let j = 0; j < 8; j++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  crcTable[i] = c >>> 0;
}

// Memory-safe chunked CRC32 stream calculator
export function calculateFileCRC32(filePath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const stream = fs.createReadStream(filePath);
    let crc = 0 ^ -1;

    stream.on("data", (chunk: Buffer | string) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      for (let i = 0; i < buffer.length; i++) {
        crc = (crc >>> 8) ^ crcTable[(crc ^ buffer[i]) & 0xff];
      }
    });

    stream.on("end", () => {
      resolve((crc ^ -1) >>> 0);
    });

    stream.on("error", reject);
  });
}
