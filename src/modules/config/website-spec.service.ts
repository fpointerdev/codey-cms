import { Prisma } from "@prisma/client";
import { sanitizeGeneratedStylesheet } from "../../core/security/css-sanitizer.js";
import type { ModuleContext, ModuleId } from "../../core/types/module.js";
import { CmsService } from "../cms/cms.service.js";
import {
  deploymentProfiles,
  moduleCatalog,
  themeManifest,
  type DeploymentProfileId
} from "../manifest.js";
import {
  builderElementForSectionType,
  builderElementRegistry,
  builderRegistryVersion,
  builderSectionPatternRegistry,
  builderStylePresetRegistry,
  contentBlockTypes,
  sectionPresetRegistry
} from "../builder/element-registry.js";
import { websiteSpecSchema, type WebsiteSpec, type WebsiteSpecMedia, type WebsiteSpecSection } from "./website-spec.schemas.js";
import { normalizeDesignSystemSettings } from "./site-design.js";

type RequestUser = {
  id: string;
};

type WebsiteSpecDatabase = ModuleContext["prisma"] | Prisma.TransactionClient;

type WebsiteSpecContext = Omit<ModuleContext, "prisma"> & {
  prisma: WebsiteSpecDatabase;
};

type GeneratedMediaPlaceholder = {
  key: string;
  kind: "IMAGE" | "VIDEO" | "DOCUMENT" | "OTHER";
  url: string;
  mimeType: string;
  width: number;
  height: number;
  altText: string;
  prompt: string;
  placement: string;
  usedBy: string[];
};

type GeneratedContentBlock = {
  key: string;
  type:
    | "TEXT"
    | "RICH_TEXT"
    | "IMAGE"
    | "GALLERY"
    | "EMBED"
    | "BUTTON"
    | "CTA"
    | "CONTACT_FORM"
    | "PRODUCT_LIST"
    | "CUSTOM";
  label?: string;
  value: unknown;
  sortOrder: number;
  editable: boolean;
  mediaKey?: string;
  mediaAssetId?: string;
};

type GeneratedPageSection = {
  key: string;
  label?: string;
  sortOrder: number;
  settings: Record<string, unknown>;
  blocks: GeneratedContentBlock[];
};

type GeneratedCmsPage = {
  title: string;
  slug: string;
  locale: string;
  translationGroupId?: string | null;
  excerpt?: string;
  content: Record<string, unknown>;
  metaTitle?: string;
  metaDescription?: string;
  seo?: Record<string, unknown>;
  status: "DRAFT" | "PUBLISHED" | "ARCHIVED";
  sections: GeneratedPageSection[];
};

type GeneratedCmsPost = {
  title: string;
  slug: string;
  locale: string;
  translationGroupId?: string | null;
  excerpt?: string;
  content: Record<string, unknown>;
  status: "DRAFT" | "PUBLISHED" | "ARCHIVED";
  tags: string[];
  categorySlugs: string[];
};

type GeneratedProduct = {
  name: string;
  slug: string;
  description?: string;
  sku?: string;
  priceCents: number;
  currency: string;
  stockQuantity: number;
  status: "DRAFT" | "ACTIVE" | "ARCHIVED";
  metaTitle?: string;
  metaDescription?: string;
  seo?: Record<string, unknown>;
  category?: {
    name: string;
    slug: string;
    description?: string;
  };
  images: Array<{
    mediaKey: string;
    url: string;
    alt?: string;
    sortOrder: number;
    isPrimary: boolean;
    mediaAssetId?: string;
  }>;
  options: Array<{ name: string; values: string[]; sortOrder: number }>;
  variants: Array<{
    name: string;
    sku?: string;
    optionValues?: Record<string, unknown>;
    priceCents?: number;
    stockQuantity: number;
    active: boolean;
  }>;
};

export type WebsiteGenerationPlan = {
  deploymentProfile: DeploymentProfileId;
  modules: ModuleId[];
  pricing: {
    profileMonthlyEuroCents: number;
    moduleMonthlyEuroCents: number;
  };
  site: {
    slug: string;
    name: string;
    locale: string;
    timezone: string;
    currency: string;
    summary: string;
  };
  style: WebsiteSpec["style"];
  branding?: {
    logoUrl?: string;
    logoMode: "text" | "image" | "image-and-name";
    logoAltText?: string;
    logoHeight: number;
  };
  cmsPages: GeneratedCmsPage[];
  cmsPosts: GeneratedCmsPost[];
  products: GeneratedProduct[];
  mediaPlaceholders: GeneratedMediaPlaceholder[];
  navigation: Array<{ label: string; pageSlug: string; sortOrder: number }>;
  warnings: string[];
};

type ApplyResult = {
  plan: WebsiteGenerationPlan;
  applied: {
    modules: number;
    mediaAssets: number;
    pages: number;
    posts: number;
    products: number;
    menuItems: number;
  };
};

const coreModules: ModuleId[] = ["health", "config", "auth", "users", "roles"];

const sectionTemplateByType: Record<WebsiteSpecSection["type"], string> = {
  hero: "hero",
  text: "content",
  richText: "content",
  image: "gallery",
  gallery: "gallery",
  cta: "custom",
  contactForm: "contact",
  productList: "products",
  featureGrid: "custom",
  pricing: "custom",
  faq: "custom",
  custom: "custom"
};

