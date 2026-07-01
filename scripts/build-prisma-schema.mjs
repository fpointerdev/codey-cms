import { cp, lstat, mkdir, readFile, readdir, rm, symlink, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const schemaDir = path.join(root, "prisma", "schema");
const modulesDir = path.join(schemaDir, "modules");
const outputDir = path.join(root, "prisma", "generated");
const outputFile = path.join(outputDir, "schema.prisma");
const migrationsDir = path.join(root, "prisma", "migrations");
const generatedMigrationsDir = path.join(outputDir, "migrations");

async function removeGeneratedMigrationsDir() {
  try {
    const stats = await lstat(generatedMigrationsDir);
    if (stats.isSymbolicLink()) {
      await unlink(generatedMigrationsDir);
      return;
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return;
  }

  await rm(generatedMigrationsDir, { recursive: true, force: true });
}

const baseSchema = await readFile(path.join(schemaDir, "base.prisma"), "utf8");
const moduleFiles = (await readdir(modulesDir))
  .filter((file) => file.endsWith(".prisma"))
  .sort();

const requestedModules = process.env.PRISMA_SCHEMA_MODULES?.trim();
const normalizeModuleName = (file) =>
  file.replace(".prisma", "").replace(/^\d+-/, "");
const schemaDependencies = {
  orders: ["products"],
  payments: ["orders"]
};
const expandRequestedModules = (modules) => {
  const selected = new Set(modules);

  for (const module of selected) {
    for (const dependency of schemaDependencies[module] ?? []) {
      selected.add(dependency);
    }
  }

  return selected;
};
const requestedModuleNames =
  requestedModules && requestedModules !== "all"
    ? expandRequestedModules(
        requestedModules
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean)
      )
    : null;
const enabledModules =
  !requestedModules || requestedModules === "all"
    ? moduleFiles
    : moduleFiles.filter((file) =>
        requestedModuleNames?.has(normalizeModuleName(file))
      );

const moduleSchemas = await Promise.all(
  enabledModules.map(async (file) => {
    const contents = await readFile(path.join(modulesDir, file), "utf8");
    return `// module: ${file.replace(".prisma", "")}\n${contents.trim()}`;
  })
);

await mkdir(outputDir, { recursive: true });
await removeGeneratedMigrationsDir();
try {
  await symlink(path.relative(outputDir, migrationsDir), generatedMigrationsDir, "dir");
} catch {
  if (await lstat(migrationsDir).then(() => true, () => false)) {
    await removeGeneratedMigrationsDir();
    await cp(migrationsDir, generatedMigrationsDir, { recursive: true });
  }
}
await writeFile(
  outputFile,
  [baseSchema.trim(), ...moduleSchemas].join("\n\n") + "\n",
  "utf8"
);

console.log(
  `Generated ${path.relative(root, outputFile)} with modules: ${
    enabledModules.map((file) => file.replace(".prisma", "")).join(", ") ||
    "none"
  }`
);
