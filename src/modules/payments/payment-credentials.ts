import { AppError } from "../../core/errors/app-error.js";
import { decryptSecretEnvelope, encryptSecretEnvelope } from "../../core/security/secret-envelope.js";

export type PaymentProviderCredentials = {
  secretKey?: string;
  webhookSecret?: string;
  clientSecret?: string;
};

export function encryptPaymentCredentials(
  encryptionSecret: string,
  credentials: PaymentProviderCredentials
) {
  return encryptSecretEnvelope(encryptionSecret, credentials);
}

export function decryptPaymentCredentials(
  encryptionSecret: string,
  envelope?: string | null
): PaymentProviderCredentials {
  if (!envelope) return {};

  try {
    const credentials = decryptSecretEnvelope<unknown>(encryptionSecret, envelope);

    if (!credentials || typeof credentials !== "object" || Array.isArray(credentials)) {
      throw new Error("Invalid credential payload");
    }

    return credentials;
  } catch {
    throw new AppError(
      500,
      "payment_credentials_unavailable",
      "Stored payment credentials could not be decrypted. Check the CMS credential encryption key."
    );
  }
}