export function validateWebsiteSpec(input: unknown) {
  return websiteSpecSchema.parse(input);
}

export function buildWebsiteGenerationPlan(input: unknown): WebsiteGenerationPlan {
  const spec = validateWebsiteSpec(input);
  const deploymentProfile = selectDeploymentProfile(spec);
  const modules = resolveModules(spec, deploymentProfile);
  const mediaPlaceholders = buildMediaPlaceholders(spec);

  return {
    deploymentProfile,
    modules,
    pricing: {
      profileMonthlyEuroCents: deploymentProfiles[deploymentProfile].monthlyEuroCents,
      moduleMonthlyEuroCents: modules.reduce(
        (total, moduleId) => total + moduleCatalog[moduleId].monthlyEuroCents,
        0
      )
    },
    site: {
      slug: "default",
      name: spec.project.name,
      locale: spec.project.locale,
      timezone: spec.project.timezone,
      currency: spec.project.currency.toUpperCase(),
      summary: spec.project.summary
    },
    style: {
      ...spec.style,
      ...(spec.style.customCss
        ? { customCss: sanitizeGeneratedStylesheet(spec.style.customCss) }
        : {})
    },
    branding: buildGeneratedBranding(spec, mediaPlaceholders),
    cmsPages: modules.includes("cms") ? spec.pages.map((page) => mapPage(spec, page, mediaPlaceholders)) : [],
    cmsPosts: modules.includes("cms") ? spec.posts.map((post) => mapPost(spec, post)) : [],
    products: modules.includes("products") ? spec.products.map((product) => mapProduct(product, mediaPlaceholders)) : [],
    mediaPlaceholders,
    navigation: spec.pages
      .filter((page) => page.includeInNavigation)
      .map((page, index) => ({
        label: page.navLabel ?? page.title,
        pageSlug: page.slug,
        sortOrder: index
      })),
    warnings: buildWarnings(spec, modules)
  };
}

export async function applyWebsiteSpec(
  context: ModuleContext,
  input: unknown,
  user?: RequestUser
): Promise<ApplyResult> {
  const plan = buildWebsiteGenerationPlan(input);

  return context.prisma.$transaction(
    (transaction) => applyWebsiteGenerationPlan(
      { ...context, prisma: transaction },
      plan,
      user
    ),
    { maxWait: 10_000, timeout: 120_000 }
  );
}

async function applyWebsiteGenerationPlan(
  context: WebsiteSpecContext,
  plan: WebsiteGenerationPlan,
  user?: RequestUser
): Promise<ApplyResult> {
  const site = await context.prisma.site.upsert({
    where: { slug: plan.site.slug },
    update: {
      name: plan.site.name,
      deploymentProfile: plan.deploymentProfile
    },
    create: {
      slug: plan.site.slug,
      name: plan.site.name,
      deploymentProfile: plan.deploymentProfile
    }
  });

  await syncInstalledModules(context, site.id, plan.modules);
  await syncLocalizationSettings(context, site.id, plan);
  const mediaAssetIds = await syncMediaPlaceholders(context, site.id, plan.mediaPlaceholders);
  await syncGeneratedSiteSettings(context, site.id, plan);
  const pages = await syncCmsContent(context, plan, mediaAssetIds, user);
  const products = await syncProducts(context, plan, mediaAssetIds);
  const menuItems = await syncMainMenu(context, plan);

  return {
    plan,
    applied: {
      modules: plan.modules.length,
      mediaAssets: mediaAssetIds.size,
      pages,
      posts: plan.cmsPosts.length,
      products,
      menuItems
    }
  };
}

function buildGeneratedBranding(
  spec: WebsiteSpec,
  mediaPlaceholders: GeneratedMediaPlaceholder[]
): WebsiteGenerationPlan["branding"] {
  if (!spec.branding) return undefined;

  const logo = spec.branding.logoMediaKey
    ? mediaPlaceholders.find((media) => media.key === spec.branding?.logoMediaKey)
    : undefined;

  return {
    ...(logo ? { logoUrl: logo.url } : {}),
    logoMode: spec.branding.logoMode,
    logoAltText: spec.branding.logoAltText || logo?.altText,
    logoHeight: spec.branding.logoHeight
  };
}

