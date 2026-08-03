import { randomBytes } from "node:crypto";
import { Prisma } from "@prisma/client";
import { AppError } from "../../core/errors/app-error.js";
import type { ModuleContext } from "../../core/types/module.js";
import { queueOrderEmail } from "./order-email.service.js";

type OrderItemInput = {
  productId: string;
  variantId?: string;
  quantity: number;
  metadata?: Record<string, unknown>;
};

export type CreateOrderInput = {
  customerEmail: string;
  customerName?: string;
  customerPhone?: string;
  shippingCountry?: string;
  shippingAddress?: {
    line1: string;
    line2?: string;
    city: string;
    region?: string;
    postalCode: string;
  };
  shippingRateId?: string;
  couponCode?: string;
  metadata?: Record<string, unknown>;
  items: OrderItemInput[];
};

export type CreateCartInput = {
  customerEmail?: string;
  shippingCountry?: string;
  shippingRateId?: string;
  couponCode?: string;
  metadata?: Record<string, unknown>;
};

export type CheckoutCartInput = Omit<CreateOrderInput, "items">;

export type LookupOrderInput = {
  orderNumber: string;
  customerEmail: string;
};

type ShopTransaction = Prisma.TransactionClient;
type CartWithItems = Prisma.CartGetPayload<{ include: { items: true } }>;
type OrderStatus = "PENDING" | "CONFIRMED" | "PAID" | "FULFILLED" | "CANCELLED" | "REFUNDED";
type CheckoutStatus = "STARTED" | "SHIPPING_SELECTED" | "PAYMENT_PENDING" | "PAYMENT_AUTHORIZED" | "COMPLETE" | "ABANDONED";

export const orderReservationTtlMs = 30 * 60 * 1000;

const merchantOrderTransitions: Partial<Record<OrderStatus, OrderStatus[]>> = {
  PENDING: ["CANCELLED"],
  CONFIRMED: ["CANCELLED"],
  PAID: ["FULFILLED"]
};

export function assertMerchantOrderTransition(currentStatus: OrderStatus, nextStatus: OrderStatus) {
  if (currentStatus === nextStatus) return;
  if (merchantOrderTransitions[currentStatus]?.includes(nextStatus)) return;

  throw new AppError(
    409,
    "invalid_order_status_transition",
    "This order status can only be changed by the payment or fulfillment workflow."
  );
}

export function assertMerchantCheckoutTransition(
  currentStatus: CheckoutStatus,
  nextStatus: CheckoutStatus
) {
  if (currentStatus === nextStatus) return;
  if (
    ["STARTED", "SHIPPING_SELECTED", "PAYMENT_PENDING"].includes(currentStatus) &&
    nextStatus === "ABANDONED"
  ) return;

  throw new AppError(
    409,
    "invalid_checkout_status_transition",
    "Checkout authorization and completion are controlled by the payment workflow."
  );
}

type ReservedOrderItem = {
  productId: string | null;
  variantId: string | null;
  quantity: number;
};

function createOrderNumber() {
  return `ORD-${Date.now().toString(36).toUpperCase()}-${randomBytes(3).toString("hex").toUpperCase()}`;
}

function createCartToken() {
  return randomBytes(32).toString("base64url");
}

function normalizeCode(code?: string) {
  return code?.trim().toUpperCase();
}

function normalizeCountry(country?: string) {
  return country?.trim().toUpperCase();
}

function normalizeRegion(region?: string) {
  return region?.trim().toUpperCase();
}

function checkoutMetadata(input: CreateOrderInput) {
  const metadata = { ...(input.metadata ?? {}) };
  if (input.customerPhone) metadata.customerPhone = input.customerPhone;
  if (input.shippingAddress) metadata.shippingAddress = input.shippingAddress;
  return Object.keys(metadata).length ? metadata : undefined;
}

function itemKey(item: Pick<OrderItemInput, "productId" | "variantId">) {
  return `${item.productId}:${item.variantId ?? ""}`;
}

function productRequiresQuote(product: { metadata?: Prisma.JsonValue | null }) {
  const metadata = product.metadata;
  return Boolean(
    metadata &&
    typeof metadata === "object" &&
    !Array.isArray(metadata) &&
    metadata.purchaseMode === "quote"
  );
}

function activeCartWhere(token: string) {
  return {
    sessionToken: token,
    status: "ACTIVE" as const,
    OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }]
  };
}

