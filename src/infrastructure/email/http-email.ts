import type { AppConfig } from "../../config/index.js";
import { AppError } from "../../core/errors/app-error.js";
import type {
  EmailClient,
  EmailDeliveryConfig,
  EmailDeliveryResult,
  EmailMessage,
  EmailProvider
} from "./email.types.js";

const providerEndpoints: Record<Exclude<EmailProvider, "generic">, string> = {
  resend: "https://api.resend.com/emails",
  postmark: "https://api.postmarkapp.com/email"
};

function provider(config: EmailDeliveryConfig) {
  return config.provider || "generic";
}

export function emailProviderEndpoint(config: EmailDeliveryConfig) {
  const selectedProvider = provider(config);
  return selectedProvider === "generic" ? config.httpEndpoint : providerEndpoints[selectedProvider];
}

function deliveryConfig(config: AppConfig | EmailDeliveryConfig): EmailDeliveryConfig {
  return "email" in config ? config.email : config;
}

export function isEmailDeliveryConfigured(config: AppConfig | EmailDeliveryConfig) {
  const email = deliveryConfig(config);
  const selectedProvider = provider(email);

  return email.driver === "http" && Boolean(
    email.from &&
    emailProviderEndpoint(email) &&
    (selectedProvider === "generic" || email.httpBearerToken)
  );
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
    const selectedProvider = provider(config);
    const response = await fetch(emailProviderEndpoint(config)!, {
      method: "POST",
      headers: requestHeaders(selectedProvider, config.httpBearerToken),
      body: JSON.stringify(requestBody(selectedProvider, message)),
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
      MessageID?: string;
    };

    return {
      providerMessageId: data.providerMessageId ?? data.messageId ?? data.id ?? data.MessageID
    };
  } finally {
    clearTimeout(timeout);
  }
}

function requestHeaders(provider: EmailProvider, credential?: string): Record<string, string> {
  if (provider === "postmark") {
    return {
      "content-type": "application/json",
      "x-postmark-server-token": credential!
    };
  }

  const headers: Record<string, string> = { "content-type": "application/json" };
  if (credential) headers.authorization = `Bearer ${credential}`;
  return headers;
}

function requestBody(provider: EmailProvider, message: EmailMessage) {
  if (provider === "resend") {
    return {
      from: message.from,
      to: [message.to],
      subject: message.subject,
      text: message.text,
      html: message.html
    };
  }

  if (provider === "postmark") {
    return {
      From: message.from,
      To: message.to,
      Subject: message.subject,
      TextBody: message.text,
      HtmlBody: message.html,
      MessageStream: "outbound",
      Metadata: message.metadata
    };
  }

  return message;
}
