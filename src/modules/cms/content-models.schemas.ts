import { z } from "zod";

const identifierSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[a-z][a-z0-9_]*$/, "Use lowercase letters, numbers, and underscores.");

const collectionSlugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use a lowercase URL slug.");

const entrySlugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1)
  .max(180)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use a lowercase URL slug.");

const contentFieldOptionSchema = z.object({
  label: z.string().trim().min(1).max(120),
  value: z.string().trim().min(1).max(120)
}).strict();

export const contentFieldTypeSchema = z.enum([
  "text",
  "textarea",
  "richText",
  "email",
  "url",
  "number",
  "boolean",
  "date",
  "dateTime",
  "image",
  "file",
  "select",
  "relation"
]);

export const contentFieldSchema = z.object({
  key: identifierSchema,
  label: z.string().trim().min(1).max(120),
  type: contentFieldTypeSchema,
  required: z.boolean().default(false),
  multiple: z.boolean().default(false),
  helpText: z.string().trim().max(240).optional(),
  placeholder: z.string().trim().max(160).optional(),
  options: z.array(contentFieldOptionSchema).max(100).optional(),
  relationCollection: collectionSlugSchema.optional(),
  minLength: z.number().int().min(0).max(100_000).optional(),
  maxLength: z.number().int().min(1).max(100_000).optional(),
  min: z.number().finite().optional(),
  max: z.number().finite().optional()
}).strict().superRefine((field, context) => {
  if (field.multiple && !["select", "relation", "image", "file"].includes(field.type)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["multiple"],
      message: "Multiple values are supported for select, relation, image, and file fields."
    });
  }

  if (field.type === "select" && (!field.options || field.options.length === 0)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["options"],
      message: "Select fields need at least one option."
    });
  }

  if (field.type === "relation" && !field.relationCollection) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["relationCollection"],
      message: "Relation fields need a target collection."
    });
  }

  if (field.minLength !== undefined && field.maxLength !== undefined && field.minLength > field.maxLength) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["minLength"],
      message: "Minimum length cannot exceed maximum length."
    });
  }

  if (field.min !== undefined && field.max !== undefined && field.min > field.max) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["min"],
      message: "Minimum value cannot exceed maximum value."
    });
  }

  const typeMaximum = field.type === "email" ? 320 : field.type === "url" ? 2048 : undefined;
  if (typeMaximum !== undefined && (field.minLength ?? 0) > typeMaximum) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["minLength"],
      message: `${field.type === "email" ? "Email" : "URL"} length cannot exceed ${typeMaximum} characters.`
    });
  }
  if (typeMaximum !== undefined && (field.maxLength ?? typeMaximum) > typeMaximum) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["maxLength"],
      message: `${field.type === "email" ? "Email" : "URL"} length cannot exceed ${typeMaximum} characters.`
    });
  }
});

const collectionShape = z.object({
  name: z.string().trim().min(1).max(120),
  slug: collectionSlugSchema,
  description: z.string().trim().max(500).optional(),
  titleField: identifierSchema,
  fields: z.array(contentFieldSchema).min(1).max(50),
  publicRead: z.boolean().default(true)
}).strict();

function validateCollectionFields(
  value: { fields: Array<{ key: string; type: string; options?: Array<{ value: string }> }>; titleField: string },
  context: z.RefinementCtx
) {
  const fieldKeys = new Set<string>();

  value.fields.forEach((field, index) => {
    if (fieldKeys.has(field.key)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["fields", index, "key"],
        message: "Field keys must be unique."
      });
    }
    fieldKeys.add(field.key);

    if (field.options) {
      const optionValues = new Set<string>();
      field.options.forEach((option, optionIndex) => {
        if (optionValues.has(option.value)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["fields", index, "options", optionIndex, "value"],
            message: "Option values must be unique."
          });
        }
        optionValues.add(option.value);
      });
    }
  });

  const titleField = value.fields.find((field) => field.key === value.titleField);
  if (!titleField || !["text", "textarea"].includes(titleField.type)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["titleField"],
      message: "The display title must reference a text field."
    });
  }
}

export const createContentCollectionSchema = collectionShape.superRefine(validateCollectionFields);

export const updateContentCollectionSchema = collectionShape
  .partial()
  .extend({
    description: z.string().trim().max(500).nullable().optional()
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, "Provide at least one collection change.");

export const contentCollectionParams = z.object({
  collectionSlug: collectionSlugSchema
});

export const contentEntryParams = contentCollectionParams.extend({
  entrySlug: entrySlugSchema
});

export const contentEntryRevisionParams = contentEntryParams.extend({
  revisionId: z.string().trim().min(1).max(120)
});

const entryDataSchema = z.record(z.unknown()).superRefine((value, context) => {
  if (Buffer.byteLength(JSON.stringify(value), "utf8") > 256 * 1024) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Entry data cannot exceed 256 KB."
    });
  }
});

export const createContentEntrySchema = z.object({
  slug: entrySlugSchema,
  locale: z.string().trim().toLowerCase().min(2).max(16).default("en"),
  data: entryDataSchema,
  status: z.enum(["DRAFT", "PUBLISHED", "ARCHIVED"]).default("DRAFT"),
  publishedAt: z.coerce.date().optional()
}).strict();

export const updateContentEntrySchema = z.object({
  slug: entrySlugSchema.optional(),
  data: entryDataSchema.optional(),
  status: z.enum(["DRAFT", "PUBLISHED", "ARCHIVED"]).optional(),
  publishedAt: z.coerce.date().nullable().optional()
}).strict().refine((value) => Object.keys(value).length > 0, "Provide at least one entry change.");

export const contentEntryQuerySchema = z.object({
  locale: z.string().trim().toLowerCase().min(2).max(16).optional(),
  q: z.string().trim().max(160).optional(),
  includeDrafts: z.enum(["true", "false"]).optional().transform((value) => value === "true"),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25)
});

export const deleteContentCollectionSchema = z.object({
  confirmation: collectionSlugSchema
}).strict();

export type ContentField = z.infer<typeof contentFieldSchema>;
export type CreateContentCollectionInput = z.infer<typeof createContentCollectionSchema>;
export type UpdateContentCollectionInput = z.infer<typeof updateContentCollectionSchema>;
export type CreateContentEntryInput = z.infer<typeof createContentEntrySchema>;
export type UpdateContentEntryInput = z.infer<typeof updateContentEntrySchema>;
export type ContentEntryQuery = z.infer<typeof contentEntryQuerySchema>;
