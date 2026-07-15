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
          settings: {}
        },
        {
          key: "capabilities",
          type: "featureGrid",
          heading: "Capabilities",
          items: [{ title: "Structural steel", mediaKey: "capability-steel" }],
          settings: {}
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
  const capabilityValue = capabilities?.blocks[0]?.value as {
    items?: Array<{ image?: { url?: string } }>;
  };

  assert.equal(plan.style.customCss, ".page-section{scroll-margin-top:96px}");
  assert.equal(plan.branding?.logoUrl, "/media/brand-logo.svg");
  assert.equal(home?.content.hideTitle, true);
  assert.equal(hero?.label, undefined);
  assert.equal(hero?.blocks[0]?.type, "RICH_TEXT");
  assert.equal(hero?.blocks[0]?.value, "<h1>Built with precision</h1>");
  assert.equal(capabilities?.blocks.length, 1);
  assert.equal(capabilityValue.items?.[0]?.image?.url, "/media/steel.webp");
});
