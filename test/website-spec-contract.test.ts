import assert from "node:assert/strict";
import test from "node:test";
import {
  websiteSpecProductSchema,
  websiteSpecSchema
} from "../src/modules/config/website-spec.schemas.js";
import {
  buildWebsiteGenerationPlan,
  generationContract
} from "../src/modules/config/website-spec.service.js";

test("WebsiteSpec products default to online purchase and can request a quote", () => {
  const baseProduct = {
    name: "Custom installation",
    slug: "custom-installation",
    priceCents: 0,
    currency: "EUR",
    stockQuantity: 0,
    seo: {},
    imageMediaKeys: [],
    options: [],
    variants: []
  };

  assert.equal(websiteSpecProductSchema.parse(baseProduct).purchaseMode, "buy");
  assert.equal(websiteSpecProductSchema.parse({ ...baseProduct, purchaseMode: "quote" }).purchaseMode, "quote");
});

test("generation contract gives agents one deterministic WebsiteSpec workflow", () => {
  const contract = generationContract();
  const workflow = new Map(contract.automation.workflow.map((operation) => [operation.id, operation]));
  const apply = workflow.get("apply") as {
    path?: string;
    authentication?: string;
    permission?: { action: string; subject: string };
    writes?: boolean;
    atomic?: boolean;
  };

  assert.equal(contract.name, "codey-cms.website-generation");
  assert.equal(contract.version, "1.0");
  assert.equal(contract.automation.version, "1.0");
  assert.equal(contract.automation.release.selection, "latest-signed-stable");
  assert.equal(contract.automation.release.customerVersionChoice, false);
  assert.equal(workflow.get("readiness")?.path, "/api/v1/health/ready");
  assert.equal(workflow.get("login")?.path, "/api/v1/auth/login");
  assert.deepEqual(apply.permission, { action: "manage", subject: "modules" });
  assert.equal(apply.path, "/api/v1/config/generation/apply");
  assert.equal(apply.authentication, "bearer");
  assert.equal(apply.writes, true);
  assert.equal(apply.atomic, true);
  assert.deepEqual(websiteSpecSchema.parse(contract.websiteSpec.example), contract.websiteSpec.example);
  assert.equal(contract.publicRuntime.serverRendered, true);
  assert.equal(contract.publicRuntime.commerce.cart, "in-context-dialog");
});

