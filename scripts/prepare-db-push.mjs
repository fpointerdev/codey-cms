import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const dbPushCompatibilitySql = `
DO $$
BEGIN
  IF to_regclass('"RefreshToken"') IS NOT NULL THEN
    ALTER TABLE "RefreshToken" ADD COLUMN IF NOT EXISTS "familyId" TEXT;
    UPDATE "RefreshToken" SET "familyId" = "id" WHERE "familyId" IS NULL;
    ALTER TABLE "RefreshToken" ALTER COLUMN "familyId" SET NOT NULL;
  END IF;

  IF to_regclass('"Order"') IS NOT NULL THEN
    ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "lookupTokenHash" TEXT;
    CREATE UNIQUE INDEX IF NOT EXISTS "Order_lookupTokenHash_key"
      ON "Order"("lookupTokenHash");
  END IF;
END
$$;
`;

export async function prepareDbPush() {
  const prismaCli = path.join(root, "node_modules", "prisma", "build", "index.js");

  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [
      prismaCli,
      "db",
      "execute",
      "--schema",
      "prisma/generated/schema.prisma",
      "--stdin"
    ], {
      cwd: root,
      env: process.env,
      stdio: ["pipe", "inherit", "inherit"]
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Prisma database compatibility preparation exited with code ${code}.`));
    });
    child.stdin.end(dbPushCompatibilitySql);
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await prepareDbPush();
}
