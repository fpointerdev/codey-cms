import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes
} from "node:crypto";
import { AppError } from "../../core/errors/app-error.js";

export type PaymentProviderCredentials = {
  secretKey?: string;
  webhookSecret?: string;
  clientSecret?: string;
};

const envelopeVersion = "v1";

function encryptionKey(secret: string) {
  return createHash("sha256").update(secret, "utf8").digest();
}

export function encryptPaymentCredentials(
  encryptionSecret: string,
  credentials: PaymentProviderCredentials
) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(encryptionSecret), iv);
  const plaintext = Buffer.from(JSON.stringify(credentials), "utf8");
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return [
    envelopeVersion,
    iv.toString("base64url"),
    authTag.toString("base64url"),
    encrypted.toString("base64url")
  ].join(".");
}

export function decryptPaymentCredentials(
  encryptionSecret: string,
  envelope?: string | null
): PaymentProviderCredentials {
  if (!envelope) return {};

  try {
    const [version, ivValue, authTagValue, encryptedValue] = envelope.split(".");
    if (version !== envelopeVersion || !ivValue || !authTagValue || !encryptedValue) {
      throw new Error("Invalid credential envelope");
    }

    const decipher = createDecipheriv(
      "aes-256-gcm",
      encryptionKey(encryptionSecret),
      Buffer.from(ivValue, "base64url")
    );
    decipher.setAuthTag(Buffer.from(authTagValue, "base64url"));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(encryptedValue, "base64url")),
      decipher.final()
    ]);
    const credentials = JSON.parse(plaintext.toString("utf8")) as unknown;

    if (!credentials || typeof credentials !== "object" || Array.isArray(credentials)) {
      throw new Error("Invalid credential payload");
    }

    return credentials as PaymentProviderCredentials;
  } catch {
    throw new AppError(
      500,
      "payment_credentials_unavailable",
      "Stored payment credentials could not be decrypted. Check the CMS credential encryption key."
    );
  }
}
