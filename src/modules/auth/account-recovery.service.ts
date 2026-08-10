import type { PrismaClient } from "@prisma/client";
import { writeAuditLog } from "../../core/audit/audit-log.js";
import { AppError } from "../../core/errors/app-error.js";
import { hashPassword } from "../../core/security/password.js";
import type { AuthEmailService } from "./auth-email.service.js";
import { addSeconds, createOpaqueToken, hashToken } from "./auth-token.js";
import type { AuthRequestMeta } from "./auth.types.js";
import { authUserInclude, toAuthenticatedUser } from "./auth-user.js";

export class AccountRecoveryService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly email: AuthEmailService
  ) {}

  async requestPasswordReset(input: { email: string }, meta: AuthRequestMeta) {
    await this.email.assertRecoveryTokenDeliveryConfigured("Password reset");

    const user = await this.prisma.user.findUnique({
      where: { email: input.email.toLowerCase() }
    });

    if (!user || user.status !== "ACTIVE") {
      return { requested: true, token: null };
    }

    const token = await this.createPasswordResetToken(user.id);
    await this.email.deliverRecoveryToken("passwordReset", {
      email: user.email,
      token,
      name: user.name ?? undefined
    });

    await this.audit({
      actorUserId: user.id,
      action: "password_reset.request",
      subject: "user",
      subjectId: user.id,
      meta
    });

    return {
      requested: true,
      token: this.email.exposeSensitiveToken(token)
    };
  }

  async confirmPasswordReset(input: { token: string; password: string }, meta: AuthRequestMeta) {
    const tokenHash = hashToken(input.token);

    await this.prisma.$transaction(async (tx) => {
      const storedToken = await tx.passwordResetToken.findUnique({
        where: { tokenHash },
        include: { user: true }
      });

      if (
        !storedToken ||
        storedToken.consumedAt ||
        storedToken.expiresAt.getTime() <= Date.now() ||
        storedToken.user.status !== "ACTIVE"
      ) {
        throw new AppError(401, "invalid_password_reset_token", "Password reset token is invalid or expired.");
      }

      const consumedToken = await tx.passwordResetToken.updateMany({
        where: {
          id: storedToken.id,
          consumedAt: null
        },
        data: { consumedAt: new Date() }
      });
      if (consumedToken.count !== 1) {
        throw new AppError(401, "invalid_password_reset_token", "Password reset token is invalid or expired.");
      }

      await tx.passwordResetToken.updateMany({
        where: {
          userId: storedToken.userId,
          consumedAt: null
        },
        data: { consumedAt: new Date() }
      });
      await tx.user.update({
        where: { id: storedToken.userId },
        data: {
          passwordHash: await hashPassword(input.password),
          authVersion: { increment: 1 }
        }
      });
      await tx.refreshToken.updateMany({
        where: {
          userId: storedToken.userId,
          revokedAt: null
        },
        data: { revokedAt: new Date() }
      });
      await writeAuditLog(tx, {
        actorUserId: storedToken.userId,
        action: "password_reset.confirm",
        subject: "user",
        subjectId: storedToken.userId,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent
      });
    });

    return { reset: true };
  }

  async requestEmailVerification(input: { email: string }, meta: AuthRequestMeta) {
    await this.email.assertRecoveryTokenDeliveryConfigured("Email verification");

    const user = await this.prisma.user.findUnique({
      where: { email: input.email.toLowerCase() }
    });
    if (!user || user.emailVerifiedAt) {
      return { requested: true, token: null };
    }

    const token = await this.createEmailVerificationToken(user.id);
    await this.email.deliverRecoveryToken("emailVerification", {
      email: user.email,
      token,
      name: user.name ?? undefined
    });

    await this.audit({
      actorUserId: user.id,
      action: "email_verification.request",
      subject: "user",
      subjectId: user.id,
      meta
    });

    return {
      requested: true,
      token: this.email.exposeSensitiveToken(token)
    };
  }

  async confirmEmailVerification(input: { token: string }, meta: AuthRequestMeta) {
    const tokenHash = hashToken(input.token);

    const user = await this.prisma.$transaction(async (tx) => {
      const storedToken = await tx.emailVerificationToken.findUnique({
        where: { tokenHash },
        include: {
          user: {
            include: authUserInclude
          }
        }
      });

      if (
        !storedToken ||
        storedToken.consumedAt ||
        storedToken.expiresAt.getTime() <= Date.now() ||
        storedToken.user.status !== "ACTIVE"
      ) {
        throw new AppError(401, "invalid_email_verification_token", "Email verification token is invalid or expired.");
      }

      const consumedToken = await tx.emailVerificationToken.updateMany({
        where: {
          id: storedToken.id,
          consumedAt: null
        },
        data: { consumedAt: new Date() }
      });
      if (consumedToken.count !== 1) {
        throw new AppError(401, "invalid_email_verification_token", "Email verification token is invalid or expired.");
      }

      const verifiedUser = await tx.user.update({
        where: { id: storedToken.userId },
        data: { emailVerifiedAt: new Date() },
        include: authUserInclude
      });
      await writeAuditLog(tx, {
        actorUserId: storedToken.userId,
        action: "email_verification.confirm",
        subject: "user",
        subjectId: storedToken.userId,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent
      });

      return verifiedUser;
    });

    return { verified: true, user: toAuthenticatedUser(user) };
  }

  async createEmailVerificationToken(userId: string) {
    const token = createOpaqueToken();
    await this.prisma.emailVerificationToken.create({
      data: {
        tokenHash: hashToken(token),
        userId,
        expiresAt: addSeconds(60 * 60 * 24)
      }
    });
    return token;
  }

  private async createPasswordResetToken(userId: string) {
    const token = createOpaqueToken();
    await this.prisma.$transaction(async (tx) => {
      await tx.passwordResetToken.updateMany({
        where: {
          userId,
          consumedAt: null
        },
        data: { consumedAt: new Date() }
      });
      await tx.passwordResetToken.create({
        data: {
          tokenHash: hashToken(token),
          userId,
          expiresAt: addSeconds(60 * 30)
        }
      });
    }, { isolationLevel: "Serializable" });
    return token;
  }

  private async audit(input: {
    actorUserId?: string;
    action: string;
    subject: string;
    subjectId?: string;
    meta: AuthRequestMeta;
  }) {
    await writeAuditLog(this.prisma, {
      actorUserId: input.actorUserId,
      action: input.action,
      subject: input.subject,
      subjectId: input.subjectId,
      ipAddress: input.meta.ipAddress,
      userAgent: input.meta.userAgent,
      requestId: input.meta.requestId
    });
  }
}
