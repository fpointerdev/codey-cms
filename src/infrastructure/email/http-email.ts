import type { AppConfig } from "../../config/index.js";
import { AppError } from "../../core/errors/app-error.js";
import type { EmailClient, EmailDeliveryResult, EmailMessage } from "./email.types.js";

export function isEmailDeliveryConfigured(config: AppConfig) {
  return config.email.driver === "http" && Boolean(config.email.from && config.email.httpEndpoint);
}

export function createEmailClient(config: AppConfig): EmailClient {
  if (!isEmailDeliveryConfigured(config)) {
    throw new AppError(503, "email_not_configured", "Transactional email is not configured.");
  }

  return {
    send: (message) => sendHttpEmail(config, message)
  };
}

async function sendHttpEmail(
  config: AppConfig,
  message: EmailMessage
): Promise<EmailDeliveryResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.email.timeoutMs);

  try {
    const response = await fetch(config.email.httpEndpoint!, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(config.email.httpBearerToken
          ? { authorization: `Bearer ${config.email.httpBearerToken}` }
          : {})
      },
      body: JSON.stringify(message),
      signal: controller.signal
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "");
      throw new Error(`Email provider returned ${response.status}: ${errorBody.slice(0, 500)}`);
    }

    const data = (await response.json().catch(() => ({}))) as {
      id?: string;
      messageId?: string;
      providerMessageId?: string;
    };

    return {
      providerMessageId: data.providerMessageId ?? data.messageId ?? data.id
    };
  } finally {
    clearTimeout(timeout);
  }
}
