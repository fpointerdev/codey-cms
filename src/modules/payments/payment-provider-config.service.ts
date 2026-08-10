import { createHash } from "node:crypto";
import {
  Prisma,
  type PaymentProvider,
  type PaymentProviderConfig,
  type PaymentProviderMode,
  type PrismaClient
} from "@prisma/client";
import { AppError } from "../../core/errors/app-error.js";
import { writeAuditLog } from "../../core/audit/audit-log.js";
import type { ModuleContext } from "../../core/types/module.js";
import {
  decryptPaymentCredentials,
  encryptPaymentCredentials,
  type PaymentProviderCredentials
} from "./payment-credentials.js";

export type UpdatePaymentProviderConfig = {
  mode?: PaymentProviderMode;
  enabled?: boolean;
  publishableKey?: string;
  secretKey?: string;
  clearSecretKey?: boolean;
  clientId?: string;
  clientSecret?: string;
  clearClientSecret?: boolean;
  webhookId?: string;
  webhookSecret?: string;
  clearWebhookSecret?: boolean;
  instructions?: string;
};

type PaymentProviderDatabase = PrismaClient | Prisma.TransactionClient;

export type ResolvedPaymentProviderConfig = {
  config: PaymentProviderConfig;
  credentials: PaymentProviderCredentials;
};

export function paymentProviderConfigRevision(config: PaymentProviderConfig) {
  return createHash("sha256").update(JSON.stringify({
    id: config.id,
    provider: config.provider,
    mode: config.mode,
    enabled: config.enabled,
    publishableKey: config.publishableKey,
    clientId: config.clientId,
    webhookId: config.webhookId,
    encryptedCredentials: config.encryptedCredentials,
    instructions: config.instructions
  })).digest("hex");
}

const providers: PaymentProvider[] = ["STRIPE", "PAYPAL", "MANUAL"];

function clean(value?: string | null) {
  const normalized = value?.trim();
  return normalized || null;
}

function stripeKeyMode(value: string | null, kind: "public" | "secret") {
  if (!value) return null;
  if (kind === "public") {
    if (value.startsWith("pk_test_")) return "SANDBOX";
    if (value.startsWith("pk_live_")) return "LIVE";
    return null;
  }

  if (value.startsWith("sk_test_") || value.startsWith("rk_test_")) return "SANDBOX";
  if (value.startsWith("sk_live_") || value.startsWith("rk_live_")) return "LIVE";
  return null;
}

function missingConfiguration(
  provider: PaymentProvider,
  config: Pick<PaymentProviderConfig, "mode" | "publishableKey" | "clientId" | "webhookId" | "instructions">,
  credentials: PaymentProviderCredentials
) {
  const missing: string[] = [];

  if (provider === "STRIPE") {
    if (!config.publishableKey) missing.push("publishableKey");
    if (!credentials.secretKey) missing.push("secretKey");
    if (!credentials.webhookSecret) missing.push("webhookSecret");
  } else if (provider === "PAYPAL") {
    if (!config.clientId) missing.push("clientId");
    if (!credentials.clientSecret) missing.push("clientSecret");
    if (!config.webhookId) missing.push("webhookId");
  } else if (!config.instructions) {
    missing.push("instructions");
  }

  return missing;
}

function assertStripeKeyModes(
  mode: PaymentProviderMode,
  publishableKey: string | null,
  secretKey?: string,
  webhookSecret?: string
) {
  if (publishableKey && stripeKeyMode(publishableKey, "public") !== mode) {
    throw new AppError(
      422,
      "stripe_key_mode_mismatch",
      `Stripe publishable key does not match ${mode === "LIVE" ? "live" : "sandbox"} mode.`
    );
  }

  if (secretKey && stripeKeyMode(secretKey, "secret") !== mode) {
    throw new AppError(
      422,
      "stripe_key_mode_mismatch",
      `Stripe secret key does not match ${mode === "LIVE" ? "live" : "sandbox"} mode.`
    );
  }

  if (webhookSecret && !webhookSecret.startsWith("whsec_")) {
    throw new AppError(
      422,
      "stripe_webhook_secret_invalid",
      "Stripe webhook signing secret must start with whsec_."
    );
  }
}

