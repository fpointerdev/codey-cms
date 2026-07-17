import { Prisma, type PrismaClient } from "@prisma/client";
import type { AppConfig } from "../../config/index.js";
import { AppError } from "../../core/errors/app-error.js";
import { decryptSecretEnvelope, encryptSecretEnvelope } from "../../core/security/secret-envelope.js";
import { createEmailClient, isEmailDeliveryConfigured } from "./http-email.js";
import type { EmailDeliveryConfig } from "./email.types.js";

type StoredEmailSettings = {
  enabled: boolean;
  from?: string;
  httpEndpoint?: string;
  encryptedCredentials?: string;
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
  from?: string;
  httpEndpoint?: string;
  bearerToken?: string;
  clearBearerToken?: boolean;
};

export type ResolvedEmailSettings = EmailDeliveryConfig & {
  source: "dashboard" | "environment";
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
    from: typeof record.from === "string" ? record.from : undefined,
    httpEndpoint: typeof record.httpEndpoint === "string" ? record.httpEndpoint : undefined,
    encryptedCredentials: typeof record.encryptedCredentials === "string" ? record.encryptedCredentials : undefined,
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
        source: "environment"
      };
    }

    const credentials = this.decryptCredentials(stored.encryptedCredentials);
    return {
      driver: stored.enabled ? "http" : "disabled",
      from: stored.from,
      httpEndpoint: stored.httpEndpoint,
      httpBearerToken: credentials.bearerToken,
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
      from: settings.from ?? "",
      httpEndpoint: settings.httpEndpoint ?? "",
      bearerTokenConfigured: Boolean(settings.httpBearerToken),
      configured: isEmailDeliveryConfigured(settings),
      recoveryEnabled: this.config.auth.recoveryTokenDelivery === "email",
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
    const from = input.from === undefined ? current.from : clean(input.from);
    const httpEndpoint = input.httpEndpoint === undefined ? current.httpEndpoint : clean(input.httpEndpoint);
    const bearerToken = input.clearBearerToken
      ? undefined
      : input.bearerToken === undefined
        ? current.httpBearerToken
        : clean(input.bearerToken);

    if (enabled && (!from || !httpEndpoint)) {
      throw new AppError(422, "email_settings_incomplete", "Sender address and HTTP endpoint are required before enabling email.");
    }
    if (httpEndpoint) {
      const endpoint = this.parseHttpEndpoint(httpEndpoint);
      if (enabled && this.config.isProduction && endpoint.protocol !== "https:") {
        throw new AppError(422, "email_endpoint_insecure", "Email endpoint must use HTTPS in production.");
      }
    }

    const changed = current.driver !== (enabled ? "http" : "disabled") ||
      current.from !== from ||
      current.httpEndpoint !== httpEndpoint ||
      current.httpBearerToken !== bearerToken;
    const stored: StoredEmailSettings = {
      enabled,
      from,
      httpEndpoint,
      encryptedCredentials: bearerToken
        ? encryptSecretEnvelope(this.config.payments.credentialEncryptionKey, { bearerToken })
        : undefined,
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
        providerMessageId: result.providerMessageId
      };
    } catch (error) {
      const message = error instanceof Error ? error.message.slice(0, 500) : "Email provider request failed.";
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
      from: settings.from,
      httpEndpoint: settings.httpEndpoint,
      encryptedCredentials: settings.httpBearerToken
        ? encryptSecretEnvelope(this.config.payments.credentialEncryptionKey, { bearerToken: settings.httpBearerToken })
        : undefined,
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

  private parseHttpEndpoint(value: string) {
    try {
      const endpoint = new URL(value);
      if (!["http:", "https:"].includes(endpoint.protocol)) throw new Error("Unsupported protocol");
      return endpoint;
    } catch {
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
