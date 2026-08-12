import assert from "node:assert/strict";
import test from "node:test";
import type { PrismaClient } from "@prisma/client";
import { enrichProductListContent } from "../src/modules/products/product-list-content.js";

test("product list enrichment keeps requested order and exposes active commerce data", async () => {
  let productWhere: unknown;
  const prisma = {
    product: {
      findMany: async ({ where }: { where: unknown }) => {
        productWhere = where;
        return [
          product("second", "Second product"),
          product("first", "First product")
        ];
      }
    }
  } as unknown as PrismaClient;
  const page = {
    sections: [{
      blocks: [{
        type: "PRODUCT_LIST",
        value: { productSlugs: ["first", "second"], layout: "grid" }
      }]
    }]
  };

  const enriched = await enrichProductListContent(prisma, page, "en");
  const value = enriched.sections[0]?.blocks[0]?.value as {
    products?: Array<{ slug: string; availableStock: number }>;
  };

  assert.deepEqual(productWhere, {
    slug: { in: ["first", "second"] },
    locale: "en",
    status: "ACTIVE"
  });
  assert.deepEqual(value.products?.map((item) => item.slug), ["first", "second"]);
  assert.equal(value.products?.[0]?.availableStock, 4);
});

function product(slug: string, name: string) {
  return {
    id: `product-${slug}`,
    slug,
    locale: "en",
    name,
    description: `${name} description`,
    sku: null,
    priceCents: 2500,
    currency: "EUR",
    stockQuantity: 5,
    reservedQuantity: 1,
    status: "ACTIVE",
    metadata: {},
    category: null,
    images: [],
    variants: []
  };
}
