// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

interface Chunk {
  type: string;
  data: Buffer;
}

const crcTable = Array.from({ length: 256 }, (_, initial) => {
  let value = initial;
  for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});

function crc32(value: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of value) crc = crcTable[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function parse(bytes: Uint8Array): Chunk[] {
  const value = Buffer.from(bytes);
  if (!value.subarray(0, 8).equals(signature)) throw new Error('Not a PNG file.');
  const chunks: Chunk[] = [];
  let offset = 8;
  while (offset + 12 <= value.length) {
    const length = value.readUInt32BE(offset);
    const end = offset + 12 + length;
    if (end > value.length) throw new Error('PNG chunk extends past the end of the file.');
    const type = value.subarray(offset + 4, offset + 8).toString('ascii');
    chunks.push({ type, data: value.subarray(offset + 8, offset + 8 + length) });
    offset = end;
    if (type === 'IEND') break;
  }
  if (chunks.at(-1)?.type !== 'IEND') throw new Error('PNG is missing its IEND chunk.');
  return chunks;
}

function encodeChunk(chunk: Chunk): Buffer {
  const type = Buffer.from(chunk.type, 'ascii');
  const output = Buffer.alloc(chunk.data.length + 12);
  output.writeUInt32BE(chunk.data.length, 0);
  type.copy(output, 4);
  chunk.data.copy(output, 8);
  output.writeUInt32BE(crc32(Buffer.concat([type, chunk.data])), output.length - 4);
  return output;
}

function keyword(chunk: Chunk): string | undefined {
  if (!['iTXt', 'tEXt', 'zTXt'].includes(chunk.type)) return undefined;
  const end = chunk.data.indexOf(0);
  return chunk.data.subarray(0, end < 0 ? chunk.data.length : end).toString('latin1');
}

export function writePngMetadata(bytes: Uint8Array, payload: unknown, parameters?: string): Uint8Array {
  const chunks = parse(bytes).filter((chunk) => !['kilnry', 'parameters'].includes(keyword(chunk) ?? ''));
  const body = Buffer.from(JSON.stringify(payload), 'utf8');
  if (body.byteLength > 65_536) throw new Error('Kilnry PNG metadata exceeds 64 KiB.');
  const metadata: Chunk[] = [
    {
      type: 'iTXt',
      data: Buffer.concat([Buffer.from('kilnry\0', 'latin1'), Buffer.from([0, 0, 0, 0]), body]),
    },
    ...(parameters
      ? [
          {
            type: 'tEXt',
            data: Buffer.concat([Buffer.from('parameters\0', 'latin1'), Buffer.from(parameters, 'utf8')]),
          },
        ]
      : []),
  ];
  const end = chunks.findIndex((chunk) => chunk.type === 'IEND');
  chunks.splice(end, 0, ...metadata);
  return Buffer.concat([signature, ...chunks.map(encodeChunk)]);
}

export function readPngMetadata(bytes: Uint8Array): { payload?: unknown; parameters?: string } {
  const output: { payload?: unknown; parameters?: string } = {};
  for (const chunk of parse(bytes)) {
    const name = keyword(chunk);
    if (chunk.type === 'iTXt' && name === 'kilnry') {
      const first = chunk.data.indexOf(0);
      const textStart = first + 5;
      try {
        output.payload = JSON.parse(chunk.data.subarray(textStart).toString('utf8')) as unknown;
      } catch (error) {
        throw new Error('Kilnry PNG metadata contains invalid JSON.', { cause: error });
      }
    }
    if (chunk.type === 'tEXt' && name === 'parameters') {
      const first = chunk.data.indexOf(0);
      output.parameters = chunk.data.subarray(first + 1).toString('utf8');
    }
  }
  return output;
}
