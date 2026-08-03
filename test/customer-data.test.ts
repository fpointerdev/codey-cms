import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import type { ModuleContext } from "../src/core/types/module.js";
import {
  anonymizeCustomerData,
  anonymizedCustomerEmail
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
