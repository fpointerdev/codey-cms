import assert from "node:assert/strict";
import test from "node:test";
import { buildWebsiteGenerationPlan } from "../src/modules/config/website-spec.service.js";

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
  assert.equal(plan.branding?.logoUrl, "/media/brand-logo.svg");
  assert.equal(home?.excerpt, "");
  assert.equal(home?.content.layout, "full-width");
  assert.equal(home?.content.hideTitle, true);
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