function credentialsChanged(
  current: PaymentProviderCredentials,
  next: PaymentProviderCredentials
) {
  return current.secretKey !== next.secretKey ||
    current.webhookSecret !== next.webhookSecret ||
    current.clientSecret !== next.clientSecret;
}

export class PaymentProviderConfigService {
  constructor(private readonly context: ModuleContext) {}

  async listAdminConfigs() {
    const site = await this.getOrCreateDefaultSite();
    const storedConfigs = await this.context.prisma.paymentProviderConfig.findMany({
      where: { siteId: site.id }
    });

    return providers.map((provider) => {
      const stored = storedConfigs.find((item) => item.provider === provider);
      const credentials = this.credentialsFor(stored);
      const config = stored ?? {
        provider,
        mode: "SANDBOX" as const,
        enabled: false,
        publishableKey: null,
        clientId: null,
        webhookId: null,
        instructions: provider === "MANUAL" ? "Contact us to arrange payment." : null,
        lastTestedAt: null,
        lastTestSucceeded: null,
        lastTestMessage: null,
        lastWebhookAt: null,
        updatedAt: null
      };
      const missingFields = missingConfiguration(provider, config, credentials);

      return {
        provider,
        configured: Boolean(stored),
        mode: config.mode,
        enabled: config.enabled,
        publishableKey: config.publishableKey,
        clientId: config.clientId,
        webhookId: config.webhookId,
        instructions: config.instructions,
        secretKeyConfigured: Boolean(credentials.secretKey),
        clientSecretConfigured: Boolean(credentials.clientSecret),
        webhookSecretConfigured: Boolean(credentials.webhookSecret),
        missingFields,
        ready: missingFields.length === 0,
        canEnable: missingFields.length === 0 &&
          (provider === "MANUAL" || config.lastTestSucceeded === true),
        lastTestedAt: config.lastTestedAt,
        lastTestSucceeded: config.lastTestSucceeded,
        lastTestMessage: config.lastTestMessage,
        lastWebhookAt: config.lastWebhookAt,
        updatedAt: config.updatedAt
      };
    });
  }

  async listPublicProviders() {
    const site = await this.getOrCreateDefaultSite();
    const configs = await this.context.prisma.paymentProviderConfig.findMany({
      where: {
        siteId: site.id,
        enabled: true
      },
      orderBy: { provider: "asc" }
    });

    const publicConfigs: Array<Record<string, string | null>> = [];

    for (const config of configs) {
      const credentials = this.credentialsFor(config);
      if (missingConfiguration(config.provider, config, credentials).length > 0) continue;
      if (config.provider !== "MANUAL" && config.lastTestSucceeded !== true) continue;

      if (config.provider === "STRIPE") {
        publicConfigs.push({ provider: config.provider, mode: config.mode, publishableKey: config.publishableKey });
      } else if (config.provider === "PAYPAL") {
        publicConfigs.push({ provider: config.provider, mode: config.mode, clientId: config.clientId });
      } else {
        publicConfigs.push({ provider: config.provider, mode: config.mode, instructions: config.instructions });
      }
    }

    return publicConfigs;
  }

  async updateConfig(provider: PaymentProvider, input: UpdatePaymentProviderConfig) {
    const site = await this.getOrCreateDefaultSite();
    return this.withProviderLock(site.id, provider, (database) =>
      this.updateConfigLocked(database, site.id, provider, input)
    );
  }

