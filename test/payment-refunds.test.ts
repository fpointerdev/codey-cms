import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import type { RequestHandler, Router } from "express";
import type { ModuleContext } from "../src/core/types/module.js";
import { processPaymentEvent } from "../src/modules/payments/payment-event.service.js";
import { createPaymentRefund } from "../src/modules/payments/payment-refund.service.js";
import { registerPaymentRoutes } from "../src/modules/payments/payments.routes.js";

function refundContext() {
  const payment = {
    id: "cm1234567890123456789012",
    provider: "MANUAL" as const,
    status: "SUCCEEDED" as const,
    orderId: "order-1",
    amountCents: 1_000,
    currency: "EUR",
    providerReference: "manual-payment-1",
    idempotencyKey: "payment-request-1",
    metadata: null as Record<string, unknown> | null,
    createdAt: new Date(),
    updatedAt: new Date()
  };
  const order = {
    id: "order-1",
    orderNumber: "CY-REFUND-1",
    customerEmail: "buyer@example.com",
    customerName: "Buyer",
    status: "PAID" as const,
    checkoutStatus: "COMPLETE" as const,
    currency: "EUR",
    subtotalCents: 1_000,
    taxCents: 0,
    shippingCents: 0,
    discountCents: 0,
    totalCents: 1_000,
    couponCode: null,
    shippingCountry: null,
    shippingRateId: null,
    checkoutEmailHash: null,
    checkoutIpHash: null,
    lookupTokenHash: null,
    metadata: null as Record<string, unknown> | null,
    createdAt: new Date(),
    updatedAt: new Date(),
    items: [{
      id: "item-1",
      orderId: "order-1",
      productId: "product-1",
      variantId: null,
      productName: "Product",
      variantName: null,
      sku: "PRODUCT-1",
      unitPriceCents: 1_000,
      quantity: 1,
      metadata: null,
      createdAt: new Date()
    }]
  };
  const refunds: Array<Record<string, any>> = [];
  const supportCases: Array<Record<string, any>> = [];
  const webhooks: Array<Record<string, any>> = [];
  const notifications: Array<Record<string, any>> = [];

  const prisma = {
    $queryRaw: async () => [],
    $transaction: async (operation: (tx: typeof prisma) => Promise<unknown>) => operation(prisma),
    inventoryReservation: {
      findMany: async () => []
    },
    payment: {
      findUnique: async ({ where }: { where: { id: string } }) => where.id === payment.id ? payment : null,
      findUniqueOrThrow: async () => payment,
      update: async ({ data }: { data: Record<string, any> }) => {
        Object.assign(payment, data, { updatedAt: new Date() });
        return payment;
      }
    },
    order: {
      findUnique: async ({ where }: { where: { id: string } }) => where.id === order.id ? order : null,
      update: async ({ data }: { data: Record<string, any> }) => {
        Object.assign(order, data, { updatedAt: new Date() });
        return order;
      }
    },
    paymentRefund: {
      findUnique: async ({ where }: { where: { id?: string; idempotencyKey?: string } }) =>
        refunds.find((refund) => where.id ? refund.id === where.id : refund.idempotencyKey === where.idempotencyKey) || null,
      findUniqueOrThrow: async ({ where }: { where: { id: string } }) => {
        const refund = refunds.find((item) => item.id === where.id);
        if (!refund) throw new Error("Refund not found");
        return refund;
      },
      findFirst: async ({ where }: { where: Record<string, unknown> }) => refunds.find((refund) => (
        (!where.id || refund.id === where.id) &&
        (!where.paymentId || refund.paymentId === where.paymentId) &&
        (!where.provider || refund.provider === where.provider) &&
        (!where.providerReference || refund.providerReference === where.providerReference) &&
        (!where.status || refund.status === where.status)
      )) || null,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const now = new Date();
        const refund = {
          id: `cmrefund${String(refunds.length + 1).padStart(17, "0")}`,
          status: "PENDING",
          providerReference: null,
          supportCaseId: null,
          failureMessage: null,
          completedAt: null,
          createdAt: now,
          updatedAt: now,
          ...data
        };
        refunds.push(refund);
        return refund;
      },
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const refund = refunds.find((item) => item.id === where.id);
        if (!refund) throw new Error("Refund not found");
        Object.assign(refund, data, { updatedAt: new Date() });
        return refund;
      },
      updateMany: async ({ where, data }: { where: { id: string; status?: string }; data: Record<string, unknown> }) => {
        const refund = refunds.find((item) => item.id === where.id && (!where.status || item.status === where.status));
        if (refund) Object.assign(refund, data, { updatedAt: new Date() });
        return { count: refund ? 1 : 0 };
      },
      delete: async ({ where }: { where: { id: string } }) => {
        const index = refunds.findIndex((item) => item.id === where.id);
        if (index < 0) throw new Error("Refund not found");
        return refunds.splice(index, 1)[0];
      }
    },
    orderSupportCase: {
      findFirst: async ({ where }: { where: Record<string, unknown> }) => supportCases.find((supportCase) => (
        (!where.id || supportCase.id === where.id) &&
        (!where.orderId || supportCase.orderId === where.orderId) &&
        (!where.type || supportCase.type === where.type)
      )) || null,
      findUnique: async ({ where }: { where: { id: string } }) =>
        supportCases.find((supportCase) => supportCase.id === where.id) || null,
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const supportCase = supportCases.find((item) => item.id === where.id);
        if (!supportCase) throw new Error("Support case not found");
        Object.assign(supportCase, data, { updatedAt: new Date() });
        return supportCase;
      }
    },
    paymentWebhook: {
      findUnique: async ({ where }: { where: { providerEventId: string } }) =>
        webhooks.find((webhook) => webhook.providerEventId === where.providerEventId) || null,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const webhook = {
          id: `webhook-${webhooks.length + 1}`,
          processedAt: null,
          createdAt: new Date(),
          ...data
        };
        webhooks.push(webhook);
        return webhook;
      },
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const webhook = webhooks.find((item) => item.id === where.id);
        if (!webhook) throw new Error("Webhook not found");
        Object.assign(webhook, data);
        return webhook;
      }
    },
    orderNotification: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        notifications.push(data);
        return data;
      }
    },
    auditLog: {
      create: async ({ data }: { data: Record<string, unknown> }) => ({ id: "audit-1", ...data })
    },
    site: {
      upsert: async () => ({ id: "site-1" })
    },
    moduleSetting: {
      findUnique: async () => null
    }
  };

  return {
    context: {
      prisma,
      config: {
        app: { name: "CodeY Test", mode: "shop", publicUrl: "https://shop.example.com" },
        auth: { recoveryTokenDelivery: "response" },
        commerce: {
          checkout: {
            rateLimitMax: 100,
            rateLimitWindowMs: 60_000
          }
        },
        email: { driver: "disabled", timeoutMs: 5_000 },
        payments: { credentialEncryptionKey: "test-payment-key-with-32-characters" },
        isProduction: false
      }
    } as unknown as ModuleContext,
    payment,
    order,
    refunds,
    supportCases,
    notifications
  };
}

