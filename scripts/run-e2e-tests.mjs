import { prepareTestRuntime, runCommand } from "./test-runtime.mjs";

const env = process.env.E2E_BASE_URL
  ? process.env
  : await prepareTestRuntime();

await runCommand("pnpm", ["exec", "playwright", "test"], env);
