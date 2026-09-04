import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import type { ModuleContext } from "../src/core/types/module.js";
import {
  anonymizeCustomerData,
  anonymizedCustomerEmail,
  exportCustomerData
} from "../src/modules/orders/customer-data.service.js";
import {
  customerDataAnonymizeSchema,
  customerDataExportSchema
} from "../src/modules/orders/orders.schemas.js";

test("customer anonymization creates a stable non-deliverable address", () => {
  const first = anonymizedCustomerEmail(" Customer@Example.com ");
  const second = anonymizedCustomerEmail("customer@example.com");

  assert.equal(first, second);
  assert.match(first, /^redacted-[a-f0-9]{16}@example\.invalid$/);
  assert.equal(first.includes("customer"), false);
});

test("customer data operations require a valid email and explicit destructive confirmation", () => {
  assert.equal(customerDataExportSchema.safeParse({ email: "customer@example.com" }).success, true);
  assert.equal(customerDataExportSchema.safeParse({ email: "not-an-email" }).success, false);
  assert.equal(customerDataAnonymizeSchema.safeParse({
    email: "customer@example.com",
    confirmation: "ANONYMIZE"
  }).success, true);
  assert.equal(customerDataAnonymizeSchema.safeParse({
    email: "customer@example.com",
    confirmation: "DELETE"
  }).success, false);
});

test("customer exports include the durable refund history", async () => {
  let paymentQuery: Record<string, unknown> | undefined;
  const refund = { id: "refund-1", amountCents: 500, currency: "EUR", status: "SUCCEEDED" };
  const context = {
    prisma: {
      order: { findMany: async () => [{ id: "order-1", notifications: [] }] },
      cart: { findMany: async () => [] },
      payment: {
        findMany: async (query: Record<string, unknown>) => {
          paymentQuery = query;
          return [{
            id: "payment-1",
            provider: "STRIPE",
            providerReference: "pi_customer",
            refunds: [refund]
          }];
        }
      },
      paymentWebhook: { findMany: async () => [] }
    }
  } as unknown as ModuleContext;

  const result = await exportCustomerData(context, "customer@example.com");

  assert.equal(result.schemaVersion, 3);
  assert.deepEqual(result.payments[0]?.refunds, [refund]);
  assert.deepEqual(paymentQuery?.include, {
    refunds: { orderBy: { createdAt: "asc" } }
  });
});

test("customer exports avoid unrelated payment and webhook queries", async () => {
  let paymentQueried = false;
  let webhookQueried = false;
  const context = {
    prisma: {
      order: { findMany: async () => [] },
      cart: { findMany: async () => [] },
      payment: {
        findMany: async () => {
          paymentQueried = true;
          return [];
        }
      },
      paymentWebhook: {
        findMany: async () => {
          webhookQueried = true;
          return [];
        }
      }
    }
  } as unknown as ModuleContext;

  const result = await exportCustomerData(context, "missing@example.com");

  assert.deepEqual(result.payments, []);
  assert.deepEqual(result.paymentWebhooks, []);
  assert.equal(paymentQueried, false);
  assert.equal(webhookQueried, false);
});

test("customer exports do not query webhooks for payments without provider references", async () => {
  let webhookQueried = false;
  const context = {
    prisma: {
      order: { findMany: async () => [{ id: "order-1", notifications: [] }] },
      cart: { findMany: async () => [] },
      payment: {
        findMany: async () => [{
          id: "payment-1",
          provider: "MANUAL",
          providerReference: null,
          refunds: []
        }]
      },
      paymentWebhook: {
        findMany: async () => {
          webhookQueried = true;
          return [];
        }
      }
    }
  } as unknown as ModuleContext;

  const result = await exportCustomerData(context, "customer@example.com");

  assert.equal(result.payments.length, 1);
  assert.deepEqual(result.paymentWebhooks, []);
  assert.equal(webhookQueried, false);
});

