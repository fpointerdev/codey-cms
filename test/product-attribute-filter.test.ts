import assert from "node:assert/strict";
import test from "node:test";
import {
  findProductAttributePage,
  orderProductsByIds,
  productMatchesAttributeFilter
} from "../src/modules/products/product-attribute-filter.js";

test("product attribute matching accepts public slugs", () => {
  const product = {
    metadata: {
      attributes: [
        { name: "Surface Finish", value: "Brushed Steel" },
        { name: "Width", value: "120 cm" }
      ]
    }
  };

  assert.equal(productMatchesAttributeFilter(product, {
    attributeName: "surface-finish",
    attributeValue: "brushed-steel"
  }), true);
  assert.equal(productMatchesAttributeFilter(product, {
    attributeName: "surface-finish",
    attributeValue: "painted"
  }), false);
});

test("attribute normalization handles long repeated separators in linear time", () => {
  const separators = "-".repeat(100_000);
  const product = {
    metadata: {
      attributes: [{ name: `Surface${separators}Finish`, value: `Brushed${separators}Steel` }]
    }
  };

  assert.equal(productMatchesAttributeFilter(product, {
    attributeName: `surface${separators}finish`,
    attributeValue: "brushed-steel"
  }), true);
});

test("attribute pagination scans in batches and returns one ordered page", async () => {
  const candidates = Array.from({ length: 9 }, (_, index) => ({
    id: `product-${index + 1}`,
    metadata: {
      attributes: [{ name: "Material", value: index % 2 === 0 ? "Steel" : "Wood" }]
    }
  }));
  const cursors: Array<string | undefined> = [];

  const result = await findProductAttributePage(
    async (cursor, take) => {
      cursors.push(cursor);
      const start = cursor ? candidates.findIndex((candidate) => candidate.id === cursor) + 1 : 0;
      return candidates.slice(start, start + take);
    },
    { attributeName: "material", attributeValue: "steel" },
    { skip: 2, take: 2, countTotal: true, batchSize: 3 }
  );

  assert.deepEqual(result, { ids: ["product-5", "product-7"], total: 5 });
  assert.deepEqual(cursors, [undefined, "product-3", "product-6", "product-9"]);
  assert.deepEqual(
    orderProductsByIds([{ id: "product-7" }, { id: "product-5" }], result.ids),
    [{ id: "product-5" }, { id: "product-7" }]
  );
});