async function lockCart(tx: ShopTransaction, token: string) {
  await tx.$queryRaw(
    Prisma.sql`SELECT "id" FROM "Cart" WHERE "sessionToken" = ${token} FOR UPDATE`
  );
}

async function hydrateCart(context: ModuleContext, cart: CartWithItems) {
  const productIds = [...new Set(cart.items.map((item) => item.productId))];
  const products = productIds.length
    ? await context.prisma.product.findMany({
        where: { id: { in: productIds } },
        select: {
          id: true,
          name: true,
          slug: true,
          status: true,
          priceCents: true,
          currency: true,
          metadata: true,
          stockQuantity: true,
          images: {
            orderBy: { sortOrder: "asc" },
            take: 1,
            select: { url: true, alt: true }
          },
          variants: {
            select: {
              id: true,
              name: true,
              sku: true,
              priceCents: true,
              stockQuantity: true,
              active: true
            }
          }
        }
      })
    : [];
  const productsById = new Map(products.map((product) => [product.id, product]));
  const items = cart.items.map((item) => {
    const product = productsById.get(item.productId);
    const variant = item.variantId
      ? product?.variants.find((candidate) => candidate.id === item.variantId)
      : undefined;
    const availableStock = variant?.stockQuantity ?? product?.stockQuantity ?? 0;
    const unitPriceCents = variant?.priceCents ?? product?.priceCents ?? 0;
    const available = Boolean(
      product?.status === "ACTIVE" &&
      !productRequiresQuote(product) &&
      (!item.variantId || variant?.active) &&
      item.quantity <= availableStock
    );

    return {
      ...item,
      product: product
        ? {
            id: product.id,
            name: product.name,
            slug: product.slug,
            status: product.status,
            currency: product.currency,
            stockQuantity: product.stockQuantity,
            image: product.images[0] ?? null
          }
        : null,
      variant: variant ?? null,
      available,
      availableStock,
      unitPriceCents,
      lineTotalCents: unitPriceCents * item.quantity
    };
  });

  return {
    ...cart,
    items,
    subtotalCents: items.reduce(
      (total, item) => total + (item.available ? item.lineTotalCents : 0),
      0
    )
  };
}

function aggregateReservedItems(items: ReservedOrderItem[]) {
  return items.reduce((quantities, item) => {
    if (!item.productId) return quantities;

    const key = `${item.productId}:${item.variantId ?? ""}`;
    const current = quantities.get(key) ?? {
      productId: item.productId,
      variantId: item.variantId,
      quantity: 0
    };
    current.quantity += item.quantity;
    quantities.set(key, current);
    return quantities;
  }, new Map<string, { productId: string; variantId: string | null; quantity: number }>());
}

function shippingCountryFilter(country: string | undefined) {
  return country
    ? {
        OR: [{ countries: { has: country } }, { countries: { isEmpty: true } }]
      }
    : {
        countries: { isEmpty: true }
      };
}

async function resolveCoupon(
  tx: ShopTransaction,
  couponCode: string | undefined,
  subtotalCents: number,
  currency: string
) {
  const code = normalizeCode(couponCode);

  if (!code) {
    return { code: undefined, discountCents: 0 };
  }

  const coupon = await tx.coupon.findUnique({
    where: { code }
  });
  const now = new Date();

  if (
    !coupon ||
    !coupon.active ||
    (coupon.startsAt && coupon.startsAt > now) ||
    (coupon.expiresAt && coupon.expiresAt <= now) ||
    (coupon.currency && coupon.currency !== currency) ||
    (coupon.minSubtotalCents && subtotalCents < coupon.minSubtotalCents) ||
    (coupon.usageLimit && coupon.usageCount >= coupon.usageLimit)
  ) {
    throw new AppError(422, "invalid_coupon", "Coupon is not valid for this order.");
  }

  if (coupon.discountType === "PERCENTAGE" && coupon.amount > 100) {
    throw new AppError(422, "invalid_coupon", "Percentage coupons cannot exceed 100.");
  }

  const discountCents =
    coupon.discountType === "PERCENTAGE"
      ? Math.floor((subtotalCents * coupon.amount) / 100)
      : coupon.amount;

  return {
    code,
    couponId: coupon.id,
    usageLimit: coupon.usageLimit,
    discountCents: Math.min(subtotalCents, discountCents)
  };
}

