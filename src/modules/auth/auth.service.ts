import { createHash, randomBytes } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import { jwtVerify, SignJWT } from "jose";
import { safeWriteAuditLog, writeAuditLog } from "../../core/audit/audit-log.js";
import type { AppConfig } from "../../config/index.js";
import { AppError } from "../../core/errors/app-error.js";
import { hashPassword, verifyPassword } from "../../core/security/password.js";
import { decryptSecretEnvelope, encryptSecretEnvelope } from "../../core/security/secret-envelope.js";
import { EmailSettingsService } from "../../infrastructure/email/email-settings.service.js";
import { createEmailClient, isEmailDeliveryConfigured } from "../../infrastructure/email/http-email.js";
import { assertRolesCanBeAssigned } from "../roles/role-assignment.js";
import type { AuthenticatedUser, TokenPair } from "./auth.types.js";
import { LoginProtectionService } from "./login-protection.service.js";
import {
  createMfaRecoveryCodes,
  createMfaSecret,
  createTotpUri,
  hashMfaRecoveryCode,
  verifyTotpCode
} from "./mfa.js";

const encoder = new TextEncoder();

type RequestMeta = {
  userAgent?: string;
  ipAddress?: string;
  requestId?: string;
};

type RefreshTokenWriter = Pick<PrismaClient, "refreshToken">;

type SessionContext = {
  familyId?: string;
  authenticatedAt?: Date;
  mfaVerifiedAt?: Date | null;
};

type AuditInput = RequestMeta & {
  actorUserId?: string;
};

type InviteAuditInput = AuditInput & {
  actorPermissions: AuthenticatedUser["permissions"];
};

type RecoveryFlow = "emailVerification" | "passwordReset" | "invite";

const publicInviteSelect = {
  id: true,
  email: true,
  roleNames: true,
  status: true,
  expiresAt: true,
  acceptedAt: true,
  revokedAt: true,
  createdAt: true,
  updatedAt: true,
  invitedBy: {
    select: {
      id: true,
      email: true,
      name: true
    }
  },
  acceptedBy: {
    select: {
      id: true,
      email: true,
      name: true
    }
  }
} as const;

const inviteRoleInclude = {
  permissions: {
    include: {
      permission: true
    }
  }
} as const;

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function parseDurationToSeconds(value: string) {
  const match = value.match(/^(\d+)([smhd])$/);
  if (!match) {
    throw new Error(`Invalid duration: ${value}. Use formats like 15m, 24h, 30d.`);
  }

  const amount = Number(match[1]);
  const unit = match[2];
  const multipliers: Record<string, number> = {
    s: 1,
    m: 60,
    h: 60 * 60,
    d: 60 * 60 * 24
  };

  return amount * multipliers[unit];
}

function addSeconds(seconds: number) {
  return new Date(Date.now() + seconds * 1000);
}

function createOpaqueToken() {
  return randomBytes(48).toString("base64url");
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function toAuthenticatedUser(user: {
  id: string;
  email: string;
  name: string | null;
  roles: Array<{
    role: {
      name: string;
      permissions: Array<{
        permission: {
          action: string;
          subject: string;
        };
      }>;
    };
  }>;
  mfaCredential?: { enabledAt: Date | null } | null;
}): AuthenticatedUser {
  const permissions = user.roles.flatMap((userRole) =>
    userRole.role.permissions.map((rolePermission) => ({
      action: rolePermission.permission.action,
      subject: rolePermission.permission.subject
    }))
  );

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    roles: user.roles.map((userRole) => userRole.role.name),
    permissions,
    mfaEnabled: Boolean(user.mfaCredential?.enabledAt)
  };
}

