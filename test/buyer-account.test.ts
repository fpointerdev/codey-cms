import assert from "node:assert/strict";
import test from "node:test";
import type { ModuleContext } from "../src/core/types/module.js";
import {
  attachOrderToBuyerSession,
  buyerOrderDto,
  buyerSessionCookieName,
  cancelBuyerOrder,
  claimBuyerOrder,
  createBuyerSupportCase,
  deleteExpiredBuyerSessions,
  forgetBuyerSession,
  listBuyerOrders
} from "../src/modules/orders/buyer-account.service.js";
import {
  createOrderLookupCredential
} from "../src/modules/orders/order-lookup.js";
import {
  cancelBuyerOrderSchema,
  createBuyerSupportCaseSchema,
  updateOrderTrackingSchema
} from "../src/modules/orders/orders.schemas.js";

const validBuyerToken = "a".repeat(43);

function buyerContext(prisma: Record<string, unknown>, isProduction = false) {
  return {
    prisma,
    config: {
      isProduction,
      app: {
        name: "CodeY Shop",
        mode: "cms",
        publicUrl: "https://shop.example"
      },
      auth: { recoveryTokenDelivery: "response" },
      email: { driver: "disabled", timeoutMs: 5_000 },
      payments: { credentialEncryptionKey: "test-payment-key-with-32-characters" },
      security: { credentialEncryptionKey: "test-security-key-with-32-characters" }
    }
  } as unknown as ModuleContext;
}

function sampleBuyerOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: "order-1",
    orderNumber: "CY-100",
    customerEmail: "private@example.com",
    customerName: "Private Buyer",
    status: "PAID",
    checkoutStatus: "COMPLETE",
    currency: "EUR",
    subtotalCents: 2400,
    discountCents: 0,
    shippingCents: 300,
    taxCents: 0,
    totalCents: 2700,
    createdAt: new Date("2026-08-17T08:00:00.000Z"),
    updatedAt: new Date("2026-08-17T09:00:00.000Z"),
    items: [{
      id: "item-internal",
      orderId: "order-1",
      productId: "product-internal",
      variantId: null,
      productName: "Studio chair",
      variantName: null,
      sku: "CHAIR-1",
      unitPriceCents: 2400,
      quantity: 1,
      metadata: null,
      createdAt: new Date("2026-08-17T08:00:00.000Z")
    }],
    tracking: null,
    supportCases: [],
    ...overrides
  };
}

function cookieRecorder() {
  const cookies: Array<{
    name: string;
    value: string;
    options: Record<string, unknown>;
  }> = [];
  const cleared: Array<{ name: string; options: Record<string, unknown> }> = [];
  return {
    cookies,
    cleared,
    response: {
      cookie(name: string, value: string, options: Record<string, unknown>) {
        cookies.push({ name, value, options });
      },
      clearCookie(name: string, options: Record<string, unknown>) {
        cleared.push({ name, options });
      }
    }
  };
}