async function resolveShipping(
  tx: ShopTransaction,
  shippingRateId: string | undefined,
  country: string | undefined,
  subtotalCents: number
) {
  const normalizedCountry = normalizeCountry(country);
  const subtotalFilter = {
    minSubtotalCents: { lte: subtotalCents },
    OR: [{ maxSubtotalCents: null }, { maxSubtotalCents: { gte: subtotalCents } }]
  };

  if (shippingRateId) {
    const rate = await tx.shippingRate.findFirst({
      where: {
        id: shippingRateId,
        active: true,
        ...subtotalFilter,
        zone: {
          active: true,
          ...shippingCountryFilter(normalizedCountry)
        }
      }
    });

    if (!rate) {
      throw new AppError(422, "invalid_shipping_rate", "Shipping rate is not valid for this order.");
    }

    return { shippingRateId: rate.id, shippingCents: rate.priceCents };
  }

  if (!normalizedCountry) {
    return { shippingRateId: undefined, shippingCents: 0 };
  }

  const rate = await tx.shippingRate.findFirst({
    where: {
      active: true,
      ...subtotalFilter,
      zone: {
        active: true,
        ...shippingCountryFilter(normalizedCountry)
      }
    },
    orderBy: [{ priceCents: "asc" }, { sortOrder: "asc" }]
  });

  if (!rate) {
    throw new AppError(422, "shipping_destination_unavailable", "Delivery is not available for this country.");
  }

  return {
    shippingRateId: rate.id,
    shippingCents: rate.priceCents
  };
}

async function resolveTax(
  tx: ShopTransaction,
  country: string | undefined,
  region: string | undefined,
  taxableCents: number
) {
  const normalizedCountry = normalizeCountry(country);
  const normalizedRegion = normalizeRegion(region);
  const locations = normalizedCountry
    ? [
        ...(normalizedRegion ? [{ country: normalizedCountry, region: normalizedRegion }] : []),
        { country: normalizedCountry, region: null },
        { country: null, region: null }
      ]
    : [{ country: null, region: null }];
  const taxRule = await tx.taxRule.findFirst({
    where: {
      active: true,
      OR: locations
    },
    orderBy: [{ priority: "desc" }, { createdAt: "desc" }]
  });

  if (!taxRule) {
    return 0;
  }

  return Math.floor((taxableCents * taxRule.rateBps) / 10_000);
}

