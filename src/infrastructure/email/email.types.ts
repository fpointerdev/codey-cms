export type EmailMessage = {
  to: string;
  from: string;
  subject: string;
  text: string;
  html?: string;
  metadata?: Record<string, unknown>;
};

export type EmailDeliveryResult = {
  providerMessageId?: string;
};

export type EmailDeliveryConfig = {
  driver: "disabled" | "http";
  from?: string;
  httpEndpoint?: string;
  httpBearerToken?: string;
  timeoutMs: number;
};

export type EmailClient = {
  send(message: EmailMessage): Promise<EmailDeliveryResult>;
};
