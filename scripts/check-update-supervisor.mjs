import { readFile } from "node:fs/promises";
import path from "node:path";

try {
  const file = path.join(process.env.CODEY_RUNTIME_ROOT || "/runtime", "supervisor-health.json");
  const { updatedAt } = JSON.parse(await readFile(file, "utf8"));
  const age = Date.now() - updatedAt;
  if (!Number.isFinite(age) || age < 0 || age > 30_000) process.exitCode = 1;
} catch {
  process.exitCode = 1;
}
