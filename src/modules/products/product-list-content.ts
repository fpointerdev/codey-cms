import type { Prisma, PrismaClient } from "@prisma/client";
import { enrichPublicMedia } from "../cms/public-media.js";
import { withAvailableInventory } from "./product-inventory.js";

type ProductListBlock = {
  type?: string;
  value?: unknown;
};

type ProductListSection = {
  blocks?: ProductListBlock[];
};

type ProductListPage = {
  sections?: ProductListSection[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function referencedProductSlugs(page: ProductListPage) {
  const slugs = new Set<string>();

  for (const section of page.sections || []) {
    for (const block of section.blocks || []) {
      if (block.type !== "PRODUCT_LIST" || !isRecord(block.value)) continue;

      for (const slug of Array.isArray(block.value.productSlugs) ? block.value.productSlugs : []) {
        const normalized = String(slug || "").trim();
        if (normalized) slugs.add(normalized);
        if (slugs.size >= 100) return [...slugs];
      }
    }
  }

  return [...slugs];
}

export async function enrichProductListContent<T extends ProductListPage>(
  prisma: PrismaClient | Prisma.TransactionClient,
  page: T,
  locale: string
): Promise<T> {
  const slugs = referencedProductSlugs(page);
  if (!slugs.length) return page;

  const products = await prisma.product.findMany({
    where: {
      slug: { in: slugs },
      locale,
      status: "ACTIVE"
    },
    include: {
      category: true,
      images: { orderBy: { sortOrder: "asc" } },
      variants: {
        where: { active: true },
        orderBy: { createdAt: "asc" }
      }
    }
  });
  const enrichedProducts = await enrichPublicMedia(prisma, products.map(withAvailableInventory));
  const productsBySlug = new Map(enrichedProducts.map((product) => [product.slug, product]));

  return {
    ...page,
    sections: (page.sections || []).map((section) => ({
      ...section,
      blocks: (section.blocks || []).map((block) => {
        if (block.type !== "PRODUCT_LIST" || !isRecord(block.value)) return block;

        const productSlugs = Array.isArray(block.value.productSlugs)
          ? block.value.productSlugs.map((slug) => String(slug || "").trim()).filter(Boolean)
          : [];

        return {
          ...block,
          value: {
            ...block.value,
            products: productSlugs.map((slug) => productsBySlug.get(slug)).filter(Boolean)
          }
        };
      })
    }))
  };
}