test("manual refunds are atomic, partial, idempotent, and buyer-notified", async () => {
  const harness = refundContext();
  const firstInput = {
    paymentId: harness.payment.id,
    amountCents: 400,
    reason: "CUSTOMER_REQUEST" as const,
    note: "Customer requested a partial refund.",
    idempotencyKey: "refund-request-1",
    initiatedByUserId: "owner-1"
  };

  const first = await createPaymentRefund(harness.context, firstInput);
  assert.equal(first.refund.status, "SUCCEEDED");
  assert.equal(harness.payment.status, "SUCCEEDED");
  assert.deepEqual(harness.payment.metadata, { refundedCents: 400 });
  assert.deepEqual(harness.order.metadata, { refundedCents: 400 });
  assert.equal(harness.notifications.length, 1);
  assert.match(String(harness.notifications[0]?.body), /4\.00/);

  const duplicate = await createPaymentRefund(harness.context, firstInput);
  assert.equal(duplicate.duplicate, true);
  assert.equal(harness.refunds.length, 1);
  assert.equal(harness.notifications.length, 1);

  const final = await createPaymentRefund(harness.context, {
    ...firstInput,
    amountCents: 600,
    idempotencyKey: "refund-request-2"
  });
  assert.equal(final.refund.status, "SUCCEEDED");
  assert.equal(harness.payment.status, "REFUNDED");
  assert.equal(harness.order.status, "REFUNDED");
  assert.deepEqual(harness.order.metadata, { refundedCents: 1_000 });
  assert.equal(harness.refunds.length, 2);
  assert.equal(harness.notifications.length, 2);
});

test("refunds cannot exceed the unrefunded payment balance", async () => {
  const harness = refundContext();

  await assert.rejects(
    createPaymentRefund(harness.context, {
      paymentId: harness.payment.id,
      amountCents: 1_001,
      reason: "OTHER",
      idempotencyKey: "refund-too-large"
    }),
    (error: unknown) => Boolean(
      error && typeof error === "object" && "code" in error && error.code === "payment_refund_amount_invalid"
    )
  );
  assert.equal(harness.refunds.length, 0);
});

