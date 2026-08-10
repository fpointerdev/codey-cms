import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const base32Alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const recoveryAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function createMfaSecret() {
  return encodeBase32(randomBytes(20));
}

export function createMfaRecoveryCodes(count = 10) {
  return Array.from({ length: count }, () => {
    const bytes = randomBytes(10);
    const value = Array.from(bytes, (byte) => recoveryAlphabet[byte % recoveryAlphabet.length])
      .join("")
      .slice(0, 10);
    return `${value.slice(0, 5)}-${value.slice(5)}`;
  });
}

export function hashMfaRecoveryCode(code: string, key: string) {
  return createHmac("sha256", key)
    .update(normalizeRecoveryCode(code))
    .digest("hex");
}

export function createTotpUri(input: { secret: string; issuer: string; account: string }) {
  const label = `${input.issuer}:${input.account}`;
  const parameters = new URLSearchParams({
    secret: input.secret,
    issuer: input.issuer,
    algorithm: "SHA1",
    digits: "6",
    period: "30"
  });
  return `otpauth://totp/${encodeURIComponent(label)}?${parameters.toString()}`;
}

export function verifyTotpCode(secret: string, code: string, now = Date.now()) {
  const normalized = code.replaceAll(/\s/g, "");
  if (!/^\d{6}$/.test(normalized)) return null;

  const counter = Math.floor(now / 30_000);
  for (const offset of [1, 0, -1]) {
    const candidate = counter + offset;
    if (safeEqual(normalized, hotp(secret, candidate))) return candidate;
  }
  return null;
}

export function createTotpCode(secret: string, now = Date.now()) {
  return hotp(secret, Math.floor(now / 30_000));
}

export function normalizeRecoveryCode(code: string) {
  return code.trim().toUpperCase().replaceAll(/[^A-Z0-9]/g, "");
}

function hotp(secret: string, counter: number) {
  const value = Buffer.alloc(8);
  value.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac("sha1", decodeBase32(secret)).update(value).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary = (
    (digest[offset] & 0x7f) << 24 |
    (digest[offset + 1] & 0xff) << 16 |
    (digest[offset + 2] & 0xff) << 8 |
    digest[offset + 3] & 0xff
  );
  return String(binary % 1_000_000).padStart(6, "0");
}

function encodeBase32(value: Buffer) {
  let bits = 0;
  let bitCount = 0;
  let result = "";

  for (const byte of value) {
    bits = bits << 8 | byte;
    bitCount += 8;
    while (bitCount >= 5) {
      result += base32Alphabet[bits >>> (bitCount - 5) & 31];
      bitCount -= 5;
    }
  }
  if (bitCount > 0) result += base32Alphabet[bits << (5 - bitCount) & 31];
  return result;
}

function decodeBase32(value: string) {
  let bits = 0;
  let bitCount = 0;
  const result = [];

  for (const character of value.toUpperCase().replaceAll("=", "")) {
    const index = base32Alphabet.indexOf(character);
    if (index < 0) throw new Error("Invalid base32 secret.");
    bits = bits << 5 | index;
    bitCount += 5;
    if (bitCount >= 8) {
      result.push(bits >>> (bitCount - 8) & 0xff);
      bitCount -= 8;
    }
  }
  return Buffer.from(result);
}

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}
