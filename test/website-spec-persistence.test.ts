import assert from "node:assert/strict";
import test from "node:test";
import type { PrismaClient } from "@prisma/client";
import {
  replaceGeneratedMainMenu,
  replaceGeneratedProduct
} from "../src/modules/config/website-spec.service.js";

test("generated product relations are replaced in one transaction", async () => {
  const calls: string[] = [];
  const transaction = {
    productImage: {
      deleteMany: async () => calls.push("images")
    },
    productOption: {
      deleteMany: async () => calls.push("options")
    },
    productVariant: {
      deleteMany: async () => calls.push("variants")
    },
    product: {
      update: async () => {
        calls.push("product");
        return { id: "product-1" };
      }
    }
  };
  const database = {
    $transaction: async (operation: (client: typeof transaction) => Promise<unknown>) => {
      calls.push("transaction");
      return operation(transaction);
    }
  } as unknown as PrismaClient;

  await replaceGeneratedProduct(database, "product-1", { name: "Updated product" });

  assert.deepEqual(calls, ["transaction", "images", "options", "variants", "product"]);
});

test("generated main menu is rebuilt in one transaction", async () => {
  const calls: string[] = [];
  const createdItems: Array<Record<string, unknown>> = [];
  const transaction = {
    menu: {
      upsert: async () => {
        calls.push("menu");
        return { id: "menu-1" };
      }
    },
    menuItem: {
      deleteMany: async () => calls.push("delete-items"),
      createMany: async ({ data }: { data: Array<Record<string, unknown>> }) => {
        calls.push("create-items");
        createdItems.push(...data);
        return { count: data.length };
      }
    },
    cmsPage: {
      findMany: async () => {
        calls.push("find-pages");
        return [{ id: "page-home", slug: "home" }];
      }
    }
  };
  const database = {
    $transaction: async (operation: (client: typeof transaction) => Promise<unknown>) => {
      calls.push("transaction");
      return operation(transaction);
    }
  } as unknown as PrismaClient;

  const count = await replaceGeneratedMainMenu(database, "en", [
    { label: "Home", pageSlug: "home", sortOrder: 0 },
    { label: "Contact", pageSlug: "contact", sortOrder: 1 }
  ]);

  assert.equal(count, 2);
  assert.deepEqual(calls, [
    "transaction",
    "menu",
    "delete-items",
    "find-pages",
    "create-items"
  ]);
  assert.equal(createdItems[0]?.pageId, "page-home");
  assert.equal(createdItems[0]?.url, null);
  assert.equal(createdItems[1]?.pageId, undefined);
  assert.equal(createdItems[1]?.url, "/contact");
});
