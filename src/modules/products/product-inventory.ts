export function availableStock(stockQuantity: number, reservedQuantity = 0) {
  return Math.max(stockQuantity - reservedQuantity, 0);
}

export function configuredPurchaseLimit(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const limit = (value as Record<string, unknown>).maxPurchaseQuantity;
  return typeof limit === "number" && Number.isSafeInteger(limit) && limit > 0
    ? limit
    : undefined;
}

export function effectivePurchaseLimit(...metadata: unknown[]) {
  const limits = metadata
    .map(configuredPurchaseLimit)
    .filter((limit): limit is number => limit !== undefined);
  return limits.length ? Math.min(...limits) : undefined;
}

export function canSetOnHandStock(stockQuantity: number, reservedQuantity: number) {
  return stockQuantity >= reservedQuantity;
}

export function withAvailableInventory<T extends {
  stockQuantity: number;
  reservedQuantity: number;
  variants?: Array<{ stockQuantity: number; reservedQuantity: number }>;
}>(product: T) {
  const variants = product.variants?.map((variant) => ({
    ...variant,
    availableStock: availableStock(variant.stockQuantity, variant.reservedQuantity)
  }));
  return {
    ...product,
    availableStock: variants?.length
      ? variants.reduce((total, variant) => total + variant.availableStock, 0)
      : availableStock(product.stockQuantity, product.reservedQuantity),
    ...(variants ? { variants } : {})
  };
}