async function syncGeneratedSiteSettings(
  context: WebsiteSpecContext,
  siteId: string,
  plan: WebsiteGenerationPlan
) {
  const key = { siteId, moduleId: "config", key: "site" };
  const existing = await context.prisma.moduleSetting.findUnique({
    where: { siteId_moduleId_key: key },
    select: { value: true }
  });
  const stored = existing?.value && typeof existing.value === "object" && !Array.isArray(existing.value)
    ? existing.value as Record<string, unknown>
    : {};
  const storedDesign = normalizeDesignSystemSettings(stored.design);
  const design = normalizeDesignSystemSettings({
    ...storedDesign,
    preset: "custom",
    colors: {
      ...storedDesign.colors,
      text: plan.style.colorPalette.primary,
      primary: plan.style.colorPalette.accent || plan.style.colorPalette.primary
    },
    typography: {
      ...storedDesign.typography,
      headingFont: plan.style.typography.heading || storedDesign.typography.headingFont,
      bodyFont: plan.style.typography.body || storedDesign.typography.bodyFont
    }
  });
  const value = {
    ...stored,
    title: plan.site.name,
    description: plan.site.summary,
    metaTitle: plan.site.name,
    metaDescription: plan.site.summary.slice(0, 300),
    siteUrl: typeof stored.siteUrl === "string" ? stored.siteUrl : "",
    searchIndexing: stored.searchIndexing !== false,
    sitemapEnabled: stored.sitemapEnabled !== false,
    design,
    generatedFrom: "websiteSpec",
    generatedCss: sanitizeGeneratedStylesheet(plan.style.runtimeCss, 60_000),
    experience: plan.style.experience,
    customCss: plan.style.customCss || (typeof stored.customCss === "string" ? stored.customCss : ""),
    ...(plan.branding
      ? {
          logoUrl: plan.branding.logoUrl || "",
          logoMode: plan.branding.logoMode,
          logoAltText: plan.branding.logoAltText || plan.site.name,
          logoHeight: plan.branding.logoHeight
        }
      : {
          logoUrl: typeof stored.logoUrl === "string" ? stored.logoUrl : "",
          logoMode: ["text", "image", "image-and-name"].includes(String(stored.logoMode))
            ? stored.logoMode
            : "text",
          logoAltText: typeof stored.logoAltText === "string" ? stored.logoAltText : "",
          logoHeight: typeof stored.logoHeight === "number" ? stored.logoHeight : 42
        })
  };

  await context.prisma.moduleSetting.upsert({
    where: { siteId_moduleId_key: key },
    update: { value: value as Prisma.InputJsonValue },
    create: {
      siteId,
      moduleId: "config",
      key: "site",
      value: value as Prisma.InputJsonValue
    }
  });
}

async function syncLocalizationSettings(
  context: WebsiteSpecContext,
  siteId: string,
  plan: WebsiteGenerationPlan
) {
  if (!plan.modules.includes("localization")) return;

  await context.prisma.moduleSetting.upsert({
    where: {
      siteId_moduleId_key: {
        siteId,
        moduleId: "localization",
        key: "settings"
      }
    },
    update: {
      value: {
        enabled: true,
        defaultLocale: plan.site.locale,
        fallbackLocale: plan.site.locale,
        locales: [
          {
            code: plan.site.locale,
            label: plan.site.locale.toUpperCase(),
            enabled: true
          }
        ],
        urlMode: "prefix",
        showLanguageSwitcher: false
      }
    },
    create: {
      siteId,
      moduleId: "localization",
      key: "settings",
      value: {
        enabled: true,
        defaultLocale: plan.site.locale,
        fallbackLocale: plan.site.locale,
        locales: [
          {
            code: plan.site.locale,
            label: plan.site.locale.toUpperCase(),
            enabled: true
          }
        ],
        urlMode: "prefix",
        showLanguageSwitcher: false
      }
    }
  });
}

export function generationContract() {
  return {
    version: "1.0",
    intents: ["presentation", "cms", "shop", "saas"],
    deploymentProfiles,
    modules: moduleCatalog,
    theme: themeManifest,
    builder: {
      version: builderRegistryVersion,
      elements: builderElementRegistry,
      sectionPresets: sectionPresetRegistry,
      stylePresets: builderStylePresetRegistry,
      sectionPatterns: builderSectionPatternRegistry
    },
    sectionTypes: Object.keys(sectionTemplateByType),
    contentBlockTypes: contentBlockTypes(),
    mediaKinds: ["IMAGE", "VIDEO", "DOCUMENT", "OTHER"]
  };
}

function selectDeploymentProfile(spec: WebsiteSpec): DeploymentProfileId {
  if (hasShopSignals(spec)) return "shop";
  if (spec.intent === "saas") return "saas";
  if (spec.intent === "cms" || spec.modules.blog || spec.posts.length > 0) return "cms";
  return "presentation";
}

function resolveModules(spec: WebsiteSpec, profile: DeploymentProfileId) {
  const modules = new Set<ModuleId>();
  const add = (moduleId: ModuleId) => {
    for (const dependency of moduleCatalog[moduleId].dependencies) {
      add(dependency);
    }
    modules.add(moduleId);
  };

  for (const moduleId of coreModules) add(moduleId);
  for (const moduleId of deploymentProfiles[profile].modules) add(moduleId);

  if (spec.pages.length > 0 || spec.modules.cms || spec.modules.blog || spec.posts.length > 0) add("cms");
  if (spec.modules.localization) add("localization");
  if (spec.modules.notifications) add("notifications");
  if (spec.modules.products || spec.products.length > 0 || hasProductListSection(spec)) add("products");
  if (spec.modules.orders || spec.modules.shop || spec.intent === "shop") add("orders");
  if (spec.modules.payments || spec.modules.shop || spec.intent === "shop") add("payments");

  return Object.keys(moduleCatalog).filter((moduleId): moduleId is ModuleId =>
    modules.has(moduleId as ModuleId)
  );
}

function hasShopSignals(spec: WebsiteSpec) {
  return (
    spec.intent === "shop" ||
    spec.modules.shop === true ||
    spec.modules.products === true ||
    spec.modules.orders === true ||
    spec.modules.payments === true ||
    spec.products.length > 0 ||
    hasProductListSection(spec)
  );
}

