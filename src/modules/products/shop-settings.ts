import type { PrismaClient } from "@prisma/client";
import { shopSettingsSchema } from "./products.schemas.js";

export type ShopSettings = ReturnType<typeof normalizeShopSettings>;

export const defaultShopSettings = shopSettingsSchema.parse({});

export function normalizeShopSettings(value: unknown) {
  const parsed = shopSettingsSchema.safeParse(value);
  return parsed.success ? parsed.data : { ...defaultShopSettings };
}

export async function readShopSettings(prisma: PrismaClient) {
  const setting = await prisma.moduleSetting.findFirst({
    where: {
      moduleId: "products",
      key: "storefront",
      site: {
        slug: "default"
      }
    }
  });

  return normalizeShopSettings(setting?.value);
}