async function createOrderInTransaction(tx: ShopTransaction, input: CreateOrderInput) {
  const requestedQuantities = input.items.reduce((totals, item) => {
    totals.set(itemKey(item), (totals.get(itemKey(item)) ?? 0) + item.quantity);
    return totals;
  }, new Map<string, number>());
  const productIds = [...new Set(input.items.map((item) => item.productId))];
  const variantIds = input.items.flatMap((item) => (item.variantId ? [item.variantId] : []));
  const products = await tx.product.findMany({
    where: {
      id: { in: productIds },
      status: "ACTIVE"
    },
    include: {
      variants: {
        where: {
          id: { in: variantIds },
          active: true
        }
      }
    }
  });

  if (products.length !== productIds.length) {
    throw new AppError(422, "invalid_order_item", "One or more products are unavailable.");
  }
  if (products.some(productRequiresQuote)) {
    throw new AppError(422, "quote_product_not_purchasable", "Request a quote for this product instead.");
  }

  const productsById = new Map(products.map((product) => [product.id, product]));
  const variantsById = new Map(
    products.flatMap((product) =>
      product.variants.map((variant) => [variant.id, { ...variant, productId: product.id }] as const)
    )
  );
  const currencies = new Set(products.map((product) => product.currency));

  if (currencies.size !== 1) {
    throw new AppError(422, "mixed_currency_order", "Order items must use one currency.");
  }

  for (const [key, quantity] of requestedQuantities) {
    const [productId, variantId] = key.split(":");

    if (variantId) {
      const updated = await tx.productVariant.updateMany({
        where: {
          id: variantId,
          productId,
          active: true,
          stockQuantity: { gte: quantity }
        },
        data: {
          stockQuantity: { decrement: quantity }
        }
      });

      if (updated.count !== 1) {
        throw new AppError(409, "insufficient_stock", "One or more variants are out of stock.");
      }

      continue;
    }

    const updated = await tx.product.updateMany({
      where: {
        id: productId,
        stockQuantity: { gte: quantity }
      },
      data: {
        stockQuantity: { decrement: quantity }
      }
    });

    if (updated.count !== 1) {
      throw new AppError(409, "insufficient_stock", "One or more products are out of stock.");
    }
  }

  const orderItems = input.items.map((item) => {
    const product = productsById.get(item.productId);
    const variant = item.variantId ? variantsById.get(item.variantId) : undefined;

    if (!product || (item.variantId && (!variant || variant.productId !== product.id))) {
      throw new AppError(422, "invalid_order_item", "One or more products are unavailable.");
    }

    return {
      productId: product.id,
      variantId: variant?.id,
      productName: product.name,
      variantName: variant?.name,
      sku: variant?.sku ?? product.sku,
      unitPriceCents: variant?.priceCents ?? product.priceCents,
      quantity: item.quantity,
      metadata: item.metadata as Prisma.InputJsonValue | undefined
    };
  });
  const subtotalCents = orderItems.reduce(
    (total, item) => total + item.unitPriceCents * item.quantity,
    0
  );
  const currency = products[0]!.currency;
  const { code, couponId, usageLimit, discountCents } = await resolveCoupon(
    tx,
    input.couponCode,
    subtotalCents,
    currency
  );
  const shippingCountry = normalizeCountry(input.shippingCountry);
  const { shippingRateId, shippingCents } = await resolveShipping(
    tx,
    input.shippingRateId,
    shippingCountry,
    subtotalCents
  );
  const taxableCents = Math.max(subtotalCents - discountCents + shippingCents, 0);
  const taxCents = await resolveTax(
    tx,
    shippingCountry,
    input.shippingAddress?.region,
    taxableCents
  );
  const totalCents = taxableCents + taxCents;
  const order = await tx.order.create({
    data: {
      orderNumber: createOrderNumber(),
      customerEmail: input.customerEmail,
      customerName: input.customerName,
      checkoutStatus: "PAYMENT_PENDING",
      currency,
      subtotalCents,
      taxCents,
      shippingCents,
      discountCents,
      totalCents,
      couponCode: code,
      shippingCountry,
      shippingRateId,
      metadata: checkoutMetadata(input) as Prisma.InputJsonValue | undefined,
      items: {
        create: orderItems
      }
    },
    include: { items: true }
  });

  if (couponId) {
    const updatedCoupon = await tx.coupon.updateMany({
      where: {
        id: couponId,
        ...(usageLimit ? { usageCount: { lt: usageLimit } } : {})
      },
      data: {
        usageCount: { increment: 1 }
      }
    });

    if (updatedCoupon.count !== 1) {
      throw new AppError(422, "invalid_coupon", "Coupon is not valid for this order.");
    }
  }

  await queueOrderEmail(tx, order, {
    eventType: "ORDER_RECEIVED"
  });

  return order;
}

export async function createOrder(context: ModuleContext, input: CreateOrderInput) {
  await releaseExpiredOrderReservations(context);
  return context.prisma.$transaction((tx) => createOrderInTransaction(tx, input));
}

export async function createCart(context: ModuleContext, input: CreateCartInput) {
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

  return context.prisma.cart.create({
    data: {
      sessionToken: createCartToken(),
      customerEmail: input.customerEmail,
      shippingCountry: normalizeCountry(input.shippingCountry),
      shippingRateId: input.shippingRateId,
      couponCode: normalizeCode(input.couponCode),
      metadata: input.metadata as Prisma.InputJsonValue | undefined,
      expiresAt
    },
    include: { items: true }
  });
}

export async function getCart(context: ModuleContext, token: string) {
  const cart = await context.prisma.cart.findFirst({
    where: activeCartWhere(token),
    include: {
      items: {
        orderBy: { createdAt: "asc" }
      }
    }
  });

  if (!cart) {
    throw new AppError(404, "cart_not_found", "Cart not found.");
  }

  return hydrateCart(context, cart);
}

