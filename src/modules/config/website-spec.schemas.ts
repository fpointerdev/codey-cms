import { z } from "zod";

const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1)
  .max(180)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lowercase words separated by hyphens.");

const colorSchema = z
  .string()
  .trim()
  .regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, "Use a hex color like #1f2937.");

const urlLikeSchema = z
  .string()
  .trim()
  .min(1)
  .max(700)
  .refine((value) => {
    if (value.startsWith("#")) return true;
    if (value.startsWith("/")) return true;

    try {
      const url = new URL(value);
      return ["http:", "https:", "mailto:", "tel:"].includes(url.protocol);
    } catch {
      return false;
    }
  }, "Use a relative path or absolute HTTP(S), email, or phone URL.");

const mediaSourceUrlSchema = z
  .string()
  .trim()
  .min(1)
  .max(120_000)
  .refine((value) => {
    if (value.startsWith("/") || value.startsWith("./")) return true;
    if (/^data:image\/(?:png|jpe?g|webp|gif|svg\+xml);(?:base64|utf8),/i.test(value)) return true;

    try {
      const url = new URL(value);
      return url.protocol === "http:" || url.protocol === "https:";
    } catch {
      return false;
    }
  }, "Use a relative, HTTP(S), or data image URL.");

const ctaSchema = z
  .object({
    label: z.string().trim().min(1).max(80),
    url: urlLikeSchema,
    style: z.enum(["primary", "secondary", "link"]).default("primary")
  })
  .strict();

const contentItemSchema = z
  .object({
    title: z.string().trim().min(1).max(120),
    body: z.string().trim().max(700).optional(),
    label: z.string().trim().max(80).optional(),
    value: z.string().trim().max(120).optional(),
    mediaKey: slugSchema.optional(),
    url: urlLikeSchema.optional()
  })
  .strict();

export const websiteSpecMediaSchema = z
  .object({
    key: slugSchema,
    kind: z.enum(["IMAGE", "VIDEO", "DOCUMENT", "OTHER"]).default("IMAGE"),
    prompt: z.string().trim().min(1).max(600),
    altText: z.string().trim().min(1).max(240),
    placement: z.enum(["hero", "section", "gallery", "product", "background", "other"]).default("section"),
    url: mediaSourceUrlSchema.optional(),
    width: z.number().int().positive().max(8000).default(1200),
    height: z.number().int().positive().max(8000).default(800),
    mimeType: z.string().trim().min(1).max(160).default("image/png")
  })
  .strict();

export const websiteSpecBrandingSchema = z
  .object({
    logoMediaKey: slugSchema.optional(),
    logoMode: z.enum(["text", "image", "image-and-name"]).default("text"),
    logoAltText: z.string().trim().max(160).optional(),
    logoHeight: z.number().int().min(20).max(120).default(42)
  })
  .strict();

export const websiteSpecSectionSchema = z
  .object({
    key: slugSchema,
    type: z.enum([
      "hero",
      "text",
      "richText",
      "image",
      "gallery",
      "cta",
      "contactForm",
      "productList",
      "featureGrid",
      "pricing",
      "faq",
      "custom"
    ]),
    eyebrow: z.string().trim().max(80).optional(),
    heading: z.string().trim().max(180).optional(),
    body: z.string().trim().max(4000).optional(),
    items: z.array(contentItemSchema).max(40).default([]),
    mediaKey: slugSchema.optional(),
    galleryMediaKeys: z.array(slugSchema).max(24).default([]),
    productSlugs: z.array(slugSchema).max(100).default([]),
    cta: ctaSchema.optional(),
    settings: z.record(z.unknown()).default({})
  })
  .strict();

export const websiteSpecPageSchema = z
  .object({
    title: z.string().trim().min(1).max(180),
    slug: slugSchema,
    purpose: z.enum(["home", "about", "landing", "content", "shop", "contact", "legal", "dashboard"]),
    excerpt: z.string().trim().max(500).optional(),
    navLabel: z.string().trim().min(1).max(80).optional(),
    includeInNavigation: z.boolean().default(true),
    seo: z
      .object({
        title: z.string().trim().max(180).optional(),
        description: z.string().trim().max(300).optional(),
        keywords: z.array(z.string().trim().min(1).max(60)).max(20).default([])
      })
      .strict()
      .default({}),
    sections: z.array(websiteSpecSectionSchema).min(1).max(30)
  })
  .strict();