function hasProductListSection(spec: WebsiteSpec) {
  return spec.pages.some((page) => page.sections.some((section) => section.type === "productList"));
}

function buildMediaPlaceholders(spec: WebsiteSpec) {
  const mediaByKey = new Map<string, GeneratedMediaPlaceholder>();
  const add = (media: WebsiteSpecMedia, usedBy: string) => {
    const existing = mediaByKey.get(media.key);
    if (existing) {
      existing.usedBy.push(usedBy);
      return existing;
    }

    const placeholder = {
      key: media.key,
      kind: media.kind,
      url: createPlaceholderUrl(media),
      mimeType: media.mimeType,
      width: media.width,
      height: media.height,
      altText: media.altText,
      prompt: media.prompt,
      placement: media.placement,
      usedBy: [usedBy]
    };
    mediaByKey.set(media.key, placeholder);
    return placeholder;
  };

  for (const media of spec.media) {
    add(media, "spec.media");
  }

  for (const page of spec.pages) {
    for (const section of page.sections) {
      if (section.mediaKey) {
        add(mediaFromKey(spec, section.mediaKey), `page:${page.slug}:section:${section.key}`);
      }

      for (const item of section.items) {
        if (item.mediaKey) {
          add(mediaFromKey(spec, item.mediaKey), `page:${page.slug}:section:${section.key}:item`);
        }
      }

      for (const mediaKey of section.galleryMediaKeys) {
        add(mediaFromKey(spec, mediaKey), `page:${page.slug}:section:${section.key}`);
      }

      if (!section.mediaKey && ["hero", "image"].includes(section.type)) {
        const media = generatedSectionMedia(page.slug, section);
        add(media, `page:${page.slug}:section:${section.key}`);
      }
    }
  }

  for (const product of spec.products) {
    if (product.imageMediaKeys.length === 0) {
      add(generatedProductMedia(product.slug, product.name), `product:${product.slug}`);
    }

    for (const mediaKey of product.imageMediaKeys) {
      add(mediaFromKey(spec, mediaKey), `product:${product.slug}`);
    }
  }

  return [...mediaByKey.values()];
}

function mapPage(
  spec: WebsiteSpec,
  page: WebsiteSpec["pages"][number],
  mediaPlaceholders: GeneratedMediaPlaceholder[]
): GeneratedCmsPage {
  return {
    title: page.title,
    slug: page.slug,
    locale: spec.project.locale,
    translationGroupId: page.slug,
    excerpt: page.excerpt ?? "",
    content: {
      source: "websiteSpec",
      layout: "full-width",
      intent: spec.intent,
      project: spec.project,
      style: spec.style,
      hideTitle: page.sections[0]?.type === "hero" && Boolean(page.sections[0].heading)
    },
    metaTitle: page.seo.title ?? page.title,
    metaDescription: page.seo.description ?? page.excerpt ?? spec.project.summary,
    seo: {
      keywords: page.seo.keywords,
      purpose: page.purpose
    },
    status: "PUBLISHED",
    sections: page.sections.map((section, index) =>
      mapSection(page.slug, section, index, mediaPlaceholders)
    )
  };
}

