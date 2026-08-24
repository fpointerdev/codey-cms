import { z } from "zod";
import { createContentCollectionSchema } from "../modules/cms/content-models.schemas.js";

const extensionIdSchema = z
  .string()
  .trim()
  .min(3)
  .max(120)
  .regex(/^[a-z0-9]+(?:[.-][a-z0-9]+)+$/, "Use a reverse-domain or vendor-prefixed extension ID.");

const semverSchema = z
  .string()
  .trim()
  .regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/, "Use a semantic version such as 1.0.0.");

const httpUrlSchema = z.string().url().max(1000).refine((value) => {
  const url = new URL(value);
  return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password;
}, "Use an HTTP(S) URL without embedded credentials.");

export const extensionManifestSchema = z.object({
  $schema: z.string().trim().min(1).max(1000).optional(),
  schemaVersion: z.literal("1.0"),
  id: extensionIdSchema,
  name: z.string().trim().min(1).max(120),
  version: semverSchema,
  description: z.string().trim().min(1).max(500),
  license: z.string().trim().min(1).max(80),
  author: z.object({
    name: z.string().trim().min(1).max(120),
    url: httpUrlSchema.optional()
  }).strict(),
  homepage: httpUrlSchema.optional(),
  repository: httpUrlSchema.optional(),
  requires: z.object({
    cms: z.string().trim().min(1).max(80)
  }).strict(),
  contentModels: z.array(createContentCollectionSchema).min(1).max(20)
}).strict().superRefine((manifest, context) => {
  const slugs = new Set<string>();
  manifest.contentModels.forEach((model, index) => {
    if (slugs.has(model.slug)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["contentModels", index, "slug"],
        message: "Collection slugs must be unique inside an extension."
      });
    }
    slugs.add(model.slug);
  });
});

export const extensionParamsSchema = z.object({
  extensionId: extensionIdSchema
});

export type ExtensionManifest = z.infer<typeof extensionManifestSchema>;
