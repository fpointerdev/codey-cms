import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes
} from "node:crypto";

const envelopeVersion = "v1";

function encryptionKey(secret: string) {
  return createHash("sha256").update(secret, "utf8").digest();
}

export function encryptSecretEnvelope(secret: string, value: unknown) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(secret), iv);
  const plaintext = Buffer.from(JSON.stringify(value), "utf8");
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return [
    envelopeVersion,
    iv.toString("base64url"),
    authTag.toString("base64url"),
    encrypted.toString("base64url")
  ].join(".");
}

export function decryptSecretEnvelope<T>(secret: string, envelope: string): T {
  const [version, ivValue, authTagValue, encryptedValue] = envelope.split(".");
  if (version !== envelopeVersion || !ivValue || !authTagValue || !encryptedValue) {
    throw new Error("Invalid credential envelope");
  }

  const decipher = createDecipheriv(
    "aes-256-gcm",
    encryptionKey(secret),
    Buffer.from(ivValue, "base64url")
  );
  decipher.setAuthTag(Buffer.from(authTagValue, "base64url"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(encryptedValue, "base64url")),
    decipher.final()
  ]);

  return JSON.parse(plaintext.toString("utf8")) as T;
}
