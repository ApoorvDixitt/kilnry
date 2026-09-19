// Kilnry — https://github.com/ApoorvDixitt/kilnry
// Copyright (c) 2026 Apoorv Dixit. Licensed under the Sustainable Use License 1.0.
// SPDX-License-Identifier: LicenseRef-Sustainable-Use-1.0
// See LICENSE.md in the repository root. You may not remove or obscure this notice.

import { KilnryError } from '../errors.js';

const alphabet = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
const reverse = new Map([...alphabet].map((character, index) => [character, index]));
const bech32mConstant = 0x2bc830a3;

function polymod(values: number[]): number {
  const generators = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  let checksum = 1;
  for (const value of values) {
    const top = checksum >>> 25;
    checksum = ((checksum & 0x1ffffff) << 5) ^ value;
    for (let index = 0; index < generators.length; index += 1) {
      if ((top >>> index) & 1) checksum ^= generators[index]!;
    }
  }
  return checksum >>> 0;
}

function expandHrp(hrp: string): number[] {
  return [...hrp]
    .map((character) => character.charCodeAt(0) >>> 5)
    .concat(0, ...[...hrp].map((character) => character.charCodeAt(0) & 31));
}

function checksum(hrp: string, data: number[]): number[] {
  const value = polymod([...expandHrp(hrp), ...data, 0, 0, 0, 0, 0, 0]) ^ bech32mConstant;
  return Array.from({ length: 6 }, (_, index) => (value >>> (5 * (5 - index))) & 31);
}

function convertBits(values: Iterable<number>, from: number, to: number, pad: boolean): number[] {
  let accumulator = 0;
  let bits = 0;
  const result: number[] = [];
  const maxValue = (1 << to) - 1;
  for (const value of values) {
    if (value < 0 || value >>> from !== 0)
      throw new KilnryError('INVALID_INPUT', 'Recovery kit has invalid data.');
    accumulator = (accumulator << from) | value;
    bits += from;
    while (bits >= to) {
      bits -= to;
      result.push((accumulator >>> bits) & maxValue);
    }
  }
  if (pad && bits > 0) result.push((accumulator << (to - bits)) & maxValue);
  if (!pad && (bits >= from || ((accumulator << (to - bits)) & maxValue) !== 0)) {
    throw new KilnryError('INVALID_INPUT', 'Recovery kit has invalid padding.');
  }
  return result;
}

export function encodeRecoveryKit(kek: Uint8Array): string {
  if (kek.length !== 32) throw new Error('Recovery kits require a 32-byte key.');
  const hrp = 'kilnry';
  const data = convertBits([1, ...kek], 8, 5, true);
  const encoded = `${hrp}1${[...data, ...checksum(hrp, data)].map((value) => alphabet[value]).join('')}`;
  return encoded;
}

export function decodeRecoveryKit(input: string): Uint8Array {
  const value = input.toLowerCase().replace(/[\s-]/g, '');
  if (value !== input.replace(/[\s-]/g, '').toLowerCase()) {
    throw new KilnryError('INVALID_INPUT', 'Recovery kit must not mix upper- and lower-case characters.');
  }
  const separator = value.lastIndexOf('1');
  if (separator < 1 || value.slice(0, separator) !== 'kilnry') {
    throw new KilnryError('INVALID_INPUT', 'Recovery kit must start with kilnry1.');
  }
  const encoded = value.slice(separator + 1);
  if (encoded.length < 7) throw new KilnryError('INVALID_INPUT', 'Recovery kit is incomplete.');
  const values = [...encoded].map((character) => {
    const decoded = reverse.get(character);
    if (decoded === undefined)
      throw new KilnryError('INVALID_INPUT', 'Recovery kit contains an invalid character.');
    return decoded;
  });
  if (polymod([...expandHrp('kilnry'), ...values]) !== bech32mConstant) {
    throw new KilnryError('INVALID_INPUT', 'Recovery kit checksum does not match.');
  }
  const payload = Uint8Array.from(convertBits(values.slice(0, -6), 5, 8, false));
  if (payload.length !== 33 || payload[0] !== 1) {
    throw new KilnryError('INVALID_INPUT', 'Recovery kit version is not supported.');
  }
  return payload.slice(1);
}

export function formatRecoveryKit(kit: string): string {
  const prefix = kit.slice(0, 7);
  const rest =
    kit
      .slice(7)
      .match(/.{1,4}/g)
      ?.join(' ') ?? '';
  return `${prefix} ${rest}`.trim();
}
