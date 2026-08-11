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
    const validation = validationSchemas(node, source);
    routes.push({
      method,
      module,
      path: openApiPath(`${basePath}${routeArgument.text === "/" ? "" : routeArgument.text}`),
      source: `${path.relative(root, filePath)}:${position.line + 1}`,
      protected: containsCall(node, new Set(["requireAuth", "requirePermission"])),
      permission: permissionContract(node),
      validation,
      created: containsCall(node, new Set(["sendCreated"])),
      responseMediaType: responseMediaType(node)
    });
  });
}

routes.sort((left, right) => left.path.localeCompare(right.path) || left.method.localeCompare(right.method));
const paths = {};
for (const route of routes) {
  paths[route.path] ||= {};
  if (paths[route.path][route.method]) throw new Error(`Duplicate route inventory entry: ${route.method.toUpperCase()} ${route.path}.`);
  const successStatus = route.created ? "201" : "200";
  paths[route.path][route.method] = {
    tags: [route.module],
    operationId: operationId(route),
    summary: `${route.method.toUpperCase()} ${route.path}`,
    "x-codey-source": route.source,
    ...(Object.keys(route.validation).length ? { "x-codey-validation": route.validation } : {}),
    ...(route.permission ? { "x-codey-permission": route.permission } : {}),
    ...(route.protected ? { security: [{ bearerAuth: [] }] } : { security: [] }),
    ...(pathParameters(route.path).length ? { parameters: pathParameters(route.path) } : {}),
    ...(route.validation.body ? {
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              description: `Validated at runtime by ${route.validation.body}.`,
              "x-codey-zod-schema": route.validation.body
            }
          }
        }
      }
    } : {}),
    responses: {
      [successStatus]: {
        description: route.created ? "Resource created." : "Successful response.",
        content: route.responseMediaType
          ? { [route.responseMediaType]: { schema: { type: "string" } } }
          : { "application/json": { schema: { $ref: "#/components/schemas/SuccessEnvelope" } } }
      },
      "400": { $ref: "#/components/responses/BadRequest" },
      ...(route.protected ? {
        "401": { $ref: "#/components/responses/Unauthorized" },
        "403": { $ref: "#/components/responses/Forbidden" }
      } : {}),
      "422": { $ref: "#/components/responses/ValidationError" },
      "429": { $ref: "#/components/responses/RateLimited" },
      default: { $ref: "#/components/responses/Error" }
    }
  };
}

const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const document = {
  openapi: "3.1.0",
  info: {
    title: "CodeY CMS API",
    version: packageJson.version,
    description: "Generated stable /api/v1 contract. Each operation identifies its authentication, permission, path parameter, and authoritative Zod validation source."
  },
  servers: [{ url: "/api/v1" }],
  tags: [...new Set(routes.map((route) => route.module))].sort().map((name) => ({ name })),
  paths,
  components: {
    securitySchemes: {
      bearerAuth: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "JWT"
      }
    },
    schemas: {
      SuccessEnvelope: {
        type: "object",
        required: ["success", "data", "error", "meta"],
        properties: {
          success: { const: true },
          data: {},
          error: { type: "null" },
          meta: { oneOf: [{ type: "object" }, { type: "null" }] }
        }
      },
      ErrorEnvelope: {
        type: "object",
        required: ["success", "data", "error", "meta"],
        properties: {
          success: { const: false },
          data: { type: "null" },
          error: {
            type: "object",
            required: ["code", "message"],
            properties: {
              code: { type: "string" },
              message: { type: "string" },
              details: {}
            }
          },
          meta: { oneOf: [{ type: "object" }, { type: "null" }] }
        }
      }
    },
    responses: Object.fromEntries([
      ["BadRequest", "Bad request."],
      ["Unauthorized", "Authentication is required."],
      ["Forbidden", "The authenticated user lacks the required permission."],
      ["ValidationError", "Request validation failed."],
      ["RateLimited", "Request rate limit exceeded."],
      ["Error", "Error response using the CodeY API envelope."]
    ].map(([name, description]) => [name, {
      description,
      content: {
        "application/json": { schema: { $ref: "#/components/schemas/ErrorEnvelope" } }
      }
    }]))
  }
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

function containsCall(node, names) {
  let found = false;
  visit(node, (child) => {
    if (ts.isCallExpression(child) && ts.isIdentifier(child.expression) && names.has(child.expression.text)) {
      found = true;
    }
  });
  return found;
}

function validationSchemas(node, source) {
  const validation = {};
  visit(node, (child) => {
    if (
      !ts.isCallExpression(child) ||
      !ts.isIdentifier(child.expression) ||
      child.expression.text !== "validateRequest" ||
      !ts.isObjectLiteralExpression(child.arguments[0])
    ) return;

    for (const property of child.arguments[0].properties) {
      if (!ts.isPropertyAssignment(property)) continue;
      const name = propertyName(property.name);
      if (!["body", "params", "query"].includes(name)) continue;
      validation[name] = property.initializer.getText(source);
    }
  });
  return validation;
}

function permissionContract(node) {
  let permission;
  visit(node, (child) => {
    if (
      permission ||
      !ts.isCallExpression(child) ||
      !ts.isIdentifier(child.expression) ||
      child.expression.text !== "requirePermission"
    ) return;
    const action = child.arguments[1];
    const subject = child.arguments[2];
    if (ts.isStringLiteralLike(action) && ts.isStringLiteralLike(subject)) {
      permission = { action: action.text, subject: subject.text };
    }
  });
  return permission;
}

function responseMediaType(node) {
  let mediaType;
  visit(node, (child) => {
    if (
      !ts.isCallExpression(child) ||
      !ts.isPropertyAccessExpression(child.expression) ||
      child.expression.name.text !== "type" ||
      !ts.isStringLiteralLike(child.arguments[0])
    ) return;

    const declaredType = child.arguments[0].text;
    mediaType = declaredType === "html" ? "text/html" : declaredType;
  });
  return mediaType;
}

function pathParameters(routePath) {
  return [...routePath.matchAll(/\{([A-Za-z0-9_]+)\}/g)].map((match) => ({
    name: match[1],
    in: "path",
    required: true,
    schema: { type: "string", minLength: 1 }
  }));
}
