import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

const missingLookupHash = Buffer.alloc(32);

export type PublicOrder = {
  orderNumber: string;
  status: string;
  checkoutStatus: string;
  currency: string;
  subtotalCents: number;
  discountCents: number;
  shippingCents: number;
  taxCents: number;
  totalCents: number;
  createdAt: Date;
  items: Array<{
    productName: string;
    variantName: string | null;
    quantity: number;
    unitPriceCents: number;
  }>;
};

export function hashOrderLookupToken(token: string) {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function createOrderLookupCredential() {
  const lookupToken = randomBytes(32).toString("base64url");
  return {
    lookupToken,
    lookupTokenHash: hashOrderLookupToken(lookupToken)
  };
}

export function orderLookupTokenMatches(storedHash: string | null | undefined, lookupToken: string) {
  const actual = createHash("sha256").update(lookupToken, "utf8").digest();
  const expected = storedHash && /^[a-f0-9]{64}$/i.test(storedHash)
    ? Buffer.from(storedHash, "hex")
    : missingLookupHash;
  return timingSafeEqual(actual, expected) && Boolean(storedHash);
}

export function publicOrderDto(order: PublicOrder): PublicOrder {
  return {
    orderNumber: order.orderNumber,
    status: order.status,
    checkoutStatus: order.checkoutStatus,
    currency: order.currency,
    subtotalCents: order.subtotalCents,
    discountCents: order.discountCents,
    shippingCents: order.shippingCents,
    taxCents: order.taxCents,
    totalCents: order.totalCents,
    createdAt: order.createdAt,
    items: order.items.map((item) => ({
      productName: item.productName,
      variantName: item.variantName,
      quantity: item.quantity,
      unitPriceCents: item.unitPriceCents
    }))
  };
}

export function adminOrderDto<T extends Record<string, unknown>>(order: T) {
  const { lookupTokenHash: _lookupTokenHash, notifications, ...safeOrder } = order;
  return {
    ...safeOrder,
    ...(Array.isArray(notifications)
      ? {
          notifications: notifications.map((notification) => {
            if (!notification || typeof notification !== "object") return notification;
            const { secretEnvelope: _secretEnvelope, ...safeNotification } = notification as Record<string, unknown>;
            return safeNotification;
          })
        }
      : {})
  };
}