test("approved buyer refund requests resolve only after the refund succeeds", async () => {
  const harness = refundContext();
  harness.supportCases.push({
    id: "cm1234567890123456789013",
    orderId: harness.order.id,
    type: "REFUND",
    status: "APPROVED",
    subject: "Item arrived damaged",
    message: "The item cannot be used in its delivered condition.",
    requestedRefundCents: 400,
    merchantResponse: "Approved.",
    resolvedAt: null,
    createdAt: new Date(),
    updatedAt: new Date()
  });

  const result = await createPaymentRefund(harness.context, {
    paymentId: harness.payment.id,
    amountCents: 400,
    reason: "CUSTOMER_REQUEST",
    idempotencyKey: "approved-refund-request",
    supportCaseId: "cm1234567890123456789013"
  });

  assert.equal(result.refund.status, "SUCCEEDED");
  assert.equal(result.refund.supportCaseId, "cm1234567890123456789013");
  assert.equal(harness.supportCases[0]?.status, "RESOLVED");
  assert.ok(harness.supportCases[0]?.resolvedAt instanceof Date);

  Object.assign(result.refund, { status: "FAILED", completedAt: null });
  Object.assign(harness.supportCases[0], { status: "REJECTED" });
  await assert.rejects(
    createPaymentRefund(harness.context, {
      paymentId: harness.payment.id,
      amountCents: 400,
      reason: "CUSTOMER_REQUEST",
      idempotencyKey: "approved-refund-request",
      retryRefundId: result.refund.id,
      supportCaseId: "cm1234567890123456789013"
    }),
    (error: unknown) => Boolean(
      error && typeof error === "object" && "code" in error && error.code === "refund_request_not_approved"
    )
  );
});

test("refund claims reject invalid state and conflicting retries", async () => {
  const failedPayment = refundContext();
  Object.assign(failedPayment.payment, { status: "FAILED" });
  await assert.rejects(
    createPaymentRefund(failedPayment.context, {
      paymentId: failedPayment.payment.id,
      amountCents: 100,
      reason: "OTHER",
      idempotencyKey: "refund-failed-payment"
    }),
    (error: unknown) => Boolean(
      error && typeof error === "object" && "code" in error && error.code === "payment_not_refundable"
    )
  );

  const missingOrder = refundContext();
  Object.assign(missingOrder.order, { status: "CANCELLED" });
  await assert.rejects(
    createPaymentRefund(missingOrder.context, {
      paymentId: missingOrder.payment.id,
      amountCents: 100,
      reason: "OTHER",
      idempotencyKey: "refund-cancelled-order"
    }),
    (error: unknown) => Boolean(
      error && typeof error === "object" && "code" in error && error.code === "order_not_refundable"
    )
  );

  const conflict = refundContext();
  const input = {
    paymentId: conflict.payment.id,
    amountCents: 100,
    reason: "OTHER" as const,
    note: "Original note",
    idempotencyKey: "refund-conflict"
  };
  await createPaymentRefund(conflict.context, input);
  await assert.rejects(
    createPaymentRefund(conflict.context, { ...input, note: "Changed note" }),
    (error: unknown) => Boolean(
      error && typeof error === "object" && "code" in error && error.code === "payment_refund_idempotency_conflict"
    )
  );

  const completed = conflict.refunds[0];
  Object.assign(completed, { status: "FAILED", completedAt: null });
  Object.assign(conflict.payment, { metadata: { refundedCents: 950 } });
  await assert.rejects(
    createPaymentRefund(conflict.context, { ...input, retryRefundId: completed.id }),
    (error: unknown) => Boolean(
      error && typeof error === "object" && "code" in error && error.code === "payment_refund_amount_invalid"
    )
  );
});

test("provider failure events close pending refunds without changing the paid balance", async () => {
  const harness = refundContext();
  const now = new Date();
  harness.refunds.push({
    id: "cmrefund00000000000000001",
    paymentId: harness.payment.id,
    provider: "MANUAL",
    status: "PENDING",
    amountCents: 400,
    currency: "EUR",
    reason: "OTHER",
    note: null,
    idempotencyKey: "pending-refund",
    providerReference: "provider-refund-1",
    failureMessage: null,
    initiatedByUserId: null,
    supportCaseId: null,
    completedAt: null,
    createdAt: now,
    updatedAt: now
  });

  const result = await processPaymentEvent(harness.context, {
    provider: "MANUAL",
    eventType: "payment.refund_failed",
    providerEventId: "refund-failed-event-1",
    providerReference: harness.payment.providerReference,
    paymentId: harness.payment.id,
    refundReference: "provider-refund-1",
    amountCents: 400,
    currency: "EUR",
    failureMessage: "Provider settlement failed.",
    payload: { status: "failed" }
  });

  assert.equal(result.refund?.status, "FAILED");
  assert.equal(result.refund?.failureMessage, "Provider settlement failed.");
  assert.equal(harness.payment.status, "SUCCEEDED");
  assert.equal(harness.payment.metadata, null);
  assert.equal(harness.order.status, "PAID");
  assert.equal(harness.notifications.length, 0);
});

