import { z } from "zod";

export const orderIdParams = z.object({
  id: z.string().cuid()
});

export const orderNotificationIdParams = z.object({
  notificationId: z.string().cuid()
});

export const cartTokenParams = z.object({
  token: z.string().trim().min(16).max(160)
});

export const cartItemParams = cartTokenParams.extend({
  itemId: z.string().cuid()
});

export const shippingZoneIdParams = z.object({
  id: z.string().cuid()
});

export const commerceResourceParams = z.object({
  id: z.string().cuid()
});

function orderItemSchema(maxItemQuantity: number) {
  return z.object({
    productId: z.string().cuid(),
    variantId: z.string().cuid().optional(),
    quantity: z.number().int().positive().max(maxItemQuantity),
    metadata: z.record(z.unknown()).optional()
  });
}

const shippingAddressSchema = z.object({
  line1: z.string().trim().min(1).max(160),
  line2: z.string().trim().max(160).optional(),
  city: z.string().trim().min(1).max(120),
  region: z.string().trim().max(120).optional(),
  postalCode: z.string().trim().min(1).max(40)
}).strict();

function validateShippingSelection(
  checkout: { shippingCountry?: string; shippingAddress?: unknown; shippingRateId?: string },
  context: z.RefinementCtx
) {
  if ((checkout.shippingCountry || checkout.shippingRateId) && !checkout.shippingAddress) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["shippingAddress"],
      message: "A delivery address is required when shipping is selected."
    });
  }

  if ((checkout.shippingAddress || checkout.shippingRateId) && !checkout.shippingCountry) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["shippingCountry"],
      message: "A delivery country is required when shipping is selected."
    });
  }
}

function orderSchema(maxItemQuantity: number, maxOrderItems: number) {
  return z.object({
    customerEmail: z.string().email(),
    customerName: z.string().trim().max(120).optional(),
    customerPhone: z.string().trim().max(80).optional(),
    shippingCountry: z.string().trim().length(2).optional(),
    shippingAddress: shippingAddressSchema.optional(),
    shippingRateId: z.string().cuid().optional(),
    couponCode: z.string().trim().min(1).max(80).optional(),
    metadata: z.record(z.unknown()).optional(),
    items: z.array(orderItemSchema(maxItemQuantity)).min(1).max(maxOrderItems)
  }).superRefine(validateShippingSelection);
}

export function checkoutLimitSchemas(limits: { maxItemQuantity: number; maxOrderItems: number }) {
  return {
    createOrder: orderSchema(limits.maxItemQuantity, limits.maxOrderItems),
    addCartItem: orderItemSchema(limits.maxItemQuantity),
    updateCartItem: z.object({
      quantity: z.number().int().positive().max(limits.maxItemQuantity)
    })
  };
}

const defaultCheckoutSchemas = checkoutLimitSchemas({ maxItemQuantity: 20, maxOrderItems: 50 });
export const createOrderSchema = defaultCheckoutSchemas.createOrder;

export const updateOrderStatusSchema = z.object({
  status: z.enum(["PENDING", "CONFIRMED", "PAID", "FULFILLED", "CANCELLED", "REFUNDED"])
});

export const updateCheckoutStatusSchema = z.object({
  checkoutStatus: z.enum([
    "STARTED",
    "SHIPPING_SELECTED",
    "PAYMENT_PENDING",
    "PAYMENT_AUTHORIZED",
    "COMPLETE",
    "ABANDONED"
  ])
});

export const createCartSchema = z.object({
  customerEmail: z.string().email().optional(),
  couponCode: z.string().trim().min(1).max(80).optional(),
  shippingCountry: z.string().trim().length(2).optional(),
  shippingRateId: z.string().cuid().optional(),
  metadata: z.record(z.unknown()).optional()
});

export const addCartItemSchema = defaultCheckoutSchemas.addCartItem;

export const updateCartItemSchema = defaultCheckoutSchemas.updateCartItem;

export const checkoutCartSchema = z.object({
  customerEmail: z.string().email(),
  customerName: z.string().trim().max(120).optional(),
  customerPhone: z.string().trim().max(80).optional(),
  shippingCountry: z.string().trim().length(2).optional(),
  shippingAddress: shippingAddressSchema.optional(),
  shippingRateId: z.string().cuid().optional(),
  couponCode: z.string().trim().min(1).max(80).optional(),
  metadata: z.record(z.unknown()).optional()
}).superRefine(validateShippingSelection);

export const lookupOrderSchema = z.object({
  orderNumber: z.string().trim().min(1).max(80),
  lookupToken: z.string().trim().min(40).max(100)
}).strict();

export const customerDataExportSchema = z.object({
  email: z.string().email()
});

export const customerDataAnonymizeSchema = customerDataExportSchema.extend({
  confirmation: z.literal("ANONYMIZE")
});

export const createShippingZoneSchema = z.object({
  name: z.string().trim().min(1).max(120),
  countries: z.array(z.string().trim().length(2)).max(250).default([]),
  active: z.boolean().default(true)
});

export const createShippingRateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  minSubtotalCents: z.number().int().nonnegative().default(0),
  maxSubtotalCents: z.number().int().nonnegative().optional(),
  priceCents: z.number().int().nonnegative(),
  active: z.boolean().default(true),
  sortOrder: z.number().int().default(0)
});

export const createTaxRuleSchema = z.object({
  name: z.string().trim().min(1).max(120),
  country: z.string().trim().length(2).optional(),
  region: z.string().trim().min(1).max(80).optional(),
  rateBps: z.number().int().min(0).max(10000),
  active: z.boolean().default(true),
  priority: z.number().int().default(0)
});

export const createCouponSchema = z.object({
  code: z.string().trim().min(1).max(80),
  description: z.string().trim().max(500).optional(),
  discountType: z.enum(["PERCENTAGE", "FIXED"]),
  amount: z.number().int().positive(),
  currency: z.string().length(3).optional(),
  minSubtotalCents: z.number().int().nonnegative().optional(),
  active: z.boolean().default(true),
  startsAt: z.coerce.date().optional(),
  expiresAt: z.coerce.date().optional(),
  usageLimit: z.number().int().positive().optional()
}).superRefine((coupon, context) => {
  if (coupon.discountType === "PERCENTAGE" && coupon.amount > 100) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["amount"],
      message: "Percentage coupon amount cannot exceed 100."
    });
  }

  if (coupon.startsAt && coupon.expiresAt && coupon.expiresAt <= coupon.startsAt) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["expiresAt"],
      message: "Coupon expiry must be after the start date."
    });
  }
});