function mapSection(
  pageSlug: string,
  section: WebsiteSpecSection,
  sortOrder: number,
  mediaPlaceholders: GeneratedMediaPlaceholder[]
): GeneratedPageSection {
  const blocks: GeneratedContentBlock[] = [];
  const sectionMedia = section.mediaKey ?? (
    ["hero", "image"].includes(section.type)
      ? generatedSectionMediaKey(pageSlug, section)
      : undefined
  );
  const media = sectionMedia
    ? mediaPlaceholders.find((item) => item.key === sectionMedia)
    : undefined;
  const builderElement = builderElementForSectionType(section.type);
  const structuredSection = ["featureGrid", "pricing", "faq", "custom"].includes(section.type);

  if (section.eyebrow) {
    blocks.push(textBlock(section.key, "eyebrow", section.eyebrow, blocks.length));
  }

  if (section.heading && !structuredSection) {
    blocks.push(headingBlock(section.key, section.heading, blocks.length, section.type === "hero" ? 1 : 2));
  }

  if (section.body && !structuredSection) {
    blocks.push({
      key: `${section.key}-body`,
      type: section.type === "text" ? "TEXT" : "RICH_TEXT",
      label: "Body",
      value: section.body,
      sortOrder: blocks.length,
      editable: true
    });
  }

  if (["hero", "image"].includes(section.type) && media) {
    blocks.push(imageBlock(section.key, media, blocks.length));
  }

  if (section.type === "gallery") {
    const galleryKeys = [...new Set([
      ...section.items.map((item) => item.mediaKey).filter((key): key is string => Boolean(key)),
      ...section.galleryMediaKeys,
      ...(section.mediaKey ? [section.mediaKey] : [])
    ])];
    const galleryMedia = galleryKeys
      .map((mediaKey) => mediaPlaceholders.find((item) => item.key === mediaKey))
      .filter((item): item is GeneratedMediaPlaceholder => Boolean(item));

    if (galleryMedia.length) {
      blocks.push({
        key: `${section.key}-gallery`,
        type: "GALLERY",
        label: section.heading ?? "Gallery",
        value: {
          items: galleryMedia.map((item) => {
            const content = section.items.find((candidate) => candidate.mediaKey === item.key);
            const caption = [
              content?.title ? `<h3>${escapeGeneratedHtml(content.title)}</h3>` : "",
              content?.body ? `<p>${escapeGeneratedHtml(content.body)}</p>` : ""
            ].filter(Boolean).join("");

            return {
              url: item.url,
              alt: item.altText,
              mediaKey: item.key,
              ...(caption ? { caption } : {}),
              ...(content?.url ? { link: content.url } : {})
            };
          }),
          settings: {
            displayMode: "gallery",
            layoutMode: "grid",
            columnsDesktop: Math.min(3, galleryMedia.length),
            columnsTablet: Math.min(2, galleryMedia.length),
            columnsMobile: 1,
            gap: 16,
            imageRatio: "4 / 3",
            objectFit: "cover",
            showCaptions: true,
            lightbox: true
          }
        },
        sortOrder: blocks.length,
        editable: true
      });
    }

    const copyItems = section.items.filter((item) => !item.mediaKey);
    if (copyItems.length) {
      blocks.push({
        key: `${section.key}-items`,
        type: "CUSTOM",
        label: `${section.heading ?? "Gallery"} items`,
        value: {
          variant: "feature-cards",
          items: mapSectionItems(copyItems, mediaPlaceholders)
        },
        sortOrder: blocks.length,
        editable: true
      });
    }
  }

  if (section.cta && !structuredSection) {
    blocks.push({
      key: `${section.key}-cta`,
      type: section.type === "cta" ? "CTA" : "BUTTON",
      label: section.cta.label,
      value: {
        label: section.cta.label,
        url: section.cta.url,
        style: section.cta.style
      },
      sortOrder: blocks.length,
      editable: true
    });
  }

  if (section.type === "contactForm") {
    blocks.push({
      key: `${section.key}-form`,
      type: "CONTACT_FORM",
      label: section.heading ?? "Contact form",
      value: {
        formKey: `${pageSlug}-${section.key}`,
        fields: ["name", "email", "phone", "subject", "message"],
        ...(section.cta?.label ? { buttonLabel: section.cta.label } : {})
      },
      sortOrder: blocks.length,
      editable: true
    });
  }

  if (section.type === "productList") {
    blocks.push({
      key: `${section.key}-products`,
      type: "PRODUCT_LIST",
      label: section.heading ?? "Products",
      value: {
        title: section.heading,
        productSlugs: section.productSlugs,
        limit: section.productSlugs.length || 12
      },
      sortOrder: blocks.length,
      editable: true
    });
  }

  if (section.type === "hero" && section.items.length) {
    blocks.push({
      key: `${section.key}-points`,
      type: "CUSTOM",
      label: "Hero points",
      value: {
        variant: "hero-points",
        items: mapSectionItems(section.items, mediaPlaceholders)
      },
      sortOrder: blocks.length,
      editable: true
    });
  }

  if (structuredSection || blocks.length === 0) {
    blocks.push({
      key: `${section.key}-content`,
      type: "CUSTOM",
      label: section.heading ?? section.type,
      value: {
        variant: builderElement?.id ?? section.type,
        type: section.type,
        heading: section.heading,
        body: section.body,
        items: mapSectionItems(section.items, mediaPlaceholders),
        ...(section.cta ? { cta: section.cta } : {}),
        settings: section.settings
      },
      sortOrder: blocks.length,
      editable: true
    });
  }

  return {
    key: section.key,
    sortOrder,
    settings: generatedSectionSettings(section, builderElement?.id),
    blocks
  };
}

function generatedSectionSettings(
  section: WebsiteSpecSection,
  elementId: string | undefined
) {
  const settings = section.settings;
  const requestedLayout = typeof settings.layout === "string" ? settings.layout : "";

  return {
    ...settings,
    template: sectionTemplateByType[section.type],
    layout: supportedSectionLayout(requestedLayout, section.type),
    container: supportedSetting(settings.container, ["narrow", "default", "wide", "full"], "wide"),
    spacing: supportedSetting(settings.spacing, ["none", "sm", "md", "lg", "xl"], section.type === "hero" ? "xl" : "md"),
    websiteSpec: {
      type: section.type,
      composition: requestedLayout || defaultLayout(section.type),
      collection: ["featureGrid", "gallery", "pricing", "productList", "faq"].includes(section.type) || section.items.length > 0
    },
    elementId: elementId ?? "structured-content"
  };
}

function supportedSectionLayout(value: string, type: WebsiteSpecSection["type"]) {
  return supportedSetting(value, [
    "one-column",
    "two-column",
    "three-column",
    "four-column",
    "sidebar-left",
    "sidebar-right",
    "full-bleed",
    "asymmetric"
  ], defaultLayout(type));
}

function supportedSetting(value: unknown, allowed: string[], fallback: string) {
  return typeof value === "string" && allowed.includes(value) ? value : fallback;
}

