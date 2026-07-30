import "dotenv/config";
import { spawn } from "node:child_process";

function requiredTestDatabaseUrl() {
  const value = process.env.TEST_DATABASE_URL?.trim();
  if (!value) throw new Error("TEST_DATABASE_URL is required for integration and browser tests.");

  const url = new URL(value);
  const databaseName = decodeURIComponent(url.pathname.replace(/^\//, ""));
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !/(test|ci|e2e)/i.test(databaseName)) {
    throw new Error("TEST_DATABASE_URL must point to a PostgreSQL database named for test, CI, or E2E use.");
  }

  return value;
}

export function testRuntimeEnvironment(overrides = {}) {
  return {
    ...process.env,
    NODE_ENV: "test",
    APP_ENV: "development",
    APP_NAME: "CodeY CMS Test",
    APP_MODE: process.env.TEST_APP_MODE || "shop",
    APP_PUBLIC_URL: "http://127.0.0.1:4173",
    PORT: "4173",
    DATABASE_URL: requiredTestDatabaseUrl(),
    JWT_ACCESS_SECRET: "integration-access-secret-with-at-least-32-characters",
    CMS_CREDENTIAL_ENCRYPTION_KEY: "integration-credential-key-with-at-least-32-characters",
    CORS_ORIGINS: "http://127.0.0.1:4173",
    LOG_LEVEL: "silent",
    AUTH_ALLOW_REGISTRATION: "false",
    AUTH_REQUIRE_EMAIL_VERIFICATION: "false",
    AUTH_RECOVERY_TOKEN_DELIVERY: "response",
    CODEY_SEED_DEMO_CONTENT: "true",
    CODEY_ADMIN_EMAIL: "",
    CODEY_ADMIN_PASSWORD: "",
    EMAIL_DRIVER: "disabled",
    STORAGE_DRIVER: "local",
    STORAGE_LOCAL_DIR: "/tmp/codey-cms-integration-uploads",
    STORAGE_KEY_PREFIX: "tests/codey-cms",
    BACKUP_DIR: "/tmp/codey-cms-integration-backups",
    BACKUP_REQUIRED: "false",
    BACKUP_REQUIRE_ENCRYPTION: "false",
    BACKUP_ENCRYPTION_KEY: "",
    ...overrides
  };
}

export function runCommand(command, args, env = process.env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env, stdio: "inherit" });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(" ")} exited with code ${code}.`));
    });
  });
}

export async function prepareTestRuntime(overrides = {}) {
  const env = testRuntimeEnvironment(overrides);

  await runCommand("pnpm", ["run", "db:schema"], env);
  if (["1", "true", "yes", "on"].includes(String(process.env.INTEGRATION_RESET_DATABASE || "").toLowerCase())) {
    await runCommand("pnpm", [
      "exec",
      "prisma",
      "migrate",
      "reset",
      "--force",
      "--skip-seed",
      "--schema",
      "prisma/generated/schema.prisma"
    ], env);
  } else {
    await runCommand("pnpm", ["run", "db:deploy"], env);
  }
  await runCommand("pnpm", ["run", "db:seed"], env);
  await runCommand("pnpm", ["exec", "tsx", "scripts/prepare-test-owner.ts"], env);

  return env;
}
