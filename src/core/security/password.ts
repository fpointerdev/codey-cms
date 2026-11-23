import bcrypt from "bcryptjs";
import { z } from "zod";

const SALT_ROUNDS = 12;

export function newPasswordSchema(minimumLength = 8) {
  return z.string().min(minimumLength).max(128).refine(
    (password) => Buffer.byteLength(password, "utf8") <= 72,
    "Password is too long. Use fewer characters (maximum 72 UTF-8 bytes)."
  );
}

export function hashPassword(password: string) {
  newPasswordSchema().parse(password);
  return bcrypt.hash(password, SALT_ROUNDS);
}

export function verifyPassword(password: string, passwordHash: string) {
  return bcrypt.compare(password, passwordHash);
}