export const websiteSpecPostSchema = z
  .object({
    title: z.string().trim().min(1).max(180),
    slug: slugSchema,
    excerpt: z.string().trim().max(500).optional(),
    body: z.string().trim().min(1).max(12_000),
    tags: z.array(z.string().trim().min(1).max(60)).max(20).default([]),
    categorySlugs: z.array(slugSchema).max(10).default([])
  })
  .strict();

export const websiteSpecProductSchema = z
  .object({
    name: z.string().trim().min(1).max(180),
    slug: slugSchema,
    description: z.string().trim().max(2000).optional(),
    sku: z.string().trim().max(80).optional(),
    priceCents: z.number().int().nonnegative(),
    currency: z.string().trim().length(3).default("EUR"),
    stockQuantity: z.number().int().nonnegative().default(0),
    purchaseMode: z.enum(["buy", "quote"]).default("buy"),
    seo: z
      .object({
        title: z.string().trim().max(180).optional(),
        description: z.string().trim().max(300).optional(),
        keywords: z.array(z.string().trim().min(1).max(60)).max(20).default([])
      })
      .strict()
      .default({}),
    category: z
      .object({
        name: z.string().trim().min(1).max(120),
        slug: slugSchema,
        description: z.string().trim().max(500).optional()
      })
      .strict()
      .optional(),
    imageMediaKeys: z.array(slugSchema).max(20).default([]),
    options: z
      .array(
        z
          .object({
            name: z.string().trim().min(1).max(80),
            values: z.array(z.string().trim().min(1).max(120)).max(100).default([])
          })
          .strict()
      )
      .max(20)
      .default([]),
    variants: z
      .array(
        z
          .object({
            name: z.string().trim().min(1).max(120),
            sku: z.string().trim().max(80).optional(),
            optionValues: z.record(z.unknown()).default({}),
            priceCents: z.number().int().nonnegative().optional(),
            stockQuantity: z.number().int().nonnegative().default(0),
            active: z.boolean().default(true)
          })
          .strict()
      )
      .max(200)
      .default([])
  })
  .strict();

