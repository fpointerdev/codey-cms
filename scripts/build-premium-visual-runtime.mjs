import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { build } from "esbuild";

const root = process.cwd();
const outputDirectory = path.join(root, "apps/web/vendor");
const webDirectory = path.join(root, "apps/web");
const checkOnly = process.argv.includes("--check");

if (!checkOnly) await mkdir(outputDirectory, { recursive: true });

async function writeOrCheck(outputPath, content) {
  if (!checkOnly) {
    await writeFile(outputPath, content);
    return;
  }

  const current = await readFile(outputPath, "utf8").catch(() => "");
  if (current !== content) {
    throw new Error(`${path.relative(root, outputPath)} is stale. Run pnpm web:build.`);
  }
}

function normalizeGeneratedLine(line) {
  const trimmed = line.trimEnd();
  const contentStart = trimmed.search(/\S/);
  if (contentStart <= 0) return trimmed;

  const indentation = trimmed.slice(0, contentStart);
  return indentation.includes("\t")
    ? `${indentation.replaceAll(" ", "")}${trimmed.slice(contentStart)}`
    : trimmed;
}

const runtimeBuilds = [
  ["motion-runtime.entry.js", "motion-runtime.js"],
  ["three-runtime.entry.js", "three-runtime.js"]
].map(async ([entry, output]) => {
  const result = await build({
    entryPoints: [path.join(root, "apps/web/web", entry)],
    bundle: true,
    format: "esm",
    legalComments: "none",
    minify: true,
    platform: "browser",
    target: ["es2022"],
    write: false
  });
  const code = result.outputFiles[0]?.text;
  if (!code) throw new Error(`esbuild did not produce ${output}.`);

  const normalized = code
    .split("\n")
    .map(normalizeGeneratedLine)
    .join("\n")
    .trimEnd();
  await writeOrCheck(path.join(outputDirectory, output), `${normalized}\n`);
});

const styleBuilds = [
  ["styles.css", "site.css"],
  ["admin.css", "admin-bundle.css"]
].map(async ([entry, output]) => {
  const result = await build({
    entryPoints: [path.join(webDirectory, entry)],
    bundle: true,
    legalComments: "none",
    minify: true,
    write: false
  });
  const css = result.outputFiles[0]?.text;
  if (!css) throw new Error(`esbuild did not produce ${output}.`);

  await writeOrCheck(path.join(webDirectory, output), `${css.trimEnd()}\n`);
});

await Promise.all([...runtimeBuilds, ...styleBuilds]);

console.log(checkOnly
  ? "Browser styles and premium runtimes are current."
  : "Built browser styles plus optional Motion and Three.js runtimes.");
