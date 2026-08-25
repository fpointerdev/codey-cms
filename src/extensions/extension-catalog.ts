import { z } from "zod";
import { extensionIdSchema, extensionSemverSchema } from "./extension-manifest.js";

const catalogEntrySchema = z.object({
  id: extensionIdSchema,
  version: extensionSemverSchema,
  directory: z.string().trim().min(1).max(120).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  manifestSha256: z.string().regex(/^[a-f0-9]{64}$/)
}).strict();

export const extensionCatalogSchema = z.object({
  schemaVersion: z.literal(1),
  catalogVersion: extensionSemverSchema,
  extensions: z.array(catalogEntrySchema).max(500)
}).strict().superRefine((catalog, context) => {
  const ids = new Set<string>();
  const directories = new Set<string>();
  catalog.extensions.forEach((extension, index) => {
    if (ids.has(extension.id)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["extensions", index, "id"],
        message: "Extension IDs must be unique in the catalog."
      });
    }
    if (directories.has(extension.directory)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["extensions", index, "directory"],
        message: "Extension directories must be unique in the catalog."
      });
    }
    ids.add(extension.id);
    directories.add(extension.directory);
  });
});

export type ExtensionCatalog = z.infer<typeof extensionCatalogSchema>;