function headingBlock(
  sectionKey: string,
  value: string,
  sortOrder: number,
  level: 1 | 2
): GeneratedContentBlock {
  return {
    key: `${sectionKey}-heading`,
    type: "RICH_TEXT",
    label: "Heading",
    value: `<h${level}>${escapeGeneratedHtml(value)}</h${level}>`,
    sortOrder,
    editable: true
  };
}

function escapeGeneratedHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function textBlock(sectionKey: string, key: string, value: string, sortOrder: number): GeneratedContentBlock {
  return {
    key: `${sectionKey}-${key}`,
    type: "TEXT",
    label: key,
    value,
    sortOrder,
    editable: true
  };
}

function imageBlock(
  sectionKey: string,
  media: GeneratedMediaPlaceholder,
  sortOrder: number
): GeneratedContentBlock {
  return {
    key: `${sectionKey}-image`,
    type: "IMAGE",
    label: media.altText,
    value: {
      url: media.url,
      altText: media.altText,
      mediaKey: media.key
    },
    sortOrder,
    editable: true,
    mediaKey: media.key
  };
}

function mapSectionItems(
  items: WebsiteSpecSection["items"],
  mediaPlaceholders: GeneratedMediaPlaceholder[]
) {
  return items.map((item) => {
    if (!item.mediaKey) return item;
    const media = mediaPlaceholders.find((candidate) => candidate.key === item.mediaKey);
    if (!media) return item;

    return {
      ...item,
      image: {
        url: media.url,
        alt: media.altText,
        mediaKey: media.key
      }
    };
  });
}

function mapPost(spec: WebsiteSpec, post: WebsiteSpec["posts"][number]): GeneratedCmsPost {
  return {
    title: post.title,
    slug: post.slug,
    locale: spec.project.locale,
    translationGroupId: post.slug,
    excerpt: post.excerpt,
    content: {
      body: post.body,
      source: "websiteSpec"
    },
    status: "PUBLISHED",
    tags: post.tags,
    categorySlugs: post.categorySlugs
  };
}

function mapProduct(
  product: WebsiteSpec["products"][number],
  mediaPlaceholders: GeneratedMediaPlaceholder[]
): GeneratedProduct {
  const mediaKeys = product.imageMediaKeys.length
    ? product.imageMediaKeys
    : [generatedProductMediaKey(product.slug)];
  const images: GeneratedProduct["images"] = [];

  for (const [index, mediaKey] of mediaKeys.entries()) {
    const media = mediaPlaceholders.find((item) => item.key === mediaKey);

    if (media) {
      images.push({
        mediaKey: media.key,
        url: media.url,
        alt: media.altText,
        sortOrder: index,
        isPrimary: index === 0
      });
    }
  }

  return {
    name: product.name,
    slug: product.slug,
    description: product.description,
    sku: product.sku,
    priceCents: product.priceCents,
    currency: product.currency.toUpperCase(),
    stockQuantity: product.stockQuantity,
    status: "ACTIVE",
    metaTitle: product.seo.title ?? product.name,
    metaDescription: product.seo.description ?? product.description,
    seo: {
      keywords: product.seo.keywords
    },
    category: product.category,
    images,
    options: product.options.map((option, index) => ({ ...option, sortOrder: index })),
    variants: product.variants
  };
}

async function syncInstalledModules(context: WebsiteSpecContext, siteId: string, enabledModules: ModuleId[]) {
  const enabled = new Set(enabledModules);

  for (const module of Object.values(moduleCatalog)) {
    await context.prisma.installedModule.upsert({
      where: {
        siteId_moduleId: {
          siteId,
          moduleId: module.id
        }
      },
      update: {
        status: enabled.has(module.id) || module.required ? "ENABLED" : "DISABLED",
        version: module.version,
        monthlyEuroCents: module.monthlyEuroCents
      },
      create: {
        siteId,
        moduleId: module.id,
        status: enabled.has(module.id) || module.required ? "ENABLED" : "DISABLED",
        version: module.version,
        monthlyEuroCents: module.monthlyEuroCents
      }
    });
  }
}

async function syncMediaPlaceholders(
  context: WebsiteSpecContext,
  siteId: string,
  mediaPlaceholders: GeneratedMediaPlaceholder[]
) {
  const mediaAssetIds = new Map<string, string>();

  for (const media of mediaPlaceholders) {
    const existing = await context.prisma.mediaAsset.findFirst({
      where: {
        siteId,
        url: media.url,
        deletedAt: null
      }
    });
    const asset = existing
      ? await context.prisma.mediaAsset.update({
          where: { id: existing.id },
          data: {
            kind: media.kind,
            mimeType: media.mimeType,
            width: media.width,
            height: media.height,
            altText: media.altText,
            variants: {
              generated: true,
              prompt: media.prompt,
              placement: media.placement,
              usedBy: media.usedBy
            } as Prisma.InputJsonValue
          }
        })
      : await context.prisma.mediaAsset.create({
          data: {
            siteId,
            kind: media.kind,
            url: media.url,
            mimeType: media.mimeType,
            width: media.width,
            height: media.height,
            altText: media.altText,
            variants: {
              generated: true,
              prompt: media.prompt,
              placement: media.placement,
              usedBy: media.usedBy
            } as Prisma.InputJsonValue
          }
        });

    mediaAssetIds.set(media.key, asset.id);
  }

  return mediaAssetIds;
}