test("buyer order responses expose fulfillment details without customer identity or internal ids", () => {
  const order = buyerOrderDto({
    id: "order-internal",
    orderNumber: "CY-100",
    customerEmail: "private@example.com",
    customerName: "Private Buyer",
    status: "PAID",
    checkoutStatus: "COMPLETE",
    currency: "EUR",
    subtotalCents: 2400,
    discountCents: 0,
    shippingCents: 300,
    taxCents: 0,
    totalCents: 2700,
    createdAt: new Date("2026-08-17T08:00:00.000Z"),
    updatedAt: new Date("2026-08-17T09:00:00.000Z"),
    items: [{
      id: "item-internal",
      orderId: "order-internal",
      productId: "product-internal",
      variantId: null,
      productName: "Studio chair",
      variantName: null,
      sku: "CHAIR-1",
      unitPriceCents: 2400,
      quantity: 1,
      metadata: null,
      createdAt: new Date("2026-08-17T08:00:00.000Z")
    }],
    tracking: {
      id: "tracking-internal",
      orderId: "order-internal",
      status: "IN_TRANSIT",
      carrier: "Parcel service",
      trackingNumber: "TRACK-1",
      trackingUrl: "javascript:alert(1)",
      estimatedDeliveryAt: null,
      shippedAt: new Date("2026-08-17T09:00:00.000Z"),
      deliveredAt: null,
      note: null,
      createdAt: new Date("2026-08-17T09:00:00.000Z"),
      updatedAt: new Date("2026-08-17T09:00:00.000Z")
    },
    supportCases: [{
      id: "case-1",
      orderId: "order-internal",
      type: "COMPLAINT",
      status: "IN_REVIEW",
      subject: "Delivery question",
      message: "Please confirm delivery.",
      merchantResponse: "Confirmed.",
      resolvedAt: null,
      createdAt: new Date("2026-08-17T09:00:00.000Z"),
      updatedAt: new Date("2026-08-17T09:00:00.000Z")
    }]
  } as never);

  assert.equal("id" in order, false);
  assert.equal("customerEmail" in order, false);
  assert.ok(order.items[0]);
  assert.equal("sku" in order.items[0], false);
  assert.equal(order.tracking?.trackingUrl, null);
  assert.equal(order.supportCases[0]?.merchantResponse, "Confirmed.");
  assert.equal("id" in (order.supportCases[0] ?? {}), false);
});

test("buyer actions are bounded and tracking links require HTTP or HTTPS", () => {
  assert.equal(cancelBuyerOrderSchema.safeParse({ reason: "Changed my mind" }).success, true);
  assert.equal(cancelBuyerOrderSchema.safeParse({ reason: "x" }).success, false);
  assert.equal(createBuyerSupportCaseSchema.safeParse({
    type: "COMPLAINT",
    subject: "Damaged package",
    message: "The package arrived with visible damage."
  }).success, true);
  assert.equal(createBuyerSupportCaseSchema.safeParse({
    type: "CANCELLATION",
    subject: "Bypass",
    message: "Cancellation must use its dedicated workflow."
  }).success, false);
  assert.equal(updateOrderTrackingSchema.safeParse({
    status: "SHIPPED",
    trackingUrl: "https://carrier.example/track/1"
  }).success, true);
  assert.equal(updateOrderTrackingSchema.safeParse({
    status: "SHIPPED",
    trackingUrl: "javascript:alert(1)"
  }).success, false);
  assert.equal(updateOrderTrackingSchema.safeParse({
    status: "SHIPPED",
    trackingUrl: "not a URL"
  }).success, false);
  assert.equal(updateOrderTrackingSchema.safeParse({
    status: "SHIPPED",
    trackingUrl: "http://carrier.example/track/1"
  }).success, true);
});

test("checkout creates a private buyer session and reuses it on later orders", async () => {
  const expiresAt = new Date(Date.now() + 60_000);
  const createdMemberships: unknown[] = [];
  const newSessionContext = buyerContext({
    buyerSession: {
      create: async () => ({ id: "session-new", expiresAt })
    },
    buyerSessionOrder: {
      upsert: async (input: unknown) => createdMemberships.push(input)
    }
  });
  const first = cookieRecorder();

  await attachOrderToBuyerSession(newSessionContext, {}, first.response, "order-1");

  assert.equal(first.cookies[0]?.name, buyerSessionCookieName);
  assert.match(first.cookies[0]?.value ?? "", /^[A-Za-z0-9_-]{43}$/);
  assert.deepEqual(first.cookies[0]?.options, {
    httpOnly: true,
    secure: false,
    sameSite: "lax",
    path: "/",
    maxAge: 7_776_000_000
  });
  assert.equal(createdMemberships.length, 1);

  let touchedSession = false;
  const existingContext = buyerContext({
    buyerSession: {
      findFirst: async () => ({ id: "session-existing", expiresAt }),
      updateMany: async () => {
        touchedSession = true;
        return { count: 1 };
      }
    },
    buyerSessionOrder: {
      upsert: async () => undefined
    }
  }, true);
  const second = cookieRecorder();

  await attachOrderToBuyerSession(
    existingContext,
    { cookies: { [buyerSessionCookieName]: validBuyerToken } },
    second.response,
    "order-2"
  );

  assert.equal(touchedSession, true);
  assert.equal(second.cookies[0]?.value, validBuyerToken);
  assert.equal(second.cookies[0]?.options.secure, true);
  assert.ok(Number(second.cookies[0]?.options.maxAge) >= 1_000);
});