  private async updateConfigLocked(
    database: PaymentProviderDatabase,
    siteId: string,
    provider: PaymentProvider,
    input: UpdatePaymentProviderConfig
  ) {
    const current = await database.paymentProviderConfig.findUnique({
      where: {
        siteId_provider: {
          siteId,
          provider
        }
      }
    });
    const currentCredentials = this.credentialsFor(current);
    const nextCredentials = { ...currentCredentials };

    if (provider === "STRIPE") {
      delete nextCredentials.clientSecret;
      if (input.clearSecretKey) delete nextCredentials.secretKey;
      else if (input.secretKey !== undefined) nextCredentials.secretKey = clean(input.secretKey) ?? undefined;

      if (input.clearWebhookSecret) delete nextCredentials.webhookSecret;
      else if (input.webhookSecret !== undefined) nextCredentials.webhookSecret = clean(input.webhookSecret) ?? undefined;
    } else if (provider === "PAYPAL") {
      delete nextCredentials.secretKey;
      delete nextCredentials.webhookSecret;
      if (input.clearClientSecret) delete nextCredentials.clientSecret;
      else if (input.clientSecret !== undefined) nextCredentials.clientSecret = clean(input.clientSecret) ?? undefined;
    } else {
      delete nextCredentials.secretKey;
      delete nextCredentials.webhookSecret;
      delete nextCredentials.clientSecret;
    }

    const mode = provider === "MANUAL" ? "SANDBOX" : input.mode ?? current?.mode ?? "SANDBOX";
    const publishableKey = provider === "STRIPE"
      ? (input.publishableKey !== undefined ? clean(input.publishableKey) : current?.publishableKey ?? null)
      : null;
    const clientId = provider === "PAYPAL"
      ? (input.clientId !== undefined ? clean(input.clientId) : current?.clientId ?? null)
      : null;
    const webhookId = provider === "PAYPAL"
      ? (input.webhookId !== undefined ? clean(input.webhookId) : current?.webhookId ?? null)
      : null;
    const instructions = provider === "MANUAL"
      ? (input.instructions !== undefined ? clean(input.instructions) : current?.instructions ?? null)
      : null;

    if (provider === "STRIPE") {
      assertStripeKeyModes(
        mode,
        publishableKey,
        nextCredentials.secretKey,
        nextCredentials.webhookSecret
      );
    }

    const configurationChanged = !current ||
      current.mode !== mode ||
      current.publishableKey !== publishableKey ||
      current.clientId !== clientId ||
      current.webhookId !== webhookId ||
      current.instructions !== instructions ||
      credentialsChanged(currentCredentials, nextCredentials);
    const enabled = input.enabled ?? current?.enabled ?? false;
    const readinessInput = { mode, publishableKey, clientId, webhookId, instructions };
    const missingFields = missingConfiguration(provider, readinessInput, nextCredentials);

    if (enabled && missingFields.length > 0) {
      throw new AppError(
        422,
        "payment_provider_incomplete",
        "Complete all required provider settings before enabling payments.",
        { missingFields }
      );
    }

    if (
      enabled &&
      provider !== "MANUAL" &&
      (configurationChanged || current?.lastTestSucceeded !== true)
    ) {
      throw new AppError(
        422,
        "payment_provider_test_required",
        "Save and successfully test this provider before enabling it."
      );
    }

    const encryptedCredentials = Object.keys(nextCredentials).length > 0
      ? encryptPaymentCredentials(this.context.config.payments.credentialEncryptionKey, nextCredentials)
      : null;
    const resetTest = provider !== "MANUAL" && configurationChanged;

    return database.paymentProviderConfig.upsert({
      where: {
        siteId_provider: {
          siteId,
          provider
        }
      },
      update: {
        mode,
        enabled,
        publishableKey,
        clientId,
        webhookId,
        instructions,
        encryptedCredentials,
        ...(resetTest ? {
          lastTestedAt: null,
          lastTestSucceeded: null,
          lastTestMessage: null
        } : {})
      },
      create: {
        siteId,
        provider,
        mode,
        enabled,
        publishableKey,
        clientId,
        webhookId,
        instructions,
        encryptedCredentials
      }
    });
  }