async function syncCmsContent(
  context: WebsiteSpecContext,
  plan: WebsiteGenerationPlan,
  mediaAssetIds: Map<string, string>,
  user?: RequestUser
) {
  if (!plan.modules.includes("cms")) return 0;

  const cmsService = new CmsService(context.prisma);
  let pages = 0;

  for (const page of plan.cmsPages) {
    const input = stripGeneratedBlockFields(page, mediaAssetIds);
    const existing = await context.prisma.cmsPage.findFirst({
      where: {
        slug: page.slug,
        locale: page.locale
      },
      select: { id: true }
    });

    if (existing) await cmsService.updatePage(page.slug, input, user, page.locale);
    else await cmsService.createPage(input, user);

    pages += 1;
  }

  await syncGeneratedPostCategories(context, plan);

  for (const post of plan.cmsPosts) {
    const existing = await context.prisma.cmsPost.findFirst({
      where: {
        slug: post.slug,
        locale: post.locale
      },
      select: { id: true }
    });

    if (existing) await cmsService.updatePost(post.slug, post, user, post.locale);
    else await cmsService.createPost(post, user);
  }

  return pages;
}

async function syncGeneratedPostCategories(context: WebsiteSpecContext, plan: WebsiteGenerationPlan) {
  const categorySlugs = [
    ...new Set(plan.cmsPosts.flatMap((post) => post.categorySlugs))
  ];

  for (const slug of categorySlugs) {
    await context.prisma.cmsCategory.upsert({
      where: {
        locale_slug: {
          locale: plan.site.locale,
          slug
        }
      },
      update: {},
      create: {
        name: titleFromSlug(slug),
        slug,
        locale: plan.site.locale,
        translationGroupId: slug,
        description: `Generated category for ${plan.site.name}.`
      }
    });
  }
}

async function syncProducts(
  context: WebsiteSpecContext,
  plan: WebsiteGenerationPlan,
  mediaAssetIds: Map<string, string>
) {
  if (!plan.modules.includes("products")) return 0;

  let synced = 0;

  for (const product of plan.products) {
    const categoryId = product.category
      ? (
          await context.prisma.productCategory.upsert({
            where: {
              locale_slug: {
                locale: plan.site.locale,
                slug: product.category.slug
              }
            },
            update: {
              name: product.category.name,
              description: product.category.description
            },
            create: {
              name: product.category.name,
              slug: product.category.slug,
              locale: plan.site.locale,
              translationGroupId: product.category.slug,
              description: product.category.description
            }
          })
        ).id
      : undefined;

    const existing = await context.prisma.product.findFirst({
      where: {
        slug: product.slug,
        locale: plan.site.locale
      },
      select: { id: true }
    });

    const productData = {
      categoryId,
      name: product.name,
      slug: product.slug,
      locale: plan.site.locale,
      translationGroupId: product.slug,
      description: product.description,
      sku: product.sku,
      priceCents: product.priceCents,
      currency: product.currency,
      stockQuantity: product.stockQuantity,
      status: product.status,
      metaTitle: product.metaTitle,
      metaDescription: product.metaDescription,
      seo: product.seo as Prisma.InputJsonValue | undefined,
      metadata: {
        generated: true,
        source: "websiteSpec"
      } as Prisma.InputJsonValue
    };

    if (existing) {
      await replaceGeneratedProduct(context.prisma, existing.id, {
        ...productData,
        images: { create: productImageData(product, mediaAssetIds) },
        options: { create: product.options },
        variants: { create: productVariantData(product) }
      });
    } else {
      await context.prisma.product.create({
        data: {
          ...productData,
          images: { create: productImageData(product, mediaAssetIds) },
          options: { create: product.options },
          variants: { create: productVariantData(product) }
        }
      });
    }

    synced += 1;
  }

  return synced;
}

export async function replaceGeneratedProduct(
  database: WebsiteSpecDatabase,
  productId: string,
  data: Prisma.ProductUpdateArgs["data"]
) {
  return withDatabaseTransaction(database, async (transaction) => {
    await transaction.productImage.deleteMany({ where: { productId } });
    await transaction.productOption.deleteMany({ where: { productId } });
    await transaction.productVariant.deleteMany({ where: { productId } });

    return transaction.product.update({
      where: { id: productId },
      data
    });
  });
}

export async function replaceGeneratedMainMenu(
  database: WebsiteSpecDatabase,
  locale: string,
  navigation: WebsiteGenerationPlan["navigation"]
) {
  return withDatabaseTransaction(database, async (transaction) => {
    const menu = await transaction.menu.upsert({
      where: {
        locale_slug: {
          locale,
          slug: "main"
        }
      },
      update: {
        name: "Main menu",
        location: "header"
      },
      create: {
        slug: "main",
        locale,
        name: "Main menu",
        location: "header"
      }
    });

    await transaction.menuItem.deleteMany({
      where: { menuId: menu.id }
    });

    const pages = await transaction.cmsPage.findMany({
      where: {
        locale,
        slug: { in: navigation.map((item) => item.pageSlug) }
      },
      select: { id: true, slug: true }
    });
    const pageIds = new Map(pages.map((page) => [page.slug, page.id]));

    if (navigation.length > 0) {
      await transaction.menuItem.createMany({
        data: navigation.map((item) => {
          const pageId = pageIds.get(item.pageSlug);

          return {
            menuId: menu.id,
            pageId,
            label: item.label,
            url: pageId ? null : `/${item.pageSlug}`,
            sortOrder: item.sortOrder,
            openInNewTab: false
          };
        })
      });
    }

    return navigation.length;
  });
}

