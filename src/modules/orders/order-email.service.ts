import { Prisma, type OrderNotification, type OrderNotificationEvent, type OrderStatus } from "@prisma/client";
import { AppError } from "../../core/errors/app-error.js";
import { decryptSecretEnvelope } from "../../core/security/secret-envelope.js";
import { EmailSettingsService } from "../../infrastructure/email/email-settings.service.js";
import { createEmailClient, isEmailDeliveryConfigured } from "../../infrastructure/email/http-email.js";
import type { ModuleContext } from "../../core/types/module.js";

type ShopTransaction = Prisma.TransactionClient;

type OrderForEmail = Prisma.OrderGetPayload<{
  include: {
    items: true;
  };
}>;

type QueueOrderEmailOptions = {
  eventType: OrderNotificationEvent;
  previousStatus?: OrderStatus;
  secretEnvelope?: string;
};

type DeliverQueuedOrderEmailsOptions = {
  orderId?: string;
  notificationId?: string;
  limit?: number;
};

const maximumDeliveryAttempts = 6;
const staleClaimAgeMs = 5 * 60 * 1000;
const maximumRetryDelayMs = 60 * 60 * 1000;
const lookupTokenPlaceholder = "{{CODEY_ORDER_LOOKUP_TOKEN}}";

export function orderEmailRetryDelayMs(attempts: number) {
  return Math.min(maximumRetryDelayMs, 60_000 * (2 ** Math.max(0, attempts - 1)));
}

function formatMoney(cents: number, currency: string) {
  return new Intl.NumberFormat("en", {
    style: "currency",
    currency
  }).format(cents / 100);
}

function statusLabel(status: string) {
  return status.toLowerCase().replace(/_/g, " ");
}

function orderItemsText(order: OrderForEmail) {
  return order.items
    .map((item) => {
      const name = item.variantName ? `${item.productName} - ${item.variantName}` : item.productName;
      const lineTotal = formatMoney(item.unitPriceCents * item.quantity, order.currency);

      return `- ${name} x ${item.quantity}: ${lineTotal}`;
    })
    .join("\n");
}

