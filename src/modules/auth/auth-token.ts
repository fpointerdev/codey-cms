import { createHash, randomBytes } from "node:crypto";

export function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function parseDurationToSeconds(value: string) {
  const match = value.match(/^(\d+)([smhd])$/);
  if (!match) {
    throw new Error(`Invalid duration: ${value}. Use formats like 15m, 24h, 30d.`);
  }

  const amount = Number(match[1]);
  const unit = match[2];
  const multipliers: Record<string, number> = {
    s: 1,
    m: 60,
    h: 60 * 60,
    d: 60 * 60 * 24
  };

  return amount * multipliers[unit];
}

export function addSeconds(seconds: number) {
  return new Date(Date.now() + seconds * 1000);
}

export function createOpaqueToken() {
  return randomBytes(48).toString("base64url");
}