export async function addCartItem(context: ModuleContext, token: string, input: OrderItemInput) {
  const cart = await context.prisma.$transaction(async (tx) => {
    await lockCart(tx, token);
    const cart = await tx.cart.findFirst({
      where: activeCartWhere(token)
    });

    if (!cart) {
      throw new AppError(404, "cart_not_found", "Cart not found.");
    }

    const product = await tx.product.findFirst({
      where: {
        id: input.productId,
        status: "ACTIVE"
      },
      include: {
        variants: {
          where: {
            id: { in: input.variantId ? [input.variantId] : [] },
            active: true
          }
        }
      }
    });
    const variant = input.variantId ? product?.variants[0] : undefined;

    if (!product || productRequiresQuote(product) || (input.variantId && !variant)) {
      throw new AppError(422, "invalid_cart_item", "Product is unavailable.");
    }

    if (cart.currency && cart.currency !== product.currency) {
      throw new AppError(422, "mixed_currency_cart", "Cart items must use one currency.");
    }

    const existingItem = await tx.cartItem.findUnique({
      where: {
        cartId_selectionKey: {
          cartId: cart.id,
          selectionKey: itemKey(input)
        }
      }
    });
    const nextQuantity = (existingItem?.quantity ?? 0) + input.quantity;
    const availableStock = variant?.stockQuantity ?? product.stockQuantity;

    if (nextQuantity > 999) {
      throw new AppError(422, "cart_quantity_too_large", "Cart item quantity cannot exceed 999.");
    }

    if (nextQuantity > availableStock) {
      throw new AppError(409, "insufficient_stock", "The requested quantity is not available.");
    }

    await tx.cartItem.upsert({
      where: {
        cartId_selectionKey: {
          cartId: cart.id,
          selectionKey: itemKey(input)
        }
      },
      update: {
        quantity: nextQuantity,
        metadata: input.metadata as Prisma.InputJsonValue | undefined
      },
      create: {
        cartId: cart.id,
        productId: input.productId,
        variantId: input.variantId,
        selectionKey: itemKey(input),
        quantity: input.quantity,
        metadata: input.metadata as Prisma.InputJsonValue | undefined
      }
    });

    return tx.cart.update({
      where: { id: cart.id },
      data: {
        currency: cart.currency ?? product.currency
      },
      include: {
        items: {
          orderBy: { createdAt: "asc" }
        }
      }
    });
  });

  return hydrateCart(context, cart);
}

export async function updateCartItem(
  context: ModuleContext,
  token: string,
  itemId: string,
  quantity: number
) {
  const cart = await context.prisma.$transaction(async (tx) => {
    await lockCart(tx, token);
    const activeCart = await tx.cart.findFirst({ where: activeCartWhere(token) });
    if (!activeCart) throw new AppError(404, "cart_not_found", "Cart not found.");

    const item = await tx.cartItem.findFirst({
      where: { id: itemId, cartId: activeCart.id }
    });
    if (!item) throw new AppError(404, "cart_item_not_found", "Cart item not found.");

    const product = await tx.product.findFirst({
      where: { id: item.productId, status: "ACTIVE" },
      include: {
        variants: {
          where: { id: { in: item.variantId ? [item.variantId] : [] }, active: true }
        }
      }
    });
    const variant = item.variantId ? product?.variants[0] : undefined;
    const availableStock = variant?.stockQuantity ?? product?.stockQuantity ?? 0;
    if (!product || productRequiresQuote(product) || item.variantId && !variant) {
      throw new AppError(422, "invalid_cart_item", "Product is unavailable.");
    }
    if (quantity > availableStock) {
      throw new AppError(409, "insufficient_stock", "The requested quantity is not available.");
    }

    await tx.cartItem.update({ where: { id: item.id }, data: { quantity } });
    return tx.cart.findUniqueOrThrow({
      where: { id: activeCart.id },
      include: { items: { orderBy: { createdAt: "asc" } } }
    });
  });

  return hydrateCart(context, cart);
}

export async function removeCartItem(context: ModuleContext, token: string, itemId: string) {
  const cart = await context.prisma.$transaction(async (tx) => {
    await lockCart(tx, token);
    const activeCart = await tx.cart.findFirst({ where: activeCartWhere(token) });
    if (!activeCart) throw new AppError(404, "cart_not_found", "Cart not found.");

    const removed = await tx.cartItem.deleteMany({
      where: { id: itemId, cartId: activeCart.id }
    });
    if (removed.count !== 1) {
      throw new AppError(404, "cart_item_not_found", "Cart item not found.");
    }

    return tx.cart.findUniqueOrThrow({
      where: { id: activeCart.id },
      include: { items: { orderBy: { createdAt: "asc" } } }
    });
  });

  return hydrateCart(context, cart);
}

