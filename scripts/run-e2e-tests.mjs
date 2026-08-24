import { prepareTestRuntime, runCommand } from "./test-runtime.mjs";

const env = process.env.E2E_BASE_URL
  ? process.env
  : await prepareTestRuntime();

const playwrightArgs = process.argv.slice(2).filter((argument) => argument !== "--");
await runCommand("pnpm", ["exec", "playwright", "test", ...playwrightArgs], env);
