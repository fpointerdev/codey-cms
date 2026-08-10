import type { Prisma, PrismaClient } from "@prisma/client";
import type { AppConfig } from "../../config/index.js";
import { AppError } from "../../core/errors/app-error.js";
import { decryptSecretEnvelope, encryptSecretEnvelope } from "../../core/security/secret-envelope.js";
import {
  assertSafeEmailEndpoint,
  createEmailClient,
  emailProviderEndpoint,
  isEmailDeliveryConfigured,
  parseEmailEndpoint
} from "./http-email.js";
import type { EmailDeliveryConfig, EmailProvider } from "./email.types.js";

type StoredEmailSettings = {
  enabled: boolean;
  provider?: EmailProvider;
  recoveryEnabled?: boolean;
  from?: string;
  httpEndpoint?: string;
  encryptedCredentials?: string;
  credentialsRequired?: boolean;
  lastTestedAt?: string;
  lastTestSucceeded?: boolean;
  lastTestMessage?: string;
  updatedAt?: string;
};

type EmailCredentials = {
  bearerToken?: string;
};

export type UpdateEmailSettingsInput = {
  enabled?: boolean;
  provider?: EmailProvider;
  recoveryEnabled?: boolean;
  from?: string;
  httpEndpoint?: string;
  bearerToken?: string;
  clearBearerToken?: boolean;
};

export type ResolvedEmailSettings = EmailDeliveryConfig & {
  source: "dashboard" | "environment";
  recoveryEnabled: boolean;
  lastTestedAt?: string;
  lastTestSucceeded?: boolean;
  lastTestMessage?: string;
};

function clean(value?: string | null) {
  const normalized = value?.trim();
  return normalized || undefined;
}

function asStoredSettings(value: Prisma.JsonValue | null | undefined): StoredEmailSettings | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;

  const record = value as Record<string, unknown>;
  return {
    enabled: record.enabled === true,
    provider: ["generic", "resend", "postmark"].includes(String(record.provider))
      ? record.provider as EmailProvider
      : "generic",
    recoveryEnabled: typeof record.recoveryEnabled === "boolean" ? record.recoveryEnabled : undefined,
    from: typeof record.from === "string" ? record.from : undefined,
    httpEndpoint: typeof record.httpEndpoint === "string" ? record.httpEndpoint : undefined,
    encryptedCredentials: typeof record.encryptedCredentials === "string" ? record.encryptedCredentials : undefined,
    credentialsRequired: record.credentialsRequired === true,
    lastTestedAt: typeof record.lastTestedAt === "string" ? record.lastTestedAt : undefined,
    lastTestSucceeded: typeof record.lastTestSucceeded === "boolean" ? record.lastTestSucceeded : undefined,
    lastTestMessage: typeof record.lastTestMessage === "string" ? record.lastTestMessage : undefined,
    updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : undefined
  };
}