function orderItemsHtml(order: OrderForEmail) {
  return order.items
    .map((item) => {
      const name = item.variantName ? `${item.productName} - ${item.variantName}` : item.productName;
      const lineTotal = formatMoney(item.unitPriceCents * item.quantity, order.currency);

      return `<li>${escapeHtml(name)} x ${item.quantity}: ${escapeHtml(lineTotal)}</li>`;
    })
    .join("");
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function buildOrderEmail(order: OrderForEmail, options: QueueOrderEmailOptions) {
  const total = formatMoney(order.totalCents, order.currency);
  const itemsText = orderItemsText(order);
  const itemsHtml = orderItemsHtml(order);

  if (options.eventType === "ORDER_PAID") {
    return {
      subject: `Payment received for order ${order.orderNumber}`,
      body: [
        `Payment for order ${order.orderNumber} was received.`,
        "",
        `Total: ${total}`,
        "",
        "Items:",
        itemsText
      ].join("\n"),
      htmlBody: `<p>Payment for order <strong>${escapeHtml(order.orderNumber)}</strong> was received.</p><p>Total: ${escapeHtml(total)}</p><ul>${itemsHtml}</ul>`
    };
  }

  if (options.eventType === "ORDER_REFUNDED") {
    return {
      subject: `Order ${order.orderNumber} was refunded`,
      body: [
        `Order ${order.orderNumber} was refunded.`,
        "",
        `Total: ${total}`,
        "",
        "Items:",
        itemsText
      ].join("\n"),
      htmlBody: `<p>Order <strong>${escapeHtml(order.orderNumber)}</strong> was refunded.</p><p>Total: ${escapeHtml(total)}</p><ul>${itemsHtml}</ul>`
    };
  }

  if (options.eventType === "ORDER_STATUS_CHANGED") {
    const previous = options.previousStatus ? statusLabel(options.previousStatus) : "previous";
    const current = statusLabel(order.status);

    return {
      subject: `Order ${order.orderNumber} status updated`,
      body: [
        `Order ${order.orderNumber} changed from ${previous} to ${current}.`,
        "",
        `Total: ${total}`
      ].join("\n"),
      htmlBody: `<p>Order <strong>${escapeHtml(order.orderNumber)}</strong> changed from ${escapeHtml(previous)} to ${escapeHtml(current)}.</p><p>Total: ${escapeHtml(total)}</p>`
    };
  }

  return {
    subject: `Order ${order.orderNumber} received`,
    body: [
      `Thank you. Your order ${order.orderNumber} was received.`,
      "",
      `Total: ${total}`,
      ...(options.secretEnvelope
        ? ["", "Order lookup token:", lookupTokenPlaceholder]
        : []),
      "",
      "Items:",
      itemsText
    ].join("\n"),
    htmlBody: `<p>Thank you. Your order <strong>${escapeHtml(order.orderNumber)}</strong> was received.</p><p>Total: ${escapeHtml(total)}</p>${options.secretEnvelope ? `<p>Order lookup token:<br><code>${lookupTokenPlaceholder}</code></p>` : ""}<ul>${itemsHtml}</ul>`
  };
}

export function orderNotificationMessage(
  notification: Pick<OrderNotification, "body" | "htmlBody" | "secretEnvelope">,
  credentialEncryptionKey: string
) {
  if (!notification.secretEnvelope) {
    return { text: notification.body, html: notification.htmlBody ?? undefined };
  }

  const payload = decryptSecretEnvelope<unknown>(
    credentialEncryptionKey,
    notification.secretEnvelope
  );
  const lookupToken = payload && typeof payload === "object" && !Array.isArray(payload)
    ? (payload as Record<string, unknown>).lookupToken
    : undefined;
  if (typeof lookupToken !== "string" || !lookupToken) {
    throw new Error("Invalid order notification secret envelope");
  }

  return {
    text: notification.body.replaceAll(lookupTokenPlaceholder, lookupToken),
    html: notification.htmlBody
      ?.replaceAll(lookupTokenPlaceholder, escapeHtml(lookupToken))
  };
}

export async function queueOrderEmail(
  tx: ShopTransaction,
  order: OrderForEmail,
  options: QueueOrderEmailOptions
) {
  const email = buildOrderEmail(order, options);

  return tx.orderNotification.create({
    data: {
      orderId: order.id,
      eventType: options.eventType,
      recipient: order.customerEmail,
      subject: email.subject,
      body: email.body,
      htmlBody: email.htmlBody,
      secretEnvelope: options.secretEnvelope
    }
  });
}

export async function deliverQueuedOrderEmails(
  context: ModuleContext,
  options: DeliverQueuedOrderEmailsOptions = {}
) {
  const emailSettings = await new EmailSettingsService(context.prisma, context.config).resolve();
  if (!isEmailDeliveryConfigured(emailSettings)) {
    return {
      sent: 0,
      failed: 0,
      skipped: true
    };
  }

  const emailClient = createEmailClient(emailSettings);
  const limit = Math.min(Math.max(options.limit ?? 25, 1), 100);
  const staleBefore = new Date(Date.now() - staleClaimAgeMs);
  const orderFilter = options.orderId
    ? Prisma.sql`AND "orderId" = ${options.orderId}`
    : Prisma.empty;
  const notificationFilter = options.notificationId
    ? Prisma.sql`AND "id" = ${options.notificationId}`
    : Prisma.empty;
  const notifications = await context.prisma.$transaction(async (tx) => {
    await tx.orderNotification.updateMany({
      where: {
        status: "PROCESSING",
        attempts: { gte: maximumDeliveryAttempts },
        lastAttemptAt: { lte: staleBefore }
      },
      data: {
        status: "FAILED",
        failureReason: "Delivery worker stopped before the final attempt completed. Retry manually."
      }
    });

    return tx.$queryRaw<OrderNotification[]>(Prisma.sql`
      WITH candidates AS (
        SELECT "id"
        FROM "OrderNotification"
        WHERE "attempts" < ${maximumDeliveryAttempts}
          ${orderFilter}
          ${notificationFilter}
          AND (
            "status" = 'QUEUED'::"OrderNotificationStatus"
            OR (
              "status" = 'FAILED'::"OrderNotificationStatus"
              AND "nextAttemptAt" <= NOW()
            )
            OR (
              "status" = 'PROCESSING'::"OrderNotificationStatus"
              AND "lastAttemptAt" <= ${staleBefore}
            )
          )
        ORDER BY "createdAt" ASC
        FOR UPDATE SKIP LOCKED
        LIMIT ${limit}
      )
      UPDATE "OrderNotification" AS notification
      SET
        "status" = 'PROCESSING'::"OrderNotificationStatus",
        "attempts" = notification."attempts" + 1,
        "lastAttemptAt" = NOW(),
        "updatedAt" = NOW()
      FROM candidates
      WHERE notification."id" = candidates."id"
      RETURNING notification.*
    `
    );
  });
  let sent = 0;
  let failed = 0;

  for (const notification of notifications) {
    try {
      const message = orderNotificationMessage(
        notification,
        context.config.security.credentialEncryptionKey
      );
      await emailClient.send({
        to: notification.recipient,
        from: emailSettings.from!,
        subject: notification.subject,
        text: message.text,
        html: message.html,
        metadata: {
          orderId: notification.orderId,
          notificationId: notification.id,
          eventType: notification.eventType
        }
      });

      await context.prisma.orderNotification.update({
        where: { id: notification.id },
        data: {
          status: "SENT",
          sentAt: new Date(),
          nextAttemptAt: new Date(),
          failureReason: null,
          secretEnvelope: null
        }
      });
      sent += 1;
    } catch (error) {
      await context.prisma.orderNotification.update({
        where: { id: notification.id },
        data: {
          status: "FAILED",
          nextAttemptAt: new Date(Date.now() + orderEmailRetryDelayMs(notification.attempts)),
          failureReason: error instanceof Error ? error.message.slice(0, 500) : "Unknown error"
        }
      });
      failed += 1;
    }
  }

  return {
    sent,
    failed,
    skipped: false
  };
}

export async function requeueOrderEmail(context: ModuleContext, notificationId: string) {
  const queued = await context.prisma.orderNotification.updateMany({
    where: { id: notificationId, status: "FAILED" },
    data: {
      status: "QUEUED",
      attempts: 0,
      nextAttemptAt: new Date(),
      lastAttemptAt: null,
      failureReason: null
    }
  });
  if (queued.count === 1) {
    return deliverQueuedOrderEmails(context, { notificationId, limit: 1 });
  }

  const notification = await context.prisma.orderNotification.findUnique({
    where: { id: notificationId },
    select: { status: true }
  });
  if (!notification) {
    throw new AppError(404, "order_notification_not_found", "Order email was not found.");
  }
  if (notification.status === "SENT") {
    throw new AppError(409, "order_notification_already_sent", "This order email has already been sent.");
  }
  if (notification.status === "PROCESSING") {
    throw new AppError(409, "order_notification_in_progress", "This order email is already being delivered.");
  }
  throw new AppError(409, "order_notification_already_queued", "This order email is already queued for delivery.");
}