test("a session removed during reuse is replaced without losing the order", async () => {
  const expiresAt = new Date(Date.now() + 60_000);
  const createdMemberships: Array<Record<string, unknown>> = [];
  let createdSession = false;
  const context = buyerContext({
    buyerSession: {
      findFirst: async () => ({ id: "session-removed", expiresAt }),
      updateMany: async () => ({ count: 0 }),
      create: async () => {
        createdSession = true;
        return { id: "session-replacement", expiresAt };
      }
    },
    buyerSessionOrder: {
      upsert: async (input: Record<string, unknown>) => createdMemberships.push(input)
    }
  });
  const cookies = cookieRecorder();

  await attachOrderToBuyerSession(
    context,
    { cookies: { [buyerSessionCookieName]: validBuyerToken } },
    cookies.response,
    "order-2"
  );

  assert.equal(createdSession, true);
  assert.notEqual(cookies.cookies[0]?.value, validBuyerToken);
  assert.deepEqual(createdMemberships[0], {
    where: {
      sessionId_orderId: {
        sessionId: "session-replacement",
        orderId: "order-2"
      }
    },
    update: {},
    create: {
      sessionId: "session-replacement",
      orderId: "order-2"
    }
  });
});

test("buyers can forget only the current device session", async () => {
  let deletedWhere: unknown;
  const context = buyerContext({
    buyerSession: {
      deleteMany: async ({ where }: { where: unknown }) => {
        deletedWhere = where;
        return { count: 1 };
      }
    }
  }, true);
  const cookies = cookieRecorder();

  const result = await forgetBuyerSession(
    context,
    { cookies: { [buyerSessionCookieName]: validBuyerToken } },
    cookies.response
  );

  assert.deepEqual(result, { forgotten: true });
  assert.deepEqual(deletedWhere, {
    tokenHash: "66d34fba71f8f450f7e45598853e53bfc23bbd129027cbb131a2f4ffd7878cd0"
  });
  assert.deepEqual(cookies.cleared, [{
    name: buyerSessionCookieName,
    options: { httpOnly: true, secure: true, sameSite: "lax", path: "/" }
  }]);

  deletedWhere = undefined;
  await forgetBuyerSession(context, {
    cookies: { [buyerSessionCookieName]: "invalid" }
  }, cookies.response);
  assert.equal(deletedWhere, undefined);
  assert.equal(cookies.cleared.length, 2);
});

test("buyer history is empty without a valid session and strips private order data", async () => {
  const noSessionContext = buyerContext({
    buyerSession: { findFirst: async () => null }
  });
  assert.deepEqual(await listBuyerOrders(noSessionContext, {
    cookies: { [buyerSessionCookieName]: "invalid" }
  }), []);

  let lastSeenUpdated = false;
  const context = buyerContext({
    buyerSession: {
      findFirst: async () => ({ id: "session-1" }),
      updateMany: async () => {
        lastSeenUpdated = true;
      }
    },
    buyerSessionOrder: {
      findMany: async () => [{ order: sampleBuyerOrder() }]
    }
  });
  const orders = await listBuyerOrders(context, {
    cookies: { [buyerSessionCookieName]: validBuyerToken }
  });

  assert.equal(lastSeenUpdated, true);
  assert.equal(orders[0]?.orderNumber, "CY-100");
  assert.equal("customerEmail" in (orders[0] ?? {}), false);
});

