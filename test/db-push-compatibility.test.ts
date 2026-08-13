import assert from "node:assert/strict";
import test from "node:test";
import { dbPushCompatibilitySql } from "../scripts/prepare-db-push.mjs";

test("db push preserves refresh sessions created before token families", () => {
  assert.match(dbPushCompatibilitySql, /ADD COLUMN IF NOT EXISTS "familyId" TEXT/);
  assert.match(
    dbPushCompatibilitySql,
    /UPDATE "RefreshToken" SET "familyId" = "id" WHERE "familyId" IS NULL/
  );
  assert.match(dbPushCompatibilitySql, /ALTER COLUMN "familyId" SET NOT NULL/);
  assert.match(dbPushCompatibilitySql, /ADD COLUMN IF NOT EXISTS "lookupTokenHash" TEXT/);
  assert.match(dbPushCompatibilitySql, /CREATE UNIQUE INDEX IF NOT EXISTS "Order_lookupTokenHash_key"/);
  assert.doesNotMatch(dbPushCompatibilitySql, /DROP|TRUNCATE|DELETE/i);
});
