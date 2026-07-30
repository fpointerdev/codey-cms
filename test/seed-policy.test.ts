import assert from "node:assert/strict";
import test from "node:test";
import { shouldSeedDemoContent } from "../src/core/seed-policy.js";

test("demo content is opt-in", () => {
  assert.equal(shouldSeedDemoContent(undefined), false);
  assert.equal(shouldSeedDemoContent("false"), false);
  assert.equal(shouldSeedDemoContent("true"), true);
  assert.equal(shouldSeedDemoContent("YES"), true);
});