test("receipt credentials claim only the matching order", async () => {
  const credential = createOrderLookupCredential();
  const membershipWrites: unknown[] = [];
  const context = buyerContext({
    order: {
      findUnique: async () => ({ id: "order-1", lookupTokenHash: credential.lookupTokenHash })
    },
    buyerSession: {
      create: async () => ({ id: "session-1", expiresAt: new Date(Date.now() + 60_000) }),
      updateMany: async () => undefined
    },
    buyerSessionOrder: {
      upsert: async (input: unknown) => membershipWrites.push(input),
      findMany: async () => [{ order: sampleBuyerOrder() }]
    }
  });
  const cookies = cookieRecorder();

  const orders = await claimBuyerOrder(context, {}, cookies.response, {
    orderNumber: "CY-100",
    lookupToken: credential.lookupToken
  });

  assert.equal(orders.length, 1);
  assert.equal(membershipWrites.length, 1);
  assert.equal(cookies.cookies[0]?.name, buyerSessionCookieName);

  await assert.rejects(
    () => claimBuyerOrder(context, {}, cookies.response, {
      orderNumber: "CY-100",
      lookupToken: "b".repeat(43)
    }),
    (error: unknown) => Boolean(
      error && typeof error === "object" && "code" in error && error.code === "order_not_found"
    )
  );
});

test("support requests require ownership and cap unresolved cases", async () => {
  const request = { cookies: { [buyerSessionCookieName]: validBuyerToken } };
  await assert.rejects(
    () => createBuyerSupportCase(
      buyerContext({ buyerSession: { findFirst: async () => null } }),
      request,
      "CY-100",
      {
        type: "OTHER",
        subject: "Missing session",
        message: "This request must not work without a buyer session."
      }
    ),
    (error: unknown) => Boolean(
      error && typeof error === "object" && "code" in error && error.code === "order_not_found"
    )
  );

  let createdCase: unknown;
  let lockedRows = [{ id: "order-1" }];
  const transaction = {
    buyerSessionOrder: {
      findFirst: async () => ({ order: sampleBuyerOrder() })
    },
    $queryRaw: async () => lockedRows,
    orderSupportCase: {
      count: async () => 0,
      create: async ({ data }: { data: unknown }) => {
        createdCase = data;
        return { id: "case-1", ...(data as object) };
      }
    }
  };
  const context = buyerContext({
    buyerSession: { findFirst: async () => ({ id: "session-1" }) },
    $transaction: async (operation: (tx: typeof transaction) => Promise<unknown>) => operation(transaction)
  });

  const supportCase = await createBuyerSupportCase(context, request, "CY-100", {
    type: "COMPLAINT",
    subject: "Damaged package",
    message: "The package arrived with visible damage."
  });
  assert.deepEqual(createdCase, {
    orderId: "order-1",
    type: "COMPLAINT",
    subject: "Damaged package",
    message: "The package arrived with visible damage."
  });
  assert.equal("id" in supportCase, false);

  transaction.orderSupportCase.count = async () => 5;
  await assert.rejects(
    () => createBuyerSupportCase(context, request, "CY-100", {
      type: "OTHER",
      subject: "Another question",
      message: "Please help with another order question."
    }),
    (error: unknown) => Boolean(
      error && typeof error === "object" && "code" in error &&
      error.code === "support_case_limit_reached"
    )
  );

  lockedRows = [];
  transaction.orderSupportCase.count = async () => 0;
  await assert.rejects(
    () => createBuyerSupportCase(context, request, "CY-100", {
      type: "OTHER",
      subject: "Order disappeared",
      message: "The order disappeared while this request was being created."
    }),
    (error: unknown) => Boolean(
      error && typeof error === "object" && "code" in error && error.code === "order_not_found"
    )
  );

  lockedRows = [{ id: "order-1" }];
  transaction.buyerSessionOrder.findFirst = async () => null;
  await assert.rejects(
    () => createBuyerSupportCase(context, request, "CY-404", {
      type: "OTHER",
      subject: "Unknown order",
      message: "This order does not belong to the session."
    }),
    (error: unknown) => Boolean(
      error && typeof error === "object" && "code" in error && error.code === "order_not_found"
    )
  );
});

