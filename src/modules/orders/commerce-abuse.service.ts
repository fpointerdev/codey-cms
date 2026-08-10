import { createHmac, randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import type { AppConfig } from "../../config/index.js";
import { safeWriteAuditLog } from "../../core/audit/audit-log.js";
import { AppError } from "../../core/errors/app-error.js";

export type CommerceRateScope =
  | "cart.create"
  | "cart.checkout"
  | "order.create"
  | "order.lookup"
  | "payment.intent";

type PendingOrderHashes = {
  emailHash: string;
  ipHash?: string;
};

type RateLimitRow = {
  requestCount: number;
  expiresAt: Date;
};

const activeOrderWhere: Prisma.OrderWhereInput = {
  status: { in: ["PENDING", "CONFIRMED"] },
  checkoutStatus: { notIn: ["COMPLETE", "ABANDONED"] }
};

export class CommerceAbuseService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly config: AppConfig
  ) {}

  async consumeRateLimit(scope: CommerceRateScope, key: string) {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + this.config.commerce.checkout.rateLimitWindowMs);
    const keyHash = this.hash(`${scope}:${key.trim().toLowerCase()}`);
    const [record] = await this.prisma.$queryRaw<RateLimitRow[]>(Prisma.sql`
      INSERT INTO "CommerceRateLimit" (
        "id", "scope", "keyHash", "requestCount", "windowStartedAt", "expiresAt", "createdAt", "updatedAt"
      )
      VALUES (${randomUUID()}, ${scope}, ${keyHash}, 1, ${now}, ${expiresAt}, ${now}, ${now})
      ON CONFLICT ("scope", "keyHash") DO UPDATE SET
        "requestCount" = CASE
          WHEN "CommerceRateLimit"."expiresAt" <= ${now} THEN 1
          ELSE "CommerceRateLimit"."requestCount" + 1
        END,
        "windowStartedAt" = CASE
          WHEN "CommerceRateLimit"."expiresAt" <= ${now} THEN ${now}
          ELSE "CommerceRateLimit"."windowStartedAt"
        END,
        "expiresAt" = CASE
          WHEN "CommerceRateLimit"."expiresAt" <= ${now} THEN ${expiresAt}
          ELSE "CommerceRateLimit"."expiresAt"
        END,
        "updatedAt" = ${now}
      RETURNING "requestCount", "expiresAt"
    `);

    if (!record) {
      throw new AppError(503, "checkout_limiter_unavailable", "Checkout protection is temporarily unavailable.");
    }

    const retryAfterSeconds = Math.max(1, Math.ceil((record.expiresAt.getTime() - now.getTime()) / 1000));
    const limit = this.config.commerce.checkout.rateLimitMax;
    if (record.requestCount > limit) {
      await safeWriteAuditLog(this.prisma, {
        action: "commerce.rate_limit.exceeded",
        subject: "orders",
        outcome: "DENIED",
        severity: "WARN",
        metadata: {
          scope,
          keyHash,
          limit,
          retryAfterSeconds
        }
      });
      throw new AppError(
        429,
        "checkout_rate_limit_exceeded",
        "Too many checkout requests. Please try again later.",
        { retryAfterSeconds, limit }
      );
    }

    return {
      limit,
      remaining: Math.max(0, limit - record.requestCount),
      retryAfterSeconds
    };
  }

  pendingOrderHashes(email: string, ipAddress?: string): PendingOrderHashes {
    return {
      emailHash: this.hash(`pending-email:${email.trim().toLowerCase()}`),
      ...(ipAddress
        ? { ipHash: this.hash(`pending-ip:${ipAddress.trim().toLowerCase()}`) }
        : {})
    };
  }

  async assertPendingOrderCapacity(
    tx: Prisma.TransactionClient,
    email: string,
    hashes: PendingOrderHashes
  ) {
    const lockKeys = [hashes.emailHash, hashes.ipHash].filter((value): value is string => Boolean(value)).sort();
    for (const keyHash of lockKeys) {
      await tx.$queryRaw(
        Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`checkout:${keyHash}`}, 0))::text AS "lock"`
      );
    }

    const emailCount = await tx.order.count({
      where: {
        ...activeOrderWhere,
        OR: [
          { checkoutEmailHash: hashes.emailHash },
          {
            checkoutEmailHash: null,
            customerEmail: { equals: email.trim(), mode: "insensitive" }
          }
        ]
      }
    });
    if (emailCount >= this.config.commerce.checkout.pendingOrderLimitPerEmail) {
      throw new AppError(
        429,
        "pending_order_limit_exceeded",
        "Complete or cancel an existing checkout before starting another one.",
        { scope: "email", limit: this.config.commerce.checkout.pendingOrderLimitPerEmail }
      );
    }

    if (!hashes.ipHash) return;
    const ipCount = await tx.order.count({
      where: {
        ...activeOrderWhere,
        checkoutIpHash: hashes.ipHash
      }
    });
    if (ipCount >= this.config.commerce.checkout.pendingOrderLimitPerIp) {
      throw new AppError(
        429,
        "pending_order_limit_exceeded",
        "Too many active checkouts are already using this connection.",
        { scope: "ip", limit: this.config.commerce.checkout.pendingOrderLimitPerIp }
      );
    }
  }

  async auditPendingOrderDenial(hashes: PendingOrderHashes, scope: "email" | "ip") {
    await safeWriteAuditLog(this.prisma, {
      action: "commerce.pending_order_limit.exceeded",
      subject: "orders",
      outcome: "DENIED",
      severity: "WARN",
      metadata: {
        scope,
        keyHash: scope === "email" ? hashes.emailHash : hashes.ipHash
      }
    });
  }

  private hash(value: string) {
    return createHmac("sha256", this.config.security.credentialEncryptionKey)
      .update(value)
      .digest("hex");
  }
}
