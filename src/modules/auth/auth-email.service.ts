import type { PrismaClient } from "@prisma/client";
import type { AppConfig } from "../../config/index.js";
import { AppError } from "../../core/errors/app-error.js";
import { EmailSettingsService } from "../../infrastructure/email/email-settings.service.js";
import { createEmailClient, isEmailDeliveryConfigured } from "../../infrastructure/email/http-email.js";
import type { AuthRequestMeta } from "./auth.types.js";

type RecoveryFlow = "emailVerification" | "passwordReset" | "invite";

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export class AuthEmailService {
  private readonly settings: EmailSettingsService;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly config: AppConfig
  ) {
    this.settings = new EmailSettingsService(prisma, config);
  }

  canReturnRecoveryTokens() {
    return this.config.auth.recoveryTokenDelivery === "response" && !this.config.isProduction;
  }

  async assertRecoveryTokenDeliveryConfigured(flowName: string) {
    if (this.canReturnRecoveryTokens() || await this.canEmailRecoveryTokens()) return;

    throw new AppError(
      503,
      "auth_delivery_not_configured",
      `${flowName} token delivery is not configured.`
    );
  }

  exposeSensitiveToken(token: string | null) {
    if (!this.canReturnRecoveryTokens()) return undefined;
    return token;
  }

  inviteDelivery(token: string, deliveredByEmail: boolean) {
    if (deliveredByEmail) {
      return {
        delivery: "email" as const,
        inviteUrl: undefined
      };
    }

    return {
      delivery: "manual" as const,
      inviteUrl: this.inviteUrl(token)
    };
  }

  async deliverRecoveryToken(
    flow: RecoveryFlow,
    input: { email: string; token: string; name?: string; roleNames?: string[] }
  ) {
    if (this.canReturnRecoveryTokens()) return "response" as const;
    if (!await this.canEmailRecoveryTokens()) return "manual" as const;

    const emailSettings = await this.settings.resolve();
    const emailClient = createEmailClient(emailSettings);
    await emailClient.send(this.createRecoveryEmail(flow, input, emailSettings.from!));
    return "email" as const;
  }

  async sendLoginSecurityAlert(email: string, meta: AuthRequestMeta) {
    const settings = await this.settings.resolve();
    if (!isEmailDeliveryConfigured(settings)) return;

    const recipients = await this.prisma.user.findMany({
      where: {
        status: "ACTIVE",
        roles: {
          some: {
            role: { name: { in: ["owner", "admin"] } }
          }
        }
      },
      select: { email: true }
    });
    if (recipients.length === 0) return;

    const client = createEmailClient(settings);
    const attemptedAccount = email.toLowerCase();
    const source = meta.ipAddress || "unknown source";
    await Promise.all(recipients.map(({ email: recipient }) => client.send({
      to: recipient,
      from: settings.from!,
      subject: `Security alert for ${this.config.app.name}`,
      text: `Repeated failed sign-in attempts were delayed for ${attemptedAccount} from ${source}. Review Security activity in the dashboard.`,
      html: `<p>Repeated failed sign-in attempts were delayed for <strong>${escapeHtml(attemptedAccount)}</strong> from ${escapeHtml(source)}.</p><p>Review Security activity in the dashboard.</p>`,
      metadata: {
        flow: "securityAlert",
        type: "login_throttle",
        app: this.config.app.name
      }
    })));
  }

  private async canEmailRecoveryTokens() {
    if (!this.config.app.publicUrl) return false;

    const settings = await this.settings.resolve();
    return settings.recoveryEnabled && isEmailDeliveryConfigured(settings);
  }

  private inviteUrl(token: string) {
    const path = `/auth/invite?token=${encodeURIComponent(token)}`;
    if (!this.config.app.publicUrl) return path;

    return new URL(path, this.config.app.publicUrl).toString();
  }

  private createRecoveryEmail(
    flow: RecoveryFlow,
    input: { email: string; token: string; name?: string; roleNames?: string[] },
    from: string
  ) {
    const url = this.recoveryUrl(flow, input.token);
    const label =
      flow === "emailVerification"
        ? "Verify email"
        : flow === "passwordReset"
          ? "Reset password"
          : "Accept invite";
    const subject =
      flow === "emailVerification"
        ? `Verify your ${this.config.app.name} email`
        : flow === "passwordReset"
          ? `Reset your ${this.config.app.name} password`
          : `You have been invited to ${this.config.app.name}`;
    const intro =
      flow === "invite"
        ? `You have been invited to ${this.config.app.name}${input.roleNames?.length ? ` as ${input.roleNames.join(", ")}` : ""}.`
        : `Use this secure link to continue with ${this.config.app.name}.`;

    return {
      to: input.email,
      from,
      subject,
      text: `${intro}\n\n${label}: ${url}\n\nIf you did not request this, you can ignore this email.`,
      html: `<p>${escapeHtml(intro)}</p><p><a href="${escapeHtml(url)}">${escapeHtml(label)}</a></p><p>If you did not request this, you can ignore this email.</p>`,
      metadata: {
        flow,
        app: this.config.app.name
      }
    };
  }

  private recoveryUrl(flow: RecoveryFlow, token: string) {
    if (!this.config.app.publicUrl) {
      throw new AppError(503, "auth_delivery_not_configured", "APP_PUBLIC_URL is required for auth email delivery.");
    }

    const path =
      flow === "emailVerification"
        ? "/auth/verify-email"
        : flow === "passwordReset"
          ? "/auth/reset-password"
          : "/auth/invite";
    const url = new URL(path, this.config.app.publicUrl);
    url.searchParams.set("token", token);
    return url.toString();
  }
}