export const websiteSpecSchema = z
  .object({
    version: z.literal("1.0"),
    intent: z.enum(["presentation", "cms", "shop", "saas"]),
    project: z
      .object({
        name: z.string().trim().min(1).max(120),
        slug: slugSchema,
        summary: z.string().trim().min(1).max(800),
        audience: z.string().trim().max(240).optional(),
        locale: z.string().trim().min(2).max(20).default("en"),
        timezone: z.string().trim().min(1).max(80).default("UTC"),
        currency: z.string().trim().length(3).default("EUR")
      })
      .strict(),
    modules: z
      .object({
        cms: z.boolean().optional(),
        blog: z.boolean().optional(),
        shop: z.boolean().optional(),
        products: z.boolean().optional(),
        orders: z.boolean().optional(),
        payments: z.boolean().optional(),
        notifications: z.boolean().optional(),
        localization: z.boolean().optional(),
        auth: z.boolean().optional()
      })
      .strict()
      .default({}),
    style: z
      .object({
        theme: z.string().trim().min(1).max(80),
        tone: z.string().trim().max(160).optional(),
        colorPalette: z
          .object({
            primary: colorSchema,
            secondary: colorSchema.optional(),
            accent: colorSchema.optional(),
            neutral: colorSchema.optional()
          })
          .strict(),
        typography: z
          .object({
            heading: z.string().trim().max(80).optional(),
            body: z.string().trim().max(80).optional()
          })
          .strict()
          .default({}),
        experience: z
          .object({
            family: z.string().trim().min(1).max(80),
            recipeId: z.string().trim().min(1).max(80),
            heroComposition: z.string().trim().min(1).max(80),
            navigationSystem: z.string().trim().min(1).max(80),
            sectionRhythm: z.string().trim().min(1).max(80),
            gridSystem: z.string().trim().min(1).max(80),
            imageTreatment: z.string().trim().min(1).max(80),
            typographySystem: z.string().trim().min(1).max(80),
            signatureInteraction: z.string().trim().min(1).max(80),
            shapeLanguage: z.string().trim().min(1).max(80),
            motionSystem: z.string().trim().min(1).max(80),
            motionLevel: z.enum(["none", "light", "medium", "high"])
          })
          .strict()
          .optional(),
        runtimeCss: z.string().trim().max(60_000).optional(),
        customCss: z.string().trim().max(20_000).optional()
      })
      .strict(),
    branding: websiteSpecBrandingSchema.optional(),
    pages: z.array(websiteSpecPageSchema).min(1).max(40),
    posts: z.array(websiteSpecPostSchema).max(80).default([]),
    products: z.array(websiteSpecProductSchema).max(200).default([]),
    media: z.array(websiteSpecMediaSchema).max(250).default([])
  })
  .strict()
  .superRefine((spec, context) => {
    addUniqueIssues(spec.pages.map((page) => page.slug), context, ["pages"], "Duplicate page slug.");
    addUniqueIssues(spec.products.map((product) => product.slug), context, ["products"], "Duplicate product slug.");
    addUniqueIssues(spec.posts.map((post) => post.slug), context, ["posts"], "Duplicate post slug.");
    addUniqueIssues(spec.media.map((media) => media.key), context, ["media"], "Duplicate media key.");

    const mediaKeys = new Set(spec.media.map((media) => media.key));
    if (spec.branding && spec.branding.logoMode !== "text" && !spec.branding.logoMediaKey) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["branding", "logoMediaKey"],
        message: "Image logo mode requires a logo media key."
      });
    }
    if (spec.branding?.logoMediaKey && !mediaKeys.has(spec.branding.logoMediaKey)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["branding", "logoMediaKey"],
        message: "Referenced logo media key does not exist."
      });
    }

    for (const [pageIndex, page] of spec.pages.entries()) {
      addUniqueIssues(
        page.sections.map((section) => section.key),
        context,
        ["pages", pageIndex, "sections"],
        "Duplicate section key."
      );

      for (const [sectionIndex, section] of page.sections.entries()) {
        if (section.mediaKey && !mediaKeys.has(section.mediaKey)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["pages", pageIndex, "sections", sectionIndex, "mediaKey"],
            message: "Referenced media key does not exist."
          });
        }

        for (const [mediaIndex, mediaKey] of section.galleryMediaKeys.entries()) {
          if (!mediaKeys.has(mediaKey)) {
            context.addIssue({
              code: z.ZodIssueCode.custom,
              path: ["pages", pageIndex, "sections", sectionIndex, "galleryMediaKeys", mediaIndex],
              message: "Referenced gallery media key does not exist."
            });
          }
        }

        for (const [itemIndex, item] of section.items.entries()) {
          if (item.mediaKey && !mediaKeys.has(item.mediaKey)) {
            context.addIssue({
              code: z.ZodIssueCode.custom,
              path: ["pages", pageIndex, "sections", sectionIndex, "items", itemIndex, "mediaKey"],
              message: "Referenced item media key does not exist."
            });
          }
        }
      }
    }

    for (const [productIndex, product] of spec.products.entries()) {
      for (const [mediaIndex, mediaKey] of product.imageMediaKeys.entries()) {
        if (!mediaKeys.has(mediaKey)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["products", productIndex, "imageMediaKeys", mediaIndex],
            message: "Referenced product media key does not exist."
          });
        }
      }
    }
  });

function addUniqueIssues(
  values: string[],
  context: z.RefinementCtx,
  path: Array<string | number>,
  message: string
) {
  const seen = new Set<string>();

  for (const [index, value] of values.entries()) {
    if (seen.has(value)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: [...path, index],
        message
      });
    }

    seen.add(value);
  }
}

export const websiteSpecRequestSchema = z
  .object({
    spec: websiteSpecSchema
  })
  .strict();

export const applyWebsiteSpecRequestSchema = websiteSpecRequestSchema.extend({
  dryRun: z.boolean().default(false)
});

export type WebsiteSpec = z.infer<typeof websiteSpecSchema>;
export type WebsiteSpecPage = z.infer<typeof websiteSpecPageSchema>;
export type WebsiteSpecSection = z.infer<typeof websiteSpecSectionSchema>;
export type WebsiteSpecMedia = z.infer<typeof websiteSpecMediaSchema>;
export type WebsiteSpecBranding = z.infer<typeof websiteSpecBrandingSchema>;
export type WebsiteSpecProduct = z.infer<typeof websiteSpecProductSchema>;
