import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { build } from "esbuild";

const root = process.cwd();
const outputDirectory = path.join(root, "apps/web/vendor");

await mkdir(outputDirectory, { recursive: true });

function normalizeGeneratedLine(line) {
  const trimmed = line.trimEnd();
  const contentStart = trimmed.search(/\S/);
  if (contentStart <= 0) return trimmed;

  const indentation = trimmed.slice(0, contentStart);
  return indentation.includes("\t")
    ? `${indentation.replaceAll(" ", "")}${trimmed.slice(contentStart)}`
    : trimmed;
}

await Promise.all([
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
  await writeFile(path.join(outputDirectory, output), `${normalized}\n`);
}));

console.log("Built optional Motion and Three.js browser runtimes.");
