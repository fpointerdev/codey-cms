import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { writeAuditLog } from "../../core/audit/audit-log.js";
import type { ModuleContext } from "../../core/types/module.js";
import { adminOrderDto } from "./order-lookup.js";

type CustomerDataAudit = {
  actorUserId: string;
  ipAddress?: string;
  userAgent?: string;
  requestId?: string;
};

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function customerHash(email: string) {
  return createHash("sha256").update(normalizeEmail(email)).digest("hex");
}

export function anonymizedCustomerEmail(email: string) {
  return `redacted-${customerHash(email).slice(0, 16)}@example.invalid`;
}

export async function exportCustomerData(context: ModuleContext, email: string) {
  const normalizedEmail = normalizeEmail(email);
  const [orders, carts] = await Promise.all([
    context.prisma.order.findMany({
      where: { customerEmail: { equals: normalizedEmail, mode: "insensitive" } },
      orderBy: { createdAt: "asc" },
      include: {
        items: true,
        notifications: { orderBy: { createdAt: "asc" } }
      }
    }),
    context.prisma.cart.findMany({
      where: { customerEmail: { equals: normalizedEmail, mode: "insensitive" } },
      orderBy: { createdAt: "asc" },
      include: { items: true }
    })
  ]);
  const orderIds = orders.map((order) => order.id);
  const payments = orderIds.length
    ? await context.prisma.payment.findMany({
        where: { orderId: { in: orderIds } },
        orderBy: { createdAt: "asc" }
      })
    : [];
  const paymentReferences = payments.flatMap((payment) => payment.providerReference
    ? [{ provider: payment.provider, providerReference: payment.providerReference }]
    : []);
  const paymentWebhooks = paymentReferences.length
    ? await context.prisma.paymentWebhook.findMany({
        where: { OR: paymentReferences },
        orderBy: { createdAt: "asc" }
      })
    : [];

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    customerEmail: normalizedEmail,
    orders: orders.map(adminOrderDto),
    carts,
    payments,
    paymentWebhooks
  };
}

export async function auditCustomerDataExport(
  context: ModuleContext,
  email: string,
  audit: CustomerDataAudit,
  counts: { orders: number; carts: number; payments: number; paymentWebhooks: number }
) {
  await writeAuditLog(context.prisma, {
    actorUserId: audit.actorUserId,
    action: "customer.data.export",
    subject: "orders",
    subjectId: customerHash(email),
    ipAddress: audit.ipAddress,
    userAgent: audit.userAgent,
    requestId: audit.requestId,
    severity: "HIGH",
    metadata: counts
  });
}

export async function anonymizeCustomerData(
  context: ModuleContext,
  email: string,
  audit: CustomerDataAudit
) {
  const normalizedEmail = normalizeEmail(email);
  const redactedEmail = anonymizedCustomerEmail(normalizedEmail);
  const anonymizedAt = new Date();

  return context.prisma.$transaction(async (tx) => {
    const orders = await tx.order.findMany({
      where: { customerEmail: { equals: normalizedEmail, mode: "insensitive" } },
      select: { id: true }
    });
    const orderIds = orders.map((order) => order.id);
    const carts = await tx.cart.findMany({
      where: { customerEmail: { equals: normalizedEmail, mode: "insensitive" } },
      select: { id: true }
    });
    const payments = orderIds.length
      ? await tx.payment.findMany({
          where: { orderId: { in: orderIds } },
          select: { provider: true, providerReference: true }
        })
      : [];
    const paymentReferences = payments.flatMap((payment) => payment.providerReference
      ? [{ provider: payment.provider, providerReference: payment.providerReference }]
      : []);

    if (orderIds.length) {
      await tx.order.updateMany({
        where: { id: { in: orderIds } },
        data: {
          customerEmail: redactedEmail,
          customerName: null,
          lookupTokenHash: null,
          metadata: {
            anonymized: true,
            anonymizedAt: anonymizedAt.toISOString()
          }
        }
      });
      await tx.orderNotification.updateMany({
        where: { orderId: { in: orderIds } },
        data: {
          recipient: redactedEmail,
          body: "Customer message content removed by data anonymization.",
          htmlBody: null,
          secretEnvelope: null,
          failureReason: null
        }
      });
      await tx.orderItem.updateMany({
        where: { orderId: { in: orderIds } },
        data: { metadata: Prisma.DbNull }
      });
      await tx.payment.updateMany({
        where: { orderId: { in: orderIds } },
        data: { metadata: Prisma.DbNull }
      });
    }
    const anonymizedWebhooks = paymentReferences.length
      ? await tx.paymentWebhook.updateMany({
          where: { OR: paymentReferences },
          data: {
            payload: {
              anonymized: true,
              anonymizedAt: anonymizedAt.toISOString()
            }
          }
        })
      : { count: 0 };

    await tx.cart.deleteMany({
      where: { id: { in: carts.map((cart) => cart.id) } }
    });
    await writeAuditLog(tx, {
      actorUserId: audit.actorUserId,
      action: "customer.data.anonymize",
      subject: "orders",
      subjectId: customerHash(normalizedEmail),
      ipAddress: audit.ipAddress,
      userAgent: audit.userAgent,
      requestId: audit.requestId,
      severity: "HIGH",
      metadata: {
        ordersAnonymized: orderIds.length,
        cartsDeleted: carts.length,
        paymentWebhooksAnonymized: anonymizedWebhooks.count
      }
    });

    return {
      ordersAnonymized: orderIds.length,
      cartsDeleted: carts.length,
      paymentWebhooksAnonymized: anonymizedWebhooks.count
    };
  });
}
