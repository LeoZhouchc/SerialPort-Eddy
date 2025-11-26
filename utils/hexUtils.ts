export const cleanHexString = (input: string): string => {
  return input.replace(/[^0-9A-Fa-f]/g, '').toUpperCase();
};

export const formatHexString = (input: string): string => {
  const cleaned = cleanHexString(input);
  return cleaned.match(/.{1,2}/g)?.join(' ') || '';
};

export const hexToUint8Array = (hexString: string): Uint8Array => {
  const cleaned = cleanHexString(hexString);
  if (cleaned.length % 2 !== 0) {
    throw new Error('Invalid hex string length');
  }
  const array = new Uint8Array(cleaned.length / 2);
  for (let i = 0; i < cleaned.length; i += 2) {
    array[i / 2] = parseInt(cleaned.substring(i, i + 2), 16);
  }
  return array;
};

export const uint8ArrayToHex = (buffer: Uint8Array): string => {
  return Array.from(buffer)
    .map((b) => b.toString(16).padStart(2, '0').toUpperCase())
    .join(' ');
};

export const bytesToDecimal = (highByte: number, lowByte: number): number => {
  return (highByte << 8) | lowByte;
};

export const decimalToBytes = (value: number): [number, number] => {
  const high = (value >> 8) & 0xFF;
  const low = value & 0xFF;
  return [high, low];
};