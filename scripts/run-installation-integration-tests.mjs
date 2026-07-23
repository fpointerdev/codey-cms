import { runCommand, testRuntimeEnvironment } from "./test-runtime.mjs";

const env = testRuntimeEnvironment({
  APP_MODE: "cms",
  CODEY_INSTALL_TOKEN: "integration-install-claim-token-with-32-characters"
});

await runCommand("pnpm", ["run", "db:schema"], env);
await reset(env);

try {
  await runCommand("node", ["--import", "tsx", "--test", "test/integration/installation.test.ts"], env);
} finally {
  await reset(env);
}

async function reset(environment) {
  await runCommand("pnpm", [
    "exec",
    "prisma",
    "migrate",
    "reset",
    "--force",
    "--skip-seed",
    "--schema",
    "prisma/generated/schema.prisma"
  ], environment);
}
