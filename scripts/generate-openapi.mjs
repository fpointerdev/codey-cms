import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const modulesRoot = path.join(root, "src", "modules");
const outputPath = path.join(root, "docs", "openapi-v1.json");
const methods = new Set(["get", "post", "put", "patch", "delete"]);
const files = await sourceFiles(modulesRoot);
const basePaths = new Map([["installation", "/install"]]);

for (const filePath of files) {
  const source = await parseSource(filePath);
  visit(source, (node) => {
    if (!ts.isPropertyAssignment(node) || propertyName(node.name) !== "basePath" || !ts.isStringLiteral(node.initializer)) return;
    basePaths.set(moduleName(filePath), node.initializer.text);
  });
}

const routes = [];
for (const filePath of files) {
  const source = await parseSource(filePath);
  visit(source, (node) => {
    if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) return;
    if (!ts.isIdentifier(node.expression.expression) || node.expression.expression.text !== "router") return;
    const method = node.expression.name.text.toLowerCase();
    if (!methods.has(method)) return;

    const routeArgument = node.arguments[0];
    if (!routeArgument || !ts.isStringLiteralLike(routeArgument)) {
      const position = source.getLineAndCharacterOfPosition(node.getStart(source));
      throw new Error(`OpenAPI inventory cannot resolve ${path.relative(root, filePath)}:${position.line + 1}.`);
    }

    const module = moduleName(filePath);
    const basePath = basePaths.get(module);
    if (!basePath) throw new Error(`No API base path is declared for module ${module}.`);
    const position = source.getLineAndCharacterOfPosition(node.getStart(source));
    routes.push({
      method,
      module,
      path: openApiPath(`${basePath}${routeArgument.text === "/" ? "" : routeArgument.text}`),
      source: `${path.relative(root, filePath)}:${position.line + 1}`
    });
  });
}

routes.sort((left, right) => left.path.localeCompare(right.path) || left.method.localeCompare(right.method));
const paths = {};
for (const route of routes) {
  paths[route.path] ||= {};
  if (paths[route.path][route.method]) throw new Error(`Duplicate route inventory entry: ${route.method.toUpperCase()} ${route.path}.`);
  paths[route.path][route.method] = {
    tags: [route.module],
    operationId: operationId(route),
    summary: `${route.method.toUpperCase()} ${route.path}`,
    "x-codey-source": route.source,
    responses: {
      "200": { description: "Successful response using the CodeY API envelope." },
      default: { description: "Error response using the CodeY API envelope." }
    }
  };
}

const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const document = {
  openapi: "3.1.0",
  info: {
    title: "CodeY CMS API",
    version: packageJson.version,
    description: "Generated route inventory for the stable /api/v1 contract. Request and response validation remains authoritative in the linked Zod route schemas."
  },
  servers: [{ url: "/api/v1" }],
  tags: [...new Set(routes.map((route) => route.module))].sort().map((name) => ({ name })),
  paths
};
const output = `${JSON.stringify(document, null, 2)}\n`;

if (process.argv.includes("--check")) {
  const existing = await readFile(outputPath, "utf8").catch(() => "");
  if (existing !== output) throw new Error("docs/openapi-v1.json is stale. Run pnpm api:generate.");
  console.log(`OpenAPI inventory is current (${routes.length} operations).`);
} else {
  await writeFile(outputPath, output, "utf8");
  console.log(`Generated docs/openapi-v1.json with ${routes.length} operations.`);
}

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(entryPath);
    return entry.isFile() && entry.name.endsWith(".ts") ? [entryPath] : [];
  }));
  return nested.flat().sort();
}

async function parseSource(filePath) {
  return ts.createSourceFile(filePath, await readFile(filePath, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}

function visit(source, callback) {
  const walk = (node) => {
    callback(node);
    ts.forEachChild(node, walk);
  };
  walk(source);
}

function moduleName(filePath) {
  return path.relative(modulesRoot, filePath).split(path.sep)[0];
}

function propertyName(name) {
  return ts.isIdentifier(name) || ts.isStringLiteral(name) ? name.text : "";
}

function openApiPath(value) {
  return (value || "/").replace(/:([A-Za-z0-9_]+)/g, "{$1}").replace(/\/{2,}/g, "/");
}

function operationId(route) {
  const suffix = route.path.replace(/[{}]/g, "").split("/").filter(Boolean).join("_").replace(/[^A-Za-z0-9_]/g, "_");
  return `${route.module}_${route.method}_${suffix}`;
}
