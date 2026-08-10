import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  criticalCoverageRoots,
  currentCriticalCoverage,
  evaluateCoverageRatchets,
  readCoverageBaseline
} from "./coverage-ratchets.mjs";

const rootDirectory = process.cwd();
const baselinePath = resolve(rootDirectory, "quality/coverage-ratchets.json");
const testResult = spawnSync(process.execPath, [
  "--import",
  "tsx",
  "--experimental-test-coverage",
  "--test-coverage-include=src/**/*.ts",
  "--test-coverage-include=apps/web/web/**/*.js",
  "--test-coverage-lines=60",
  "--test-coverage-branches=58",
  "--test-coverage-functions=58",
  "--test",
  "test/*.test.ts"
], {
  cwd: rootDirectory,
  encoding: "utf8",
  maxBuffer: 32 * 1024 * 1024
});

process.stdout.write(testResult.stdout || "");
process.stderr.write(testResult.stderr || "");
if (testResult.error) throw testResult.error;
if (testResult.status !== 0) process.exit(testResult.status ?? 1);

const current = currentCriticalCoverage(testResult.stdout, rootDirectory);
if (process.argv.includes("--update")) {
  writeFileSync(baselinePath, `${JSON.stringify({
    version: 1,
    criticalRoots: criticalCoverageRoots,
    files: current
  }, null, 2)}\n`);
  console.log(`Updated coverage ratchets for ${Object.keys(current).length} critical files.`);
  process.exit(0);
}

const baseline = readCoverageBaseline(baselinePath);
const errors = evaluateCoverageRatchets(current, baseline.files);
if (errors.length) {
  for (const error of errors) console.error(`Coverage ratchet failed: ${error}`);
  process.exit(1);
}

console.log(`Coverage ratchets passed for ${Object.keys(current).length} critical files.`);
