export type EmailMessage = {
  to: string;
  from: string;
  subject: string;
  text: string;
  html?: string;
  metadata?: Record<string, unknown>;
};

export type EmailProvider = "generic" | "resend" | "postmark" | "smtp";

export type SmtpSecurity = "starttls" | "tls";

export type EmailDeliveryResult = {
  providerMessageId?: string;
};

export type EmailDeliveryConfig = {
  driver: "disabled" | "http" | "smtp";
  provider?: EmailProvider;
  from?: string;
  httpEndpoint?: string;
  httpBearerToken?: string;
  smtpHost?: string;
  smtpPort?: number;
  smtpSecurity?: SmtpSecurity;
  smtpUsername?: string;
  smtpPassword?: string;
  credentialsRequired?: boolean;
  protectInternalEndpoints?: boolean;
  timeoutMs: number;
};

export type EmailClient = {
  send(message: EmailMessage): Promise<EmailDeliveryResult>;
};
