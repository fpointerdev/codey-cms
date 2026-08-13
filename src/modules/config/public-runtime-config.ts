import { z } from "zod";
import type { AppConfig } from "../../config/index.js";
import type { LocalizationSettings } from "../localization/localization.service.js";
import { designSystemSettingsSchema } from "./config.schemas.js";

const publicFeatureFlagsSchema = z.object({
  cms: z.boolean(),
  products: z.boolean(),
  orders: z.boolean(),
  payments: z.boolean()
}).strict();

const publicLocalizationSettingsSchema = z.object({
  enabled: z.boolean(),
  defaultLocale: z.string(),
  fallbackLocale: z.string(),
  locales: z.array(z.object({
    code: z.string(),
    label: z.string(),
    enabled: z.boolean()
  }).strict()),
  urlMode: z.literal("prefix"),
  showLanguageSwitcher: z.boolean(),
  languageSwitcherDisplay: z.enum(["buttons", "dropdown"]),
  languageSwitcherLabelStyle: z.enum(["full", "code", "icon"]),
  strings: z.record(z.record(z.string()))
}).strict();

const publicSiteSettingsSchema = z.object({
  title: z.string(),
  description: z.string(),
  metaTitle: z.string(),
  metaDescription: z.string(),
  siteUrl: z.string(),
  searchIndexing: z.boolean(),
  sitemapEnabled: z.boolean(),
  design: designSystemSettingsSchema,
  generatedCss: z.string(),
  logoUrl: z.string(),
  logoMode: z.string(),
  logoAltText: z.string(),
  logoHeight: z.number(),
  faviconUrl: z.string(),
  socialImageUrl: z.string(),
  socialImageAlt: z.string(),
  customCss: z.string()
}).strict();

export const publicRuntimeConfigSchema = z.object({
  app: z.object({
    name: z.string(),
    mode: z.string(),
    publicUrl: z.string().optional()
  }).strict(),
  features: publicFeatureFlagsSchema,
  localization: publicLocalizationSettingsSchema,
  siteSettings: publicSiteSettingsSchema,
  storage: z.object({
    publicBaseUrl: z.string().optional(),
    imageVariantWidths: z.array(z.number().int().positive())
  }).strict()
}).strict();

export type PublicRuntimeConfig = z.infer<typeof publicRuntimeConfigSchema>;

type SiteSettings = {
  title: string;
  description: string;
  metaTitle: string;
  metaDescription: string;
  siteUrl: string;
  searchIndexing: boolean;
  sitemapEnabled: boolean;
  design: unknown;
  generatedCss: string;
  logoUrl: string;
  logoMode: string;
  logoAltText: string;
  logoHeight: number;
  faviconUrl: string;
  socialImageUrl: string;
  socialImageAlt: string;
  customCss: string;
};

export function buildPublicRuntimeConfig(
  config: AppConfig,
  siteSettings: SiteSettings,
  localization: LocalizationSettings,
  storage: AppConfig["storage"] = config.storage
): PublicRuntimeConfig {
  return publicRuntimeConfigSchema.parse({
    app: {
      name: config.app.name,
      mode: config.app.mode,
      ...(config.app.publicUrl ? { publicUrl: config.app.publicUrl } : {})
    },
    features: {
      cms: config.features.cms,
      products: config.features.products,
      orders: config.features.orders,
      payments: config.features.payments
    },
    localization,
    siteSettings: {
      title: siteSettings.title,
      description: siteSettings.description,
      metaTitle: siteSettings.metaTitle,
      metaDescription: siteSettings.metaDescription,
      siteUrl: siteSettings.siteUrl,
      searchIndexing: siteSettings.searchIndexing,
      sitemapEnabled: siteSettings.sitemapEnabled,
      design: siteSettings.design,
      generatedCss: siteSettings.generatedCss,
      logoUrl: siteSettings.logoUrl,
      logoMode: siteSettings.logoMode,
      logoAltText: siteSettings.logoAltText,
      logoHeight: siteSettings.logoHeight,
      faviconUrl: siteSettings.faviconUrl,
      socialImageUrl: siteSettings.socialImageUrl,
      socialImageAlt: siteSettings.socialImageAlt,
      customCss: siteSettings.customCss
    },
    storage: {
      ...(storage.publicBaseUrl
        ? { publicBaseUrl: storage.publicBaseUrl }
        : {}),
      imageVariantWidths: storage.imageVariantWidths
    }
  });
}
