import { prepareTestRuntime, runCommand } from "./test-runtime.mjs";

const env = await prepareTestRuntime();
await runCommand("node", ["--import", "tsx", "--test", "test/integration/runtime.test.ts"], env);