test("CodeY CMS accepts and maps the platform WebsiteSpec contract", () => {
  const plan = buildWebsiteGenerationPlan({
    version: "1.0",
    intent: "cms",
    project: {
      name: "Paiqi Metal",
      slug: "paiqi-metal",
      summary: "Precision metal fabrication for commercial projects.",
      locale: "en",
      timezone: "Europe/Belgrade",
      currency: "EUR"
    },
    modules: { cms: true },
    style: {
      theme: "editorial-industrial",
      colorPalette: { primary: "#162019", accent: "#d9ad32" },
      typography: { heading: "Inter", body: "Inter" },
      experience: {
        family: "industrial",
        recipeId: "editorial-industrial",
        heroComposition: "offset-masthead",
        navigationSystem: "quiet-topbar",
        sectionRhythm: "alternating-editorial",
        gridSystem: "twelve-column-editorial",
        imageTreatment: "edge-to-edge-documentary",
        typographySystem: "condensed-industrial",
        signatureInteraction: "chapter-reveal",
        shapeLanguage: "framed-void",
        motionSystem: "quiet-crossfade",
        motionLevel: "light"
      },
      runtimeCss: "body[data-codey-preview='cms']{background:#f7f5ef}",
      customCss: ".page-section{scroll-margin-top:96px}"
    },
    branding: {
      logoMediaKey: "brand-logo",
      logoMode: "image",
      logoAltText: "Paiqi Metal",
      logoHeight: 48
    },
    pages: [{
      title: "Home",
      slug: "home",
      purpose: "home",
      includeInNavigation: true,
      seo: {},
      sections: [
        {
          key: "hero",
          type: "hero",
          heading: "Built with precision",
          mediaKey: "hero-workshop",
          items: [{ title: "40+ years", body: "Fabrication experience" }],
          settings: { layout: "eight-column-split", container: "wide", spacing: "xl" }
        },
        {
          key: "capabilities",
          type: "featureGrid",
          heading: "Capabilities",
          cta: { label: "Explore capabilities", url: "/capabilities" },
          items: [{ title: "Structural steel", mediaKey: "capability-steel" }],
          settings: { layout: "matrix-rows" }
        },
        {
          key: "projects",
          type: "gallery",
          heading: "Selected projects",
          items: [
            { title: "Steel hall", body: "Built for long service.", mediaKey: "capability-steel" },
            { title: "Clear process", body: "A copy-only gallery item." }
          ],
          galleryMediaKeys: ["capability-steel"],
          settings: { layout: "editorial-gallery" }
        }
      ]
    }],
    posts: [],
    products: [],
    media: [
      {
        key: "brand-logo",
        kind: "IMAGE",
        prompt: "Paiqi Metal geometric logo",
        altText: "Paiqi Metal",
        placement: "other",
        url: "/media/brand-logo.svg",
        width: 240,
        height: 96,
        mimeType: "image/svg+xml"
      },
      {
        key: "hero-workshop",
        kind: "IMAGE",
        prompt: "Metal fabrication workshop",
        altText: "Metal fabrication workshop",
        placement: "hero",
        url: "/media/hero.webp",
        width: 1600,
        height: 1000,
        mimeType: "image/webp"
      },
      {
        key: "capability-steel",
        kind: "IMAGE",
        prompt: "Structural steel detail",
        altText: "Structural steel detail",
        placement: "section",
        url: "/media/steel.webp",
        width: 960,
        height: 720,
        mimeType: "image/webp"
      }
    ]
  });

  const home = plan.cmsPages[0];
  const hero = home?.sections[0];
  const capabilities = home?.sections[1];
  const projects = home?.sections[2];
  const capabilityValue = capabilities?.blocks[0]?.value as {
    items?: Array<{ image?: { url?: string } }>;
  };
  const galleryValue = projects?.blocks.find((block) => block.type === "GALLERY")?.value as {
    items?: Array<{ caption?: string }>;
  };

  assert.equal(plan.style.customCss, ".page-section{scroll-margin-top:96px}");
  assert.equal(plan.style.runtimeCss, "body[data-codey-preview='cms']{background:#f7f5ef}");
  assert.equal(plan.style.experience?.family, "industrial");
  assert.equal(plan.branding?.logoUrl, "/media/brand-logo.svg");
  assert.equal(home?.excerpt, "");
  assert.equal(home?.content.layout, "full-width");
  assert.equal(home?.content.hideTitle, true);
  assert.equal(home?.content.style.experience?.recipeId, "editorial-industrial");
  assert.equal(hero?.label, undefined);
  assert.equal(hero?.blocks[0]?.type, "RICH_TEXT");
  assert.equal(hero?.blocks[0]?.value, "<h1>Built with precision</h1>");
  assert.equal(hero?.blocks.some((block) => block.key === "hero-points"), true);
  assert.equal(hero?.settings.layout, "two-column");
  assert.deepEqual(hero?.settings.websiteSpec, {
    type: "hero",
    composition: "eight-column-split",
    collection: true
  });
  assert.equal(capabilities?.blocks.length, 1);
  assert.equal(capabilities?.blocks.some((block) => block.type === "BUTTON"), false);
  assert.deepEqual((capabilities?.blocks[0]?.value as { cta?: unknown }).cta, {
    label: "Explore capabilities",
    url: "/capabilities",
    style: "primary"
  });
  assert.equal(capabilities?.settings.layout, "one-column");
  assert.equal(capabilityValue.items?.[0]?.image?.url, "/media/steel.webp");
  assert.match(galleryValue.items?.[0]?.caption ?? "", /Steel hall.*Built for long service\./);
  assert.equal(projects?.blocks.some((block) => block.key === "projects-items"), true);
});

test("generator-safe custom WebsiteSpec elements keep their portable values", () => {
  const values = customElementValues();
  const plan = buildWebsiteGenerationPlan(customElementsWebsiteSpec(values));

  assert.deepEqual(
    plan.cmsPages[0]?.sections.map((section) => ({
      elementId: section.settings.elementId,
      transportValueStored: Object.hasOwn(section.settings, "value"),
      blockElementId: section.blocks[0]?.settings?.elementId,
      blockType: section.blocks[0]?.type,
      value: section.blocks[0]?.value
    })),
    Object.entries(values).map(([elementId, value]) => ({
      elementId,
      transportValueStored: false,
      blockElementId: elementId,
      blockType: elementId === "product-showcase" ? "PRODUCT_LIST" : "CUSTOM",
      value
    }))
  );
});

test("WebsiteSpec rejects unbounded custom element values before persistence", () => {
  const values = customElementValues();
  values.video.body = "x".repeat(12_001);

  assert.throws(
    () => buildWebsiteGenerationPlan(customElementsWebsiteSpec(values)),
    /Custom element strings must be no longer than 12,000 characters/
  );
});

test("custom WebsiteSpec sections reject non-generator-safe element selection", () => {
  const spec = customElementsWebsiteSpec() as unknown as {
    pages: Array<{ sections: Array<{ settings: Record<string, unknown> }> }>;
  };
  spec.pages[0].sections[0].settings.elementId = "structured-content";

  const section = buildWebsiteGenerationPlan(spec).cmsPages[0]?.sections[0];
  assert.equal(section?.settings.elementId, "structured-content");
  assert.equal(section?.blocks[0]?.settings?.elementId, "structured-content");
  assert.notDeepEqual(section?.blocks[0]?.value, customElementValues()["process-steps"]);
  assert.equal(Object.hasOwn(section?.blocks[0]?.value as object, "settings"), false);
});

