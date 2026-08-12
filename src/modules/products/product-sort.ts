import type { Prisma } from "@prisma/client";

export const productCatalogSortValues = ["newest", "name", "price-low", "price-high"] as const;

export type ProductCatalogSort = (typeof productCatalogSortValues)[number];

export function productCatalogOrderBy(sort: ProductCatalogSort = "newest"): Prisma.ProductOrderByWithRelationInput[] {
  if (sort === "name") return [{ name: "asc" }, { id: "asc" }];
  if (sort === "price-low") return [{ priceCents: "asc" }, { id: "asc" }];
  if (sort === "price-high") return [{ priceCents: "desc" }, { id: "desc" }];

  return [{ createdAt: "desc" }, { id: "desc" }];
}
