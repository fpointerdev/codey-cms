import "dotenv/config";
import { spawn } from "node:child_process";

function run(command, args, env = process.env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: "inherit",
      env
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with code ${code}.`));
    });
  });
}

async function buildAndValidate(env = process.env) {
  await run("node", ["scripts/build-prisma-schema.mjs"], env);
  await run("pnpm", ["exec", "prisma", "validate", "--schema", "prisma/generated/schema.prisma"], env);
}

const validationEnv = {
  ...process.env,
  DATABASE_URL: process.env.DATABASE_URL ?? "postgresql://codey:codey@127.0.0.1:5432/codey_validation"
};

await buildAndValidate(validationEnv);
await buildAndValidate({ ...validationEnv, PRISMA_SCHEMA_MODULES: "cms" });
await buildAndValidate({ ...validationEnv, PRISMA_SCHEMA_MODULES: "payments" });
await buildAndValidate({ ...validationEnv, PRISMA_SCHEMA_MODULES: "all" });

const shadowDatabaseUrl = process.env.MIGRATION_SHADOW_DATABASE_URL ?? process.env.SHADOW_DATABASE_URL;

if (shadowDatabaseUrl) {
  await run("pnpm", [
    "exec",
    "prisma",
    "migrate",
    "diff",
    "--from-migrations",
    "prisma/migrations",
    "--to-schema-datamodel",
    "prisma/generated/schema.prisma",
    "--shadow-database-url",
    shadowDatabaseUrl,
    "--exit-code"
  ], validationEnv);
} else {
  console.warn("Skipping migration diff: MIGRATION_SHADOW_DATABASE_URL is not set.");
}
