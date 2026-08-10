import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

export const criticalCoverageRoots = [
  "src/modules/auth",
  "src/modules/orders",
  "src/modules/payments",
  "src/runtime",
  "src/infrastructure/operations"
];

function cleanOutput(value) {
  return value
    .split(String.fromCharCode(27))
    .map((chunk, index) => index === 0 ? chunk : chunk.replace(/^\[[0-9;]*m/, ""))
    .join("");
}

export function parseCoverageReport(output) {
  const pathsByIndent = new Map();
  const coverage = new Map();

  for (const line of cleanOutput(output).split(/\r?\n/)) {
    const match = line.match(/^ℹ( +)([^|]+?)\s*\|\s*([\d.]*)\s*\|\s*([\d.]*)\s*\|\s*([\d.]*)\s*\|/);
    if (!match) continue;

    const indent = match[1].length;
    const name = match[2].trim();
    const metrics = match.slice(3, 6).map((value) => value ? Number(value) : null);

    for (const level of [...pathsByIndent.keys()]) {
      if (level >= indent) pathsByIndent.delete(level);
    }
    if (metrics.some((value) => value === null)) {
      pathsByIndent.set(indent, name);
      continue;
    }

    const parents = [...pathsByIndent.entries()]
      .filter(([level]) => level < indent)
      .sort(([left], [right]) => left - right)
      .map(([, value]) => value);
    coverage.set([...parents, name].join("/"), {
      lines: metrics[0],
      branches: metrics[1],
      functions: metrics[2]
    });
  }

  return coverage;
}

function sourceFiles(directory, rootDirectory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path, rootDirectory);
    if (!entry.isFile() || !entry.name.endsWith(".ts")) return [];
    return [relative(rootDirectory, path).replaceAll("\\", "/")];
  });
}

export function criticalSourceFiles(rootDirectory) {
  return criticalCoverageRoots
    .flatMap((directory) => sourceFiles(join(rootDirectory, directory), rootDirectory))
    .sort();
}

export function currentCriticalCoverage(output, rootDirectory) {
  const report = parseCoverageReport(output);

  return Object.fromEntries(criticalSourceFiles(rootDirectory).map((file) => [
    file,
    report.get(file) ?? { lines: 0, branches: 0, functions: 0 }
  ]));
}

export function evaluateCoverageRatchets(current, baseline) {
  const errors = [];
  const currentFiles = Object.keys(current).sort();
  const baselineFiles = Object.keys(baseline).sort();

  for (const file of currentFiles) {
    if (!baseline[file]) errors.push(`${file} has no coverage baseline.`);
  }
  for (const file of baselineFiles) {
    if (!current[file]) errors.push(`${file} no longer exists; update the coverage baseline intentionally.`);
  }

  for (const file of currentFiles) {
    if (!baseline[file]) continue;
    for (const metric of ["lines", "branches", "functions"]) {
      if (current[file][metric] + Number.EPSILON < baseline[file][metric]) {
        errors.push(
          `${file} ${metric} coverage decreased from ${baseline[file][metric].toFixed(2)}% to ${current[file][metric].toFixed(2)}%.`
        );
      }
    }
  }

  return errors;
}

export function readCoverageBaseline(path) {
  const parsed = JSON.parse(readFileSync(path, "utf8"));
  if (parsed.version !== 1 || !parsed.files || typeof parsed.files !== "object") {
    throw new Error("Coverage ratchet baseline is invalid.");
  }
  return parsed;
}