  async resolveConfig(provider: PaymentProvider, options: { requireEnabled?: boolean } = {}) {
    const site = await this.getOrCreateDefaultSite();
    const config = await this.context.prisma.paymentProviderConfig.findUnique({
      where: {
        siteId_provider: {
          siteId: site.id,
          provider
        }
      }
    });

    if (!config || options.requireEnabled && !config.enabled) {
      throw new AppError(
        409,
        "payment_provider_not_enabled",
        `${provider} is not enabled for this site.`
      );
    }

    if (
      options.requireEnabled &&
      provider !== "MANUAL" &&
      config.lastTestSucceeded !== true
    ) {
      throw new AppError(
        409,
        "payment_provider_test_required",
        `${provider} must pass a connection test before accepting payments.`
      );
    }

    const credentials = this.credentialsFor(config);
    const missingFields = missingConfiguration(provider, config, credentials);
    if (missingFields.length > 0) {
      throw new AppError(
        409,
        "payment_provider_incomplete",
        `${provider} configuration is incomplete.`,
        { missingFields }
      );
    }

    return { config, credentials } satisfies ResolvedPaymentProviderConfig;
  }

  async recordTestResult(
    provider: PaymentProvider,
    testedRevision: string,
    succeeded: boolean,
    message: string
  ) {
    const site = await this.getOrCreateDefaultSite();

    return this.withProviderLock(site.id, provider, async (database) => {
      const current = await database.paymentProviderConfig.findUnique({
        where: {
          siteId_provider: { siteId: site.id, provider }
        }
      });
      if (!current || paymentProviderConfigRevision(current) !== testedRevision) return false;

      await database.paymentProviderConfig.update({
        where: { id: current.id },
        data: {
          lastTestedAt: new Date(),
          lastTestSucceeded: succeeded,
          lastTestMessage: message.slice(0, 500),
          ...(!succeeded ? { enabled: false } : {})
        }
      });
      return true;
    });
  }

  async recordWebhookReceived(provider: PaymentProvider) {
    const site = await this.getOrCreateDefaultSite();

    await this.context.prisma.paymentProviderConfig.updateMany({
      where: { siteId: site.id, provider },
      data: { lastWebhookAt: new Date() }
    });
  }

  async writeAuditLog(input: {
    actorUserId?: string;
    action: string;
    provider: PaymentProvider;
    ipAddress?: string;
    userAgent?: string;
    metadata?: Prisma.InputJsonObject;
  }) {
    await writeAuditLog(this.context.prisma, {
      actorUserId: input.actorUserId,
      action: input.action,
      subject: "payment_provider",
      subjectId: input.provider,
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
      outcome: input.action.endsWith("_failed") ? "FAILURE" : "SUCCESS",
      severity: input.action.endsWith("_failed") ? "WARN" : "INFO",
      metadata: input.metadata
    });
  }

  private credentialsFor(config?: Pick<PaymentProviderConfig, "encryptedCredentials"> | null) {
    return decryptPaymentCredentials(
      this.context.config.payments.credentialEncryptionKey,
      config?.encryptedCredentials
    );
  }

  private async withProviderLock<T>(
    siteId: string,
    provider: PaymentProvider,
    operation: (database: PaymentProviderDatabase) => Promise<T>
  ) {
    return this.context.prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw(
        Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`payment-provider:${siteId}:${provider}`}, 0))::text AS "lock"`
      );
      return operation(transaction);
    });
  }

  private async getOrCreateDefaultSite() {
    return this.context.prisma.site.upsert({
      where: { slug: "default" },
      update: {},
      create: {
        slug: "default",
        name: this.context.config.app.name,
        deploymentProfile: this.context.config.app.mode === "landing"
          ? "presentation"
          : this.context.config.app.mode
      }
    });
  }
}
