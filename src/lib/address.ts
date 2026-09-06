const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function decodeBase58(input: string): Uint8Array {
  const bytes: number[] = [0];
  for (const char of input) {
    const value = BASE58.indexOf(char);
    if (value < 0) throw new Error("invalid base58");
    let carry = value;
    for (let i = 0; i < bytes.length; i += 1) {
      const n = bytes[i]! * 58 + carry;
      bytes[i] = n & 0xff;
      carry = n >> 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  let leading = 0;
  for (const char of input) {
    if (char !== "1") break;
    leading += 1;
  }
  const out = new Uint8Array(leading + bytes.length);
  for (let i = 0; i < bytes.length; i += 1) {
    out[out.length - 1 - i] = bytes[i]!;
  }
  return out;
}

export function isSolanaAddress(input: string): boolean {
  const s = input.trim();
  if (s.length < 32 || s.length > 44) return false;
  for (const char of s) {
    if (!BASE58.includes(char)) return false;
  }
  try {
    return decodeBase58(s).length === 32;
  } catch {
    return false;
  }
}
