import type { OrderNotificationEvent, OrderStatus, Prisma } from "@prisma/client";
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
};

type DeliverQueuedOrderEmailsOptions = {
  orderId?: string;
  limit?: number;
};

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
      "",
      "Items:",
      itemsText
    ].join("\n"),
    htmlBody: `<p>Thank you. Your order <strong>${escapeHtml(order.orderNumber)}</strong> was received.</p><p>Total: ${escapeHtml(total)}</p><ul>${itemsHtml}</ul>`
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
      htmlBody: email.htmlBody
    }
  });
}

export async function deliverQueuedOrderEmails(
  context: ModuleContext,
  options: DeliverQueuedOrderEmailsOptions = {}
) {
  if (!isEmailDeliveryConfigured(context.config)) {
    return {
      sent: 0,
      failed: 0,
      skipped: true
    };
  }

  const emailClient = createEmailClient(context.config);
  const notifications = await context.prisma.orderNotification.findMany({
    where: {
      status: "QUEUED",
      ...(options.orderId ? { orderId: options.orderId } : {})
    },
    orderBy: { createdAt: "asc" },
    take: options.limit ?? 25
  });
  let sent = 0;
  let failed = 0;

  for (const notification of notifications) {
    try {
      await emailClient.send({
        to: notification.recipient,
        from: context.config.email.from!,
        subject: notification.subject,
        text: notification.body,
        html: notification.htmlBody ?? undefined,
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
          attempts: { increment: 1 },
          lastAttemptAt: new Date(),
          failureReason: null
        }
      });
      sent += 1;
    } catch (error) {
      await context.prisma.orderNotification.update({
        where: { id: notification.id },
        data: {
          status: "FAILED",
          attempts: { increment: 1 },
          lastAttemptAt: new Date(),
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