export async function checkoutCart(context: ModuleContext, token: string, input: CheckoutCartInput) {
  await releaseExpiredOrderReservations(context);

  return context.prisma.$transaction(async (tx) => {
    await lockCart(tx, token);
    const cart = await tx.cart.findFirst({
      where: activeCartWhere(token),
      include: { items: true }
    });

    if (!cart) {
      throw new AppError(404, "cart_not_found", "Cart not found.");
    }

    if (!cart.items.length) {
      throw new AppError(422, "empty_cart", "Cart has no items.");
    }

    const order = await createOrderInTransaction(tx, {
      ...input,
      shippingCountry: input.shippingCountry ?? cart.shippingCountry ?? undefined,
      shippingRateId: input.shippingRateId ?? cart.shippingRateId ?? undefined,
      couponCode: input.couponCode ?? cart.couponCode ?? undefined,
      items: cart.items.map((item) => ({
        productId: item.productId,
        variantId: item.variantId ?? undefined,
        quantity: item.quantity,
        metadata: item.metadata as Record<string, unknown> | undefined
      }))
    });

    await tx.cart.update({
      where: { id: cart.id },
      data: { status: "CONVERTED" }
    });

    return order;
  });
}

export async function lookupOrder(context: ModuleContext, input: LookupOrderInput) {
  const order = await context.prisma.order.findFirst({
    where: {
      orderNumber: input.orderNumber,
      customerEmail: {
        equals: input.customerEmail,
        mode: "insensitive"
      }
    },
    include: { items: true }
  });

  if (!order) {
    throw new AppError(404, "order_not_found", "Order not found.");
  }

  return order;
}

export async function releaseOrderInventoryReservation(
  tx: ShopTransaction,
  orderId: string,
  options: {
    checkoutStatuses?: Array<"PAYMENT_PENDING" | "PAYMENT_AUTHORIZED">;
    orderStatuses?: Array<"PENDING" | "CONFIRMED">;
  } = {}
) {
  const checkoutStatuses = options.checkoutStatuses ?? ["PAYMENT_PENDING", "PAYMENT_AUTHORIZED"];
  const orderStatuses = options.orderStatuses ?? ["PENDING"];
  const order = await tx.order.findUnique({
    where: { id: orderId },
    include: { items: true }
  });

  if (
    !order ||
    !orderStatuses.includes(order.status as "PENDING" | "CONFIRMED") ||
    !checkoutStatuses.includes(order.checkoutStatus as "PAYMENT_PENDING" | "PAYMENT_AUTHORIZED")
  ) {
    return false;
  }

  const claimed = await tx.order.updateMany({
    where: {
      id: order.id,
      status: { in: orderStatuses },
      checkoutStatus: order.checkoutStatus
    },
    data: {
      status: "CANCELLED",
      checkoutStatus: "ABANDONED"
    }
  });

  if (claimed.count !== 1) return false;

  for (const item of aggregateReservedItems(order.items).values()) {
    if (item.variantId) {
      await tx.productVariant.updateMany({
        where: {
          id: item.variantId,
          productId: item.productId
        },
        data: {
          stockQuantity: { increment: item.quantity }
        }
      });
      continue;
    }

    await tx.product.updateMany({
      where: { id: item.productId },
      data: {
        stockQuantity: { increment: item.quantity }
      }
    });
  }

  if (order.couponCode) {
    await tx.coupon.updateMany({
      where: {
        code: order.couponCode,
        usageCount: { gt: 0 }
      },
      data: {
        usageCount: { decrement: 1 }
      }
    });
  }

  return true;
}

export async function releaseExpiredOrderReservations(context: ModuleContext, now = new Date()) {
  const cutoff = new Date(now.getTime() - orderReservationTtlMs);
  const expiredOrders = await context.prisma.order.findMany({
    where: {
      status: "PENDING",
      checkoutStatus: "PAYMENT_PENDING",
      createdAt: { lte: cutoff }
    },
    select: { id: true },
    orderBy: { createdAt: "asc" },
    take: 100
  });
  let released = 0;

  for (const order of expiredOrders) {
    const didRelease = await context.prisma.$transaction((tx) =>
      releaseOrderInventoryReservation(tx, order.id, {
        checkoutStatuses: ["PAYMENT_PENDING"]
      })
    );
    if (didRelease) released += 1;
  }

  return released;
}
