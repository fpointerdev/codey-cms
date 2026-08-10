import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateCoverageRatchets,
  parseCoverageReport
} from "../scripts/coverage-ratchets.mjs";

test("coverage reports preserve source paths and metrics", () => {
  const report = parseCoverageReport([
    "ℹ src | | | |",
    "ℹ  modules | | | |",
    "ℹ   auth | | | |",
    "ℹ    auth.service.ts | 69.37 | 62.60 | 75.76 | 1-2"
  ].join("\n"));

  assert.deepEqual(report.get("src/modules/auth/auth.service.ts"), {
    lines: 69.37,
    branches: 62.6,
    functions: 75.76
  });
});

test("coverage ratchets reject regressions and unbaselined files", () => {
  const baseline = {
    "src/modules/auth/auth.service.ts": { lines: 69.37, branches: 62.6, functions: 75.76 }
  };

  assert.deepEqual(evaluateCoverageRatchets(baseline, baseline), []);
  assert.deepEqual(evaluateCoverageRatchets({
    ...baseline,
    "src/modules/auth/login.service.ts": { lines: 0, branches: 0, functions: 0 }
  }, baseline), ["src/modules/auth/login.service.ts has no coverage baseline."]);
  assert.match(evaluateCoverageRatchets({
    "src/modules/auth/auth.service.ts": { lines: 68, branches: 62.6, functions: 75.76 }
  }, baseline)[0], /lines coverage decreased/);
});