test("customer anonymization clears linked commerce metadata and webhook payloads", async () => {
  const calls: Record<string, unknown> = {};
  const transaction = {
    order: {
      findMany: async () => [{ id: "order-1" }],
      updateMany: async (args: unknown) => { calls.order = args; }
    },
    cart: {
      findMany: async () => [{ id: "cart-1" }],
      deleteMany: async (args: unknown) => { calls.cart = args; }
    },
    payment: {
      findMany: async () => [{ provider: "STRIPE", providerReference: "pi_customer" }],
      updateMany: async (args: unknown) => { calls.payment = args; }
    },
    paymentRefund: {
      updateMany: async (args: unknown) => { calls.paymentRefund = args; }
    },
    paymentWebhook: {
      updateMany: async (args: unknown) => {
        calls.paymentWebhook = args;
        return { count: 2 };
      }
    },
    orderNotification: {
      updateMany: async (args: unknown) => { calls.notification = args; }
    },
    orderItem: {
      updateMany: async (args: unknown) => { calls.orderItem = args; }
    },
    orderSupportCase: {
      updateMany: async (args: unknown) => { calls.supportCase = args; }
    },
    orderTracking: {
      updateMany: async (args: unknown) => { calls.tracking = args; }
    },
    buyerSessionOrder: {
      findMany: async (args: unknown) => {
        calls.buyerSessionOrderFind = args;
        return [{ sessionId: "session-1" }];
      },
      deleteMany: async (args: unknown) => { calls.buyerSessionOrder = args; }
    },
    buyerSession: {
      deleteMany: async (args: unknown) => { calls.buyerSession = args; }
    },
    auditLog: {
      create: async ({ data }: { data: Record<string, unknown> }) => ({ id: "audit-1", ...data })
    }
  };
  const context = {
    prisma: {
      $transaction: async (operation: (tx: typeof transaction) => Promise<unknown>) => operation(transaction)
    }
  } as unknown as ModuleContext;

  const result = await anonymizeCustomerData(context, "customer@example.com", {
    actorUserId: "owner-1"
  });

  assert.deepEqual(calls.orderItem, {
    where: { orderId: { in: ["order-1"] } },
    data: { metadata: Prisma.DbNull }
  });
  assert.deepEqual(calls.buyerSessionOrder, {
    where: { orderId: { in: ["order-1"] } }
  });
  assert.deepEqual(calls.buyerSession, {
    where: {
      id: { in: ["session-1"] },
      orders: { none: {} }
    }
  });
  assert.deepEqual(calls.tracking, {
    where: { orderId: { in: ["order-1"] } },
    data: { trackingNumber: null, trackingUrl: null, note: null }
  });
  assert.deepEqual(calls.paymentRefund, {
    where: { payment: { orderId: { in: ["order-1"] } } },
    data: { note: null, failureMessage: null }
  });
  const webhookUpdate = calls.paymentWebhook as {
    where: unknown;
    data: { payload: { anonymized: boolean; anonymizedAt: string } };
  };
  assert.deepEqual(webhookUpdate.where, {
    OR: [{ provider: "STRIPE", providerReference: "pi_customer" }]
  });
  assert.equal(webhookUpdate.data.payload.anonymized, true);
  assert.match(webhookUpdate.data.payload.anonymizedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(result.paymentWebhooksAnonymized, 2);
});

test("customer anonymization does not remove unrelated empty buyer sessions", async () => {
  let buyerSessionDeleted = false;
  const transaction = {
    order: { findMany: async () => [] },
    cart: {
      findMany: async () => [],
      deleteMany: async () => ({ count: 0 })
    },
    buyerSessionOrder: {
      findMany: async () => {
        throw new Error("No order membership lookup expected.");
      }
    },
    buyerSession: {
      deleteMany: async () => {
        buyerSessionDeleted = true;
      }
    },
    auditLog: {
      create: async ({ data }: { data: Record<string, unknown> }) => ({ id: "audit-2", ...data })
    }
  };
  const context = {
    prisma: {
      $transaction: async (operation: (tx: typeof transaction) => Promise<unknown>) => operation(transaction)
    }
  } as unknown as ModuleContext;

  const result = await anonymizeCustomerData(context, "missing@example.com", {
    actorUserId: "owner-1"
  });

  assert.deepEqual(result, {
    ordersAnonymized: 0,
    cartsDeleted: 0,
    paymentWebhooksAnonymized: 0
  });
  assert.equal(buyerSessionDeleted, false);
});
