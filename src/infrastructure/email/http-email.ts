import type { AppConfig } from "../../config/index.js";
import { AppError } from "../../core/errors/app-error.js";
import type {
  EmailClient,
  EmailDeliveryConfig,
  EmailDeliveryResult,
  EmailMessage
} from "./email.types.js";

function deliveryConfig(config: AppConfig | EmailDeliveryConfig): EmailDeliveryConfig {
  return "email" in config ? config.email : config;
}

export function isEmailDeliveryConfigured(config: AppConfig | EmailDeliveryConfig) {
  const email = deliveryConfig(config);
  return email.driver === "http" && Boolean(email.from && email.httpEndpoint);
}

export function createEmailClient(config: AppConfig | EmailDeliveryConfig): EmailClient {
  if (!isEmailDeliveryConfigured(config)) {
    throw new AppError(503, "email_not_configured", "Transactional email is not configured.");
  }

  const email = deliveryConfig(config);

  return {
    send: (message) => sendHttpEmail(email, message)
  };
}

async function sendHttpEmail(
  config: EmailDeliveryConfig,
  message: EmailMessage
): Promise<EmailDeliveryResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);

  try {
    const response = await fetch(config.httpEndpoint!, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(config.httpBearerToken
          ? { authorization: `Bearer ${config.httpBearerToken}` }
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
