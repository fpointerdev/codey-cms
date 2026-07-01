import { z } from "zod";

export const createPaymentIntentSchema = z.object({
  orderId: z.string().cuid(),
  provider: z.enum(["STRIPE", "PAYPAL", "MANUAL"]).default("STRIPE"),
  idempotencyKey: z.string().trim().min(8).max(120).optional(),
  metadata: z.record(z.unknown()).optional()
});

export const paymentWebhookSchema = z.object({
  provider: z.enum(["STRIPE", "PAYPAL", "MANUAL"]),
  eventType: z.string().trim().min(1).max(120),
  providerEventId: z.string().trim().min(1).max(180).optional(),
  providerReference: z.string().trim().min(1).max(180).optional(),
  payload: z.record(z.unknown()).default({})
});
