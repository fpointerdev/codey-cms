export type EmailMessage = {
  to: string;
  from: string;
  subject: string;
  text: string;
  html?: string;
  metadata?: Record<string, unknown>;
};

export type EmailProvider = "generic" | "resend" | "postmark";

export type EmailDeliveryResult = {
  providerMessageId?: string;
};

export type EmailDeliveryConfig = {
  driver: "disabled" | "http";
  provider?: EmailProvider;
  from?: string;
  httpEndpoint?: string;
  httpBearerToken?: string;
  credentialsRequired?: boolean;
  protectInternalEndpoints?: boolean;
  timeoutMs: number;
};

export type EmailClient = {
  send(message: EmailMessage): Promise<EmailDeliveryResult>;
};
