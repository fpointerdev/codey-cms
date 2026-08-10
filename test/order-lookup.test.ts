import assert from "node:assert/strict";
import test from "node:test";
import type { Prisma } from "@prisma/client";
import { encryptSecretEnvelope } from "../src/core/security/secret-envelope.js";
import {
  orderNotificationMessage,
  queueOrderEmail
} from "../src/modules/orders/order-email.service.js";
import {
  adminOrderDto,
  createOrderLookupCredential,
  hashOrderLookupToken,
  orderLookupTokenMatches,
  publicOrderDto
} from "../src/modules/orders/order-lookup.js";

test("order lookup credentials store a hash and compare safely", () => {
  const credential = createOrderLookupCredential();

  assert.match(credential.lookupToken, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(credential.lookupTokenHash, hashOrderLookupToken(credential.lookupToken));
  assert.notEqual(credential.lookupTokenHash, credential.lookupToken);
  assert.equal(orderLookupTokenMatches(credential.lookupTokenHash, credential.lookupToken), true);
  assert.equal(orderLookupTokenMatches(credential.lookupTokenHash, `${credential.lookupToken}x`), false);
  assert.equal(orderLookupTokenMatches(null, credential.lookupToken), false);
});

test("public and admin order DTOs exclude lookup internals", () => {
  const createdAt = new Date("2026-08-10T08:00:00.000Z");
  const publicOrder = publicOrderDto({
    orderNumber: "ORD-100",
    status: "PENDING",
    checkoutStatus: "PAYMENT_PENDING",
    currency: "EUR",
    subtotalCents: 1000,
    discountCents: 100,
    shippingCents: 200,
    taxCents: 50,
    totalCents: 1150,
    createdAt,
    items: [{
      productName: "Example",
      variantName: null,
      quantity: 1,
      unitPriceCents: 1000
    }]
  });
  assert.deepEqual(Object.keys(publicOrder), [
    "orderNumber",
    "status",
    "checkoutStatus",
    "currency",
    "subtotalCents",
    "discountCents",
    "shippingCents",
    "taxCents",
    "totalCents",
    "createdAt",
    "items"
  ]);
  assert.deepEqual(Object.keys(publicOrder.items[0]!), [
    "productName",
    "variantName",
    "quantity",
    "unitPriceCents"
  ]);

  const adminOrder = adminOrderDto({
    id: "order-1",
    lookupTokenHash: "hidden",
    notifications: [{ id: "notice-1", secretEnvelope: "hidden" }]
  });
  assert.equal("lookupTokenHash" in adminOrder, false);
  assert.equal("secretEnvelope" in adminOrder.notifications[0]!, false);
});

test("confirmation jobs store only an encrypted lookup token", async () => {
  const encryptionKey = "test-order-lookup-encryption-key-32";
  const lookupToken = createOrderLookupCredential().lookupToken;
  const secretEnvelope = encryptSecretEnvelope(encryptionKey, { lookupToken });
  let createData: Record<string, unknown> | undefined;
  const tx = {
    orderNotification: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        createData = data;
        return data;
      }
    }
  } as unknown as Prisma.TransactionClient;
  const order = {
    id: "order-1",
    orderNumber: "ORD-100",
    customerEmail: "customer@example.com",
    status: "PENDING",
    currency: "EUR",
    totalCents: 1000,
    items: [{
      productName: "Example",
      variantName: null,
      unitPriceCents: 1000,
      quantity: 1
    }]
  };

  await queueOrderEmail(tx, order as never, {
    eventType: "ORDER_RECEIVED",
    secretEnvelope
  });

  assert.ok(createData);
  assert.equal(JSON.stringify(createData).includes(lookupToken), false);
  const message = orderNotificationMessage({
    body: String(createData.body),
    htmlBody: String(createData.htmlBody),
    secretEnvelope: String(createData.secretEnvelope)
  }, encryptionKey);
  assert.match(message.text, new RegExp(lookupToken));
  assert.match(message.html ?? "", new RegExp(lookupToken));
  assert.doesNotMatch(message.text, /CODEY_ORDER_LOOKUP_TOKEN/);
});
