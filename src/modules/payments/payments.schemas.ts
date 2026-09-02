import { z } from "zod";

export const createPaymentIntentSchema = z.object({
  orderId: z.string().cuid(),
  provider: z.enum(["STRIPE", "PAYPAL", "MANUAL"]).default("MANUAL"),
  idempotencyKey: z.string().trim().min(8).max(120).optional(),
  metadata: z.record(z.unknown()).optional(),
  returnUrl: z.string().trim().url().max(2_000).optional(),
  cancelUrl: z.string().trim().url().max(2_000).optional()
}).superRefine((input, context) => {
  if (input.provider !== "PAYPAL") return;

  if (!input.returnUrl) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["returnUrl"],
      message: "returnUrl is required for PayPal payments."
    });
  }
  if (!input.cancelUrl) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["cancelUrl"],
      message: "cancelUrl is required for PayPal payments."
    });
  }
});

export const paymentProviderParamsSchema = z.object({
  provider: z.enum(["stripe", "paypal", "manual"])
    .transform((value) => value.toUpperCase() as "STRIPE" | "PAYPAL" | "MANUAL")
});

const optionalConfigValue = z.string().trim().max(500).optional();

export const updatePaymentProviderConfigSchema = z.object({
  mode: z.enum(["SANDBOX", "LIVE"]).optional(),
  enabled: z.boolean().optional(),
  publishableKey: optionalConfigValue,
  secretKey: optionalConfigValue,
  clearSecretKey: z.boolean().optional(),
  clientId: optionalConfigValue,
  clientSecret: optionalConfigValue,
  clearClientSecret: z.boolean().optional(),
  webhookId: optionalConfigValue,
  webhookSecret: optionalConfigValue,
  clearWebhookSecret: z.boolean().optional(),
  instructions: z.string().trim().max(4_000).optional()
}).strict().superRefine((input, context) => {
  for (const [secretField, clearField] of [
    ["secretKey", "clearSecretKey"],
    ["clientSecret", "clearClientSecret"],
    ["webhookSecret", "clearWebhookSecret"]
  ] as const) {
    if (input[secretField] && input[clearField]) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: [clearField],
        message: `Cannot set and remove ${secretField} in the same request.`
      });
    }
  }
});

export const capturePayPalOrderSchema = z.object({
  orderId: z.string().cuid(),
  providerReference: z.string().trim().min(1).max(180)
});

export const manualPaymentParamsSchema = z.object({
  paymentId: z.string().cuid()
});

export const manualPaymentActionSchema = z.object({
  action: z.enum(["SUCCEED", "FAIL", "REFUND"])
});

export const paymentRefundParamsSchema = z.object({
  paymentId: z.string().cuid()
});

export const createPaymentRefundSchema = z.object({
  amountCents: z.number().int().positive().max(2_147_483_647).optional(),
  reason: z.enum(["CUSTOMER_REQUEST", "DUPLICATE", "FRAUDULENT", "OTHER"])
    .default("CUSTOMER_REQUEST"),
  note: z.string().trim().max(500).optional(),
  idempotencyKey: z.string().trim().min(8).max(120),
  retryRefundId: z.string().cuid().optional(),
  supportCaseId: z.string().cuid().optional()
}).strict();