async function syncMainMenu(context: WebsiteSpecContext, plan: WebsiteGenerationPlan) {
  if (!plan.modules.includes("cms")) return 0;

  return replaceGeneratedMainMenu(context.prisma, plan.site.locale, plan.navigation);
}

function withDatabaseTransaction<T>(
  database: WebsiteSpecDatabase,
  operation: (transaction: Prisma.TransactionClient) => Promise<T>
) {
  if ("$transaction" in database) {
    return database.$transaction(operation);
  }

  return operation(database);
}

function stripGeneratedBlockFields(page: GeneratedCmsPage, mediaAssetIds: Map<string, string>) {
  return {
    ...page,
    sections: page.sections.map((section) => ({
      ...section,
      blocks: section.blocks.map(({ mediaKey, ...block }) => ({
        ...block,
        mediaAssetId: mediaKey ? mediaAssetIds.get(mediaKey) : block.mediaAssetId
      }))
    }))
  };
}

function productImageData(product: GeneratedProduct, mediaAssetIds: Map<string, string>) {
  return product.images.map((image) => ({
    mediaAssetId: mediaAssetIds.get(image.mediaKey),
    url: image.url,
    alt: image.alt,
    sortOrder: image.sortOrder,
    isPrimary: image.isPrimary
  }));
}

function productVariantData(product: GeneratedProduct) {
  return product.variants.map((variant) => ({
    ...variant,
    optionValues: variant.optionValues as Prisma.InputJsonValue | undefined
  }));
}

function titleFromSlug(slug: string) {
  return slug
    .split(/[-_]+/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function buildWarnings(spec: WebsiteSpec, modules: ModuleId[]) {
  const warnings: string[] = [];

  if (modules.includes("products") && spec.products.length === 0) {
    warnings.push("Products module is enabled but no starter products were supplied.");
  }

  if (modules.includes("cms") && spec.pages.length === 0) {
    warnings.push("CMS module is enabled but no starter pages were supplied.");
  }

  return warnings;
}

function createPlaceholderUrl(media: WebsiteSpecMedia) {
  const sourceUrl = normalizeMediaSourceUrl(media.url);
  if (sourceUrl) return sourceUrl;

  const label = media.altText.slice(0, 80);
  const escapedLabel = escapeSvg(label);
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${media.width}" height="${media.height}" viewBox="0 0 ${media.width} ${media.height}" role="img" aria-label="${escapedLabel}">`,
    '<rect width="100%" height="100%" fill="#eef2f0"/>',
    `<text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" fill="#64748b" font-family="Arial, sans-serif" font-size="32">${escapedLabel}</text>`,
    "</svg>"
  ].join("");

  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

function normalizeMediaSourceUrl(value?: string) {
  const url = String(value || "").trim();
  if (!url) return "";
  if (/^(https?:\/\/|\/|\.\/)/i.test(url)) return url;
  if (/^data:image\/(?:png|jpe?g|webp|gif|svg\+xml);base64,/i.test(url)) return url;

  const svgUtf8Match = url.match(/^data:image\/svg\+xml;utf8,(.*)$/i);
  if (svgUtf8Match) {
    try {
      return `data:image/svg+xml;base64,${Buffer.from(decodeURIComponent(svgUtf8Match[1])).toString("base64")}`;
    } catch {
      return "";
    }
  }

  return "";
}

function escapeSvg(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function mediaFromKey(spec: WebsiteSpec, mediaKey: string) {
  const media = spec.media.find((item) => item.key === mediaKey);
  if (!media) {
    throw new Error(`Missing media key ${mediaKey}`);
  }
  return media;
}

function generatedSectionMedia(pageSlug: string, section: WebsiteSpecSection): WebsiteSpecMedia {
  return {
    key: generatedSectionMediaKey(pageSlug, section),
    kind: "IMAGE",
    prompt: `Generated ${section.type} image for ${section.heading ?? section.key}`,
    altText: section.heading ?? section.key,
    placement: section.type === "hero" ? "hero" : "section",
    width: section.type === "hero" ? 1600 : 1200,
    height: section.type === "hero" ? 900 : 800,
    mimeType: "image/png"
  };
}

function generatedSectionMediaKey(pageSlug: string, section: WebsiteSpecSection) {
  return `${pageSlug}-${section.key}-image`;
}

function generatedProductMedia(productSlug: string, productName: string): WebsiteSpecMedia {
  return {
    key: generatedProductMediaKey(productSlug),
    kind: "IMAGE",
    prompt: `Generated product image for ${productName}`,
    altText: productName,
    placement: "product",
    width: 1200,
    height: 800,
    mimeType: "image/png"
  };
}

function generatedProductMediaKey(productSlug: string) {
  return `${productSlug}-product-image`;
}

function defaultLayout(type: WebsiteSpecSection["type"]) {
  if (type === "hero" || type === "image" || type === "contactForm") return "two-column";
  return "one-column";
}
