import assert from "node:assert/strict";
import test from "node:test";
import type { ModuleContext } from "../src/core/types/module.js";
import {
  orderEmailRetryDelayMs,
  requeueOrderEmail
} from "../src/modules/orders/order-email.service.js";

test("order email retries use bounded exponential backoff", () => {
  assert.equal(orderEmailRetryDelayMs(1), 60_000);
  assert.equal(orderEmailRetryDelayMs(2), 120_000);
  assert.equal(orderEmailRetryDelayMs(6), 1_920_000);
  assert.equal(orderEmailRetryDelayMs(20), 3_600_000);
});

test("manual order email retry only transitions failed notifications", async () => {
  let updateWhere: unknown;
  const context = {
    prisma: {
      orderNotification: {
        updateMany: async (args: { where: unknown }) => {
          updateWhere = args.where;
          return { count: 0 };
        },
        findUnique: async () => ({ status: "PROCESSING" })
      }
    }
  } as unknown as ModuleContext;

  await assert.rejects(
    () => requeueOrderEmail(context, "notification-1"),
    (error: unknown) => Boolean(
      error && typeof error === "object" && "code" in error &&
      error.code === "order_notification_in_progress"
    )
  );
  assert.deepEqual(updateWhere, { id: "notification-1", status: "FAILED" });
});
