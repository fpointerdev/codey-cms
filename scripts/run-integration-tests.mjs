import { prepareTestRuntime, runCommand } from "./test-runtime.mjs";

const env = await prepareTestRuntime();
await runCommand("node", ["--import", "tsx", "--test", "test/integration/runtime.test.ts"], env);
await runCommand("node", ["--import", "tsx", "--test", "test/integration/inventory-reservation.test.ts"], env);
await runCommand("node", ["--import", "tsx", "--test", "test/integration/media-quota.test.ts"], env);
await runCommand("node", ["--import", "tsx", "--test", "test/integration/content-models.test.ts"], env);