export class AuthService {
  private readonly emailSettings: EmailSettingsService;
  private readonly loginProtection: LoginProtectionService;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly config: AppConfig
  ) {
    this.emailSettings = new EmailSettingsService(prisma, config);
    this.loginProtection = new LoginProtectionService(prisma, config);
  }

  async register(input: { email: string; password: string; name?: string }, meta: RequestMeta) {
    if (!this.config.auth.allowRegistration) {
      throw new AppError(403, "registration_disabled", "Public registration is disabled.");
    }

    if (this.config.auth.requireEmailVerification) {
      await this.assertRecoveryTokenDeliveryConfigured("Email verification");
    }

    const existing = await this.prisma.user.findUnique({
      where: { email: input.email.toLowerCase() }
    });

    if (existing) {
      throw new AppError(409, "email_taken", "A user with this email already exists.");
    }

    const defaultRole = await this.prisma.role.findUnique({
      where: { name: "user" }
    });

    const user = await this.prisma.user.create({
      data: {
        email: input.email.toLowerCase(),
        name: input.name,
        passwordHash: await hashPassword(input.password),
        roles: defaultRole
          ? {
              create: {
                roleId: defaultRole.id
              }
            }
          : undefined
      },
      include: this.authUserInclude()
    });
    const verificationToken = this.config.auth.requireEmailVerification
      ? await this.createEmailVerificationToken(user.id)
      : null;

    if (verificationToken) {
      await this.deliverRecoveryToken("emailVerification", {
        email: user.email,
        token: verificationToken,
        name: user.name ?? undefined
      });
    }

    await this.audit({
      action: "register",
      subject: "user",
      subjectId: user.id,
      meta
    });

    return {
      user: toAuthenticatedUser(user),
      tokens: this.config.auth.requireEmailVerification
        ? null
        : await this.issueTokens(user.id, user.authVersion, meta),
      emailVerification: {
        required: this.config.auth.requireEmailVerification,
        token: this.exposeSensitiveToken(verificationToken)
      }
    };
  }

  async login(input: { email: string; password: string; mfaCode?: string }, meta: RequestMeta) {
    const email = input.email.toLowerCase();
    await this.loginProtection.assertAllowed(email, meta.ipAddress);

    const user = await this.prisma.user.findUnique({
      where: { email },
      include: this.authUserInclude()
    });

    if (!user || user.status !== "ACTIVE") {
      await this.recordLoginFailure(email, meta, "credentials");
      throw new AppError(401, "invalid_credentials", "Invalid email or password.");
    }

    const isValidPassword = await verifyPassword(input.password, user.passwordHash);
    if (!isValidPassword) {
      await this.recordLoginFailure(email, meta, "credentials");
      throw new AppError(401, "invalid_credentials", "Invalid email or password.");
    }

    if (this.config.auth.requireEmailVerification && !user.emailVerifiedAt) {
      throw new AppError(403, "email_not_verified", "Email verification is required.");
    }

    let mfaVerifiedAt: Date | null = null;
    if (user.mfaCredential?.enabledAt) {
      if (!input.mfaCode) {
        throw new AppError(401, "mfa_required", "Enter the verification code for this account.", {
          mfaRequired: true
        });
      }
      if (!await this.verifyMfaCode(user.id, input.mfaCode)) {
        await this.recordLoginFailure(email, meta, "mfa");
        throw new AppError(401, "invalid_mfa_code", "The verification code is invalid.", {
          mfaRequired: true
        });
      }
      mfaVerifiedAt = new Date();
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() }
    });
    await this.audit({
      actorUserId: user.id,
      action: "login",
      subject: "user",
      subjectId: user.id,
      meta,
      metadata: { mfa: Boolean(mfaVerifiedAt) }
    });
    await this.loginProtection.recordSuccess(email);

    return {
      user: toAuthenticatedUser(user),
      tokens: await this.issueTokens(user.id, user.authVersion, meta, this.prisma, {
        mfaVerifiedAt
      })
    };
  }

  async refresh(refreshToken: string, meta: RequestMeta) {
    const tokenHash = hashToken(refreshToken);

    const result = await this.prisma.$transaction(async (tx) => {
      const storedToken = await tx.refreshToken.findUnique({
        where: { tokenHash },
        include: {
          user: {
            include: this.authUserInclude()
          }
        }
      });

      if (!storedToken) {
        return { status: "invalid" as const };
      }

      if (storedToken.revokedAt) {
        if (storedToken.replacedByTokenHash) {
          const revoked = await tx.refreshToken.updateMany({
            where: {
              familyId: storedToken.familyId,
              revokedAt: null
            },
            data: { revokedAt: new Date() }
          });
          await writeAuditLog(tx, {
            actorUserId: storedToken.userId,
            action: "refresh_token.replay_detected",
            subject: "refresh_token",
            subjectId: storedToken.id,
            ipAddress: meta.ipAddress,
            userAgent: meta.userAgent,
            requestId: meta.requestId,
            outcome: "DENIED",
            severity: "HIGH",
            metadata: {
              familyId: storedToken.familyId,
              revokedActiveTokens: revoked.count
            }
          });
        }
        return { status: "invalid" as const };
      }

      if (
        storedToken.expiresAt.getTime() <= Date.now() ||
        storedToken.user.status !== "ACTIVE" ||
        storedToken.authVersion !== storedToken.user.authVersion
      ) {
        return { status: "invalid" as const };
      }

      const tokens = await this.issueTokens(
        storedToken.userId,
        storedToken.user.authVersion,
        meta,
        tx,
        {
          familyId: storedToken.familyId,
          authenticatedAt: storedToken.authenticatedAt,
          mfaVerifiedAt: storedToken.mfaVerifiedAt
        }
      );
      const updatedToken = await tx.refreshToken.updateMany({
        where: {
          id: storedToken.id,
          revokedAt: null
        },
        data: {
          revokedAt: new Date(),
          replacedByTokenHash: hashToken(tokens.refreshToken)
        }
      });

      if (updatedToken.count !== 1) {
        throw new AppError(401, "invalid_refresh_token", "Refresh token is invalid or expired.");
      }

      await writeAuditLog(tx, {
        actorUserId: storedToken.userId,
        action: "refresh_token.rotate",
        subject: "refresh_token",
        subjectId: storedToken.id,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent
      });

      return {
        status: "valid" as const,
        user: toAuthenticatedUser(storedToken.user),
        tokens
      };
    }, { isolationLevel: "Serializable" });

    if (result.status === "invalid") {
      throw new AppError(401, "invalid_refresh_token", "Refresh token is invalid or expired.");
    }
    return {
      user: result.user,
      tokens: result.tokens
    };
  }

  async logout(refreshToken: string, meta: RequestMeta = {}) {
    const tokenHash = hashToken(refreshToken);
    const storedToken = await this.prisma.refreshToken.findUnique({
      where: {
        tokenHash
      },
      select: {
        id: true,
        userId: true
      }
    });
    const updatedTokens = await this.prisma.refreshToken.updateMany({
      where: {
        tokenHash,
        revokedAt: null
      },
      data: {
        revokedAt: new Date()
      }
    });

    if (updatedTokens.count > 0) {
      await this.audit({
        actorUserId: storedToken?.userId,
        action: "logout",
        subject: "refresh_token",
        subjectId: storedToken?.id,
        meta
      });
    }

    return updatedTokens.count;
  }

  async changePassword(
    userId: string,
    input: { currentPassword: string; newPassword: string },
    meta: RequestMeta
  ) {
    const existing = await this.prisma.user.findUnique({
      where: { id: userId },
      include: this.authUserInclude()
    });
    if (!existing || existing.status !== "ACTIVE") {
      throw new AppError(401, "unauthorized", "Authentication required.");
    }
    if (!await verifyPassword(input.currentPassword, existing.passwordHash)) {
      throw new AppError(400, "invalid_current_password", "Current password is incorrect.");
    }

    const passwordHash = await hashPassword(input.newPassword);

    return this.prisma.$transaction(async (tx) => {
      const changed = await tx.user.updateMany({
        where: {
          id: userId,
          status: "ACTIVE",
          authVersion: existing.authVersion
        },
        data: {
          passwordHash,
          authVersion: { increment: 1 }
        }
      });
      if (changed.count !== 1) {
        throw new AppError(
          409,
          "password_change_conflict",
          "Your account changed while the password was being updated. Please try again."
        );
      }

      const user = await tx.user.findUniqueOrThrow({
        where: { id: userId },
        include: this.authUserInclude()
      });
      await tx.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() }
      });
      const tokens = await this.issueTokens(user.id, user.authVersion, meta, tx);
      await writeAuditLog(tx, {
        actorUserId: userId,
        action: "password.change",
        subject: "user",
        subjectId: userId,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent
      });

      return {
        user: toAuthenticatedUser(user),
        tokens
      };
    }, { isolationLevel: "Serializable" });
  }

  async revokeAllSessions(userId: string, meta: RequestMeta) {
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.user.updateMany({
        where: { id: userId, status: "ACTIVE" },
        data: { authVersion: { increment: 1 } }
      });
      if (updated.count !== 1) {
        throw new AppError(401, "unauthorized", "Authentication required.");
      }

      const revoked = await tx.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() }
      });
      await writeAuditLog(tx, {
        actorUserId: userId,
        action: "sessions.revoke_all",
        subject: "user",
        subjectId: userId,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
        metadata: { refreshTokensRevoked: revoked.count }
      });

      return { revoked: true, refreshTokensRevoked: revoked.count };
    }, { isolationLevel: "Serializable" });
  }

  async mfaStatus(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        roles: { select: { role: { select: { name: true } } } },
        mfaCredential: {
          select: {
            enabledAt: true,
            pendingExpiresAt: true,
            recoveryCodeHashes: true,
            lastUsedAt: true
          }
        }
      }
    });
    if (!user) throw new AppError(401, "unauthorized", "Authentication required.");

    const credential = user.mfaCredential;
    const pending = Boolean(
      !credential?.enabledAt &&
      credential?.pendingExpiresAt &&
      credential.pendingExpiresAt.getTime() > Date.now()
    );

    return {
      enabled: Boolean(credential?.enabledAt),
      enabledAt: credential?.enabledAt ?? null,
      pending,
      setupExpiresAt: pending ? credential?.pendingExpiresAt ?? null : null,
      recoveryCodesRemaining: credential?.enabledAt ? credential.recoveryCodeHashes.length : 0,
      lastUsedAt: credential?.lastUsedAt ?? null,
      recommended: user.roles.some(({ role }) => ["owner", "admin"].includes(role.name))
    };
  }

  async beginMfaSetup(userId: string, input: { currentPassword: string }, meta: RequestMeta) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        passwordHash: true,
        status: true,
        mfaCredential: { select: { enabledAt: true } }
      }
    });
    if (!user || user.status !== "ACTIVE") {
      throw new AppError(401, "unauthorized", "Authentication required.");
    }
    if (!await verifyPassword(input.currentPassword, user.passwordHash)) {
      throw new AppError(400, "invalid_current_password", "Current password is incorrect.");
    }
    if (user.mfaCredential?.enabledAt) {
      throw new AppError(409, "mfa_already_enabled", "Two-step verification is already enabled.");
    }

    const secret = createMfaSecret();
    const pendingExpiresAt = addSeconds(10 * 60);
    await this.prisma.userMfaCredential.upsert({
      where: { userId },
      create: {
        userId,
        secretEnvelope: encryptSecretEnvelope(this.config.security.credentialEncryptionKey, { secret }),
        pendingExpiresAt
      },
      update: {
        secretEnvelope: encryptSecretEnvelope(this.config.security.credentialEncryptionKey, { secret }),
        recoveryCodeHashes: [],
        enabledAt: null,
        pendingExpiresAt,
        lastUsedAt: null,
        lastAcceptedCounter: null
      }
    });
    await this.audit({
      actorUserId: userId,
      action: "mfa.setup_started",
      subject: "user",
      subjectId: userId,
      meta
    });

    return {
      secret,
      otpauthUri: createTotpUri({
        secret,
        issuer: this.config.app.name,
        account: user.email
      }),
      setupExpiresAt: pendingExpiresAt
    };
  }

  async confirmMfaSetup(userId: string, input: { code: string }, meta: RequestMeta) {
    const credential = await this.prisma.userMfaCredential.findUnique({
      where: { userId }
    });
    if (
      !credential ||
      credential.enabledAt ||
      !credential.pendingExpiresAt ||
      credential.pendingExpiresAt.getTime() <= Date.now()
    ) {
      throw new AppError(409, "mfa_setup_expired", "Start two-step verification setup again.");
    }
    const mfaSecret = this.readMfaSecret(credential.secretEnvelope);
    const matchedCounter = verifyTotpCode(mfaSecret.secret, input.code);
    if (matchedCounter === null) {
      throw new AppError(422, "invalid_mfa_code", "The verification code is invalid.");
    }

    const recoveryCodes = createMfaRecoveryCodes();
    const recoveryCodeHashes = recoveryCodes.map((code) =>
      hashMfaRecoveryCode(code, this.config.security.credentialEncryptionKey)
    );
    const mfaVerifiedAt = new Date();

    const result = await this.prisma.$transaction(async (tx) => {
      const enabled = await tx.userMfaCredential.updateMany({
        where: {
          id: credential.id,
          enabledAt: null,
          pendingExpiresAt: { gt: new Date() },
          lastAcceptedCounter: null
        },
        data: {
          enabledAt: mfaVerifiedAt,
          pendingExpiresAt: null,
          recoveryCodeHashes,
          lastUsedAt: mfaVerifiedAt,
          lastAcceptedCounter: matchedCounter,
          ...(mfaSecret.key === this.config.security.credentialEncryptionKey
            ? {}
            : {
                secretEnvelope: encryptSecretEnvelope(
                  this.config.security.credentialEncryptionKey,
                  { secret: mfaSecret.secret }
                )
              })
        }
      });
      if (enabled.count !== 1) {
        throw new AppError(409, "mfa_setup_expired", "Start two-step verification setup again.");
      }

      const user = await tx.user.update({
        where: { id: userId },
        data: { authVersion: { increment: 1 } },
        include: this.authUserInclude()
      });
      await tx.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() }
      });
      const tokens = await this.issueTokens(user.id, user.authVersion, meta, tx, {
        mfaVerifiedAt
      });
      await writeAuditLog(tx, {
        actorUserId: userId,
        action: "mfa.enabled",
        subject: "user",
        subjectId: userId,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
        requestId: meta.requestId,
        severity: "HIGH"
      });

      return { user, tokens };
    }, { isolationLevel: "Serializable" });

    return {
      enabled: true,
      recoveryCodes,
      user: toAuthenticatedUser(result.user),
      tokens: result.tokens
    };
  }

  async disableMfa(
    userId: string,
    input: { currentPassword: string; code: string },
    meta: RequestMeta
  ) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: this.authUserInclude()
    });
    if (!user || user.status !== "ACTIVE") {
      throw new AppError(401, "unauthorized", "Authentication required.");
    }
    if (!user.mfaCredential?.enabledAt) {
      throw new AppError(409, "mfa_not_enabled", "Two-step verification is not enabled.");
    }
    if (!await verifyPassword(input.currentPassword, user.passwordHash)) {
      throw new AppError(400, "invalid_current_password", "Current password is incorrect.");
    }
    if (!await this.verifyMfaCode(userId, input.code)) {
      throw new AppError(422, "invalid_mfa_code", "The verification code is invalid.");
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.userMfaCredential.delete({ where: { userId } });
      const updatedUser = await tx.user.update({
        where: { id: userId },
        data: { authVersion: { increment: 1 } },
        include: this.authUserInclude()
      });
      await tx.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() }
      });
      const tokens = await this.issueTokens(updatedUser.id, updatedUser.authVersion, meta, tx);
      await writeAuditLog(tx, {
        actorUserId: userId,
        action: "mfa.disabled",
        subject: "user",
        subjectId: userId,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
        requestId: meta.requestId,
        severity: "HIGH"
      });

      return {
        enabled: false,
        user: toAuthenticatedUser(updatedUser),
        tokens
      };
    }, { isolationLevel: "Serializable" });
  }

  async requestPasswordReset(input: { email: string }, meta: RequestMeta) {
    await this.assertRecoveryTokenDeliveryConfigured("Password reset");

    const user = await this.prisma.user.findUnique({
      where: { email: input.email.toLowerCase() }
    });

    if (!user || user.status !== "ACTIVE") {
      return { requested: true, token: null };
    }

    const token = await this.createPasswordResetToken(user.id);
    await this.deliverRecoveryToken("passwordReset", {
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
      token: this.exposeSensitiveToken(token)
    };
  }

  async confirmPasswordReset(input: { token: string; password: string }, meta: RequestMeta) {
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
        data: {
          revokedAt: new Date()
        }
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

  async requestEmailVerification(input: { email: string }, meta: RequestMeta) {
    await this.assertRecoveryTokenDeliveryConfigured("Email verification");

    const user = await this.prisma.user.findUnique({
      where: { email: input.email.toLowerCase() }
    });

    if (!user || user.emailVerifiedAt) {
      return { requested: true, token: null };
    }

    const token = await this.createEmailVerificationToken(user.id);
    await this.deliverRecoveryToken("emailVerification", {
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
      token: this.exposeSensitiveToken(token)
    };
  }

  async confirmEmailVerification(input: { token: string }, meta: RequestMeta) {
    const tokenHash = hashToken(input.token);

    const user = await this.prisma.$transaction(async (tx) => {
      const storedToken = await tx.emailVerificationToken.findUnique({
        where: { tokenHash },
        include: {
          user: {
            include: this.authUserInclude()
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
        include: this.authUserInclude()
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

  async createInvite(
    input: { email: string; roleNames: string[] },
    audit: InviteAuditInput
  ) {
    const roleNames = [...new Set(input.roleNames)];
    const email = input.email.toLowerCase();
    const existingUser = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true }
    });
    if (existingUser) {
      throw new AppError(409, "email_taken", "A user with this email already exists.");
    }

    const roles = await this.prisma.role.findMany({
      where: {
        name: { in: roleNames }
      },
      include: inviteRoleInclude
    });

    if (roles.length !== roleNames.length) {
      throw new AppError(422, "invalid_invite_roles", "One or more invite roles do not exist.");
    }
    assertRolesCanBeAssigned(audit.actorPermissions, roles);

    const token = createOpaqueToken();
    const invite = await this.prisma.$transaction(async (tx) => {
      await tx.userInvite.updateMany({
        where: {
          email,
          status: "PENDING",
          revokedAt: null,
          acceptedAt: null
        },
        data: {
          status: "REVOKED",
          revokedAt: new Date()
        }
      });

      return tx.userInvite.create({
        data: {
          email,
          tokenHash: hashToken(token),
          roleNames,
          invitedById: audit.actorUserId,
          expiresAt: addSeconds(60 * 60 * 24 * 7)
        },
        select: publicInviteSelect
      });
    }, { isolationLevel: "Serializable" });

    await this.audit({
      actorUserId: audit.actorUserId,
      action: "invite.create",
      subject: "user_invite",
      subjectId: invite.id,
      meta: audit,
      metadata: {
        email: invite.email,
        roleNames
      }
    });
    const delivery = await this.deliverRecoveryToken("invite", {
      email: invite.email,
      token,
      roleNames
    });

    return {
      invite,
      ...this.inviteDelivery(token, delivery === "email")
    };
  }

  async listInvites(input: {
    page: number;
    limit: number;
    search?: string;
    status?: "PENDING" | "ACCEPTED" | "REVOKED";
  }) {
    const where: Prisma.UserInviteWhereInput = {
      ...(input.status ? { status: input.status } : {}),
      ...(input.search
        ? { email: { contains: input.search, mode: "insensitive" } }
        : {})
    };
    const [invites, total] = await Promise.all([
      this.prisma.userInvite.findMany({
        where,
        skip: (input.page - 1) * input.limit,
        take: input.limit,
        orderBy: { createdAt: "desc" },
        select: publicInviteSelect
      }),
      this.prisma.userInvite.count({ where })
    ]);

    return {
      invites,
      pagination: {
        page: input.page,
        limit: input.limit,
        total,
        pages: Math.max(1, Math.ceil(total / input.limit))
      }
    };
  }

  async resendInvite(inviteId: string, audit: InviteAuditInput) {
    const existing = await this.prisma.userInvite.findUnique({
      where: { id: inviteId },
      select: publicInviteSelect
    });
    if (!existing) throw new AppError(404, "invite_not_found", "Invite not found.");
    if (existing.status !== "PENDING" || existing.revokedAt || existing.acceptedAt) {
      throw new AppError(409, "invite_not_pending", "Only pending invites can be resent.");
    }

    const existingUser = await this.prisma.user.findUnique({
      where: { email: existing.email },
      select: { id: true }
    });
    if (existingUser) {
      throw new AppError(409, "email_taken", "A user with this email already exists.");
    }

    const roles = await this.prisma.role.findMany({
      where: { name: { in: existing.roleNames } },
      include: inviteRoleInclude
    });
    if (roles.length !== existing.roleNames.length) {
      throw new AppError(422, "invalid_invite_roles", "One or more invite roles do not exist.");
    }
    assertRolesCanBeAssigned(audit.actorPermissions, roles);

    const token = createOpaqueToken();
    const invite = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.userInvite.updateMany({
        where: {
          id: inviteId,
          status: "PENDING",
          revokedAt: null,
          acceptedAt: null
        },
        data: {
          tokenHash: hashToken(token),
          expiresAt: addSeconds(60 * 60 * 24 * 7),
          invitedById: audit.actorUserId
        }
      });
      if (updated.count !== 1) {
        throw new AppError(409, "invite_not_pending", "Only pending invites can be resent.");
      }

      return tx.userInvite.findUniqueOrThrow({
        where: { id: inviteId },
        select: publicInviteSelect
      });
    }, { isolationLevel: "Serializable" });

    await this.audit({
      actorUserId: audit.actorUserId,
      action: "invite.resend",
      subject: "user_invite",
      subjectId: invite.id,
      meta: audit,
      metadata: {
        email: invite.email,
        roleNames: invite.roleNames
      }
    });
    const delivery = await this.deliverRecoveryToken("invite", {
      email: invite.email,
      token,
      roleNames: invite.roleNames
    });

    return {
      invite,
      ...this.inviteDelivery(token, delivery === "email")
    };
  }

  async revokeInvite(inviteId: string, audit: InviteAuditInput) {
    const existing = await this.prisma.userInvite.findUnique({
      where: { id: inviteId },
      select: publicInviteSelect
    });
    if (!existing) throw new AppError(404, "invite_not_found", "Invite not found.");
    if (existing.status !== "PENDING" || existing.revokedAt || existing.acceptedAt) {
      throw new AppError(409, "invite_not_pending", "Only pending invites can be revoked.");
    }

    const roles = await this.prisma.role.findMany({
      where: { name: { in: existing.roleNames } },
      include: inviteRoleInclude
    });
    assertRolesCanBeAssigned(audit.actorPermissions, roles);

    const revoked = await this.prisma.userInvite.updateMany({
      where: {
        id: inviteId,
        status: "PENDING",
        revokedAt: null,
        acceptedAt: null
      },
      data: {
        status: "REVOKED",
        revokedAt: new Date()
      }
    });
    if (revoked.count !== 1) {
      throw new AppError(409, "invite_not_pending", "Only pending invites can be revoked.");
    }

    const invite = await this.prisma.userInvite.findUniqueOrThrow({
      where: { id: inviteId },
      select: publicInviteSelect
    });
    await this.audit({
      actorUserId: audit.actorUserId,
      action: "invite.revoke",
      subject: "user_invite",
      subjectId: invite.id,
      meta: audit,
      metadata: {
        email: invite.email,
        roleNames: invite.roleNames
      }
    });

    return invite;
  }

  async acceptInvite(input: { token: string; password: string; name?: string }, meta: RequestMeta) {
    const tokenHash = hashToken(input.token);

    const accepted = await this.prisma.$transaction(async (tx) => {
      const invite = await tx.userInvite.findUnique({
        where: { tokenHash }
      });

      if (
        !invite ||
        invite.status !== "PENDING" ||
        invite.revokedAt ||
        invite.expiresAt.getTime() <= Date.now()
      ) {
        throw new AppError(401, "invalid_invite_token", "Invite token is invalid or expired.");
      }

      const existingUser = await tx.user.findUnique({
        where: { email: invite.email }
      });

      if (existingUser) {
        throw new AppError(409, "email_taken", "A user with this email already exists.");
      }

      const roles = await tx.role.findMany({
        where: {
          name: { in: invite.roleNames }
        }
      });

      if (roles.length !== invite.roleNames.length) {
        throw new AppError(422, "invalid_invite_roles", "One or more invite roles do not exist.");
      }

      const acceptedAt = new Date();
      const claimedInvite = await tx.userInvite.updateMany({
        where: {
          id: invite.id,
          tokenHash,
          status: "PENDING",
          revokedAt: null,
          acceptedAt: null
        },
        data: {
          status: "ACCEPTED",
          acceptedAt
        }
      });

      if (claimedInvite.count !== 1) {
        throw new AppError(401, "invalid_invite_token", "Invite token is invalid or expired.");
      }

      const createdUser = await tx.user.create({
        data: {
          email: invite.email,
          name: input.name,
          passwordHash: await hashPassword(input.password),
          emailVerifiedAt: new Date(),
          roles: {
            create: roles.map((role) => ({
              roleId: role.id
            }))
          }
        },
        include: this.authUserInclude()
      });

      await tx.userInvite.update({
        where: { id: invite.id },
        data: {
          acceptedById: createdUser.id
        }
      });

      await writeAuditLog(tx, {
        actorUserId: createdUser.id,
        action: "invite.accept",
        subject: "user_invite",
        subjectId: invite.id,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
        metadata: {
          email: invite.email,
          roleNames: invite.roleNames
        }
      });

      const tokens = await this.issueTokens(createdUser.id, createdUser.authVersion, meta, tx);

      return { user: createdUser, tokens };
    }, { isolationLevel: "Serializable" });

    return {
      user: toAuthenticatedUser(accepted.user),
      tokens: accepted.tokens
    };
  }

  async resolveUser(userId: string, sessionVersion?: number) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: this.authUserInclude()
    });

    if (
      !user ||
      user.status !== "ACTIVE" ||
      sessionVersion !== undefined && user.authVersion !== sessionVersion
    ) {
      throw new AppError(401, "unauthorized", "Authentication required.");
    }

    return toAuthenticatedUser(user);
  }

  async verifyAccessToken(token: string) {
    const secret = encoder.encode(this.config.auth.accessTokenSecret);
    const { payload } = await jwtVerify(token, secret).catch(() => {
      throw new AppError(401, "invalid_access_token", "Access token is invalid.");
    });

    if (typeof payload.sub !== "string") {
      throw new AppError(401, "invalid_access_token", "Access token is invalid.");
    }

    const sessionVersion = payload.sessionVersion;
    if (!Number.isInteger(sessionVersion)) {
      throw new AppError(401, "invalid_access_token", "Access token is invalid.");
    }

    return this.resolveUser(payload.sub, sessionVersion as number);
  }

  private async issueTokens(
    userId: string,
    sessionVersion: number,
    meta: RequestMeta,
    database: RefreshTokenWriter = this.prisma,
    session: SessionContext = {}
  ): Promise<TokenPair> {
    const accessExpiresIn = parseDurationToSeconds(this.config.auth.accessTokenTtl);
    const refreshExpiresIn = parseDurationToSeconds(this.config.auth.refreshTokenTtl);
    const secret = encoder.encode(this.config.auth.accessTokenSecret);
    const authenticatedAt = session.authenticatedAt ?? new Date();
    const mfaVerifiedAt = session.mfaVerifiedAt ?? null;
    const familyId = session.familyId ?? randomBytes(18).toString("base64url");

    const accessToken = await new SignJWT({
      sessionVersion,
      authTime: Math.floor(authenticatedAt.getTime() / 1000),
      mfaVerifiedAt: mfaVerifiedAt?.toISOString() ?? null
    })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(userId)
      .setIssuedAt()
      .setExpirationTime(this.config.auth.accessTokenTtl)
      .sign(secret);

    const refreshToken = randomBytes(64).toString("base64url");

    await database.refreshToken.create({
      data: {
        tokenHash: hashToken(refreshToken),
        userId,
        authVersion: sessionVersion,
        userAgent: meta.userAgent,
        ipAddress: meta.ipAddress,
        familyId,
        authenticatedAt,
        mfaVerifiedAt,
        expiresAt: addSeconds(refreshExpiresIn)
      }
    });

    return {
      accessToken,
      refreshToken,
      tokenType: "Bearer",
      expiresIn: accessExpiresIn
    };
  }

  private async createEmailVerificationToken(userId: string) {
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

  private canReturnRecoveryTokens() {
    return this.config.auth.recoveryTokenDelivery === "response" && !this.config.isProduction;
  }

  private async canEmailRecoveryTokens() {
    if (!this.config.app.publicUrl) return false;

    const settings = await this.emailSettings.resolve();
    return settings.recoveryEnabled && isEmailDeliveryConfigured(settings);
  }

  private async assertRecoveryTokenDeliveryConfigured(flowName: string) {
    if (this.canReturnRecoveryTokens() || await this.canEmailRecoveryTokens()) return;

    throw new AppError(
      503,
      "auth_delivery_not_configured",
      `${flowName} token delivery is not configured.`
    );
  }

  private exposeSensitiveToken(token: string | null) {
    if (!this.canReturnRecoveryTokens()) return undefined;
    return token;
  }

  private inviteDelivery(token: string, deliveredByEmail: boolean) {
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

  private inviteUrl(token: string) {
    const path = `/auth/invite?token=${encodeURIComponent(token)}`;
    if (!this.config.app.publicUrl) return path;

    return new URL(path, this.config.app.publicUrl).toString();
  }

  private async deliverRecoveryToken(
    flow: RecoveryFlow,
    input: { email: string; token: string; name?: string; roleNames?: string[] }
  ) {
    if (this.canReturnRecoveryTokens()) return "response" as const;
    if (!await this.canEmailRecoveryTokens()) return "manual" as const;

    const emailSettings = await this.emailSettings.resolve();
    const emailClient = createEmailClient(emailSettings);
    const message = this.createRecoveryEmail(flow, input, emailSettings.from!);
    await emailClient.send(message);
    return "email" as const;
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

  private async audit(input: {
    actorUserId?: string;
    action: string;
    subject: string;
    subjectId?: string;
    meta: RequestMeta;
    metadata?: Record<string, unknown>;
  }) {
    await writeAuditLog(this.prisma, {
      actorUserId: input.actorUserId,
      action: input.action,
      subject: input.subject,
      subjectId: input.subjectId,
      ipAddress: input.meta.ipAddress,
      userAgent: input.meta.userAgent,
      requestId: input.meta.requestId,
      metadata: input.metadata as Prisma.InputJsonValue | undefined
    });
  }

  private async recordLoginFailure(email: string, meta: RequestMeta, reason: "credentials" | "mfa") {
    const failure = await this.loginProtection.recordFailure(email, meta.ipAddress);
    await safeWriteAuditLog(this.prisma, {
      action: reason === "mfa" ? "login.mfa_failed" : "login.failed",
      subject: "user",
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      requestId: meta.requestId,
      outcome: "DENIED",
      severity: failure.blockedUntil ? "HIGH" : "WARN",
      metadata: {
        reason,
        delayed: Boolean(failure.blockedUntil),
        attempts: failure.attempts.map((attempt) => ({
          scope: attempt.scope,
          failureCount: attempt.failureCount
        }))
      }
    });
    if (failure.shouldAlert) {
      void this.sendLoginSecurityAlert(email, meta).catch(async (error) => {
        await safeWriteAuditLog(this.prisma, {
          action: "security_alert.delivery_failed",
          subject: "notification",
          requestId: meta.requestId,
          outcome: "FAILURE",
          severity: "WARN",
          metadata: {
            type: "login_throttle",
            error: error instanceof Error ? error.message : "unknown"
          }
        });
      });
    }
  }

  private async sendLoginSecurityAlert(email: string, meta: RequestMeta) {
    const settings = await this.emailSettings.resolve();
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

  private async verifyMfaCode(userId: string, code: string) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const credential = await this.prisma.userMfaCredential.findUnique({
        where: { userId }
      });
      if (!credential?.enabledAt) return false;

      const mfaSecret = this.readMfaSecret(credential.secretEnvelope);
      const matchedCounter = verifyTotpCode(mfaSecret.secret, code);
      if (matchedCounter !== null) {
        const consumed = await this.prisma.userMfaCredential.updateMany({
          where: {
            id: credential.id,
            enabledAt: { not: null },
            OR: [
              { lastAcceptedCounter: null },
              { lastAcceptedCounter: { lt: matchedCounter } }
            ]
          },
          data: {
            lastUsedAt: new Date(),
            lastAcceptedCounter: matchedCounter,
            ...(mfaSecret.key === this.config.security.credentialEncryptionKey
              ? {}
              : {
                  secretEnvelope: encryptSecretEnvelope(
                    this.config.security.credentialEncryptionKey,
                    { secret: mfaSecret.secret }
                  )
                })
          }
        });
        if (consumed.count === 1) return true;
      }

      const recoveryCodeHash = this.mfaCredentialKeys()
        .map((key) => hashMfaRecoveryCode(code, key))
        .find((hash) => credential.recoveryCodeHashes.includes(hash));
      if (!recoveryCodeHash) return false;

      const consumed = await this.prisma.userMfaCredential.updateMany({
        where: {
          id: credential.id,
          enabledAt: { not: null },
          recoveryCodeHashes: { equals: credential.recoveryCodeHashes }
        },
        data: {
          recoveryCodeHashes: {
            set: credential.recoveryCodeHashes.filter((hash) => hash !== recoveryCodeHash)
          },
          lastUsedAt: new Date(),
          ...(mfaSecret.key === this.config.security.credentialEncryptionKey
            ? {}
            : {
                secretEnvelope: encryptSecretEnvelope(
                  this.config.security.credentialEncryptionKey,
                  { secret: mfaSecret.secret }
                )
              })
        }
      });
      if (consumed.count === 1) return true;
    }

    return false;
  }

  private readMfaSecret(envelope: string) {
    let cause = "unknown";
    for (const key of this.mfaCredentialKeys()) {
      try {
        const value = decryptSecretEnvelope<unknown>(key, envelope);
        if (
          !value ||
          typeof value !== "object" ||
          typeof (value as { secret?: unknown }).secret !== "string"
        ) {
          throw new Error("MFA secret envelope is invalid.");
        }
        return { secret: (value as { secret: string }).secret, key };
      } catch (error) {
        cause = error instanceof Error ? error.message : "unknown";
      }
    }
    throw new AppError(
      500,
      "mfa_configuration_unavailable",
      "Two-step verification configuration could not be read.",
      { cause }
    );
  }

  private mfaCredentialKeys() {
    return [...new Set([
      this.config.security.credentialEncryptionKey,
      this.config.security.auditIntegrityKey,
      ...this.config.security.auditPreviousIntegrityKeys
    ])];
  }

  private authUserInclude() {
    return {
      mfaCredential: {
        select: {
          enabledAt: true
        }
      },
      roles: {
        include: {
          role: {
            include: {
              permissions: {
                include: {
                  permission: true
                }
              }
            }
          }
        }
      }
    } as const;
  }
}