export class EmailSettingsService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly config: AppConfig
  ) {}

  async resolve(): Promise<ResolvedEmailSettings> {
    const stored = await this.readStoredSettings();
    if (!stored) {
      return {
        ...this.config.email,
        protectInternalEndpoints: this.config.isProduction,
        source: "environment",
        recoveryEnabled: this.config.auth.recoveryTokenDelivery === "email"
      };
    }

    const credentials = this.decryptCredentials(stored.encryptedCredentials);
    return {
      driver: stored.enabled ? "http" : "disabled",
      provider: stored.provider || "generic",
      recoveryEnabled: stored.recoveryEnabled ?? this.config.auth.recoveryTokenDelivery === "email",
      from: stored.from,
      httpEndpoint: emailProviderEndpoint({
        driver: stored.enabled ? "http" : "disabled",
        provider: stored.provider,
        httpEndpoint: stored.httpEndpoint,
        timeoutMs: this.config.email.timeoutMs
      }),
      httpBearerToken: credentials.bearerToken,
      credentialsRequired: stored.credentialsRequired === true,
      protectInternalEndpoints: this.config.isProduction,
      timeoutMs: this.config.email.timeoutMs,
      source: "dashboard",
      lastTestedAt: stored.lastTestedAt,
      lastTestSucceeded: stored.lastTestSucceeded,
      lastTestMessage: stored.lastTestMessage
    };
  }

  async getAdminStatus() {
    const settings = await this.resolve();

    return {
      source: settings.source,
      enabled: settings.driver === "http",
      provider: settings.provider || "generic",
      from: settings.from ?? "",
      httpEndpoint: settings.provider === "generic" ? settings.httpEndpoint ?? "" : "",
      bearerTokenConfigured: Boolean(settings.httpBearerToken),
      configured: isEmailDeliveryConfigured(settings),
      recoveryEnabled: settings.recoveryEnabled,
      publicUrlConfigured: Boolean(this.config.app.publicUrl),
      lastTestedAt: settings.lastTestedAt,
      lastTestSucceeded: settings.lastTestSucceeded,
      lastTestMessage: settings.lastTestMessage
    };
  }

  async update(input: UpdateEmailSettingsInput) {
    if (input.bearerToken && input.clearBearerToken) {
      throw new AppError(422, "invalid_email_settings", "Cannot set and remove the bearer token together.");
    }

    const current = await this.resolve();
    const enabled = input.enabled ?? (current.driver === "http");
    const currentProvider = current.provider ?? "generic";
    const provider = input.provider ?? currentProvider;
    const recoveryEnabled = input.recoveryEnabled ?? current.recoveryEnabled;
    const from = input.from === undefined ? current.from : clean(input.from);
    const currentHttpEndpoint = currentProvider === "generic"
      ? this.normalizeHttpEndpoint(current.httpEndpoint)
      : undefined;
    const httpEndpoint = provider === "generic"
      ? input.httpEndpoint === undefined && currentProvider === "generic"
        ? currentHttpEndpoint
        : this.normalizeHttpEndpoint(input.httpEndpoint)
      : undefined;
    const providerChanged = provider !== currentProvider;
    const endpointChanged = provider === "generic" && currentProvider === "generic" &&
      httpEndpoint !== currentHttpEndpoint;
    const credentialBindingChanged = providerChanged || endpointChanged;
    const suppliedBearerToken = clean(input.bearerToken);
    const hadConfiguredBinding = currentProvider !== "generic" || Boolean(currentHttpEndpoint);
    const bearerToken = input.clearBearerToken
      ? undefined
      : suppliedBearerToken
        ? suppliedBearerToken
        : credentialBindingChanged
          ? undefined
          : current.httpBearerToken;
    const credentialsRequired = suppliedBearerToken
      ? false
      : credentialBindingChanged
        ? hadConfiguredBinding || current.credentialsRequired === true || provider !== "generic"
        : input.clearBearerToken
          ? false
          : current.credentialsRequired === true;

    if (enabled && !from) {
      throw new AppError(422, "email_settings_incomplete", "Sender address is required before enabling email.");
    }
    if (enabled && provider === "generic" && !httpEndpoint) {
      throw new AppError(422, "email_settings_incomplete", "HTTP endpoint is required for the generic email provider.");
    }
    if (enabled && !bearerToken && (provider !== "generic" || credentialsRequired)) {
      const credentialName = provider === "generic" ? "bearer token" : `${provider} API key`;
      throw new AppError(
        422,
        "email_credentials_required",
        `A new ${credentialName} is required before enabling email for the changed provider or endpoint.`
      );
    }
    if (httpEndpoint) {
      if (this.config.isProduction) {
        await assertSafeEmailEndpoint(httpEndpoint, { requireHttps: true });
      }
    }

    const changed = current.driver !== (enabled ? "http" : "disabled") ||
      currentProvider !== provider ||
      current.recoveryEnabled !== recoveryEnabled ||
      current.from !== from ||
      currentHttpEndpoint !== httpEndpoint ||
      current.httpBearerToken !== bearerToken ||
      current.credentialsRequired !== credentialsRequired;
    const stored: StoredEmailSettings = {
      enabled,
      provider,
      recoveryEnabled,
      from,
      httpEndpoint,
      encryptedCredentials: bearerToken
        ? encryptSecretEnvelope(this.config.payments.credentialEncryptionKey, { bearerToken })
        : undefined,
      credentialsRequired,
      updatedAt: new Date().toISOString(),
      ...(!changed ? {
        lastTestedAt: current.lastTestedAt,
        lastTestSucceeded: current.lastTestSucceeded,
        lastTestMessage: current.lastTestMessage
      } : {})
    };

    await this.writeStoredSettings(stored);
    return this.getAdminStatus();
  }

  async requiresSensitiveAuthorization(input: UpdateEmailSettingsInput) {
    if (clean(input.bearerToken) || input.clearBearerToken) return true;

    const current = await this.resolve();
    const currentProvider = current.provider ?? "generic";
    const requestedProvider = input.provider ?? currentProvider;
    if (requestedProvider !== currentProvider) return true;
    if (requestedProvider !== "generic" || input.httpEndpoint === undefined) return false;
    return this.normalizeHttpEndpoint(input.httpEndpoint) !==
      this.normalizeHttpEndpoint(current.httpEndpoint);
  }

  async test(recipient: string) {
    const settings = await this.resolve();
    if (!isEmailDeliveryConfigured(settings)) {
      throw new AppError(409, "email_not_configured", "Save and enable transactional email before testing it.");
    }

    try {
      const result = await createEmailClient(settings).send({
        to: recipient,
        from: settings.from!,
        subject: `${this.config.app.name} email test`,
        text: `Transactional email is configured for ${this.config.app.name}.`,
        html: `<p>Transactional email is configured for <strong>${escapeHtml(this.config.app.name)}</strong>.</p>`,
        metadata: {
          flow: "configurationTest",
          app: this.config.app.name
        }
      });
      await this.recordTestResult(settings, true, "Test email accepted by the provider.");

      return {
        succeeded: true,
        message: "Test email accepted by the provider.",
        providerMessageId: safeProviderMessageId(result.providerMessageId, settings.httpBearerToken)
      };
    } catch (error) {
      const message = safeProviderError(error, settings.httpBearerToken);
      await this.recordTestResult(settings, false, message);
      throw new AppError(502, "email_test_failed", "Email provider test failed.", { message });
    }
  }

  private async readStoredSettings() {
    const site = await this.getOrCreateDefaultSite();
    const setting = await this.prisma.moduleSetting.findUnique({
      where: {
        siteId_moduleId_key: {
          siteId: site.id,
          moduleId: "config",
          key: "email"
        }
      },
      select: { value: true }
    });

    return asStoredSettings(setting?.value);
  }

  private async writeStoredSettings(settings: StoredEmailSettings) {
    const site = await this.getOrCreateDefaultSite();
    const value = settings as unknown as Prisma.InputJsonValue;

    await this.prisma.moduleSetting.upsert({
      where: {
        siteId_moduleId_key: {
          siteId: site.id,
          moduleId: "config",
          key: "email"
        }
      },
      update: { value },
      create: {
        siteId: site.id,
        moduleId: "config",
        key: "email",
        value
      }
    });
  }

  private async recordTestResult(settings: ResolvedEmailSettings, succeeded: boolean, message: string) {
    await this.writeStoredSettings({
      enabled: settings.driver === "http",
      provider: settings.provider,
      recoveryEnabled: settings.recoveryEnabled,
      from: settings.from,
      httpEndpoint: settings.provider === "generic" ? settings.httpEndpoint : undefined,
      encryptedCredentials: settings.httpBearerToken
        ? encryptSecretEnvelope(this.config.payments.credentialEncryptionKey, { bearerToken: settings.httpBearerToken })
        : undefined,
      credentialsRequired: settings.credentialsRequired === true,
      lastTestedAt: new Date().toISOString(),
      lastTestSucceeded: succeeded,
      lastTestMessage: message,
      updatedAt: new Date().toISOString()
    });
  }

  private decryptCredentials(envelope?: string): EmailCredentials {
    if (!envelope) return {};

    try {
      const credentials = decryptSecretEnvelope<unknown>(this.config.payments.credentialEncryptionKey, envelope);
      if (!credentials || typeof credentials !== "object" || Array.isArray(credentials)) {
        throw new Error("Invalid credential payload");
      }

      const bearerToken = (credentials as Record<string, unknown>).bearerToken;
      return typeof bearerToken === "string" ? { bearerToken } : {};
    } catch {
      throw new AppError(
        500,
        "email_credentials_unavailable",
        "Stored email credentials could not be decrypted. Check the CMS credential encryption key."
      );
    }
  }

  private normalizeHttpEndpoint(value?: string) {
    const normalized = clean(value);
    if (!normalized) return undefined;

    try {
      return parseEmailEndpoint(normalized).toString();
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(422, "email_endpoint_invalid", "Email endpoint must be a valid HTTP or HTTPS URL.");
    }
  }

  private getOrCreateDefaultSite() {
    return this.prisma.site.upsert({
      where: { slug: "default" },
      update: {},
      create: {
        slug: "default",
        name: this.config.app.name,
        deploymentProfile: this.config.app.mode === "landing" ? "presentation" : this.config.app.mode
      },
      select: { id: true }
    });
  }
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function safeProviderMessageId(value?: string, credential?: string) {
  if (!value || (credential && value.includes(credential))) return undefined;
  return value.slice(0, 500);
}

function safeProviderError(error: unknown, credential?: string) {
  const fallback = "Email provider request failed.";
  if (!(error instanceof Error)) return fallback;

  const message = error.message.slice(0, 500);
  return credential ? message.replaceAll(credential, "[Redacted]") : message;
}
