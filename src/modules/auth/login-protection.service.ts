import { createHmac } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import type { AppConfig } from "../../config/index.js";
import { AppError } from "../../core/errors/app-error.js";

type ThrottleKey = {
  scope: "account" | "ip";
  keyHash: string;
};

export class LoginProtectionService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly config: AppConfig
  ) {}

  async assertAllowed(email: string, ipAddress?: string) {
    const keys = this.keys(email, ipAddress);
    const records = await this.prisma.authThrottle.findMany({
      where: {
        OR: keys.map((key) => ({ scope: key.scope, keyHash: key.keyHash })),
        blockedUntil: { gt: new Date() }
      },
      orderBy: { blockedUntil: "desc" }
    });
    const blockedUntil = records[0]?.blockedUntil;
    if (!blockedUntil) return;

    const retryAfterSeconds = Math.max(1, Math.ceil((blockedUntil.getTime() - Date.now()) / 1000));
    throw new AppError(
      429,
      "login_temporarily_delayed",
      "Sign-in is temporarily delayed after repeated failed attempts.",
      { retryAfterSeconds }
    );
  }

  async recordFailure(email: string, ipAddress?: string) {
    const now = new Date();
    const staleBefore = new Date(now.getTime() - this.config.security.loginProtection.windowMs);
    const results = await this.prisma.$transaction(async (tx) => {
      const attempts = [];
      await tx.authThrottle.deleteMany({
        where: { lastFailedAt: { lt: staleBefore } }
      });

      for (const key of this.keys(email, ipAddress)) {
        const attempt = await tx.authThrottle.upsert({
          where: {
            scope_keyHash: {
              scope: key.scope,
              keyHash: key.keyHash
            }
          },
          create: {
            scope: key.scope,
            keyHash: key.keyHash,
            failureCount: 1,
            firstFailedAt: now,
            lastFailedAt: now
          },
          update: {
            failureCount: { increment: 1 },
            lastFailedAt: now
          }
        });
        const freeAttempts = key.scope === "account"
          ? this.config.security.loginProtection.accountFreeAttempts
          : this.config.security.loginProtection.ipFreeAttempts;
        const delayMs = attempt.failureCount > freeAttempts
          ? Math.min(
              1_000 * 2 ** Math.min(10, attempt.failureCount - freeAttempts - 1),
              this.config.security.loginProtection.maxDelayMs
            )
          : 0;
        const blockedUntil = delayMs > 0 ? new Date(now.getTime() + delayMs) : null;

        const shouldAlert = Boolean(
          blockedUntil &&
          (!attempt.alertedAt || attempt.alertedAt.getTime() < staleBefore.getTime())
        );
        if (blockedUntil) {
          await tx.authThrottle.update({
            where: { id: attempt.id },
            data: {
              blockedUntil,
              ...(shouldAlert ? { alertedAt: now } : {})
            }
          });
        }

        attempts.push({
          scope: key.scope,
          failureCount: attempt.failureCount,
          blockedUntil,
          shouldAlert
        });
      }

      return attempts;
    });

    return {
      attempts: results,
      blockedUntil: results
        .map((attempt) => attempt.blockedUntil)
        .filter((value): value is Date => Boolean(value))
        .sort((left, right) => right.getTime() - left.getTime())[0] ?? null,
      shouldAlert: results.some((attempt) => attempt.shouldAlert)
    };
  }

  async recordSuccess(email: string) {
    const accountKey = this.keys(email)[0];
    await this.prisma.authThrottle.deleteMany({
      where: {
        scope: accountKey.scope,
        keyHash: accountKey.keyHash
      }
    });
  }

  private keys(email: string, ipAddress?: string): ThrottleKey[] {
    return [
      {
        scope: "account",
        keyHash: this.hash(`account:${email.trim().toLowerCase()}`)
      },
      ...(ipAddress
        ? [{ scope: "ip" as const, keyHash: this.hash(`ip:${ipAddress}`) }]
        : [])
    ];
  }

  private hash(value: string) {
    return createHmac("sha256", this.config.security.credentialEncryptionKey)
      .update(value)
      .digest("hex");
  }
}