test("cumulative and exact provider events do not apply the same refund twice", async () => {
  const harness = refundContext();
  const cumulative = await processPaymentEvent(harness.context, {
    provider: "MANUAL",
    eventType: "payment.refunded",
    providerEventId: "charge-refunded-1",
    providerReference: harness.payment.providerReference,
    paymentId: harness.payment.id,
    amountCents: 400,
    currency: "EUR",
    refundAmountIsCumulative: true,
    payload: { amount_refunded: 400 }
  });
  assert.equal(cumulative.refundedCents, 400);
  assert.equal(harness.notifications.length, 1);

  const exact = await processPaymentEvent(harness.context, {
    provider: "MANUAL",
    eventType: "payment.refunded",
    providerEventId: "refund-created-1",
    providerReference: harness.payment.providerReference,
    paymentId: harness.payment.id,
    refundReference: "provider-refund-1",
    amountCents: 400,
    currency: "EUR",
    payload: { id: "provider-refund-1", amount: 400 }
  });

  assert.equal(exact.refundedCents, 400);
  assert.equal(harness.refunds.length, 1);
  assert.equal(harness.refunds[0]?.providerReference, "provider-refund-1");
  assert.equal(harness.notifications.length, 1);
});

test("provider response races resolve an approved buyer refund request", async () => {
  const harness = refundContext();
  const supportCaseId = "cm1234567890123456789013";
  harness.supportCases.push({
    id: supportCaseId,
    orderId: harness.order.id,
    type: "REFUND",
    status: "APPROVED",
    subject: "Refund request",
    message: "Please refund this item.",
    requestedRefundCents: 400,
    merchantResponse: "Approved.",
    resolvedAt: null,
    createdAt: new Date(),
    updatedAt: new Date()
  });

  const paymentRefund = (harness.context.prisma as any).paymentRefund;
  const originalUpdate = paymentRefund.update.bind(paymentRefund);
  let raceInjected = false;
  paymentRefund.update = async (input: {
    where: { id: string };
    data: Record<string, unknown>;
  }) => {
    if (!raceInjected && input.data.providerReference) {
      raceInjected = true;
      harness.refunds.push({
        ...harness.refunds[0],
        id: "cmrefund00000000000000099",
        status: "SUCCEEDED",
        providerReference: input.data.providerReference,
        idempotencyKey: "webhook:MANUAL:refund-race",
        supportCaseId: null,
        completedAt: new Date()
      });
      Object.assign(harness.payment, { metadata: { refundedCents: 400 } });
      Object.assign(harness.order, { metadata: { refundedCents: 400 } });
      throw new Prisma.PrismaClientKnownRequestError("Duplicate provider refund", {
        code: "P2002",
        clientVersion: "6.19.3"
      });
    }
    return originalUpdate(input);
  };

  const result = await createPaymentRefund(harness.context, {
    paymentId: harness.payment.id,
    amountCents: 400,
    reason: "CUSTOMER_REQUEST",
    idempotencyKey: "refund-race-request",
    supportCaseId,
    initiatedByUserId: "owner-1"
  });

  assert.equal(result.duplicate, true);
  assert.equal(result.refund.status, "SUCCEEDED");
  assert.equal(harness.refunds.length, 1);
  assert.equal(harness.refunds[0]?.supportCaseId, supportCaseId);
  assert.equal(harness.supportCases[0]?.status, "RESOLVED");
  assert.ok(harness.supportCases[0]?.resolvedAt instanceof Date);
});

test("payment routes register the guarded refund endpoint", () => {
  const harness = refundContext();
  const routes: Array<{ method: string; path: string; handlers: RequestHandler[] }> = [];
  const router = {} as Router & Record<"get" | "post" | "put", Function>;
  const register = (method: string) => (path: string, ...handlers: unknown[]) => {
    routes.push({
      method,
      path,
      handlers: handlers.flat(Number.POSITIVE_INFINITY).filter((handler): handler is RequestHandler =>
        typeof handler === "function")
    });
    return router;
  };
  router.get = register("GET") as typeof router.get;
  router.post = register("POST") as typeof router.post;
  router.put = register("PUT") as typeof router.put;
  registerPaymentRoutes(router, harness.context);

  const route = routes.find((entry) =>
    entry.method === "POST" && entry.path === "/:paymentId/refunds");
  assert.ok(route);
  assert.equal(route.handlers.length, 5);
});