test("paid orders create one idempotent cancellation request", async () => {
  const order = sampleBuyerOrder();
  let createCount = 0;
  let lockedRows = [{ id: "order-1" }];
  const existingRequest = {
    id: "case-existing",
    type: "CANCELLATION",
    status: "OPEN"
  };
  const transaction = {
    buyerSessionOrder: { findFirst: async () => ({ order }) },
    $queryRaw: async () => lockedRows,
    order: { findUniqueOrThrow: async () => order },
    payment: { count: async () => 1 },
    orderSupportCase: {
      findFirst: async () => existingRequest,
      create: async () => {
        createCount += 1;
        return existingRequest;
      }
    }
  };
  const context = buyerContext({
    buyerSession: { findFirst: async () => ({ id: "session-1" }) },
    $transaction: async (operation: (tx: typeof transaction) => Promise<unknown>) => operation(transaction)
  });

  const result = await cancelBuyerOrder(
    context,
    { cookies: { [buyerSessionCookieName]: validBuyerToken } },
    "CY-100",
    "I no longer need this order."
  );

  assert.equal(result.action, "requested");
  assert.equal("id" in (result.supportCase ?? {}), false);
  assert.equal(result.supportCase?.type, "CANCELLATION");
  assert.equal(createCount, 0);
  assert.equal("customerEmail" in result.order, false);

  lockedRows = [];
  await assert.rejects(
    () => cancelBuyerOrder(
      context,
      { cookies: { [buyerSessionCookieName]: validBuyerToken } },
      "CY-100",
      "The order disappeared during cancellation."
    ),
    (error: unknown) => Boolean(
      error && typeof error === "object" && "code" in error && error.code === "order_not_found"
    )
  );
});

test("unpaid orders cancel immediately and queue the status email", async () => {
  const pendingOrder = sampleBuyerOrder({
    status: "PENDING",
    checkoutStatus: "PAYMENT_PENDING",
    couponCode: null
  });
  const cancelledOrder = sampleBuyerOrder({
    status: "CANCELLED",
    checkoutStatus: "ABANDONED",
    couponCode: null
  });
  let rawCall = 0;
  let currentCall = 0;
  let notificationQueued = false;
  const transaction = {
    buyerSessionOrder: { findFirst: async () => ({ order: pendingOrder }) },
    $queryRaw: async () => {
      rawCall += 1;
      return rawCall === 3 ? [] : [{ id: "order-1" }];
    },
    order: {
      findUniqueOrThrow: async () => {
        currentCall += 1;
        return currentCall === 1 ? pendingOrder : cancelledOrder;
      },
      findUnique: async () => pendingOrder,
      updateMany: async () => ({ count: 1 })
    },
    payment: { count: async () => 0 },
    orderNotification: {
      create: async () => {
        notificationQueued = true;
        return { id: "notice-1" };
      }
    }
  };
  const prisma = {
    buyerSession: { findFirst: async () => ({ id: "session-1" }) },
    $transaction: async (operation: (tx: typeof transaction) => Promise<unknown>) => operation(transaction),
    site: { upsert: async () => ({ id: "site-1" }) },
    moduleSetting: { findUnique: async () => null }
  };

  const result = await cancelBuyerOrder(
    buyerContext(prisma),
    { cookies: { [buyerSessionCookieName]: validBuyerToken } },
    "CY-100",
    "I placed this order by mistake."
  );

  assert.equal(result.action, "cancelled");
  assert.equal(result.order.status, "CANCELLED");
  assert.equal(notificationQueued, true);
});

test("expired buyer sessions are removed in one bounded database operation", async () => {
  let cleanupWhere: unknown;
  const context = buyerContext({
    buyerSession: {
      deleteMany: async ({ where }: { where: unknown }) => {
        cleanupWhere = where;
        return { count: 3 };
      }
    }
  });

  assert.equal(await deleteExpiredBuyerSessions(context), 3);
  assert.ok(cleanupWhere && typeof cleanupWhere === "object" && "expiresAt" in cleanupWhere);
});
