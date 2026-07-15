import { createHash, randomBytes } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import { jwtVerify, SignJWT } from "jose";
import { writeAuditLog } from "../../core/audit/audit-log.js";
import type { AppConfig } from "../../config/index.js";
import { AppError } from "../../core/errors/app-error.js";
import { hashPassword, verifyPassword } from "../../core/security/password.js";
import { createEmailClient, isEmailDeliveryConfigured } from "../../infrastructure/email/http-email.js";
import { assertRolesCanBeAssigned } from "../roles/role-assignment.js";
import type { AuthenticatedUser, TokenPair } from "./auth.types.js";

const encoder = new TextEncoder();

type RequestMeta = {
  userAgent?: string;
  ipAddress?: string;
};

type RefreshTokenWriter = Pick<PrismaClient, "refreshToken">;

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
    permissions
  };
}

export class AuthService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly config: AppConfig
  ) {}

  async register(input: { email: string; password: string; name?: string }, meta: RequestMeta) {
    if (!this.config.auth.allowRegistration) {
      throw new AppError(403, "registration_disabled", "Public registration is disabled.");
    }

    if (this.config.auth.requireEmailVerification) {
      this.assertRecoveryTokenDeliveryConfigured("Email verification");
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
      tokens: this.config.auth.requireEmailVerification ? null : await this.issueTokens(user.id, meta),
      emailVerification: {
        required: this.config.auth.requireEmailVerification,
        token: this.exposeSensitiveToken(verificationToken)
      }
    };
  }

  async login(input: { email: string; password: string }, meta: RequestMeta) {
    const user = await this.prisma.user.findUnique({
      where: { email: input.email.toLowerCase() },
      include: this.authUserInclude()
    });

    if (!user || user.status !== "ACTIVE") {
      throw new AppError(401, "invalid_credentials", "Invalid email or password.");
    }

    const isValidPassword = await verifyPassword(input.password, user.passwordHash);
    if (!isValidPassword) {
      throw new AppError(401, "invalid_credentials", "Invalid email or password.");
    }

    if (this.config.auth.requireEmailVerification && !user.emailVerifiedAt) {
      throw new AppError(403, "email_not_verified", "Email verification is required.");
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
      meta
    });

    return {
      user: toAuthenticatedUser(user),
      tokens: await this.issueTokens(user.id, meta)
    };
  }

  async refresh(refreshToken: string, meta: RequestMeta) {
    const tokenHash = hashToken(refreshToken);

    return this.prisma.$transaction(async (tx) => {
      const storedToken = await tx.refreshToken.findUnique({
        where: { tokenHash },
        include: {
          user: {
            include: this.authUserInclude()
          }
        }
      });

      if (
        !storedToken ||
        storedToken.revokedAt ||
        storedToken.expiresAt.getTime() <= Date.now() ||
        storedToken.user.status !== "ACTIVE"
      ) {
        throw new AppError(401, "invalid_refresh_token", "Refresh token is invalid or expired.");
      }

      const tokens = await this.issueTokens(storedToken.userId, meta, tx);
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
        user: toAuthenticatedUser(storedToken.user),
        tokens
      };
    });
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

  async requestPasswordReset(input: { email: string }, meta: RequestMeta) {
    this.assertRecoveryTokenDeliveryConfigured("Password reset");

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

      await tx.user.update({
        where: { id: storedToken.userId },
        data: {
          passwordHash: await hashPassword(input.password)
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
    this.assertRecoveryTokenDeliveryConfigured("Email verification");

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
    await this.deliverRecoveryToken("invite", {
      email: invite.email,
      token,
      roleNames
    });

    return {
      invite,
      ...this.inviteDelivery(token)
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
    await this.deliverRecoveryToken("invite", {
      email: invite.email,
      token,
      roleNames: invite.roleNames
    });

    return {
      invite,
      ...this.inviteDelivery(token)
    };
  }

  async revokeInvite(inviteId: string, audit: AuditInput) {
    const existing = await this.prisma.userInvite.findUnique({
      where: { id: inviteId },
      select: publicInviteSelect
    });
    if (!existing) throw new AppError(404, "invite_not_found", "Invite not found.");
    if (existing.status !== "PENDING" || existing.revokedAt || existing.acceptedAt) {
      throw new AppError(409, "invite_not_pending", "Only pending invites can be revoked.");
    }

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

    const user = await this.prisma.$transaction(async (tx) => {
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

      return createdUser;
    });

    return {
      user: toAuthenticatedUser(user),
      tokens: await this.issueTokens(user.id, meta)
    };
  }

  async resolveUser(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: this.authUserInclude()
    });

    if (!user || user.status !== "ACTIVE") {
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

    return this.resolveUser(payload.sub);
  }

  private async issueTokens(
    userId: string,
    meta: RequestMeta,
    database: RefreshTokenWriter = this.prisma
  ): Promise<TokenPair> {
    const accessExpiresIn = parseDurationToSeconds(this.config.auth.accessTokenTtl);
    const refreshExpiresIn = parseDurationToSeconds(this.config.auth.refreshTokenTtl);
    const secret = encoder.encode(this.config.auth.accessTokenSecret);

    const accessToken = await new SignJWT({})
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
        userAgent: meta.userAgent,
        ipAddress: meta.ipAddress,
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

    await this.prisma.passwordResetToken.create({
      data: {
        tokenHash: hashToken(token),
        userId,
        expiresAt: addSeconds(60 * 30)
      }
    });

    return token;
  }

  private canReturnRecoveryTokens() {
    return this.config.auth.recoveryTokenDelivery === "response" && !this.config.isProduction;
  }

  private canEmailRecoveryTokens() {
    return (
      this.config.auth.recoveryTokenDelivery === "email" &&
      Boolean(this.config.app.publicUrl) &&
      isEmailDeliveryConfigured(this.config)
    );
  }

  private assertRecoveryTokenDeliveryConfigured(flowName: string) {
    if (this.canReturnRecoveryTokens() || this.canEmailRecoveryTokens()) return;

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

  private inviteDelivery(token: string) {
    if (this.canEmailRecoveryTokens()) {
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
    if (this.canReturnRecoveryTokens()) return;
    if (!this.canEmailRecoveryTokens()) return;

    const emailClient = createEmailClient(this.config);
    const message = this.createRecoveryEmail(flow, input);
    await emailClient.send(message);
  }

  private createRecoveryEmail(
    flow: RecoveryFlow,
    input: { email: string; token: string; name?: string; roleNames?: string[] }
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
      from: this.config.email.from!,
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
      metadata: input.metadata as Prisma.InputJsonValue | undefined
    });
  }

  private authUserInclude() {
    return {
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