test("non-custom WebsiteSpec section settings remain backward compatible", () => {
  const spec = customElementsWebsiteSpec() as unknown as {
    pages: Array<{ sections: Array<Record<string, unknown>> }>;
  };
  spec.pages[0].sections = [{
    key: "intro",
    type: "text",
    body: "Existing generated content.",
    settings: { value: "legacy-setting", customOption: true }
  }];

  const settings = buildWebsiteGenerationPlan(spec).cmsPages[0]?.sections[0]?.settings;
  assert.equal(settings?.value, "legacy-setting");
  assert.equal(settings?.customOption, true);
});

test("WebsiteSpec carries only registered modern banner variants into CMS sections", () => {
  const spec = customElementsWebsiteSpec() as unknown as {
    pages: Array<{ sections: Array<Record<string, unknown>> }>;
  };
  spec.pages[0].sections = [{
    key: "hero",
    type: "hero",
    heading: "A modern opening",
    settings: { bannerVariant: "glass-interface" }
  }];

  const settings = buildWebsiteGenerationPlan(spec).cmsPages[0]?.sections[0]?.settings;
  assert.equal(settings?.bannerVariant, "glass-interface");

  (spec.pages[0].sections[0].settings as Record<string, unknown>).bannerVariant = "unknown-banner";
  assert.throws(
    () => buildWebsiteGenerationPlan(spec),
    /Use a banner design advertised by the builder registry/
  );
});

function customElementValues() {
  return {
    "process-steps": {
      title: "How delivery works",
      items: [
        { title: "Plan", body: "Agree on scope." },
        { title: "Launch", body: "Publish and verify." }
      ],
      display: { columns: 2, showNumbers: true }
    },
    "comparison-table": {
      title: "Compare support",
      firstColumnTitle: "Standard",
      secondColumnTitle: "Priority",
      items: [{ title: "Response", firstValue: "2 days", secondValue: "4 hours" }],
      display: { striped: true }
    },
    video: {
      title: "Product tour",
      body: "A short walkthrough.",
      url: "/uploads/product-tour.mp4",
      display: { presentation: "hero", ratio: "16 / 9", preload: "none", loop: false, playback: "hover-focus" }
    },
    "image-hotspots": {
      title: "Explore the showroom",
      image: { url: "/uploads/showroom.webp", alt: "Showroom" },
      hotspots: [
        { title: "Featured product", x: 42, y: 58, width: 9, productSlug: "starter-product" }
      ],
      display: { ratio: "16 / 10" }
    },
    timeline: {
      title: "Company milestones",
      items: [
        { title: "Founded", body: "Opened the first studio.", label: "2020" },
        { title: "Expanded", body: "Added a second service line.", label: "2025" }
      ]
    },
    checklist: {
      title: "Included",
      items: [{ title: "Planning" }, { title: "Delivery", body: "Documented handover." }]
    },
    "resource-list": {
      title: "Resources",
      items: [{ title: "Service guide", body: "Read the details.", label: "Guide", url: "/service-guide" }]
    },
    "location-cards": {
      title: "Locations",
      items: [{ title: "Main office", body: "1 Main Street", label: "Weekdays", url: "/contact" }]
    },
    "quote-highlight": {
      title: "Customer perspective",
      body: "The project stayed clear from start to finish.",
      attribution: "Alex, customer"
    },
    "bento-grid": {
      title: "Capabilities",
      items: [{ title: "Fast delivery", body: "A clear path to launch.", featured: true }],
      display: { presentation: "spotlight", columns: 4 }
    },
    "navigation-cards": {
      title: "Explore",
      items: [{ title: "Services", body: "See what we offer.", url: "/services" }],
      display: { presentation: "cards", columns: 3 }
    },
    "image-comparison": {
      title: "See the difference",
      items: [
        { title: "Before", image: { url: "/uploads/before.webp", alt: "Before" } },
        { title: "After", image: { url: "/uploads/after.webp", alt: "After" } }
      ],
      display: { presentation: "split" }
    },
    "product-showcase": {
      title: "Featured product",
      productSlugs: ["starter-product"],
      layout: "spotlight",
      columns: 2,
      showDescription: true
    }
  };
}

function customElementsWebsiteSpec(values = customElementValues()) {
  return {
    version: "1.0",
    intent: "cms",
    project: {
      name: "Portable custom elements",
      slug: "portable-custom-elements",
      summary: "A generated page with canonical custom builder elements."
    },
    modules: { cms: true, products: true },
    style: {
      theme: "system",
      colorPalette: { primary: "#17211b", accent: "#0f766e" }
    },
    pages: [{
      title: "Services",
      slug: "services",
      purpose: "content",
      sections: Object.entries(values).map(([elementId, value]) => ({
        key: elementId,
        type: "custom",
        settings: { elementId, value }
      }))
    }]
  };
}
