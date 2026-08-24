import assert from "node:assert/strict";
import test from "node:test";
import { pageSectionSchema } from "../src/modules/cms/cms.schemas.js";

const {
  sectionBackgroundAsset,
  sectionControlFields,
  sectionDesignSettings,
  sectionSettingsFromControls
} = await import("../apps/web/web/section-design.js");

test("legacy section colors normalize into the shared design contract", () => {
  const visualEditorSection = sectionDesignSettings({
    background: { color: "#123456", style: "contain" },
    visibility: { mobile: false }
  });
  assert.equal(visualEditorSection.background.mode, "color");
  assert.equal(visualEditorSection.background.color, "#123456");
  assert.equal(visualEditorSection.style.backgroundColor, "#123456");
  assert.equal(visualEditorSection.visibility.desktop, true);
  assert.equal(visualEditorSection.visibility.mobile, false);

  const dashboardSection = sectionDesignSettings({
    style: { backgroundColor: "#abcdef", radius: 80, borderWidth: 40 },
    background: {
      imageAssetId: "asset-1",
      imageUrl: "/uploads/hero.jpg",
      width: 1600,
      height: 900,
      overlayOpacity: 2
    }
  });
  assert.equal(dashboardSection.background.mode, "image");
  assert.equal(dashboardSection.background.imageUrl, "/uploads/hero.jpg");
  assert.equal(dashboardSection.background.overlayOpacity, 0.9);
  assert.equal(dashboardSection.style.radius, 48);
  assert.equal(dashboardSection.style.borderWidth, 8);
});

test("section editor exposes one consistent three-tab control model", () => {
  const fields = sectionControlFields({
    key: "hero",
    label: "Hero",
    settings: {
      layout: "two-column",
      style: { preset: "premium-dark", radius: 24 },
      background: {
        mode: "image",
        imageAssetId: "asset-1",
        imageUrl: "/uploads/hero.jpg"
      }
    }
  }, [{ id: "asset-1", url: "/uploads/hero.jpg", altText: "Hero image" }]);

  assert.deepEqual([...new Set(fields.map((field) => field.group))], ["Layout", "Style", "Advanced"]);
  assert.equal(fields.find((field) => field.name === "backgroundImageFile")?.type, "file");
  assert.equal(fields.find((field) => field.name === "backgroundImageFile")?.previewUrl, "/uploads/hero.jpg");
  assert.equal(fields.find((field) => field.name === "borderWidth")?.value, "0");
  assert.equal(fields.find((field) => field.name === "visibilityMobile")?.checked, true);
  assert.equal(fields.find((field) => field.name === "animationEffect")?.group, "Style");
  assert.ok(fields.find((field) => field.name === "animationEffect")?.options?.some((option) => option.value === "reveal-up"));
  assert.ok(fields.find((field) => field.name === "layout")?.options?.some((option) => option.value === "sidebar-left"));
  assert.ok(fields.find((field) => field.name === "stylePreset")?.options?.some((option) => option.value === "liquid"));

  const newSectionFields = sectionControlFields({ key: "new-section", settings: {} });
  assert.equal(newSectionFields.find((field) => field.name === "backgroundColor")?.value, "#ffffff");
  assert.equal(
    newSectionFields.find((field) => field.name === "backgroundAssetId")?.options?.[0]?.label,
    "Choose from media library"
  );
});

test("section settings synchronize background, border, responsive, and visibility values", () => {
  const asset = {
    id: "asset-2",
    url: "/uploads/background.webp",
    altText: "Editorial workspace",
    width: 1800,
    height: 1200
  };
  const settings = sectionSettingsFromControls({
    layout: "asymmetric",
    container: "wide",
    spacing: "xl",
    gap: "lg",
    align: "center",
    verticalAlign: "center",
    minHeight: "680",
    tabletLayout: "two-column",
    tabletSpacing: "md",
    mobileLayout: "one-column",
    mobileSpacing: "sm",
    stylePreset: "editorial-light",
    backgroundMode: "image",
    backgroundColor: "#f7f5ef",
    backgroundStyle: "cover",
    backgroundPosition: "top-right",
    overlayColor: "#101820",
    overlayOpacity: "0.45",
    textColor: "#ffffff",
    accentColor: "#2f6bff",
    radius: "18",
    borderWidth: "2",
    borderColor: "#d5d9e0",
    shadow: "soft",
    decorationType: "spotlight",
    decorationPosition: "bottom-right",
    decorationColor: "#2f6bff",
    decorationOpacity: "0.3",
    visibilityDesktop: true,
    visibilityTablet: true,
    visibilityMobile: false,
    animationEffect: "fade-up",
    animationDuration: "600",
    animationDelay: "100",
    htmlId: "premium-hero",
    cssClasses: "campaign-section",
    customCss: "max-width: 1400px"
  }, {}, asset);

  assert.equal(settings.style.backgroundColor, "#f7f5ef");
  assert.equal(settings.background.color, "#f7f5ef");
  assert.equal(settings.background.imageAssetId, "asset-2");
  assert.equal(settings.background.imageUrl, "/uploads/background.webp");
  assert.equal(settings.background.width, 1800);
  assert.equal(settings.style.borderWidth, 2);
  assert.equal(settings.responsive.tablet.layout, "two-column");
  assert.equal(settings.visibility.mobile, false);
  assert.equal(settings.animation.effect, "fade-up");
  assert.equal(settings.htmlId, "premium-hero");
});

test("non-image section modes release dormant media references", () => {
  const current = {
    background: {
      mode: "image",
      imageAssetId: "asset-1",
      imageUrl: "/uploads/background.webp",
      width: 1800,
      height: 1200
    }
  };
  const values = {
    backgroundMode: "color",
    backgroundColor: "#ffffff"
  };

  const settings = sectionSettingsFromControls(values, current);
  assert.equal(settings.background.mode, "color");
  assert.equal(settings.background.imageAssetId, undefined);
  assert.equal(settings.background.imageUrl, undefined);
  assert.equal(settings.background.width, undefined);
  assert.equal(settings.background.height, undefined);
});

test("background asset selection prefers upload, then library, then current image", () => {
  const current = {
    background: {
      imageAssetId: "current",
      imageUrl: "/uploads/current.jpg",
      width: 1200,
      height: 800
    }
  };
  const library = [{ id: "library", url: "/uploads/library.jpg", width: 1400, height: 900 }];
  const uploaded = { id: "uploaded", url: "/uploads/uploaded.jpg", width: 1600, height: 1000 };

  assert.equal(sectionBackgroundAsset({}, current, library, uploaded).id, "uploaded");
  assert.equal(sectionBackgroundAsset({ backgroundAssetId: "library" }, current, library).id, "library");
  assert.equal(sectionBackgroundAsset({}, current, library).id, "current");
});

test("section schema accepts the 1.0 design contract and rejects unsafe values", () => {
  const section = {
    key: "premium-hero",
    label: "Premium hero",
    settings: {
      style: {
        backgroundColor: "#172145",
        radius: 24,
        borderWidth: 2,
        borderColor: "#ffffff"
      },
      background: {
        mode: "image",
        imageAssetId: "asset-1",
        imageUrl: "/uploads/premium-hero.webp",
        width: 1800,
        height: 1200,
        style: "cover",
        position: "top-right",
        overlayColor: "#101820",
        overlayOpacity: 0.45
      },
      visibility: { desktop: true, tablet: true, mobile: false }
    },
    blocks: []
  };

  assert.equal(pageSectionSchema.safeParse(section).success, true);
  assert.equal(pageSectionSchema.safeParse({
    ...section,
    settings: {
      ...section.settings,
      background: { ...section.settings.background, imageUrl: "javascript:alert(1)" }
    }
  }).success, false);
  assert.equal(pageSectionSchema.safeParse({
    ...section,
    settings: {
      ...section.settings,
      background: { ...section.settings.background, imageUrl: "s3://codey-media/site/background.webp" }
    }
  }).success, true);
  assert.equal(pageSectionSchema.safeParse({
    ...section,
    settings: {
      ...section.settings,
      background: { ...section.settings.background, imageUrl: "//untrusted.example/image.webp" }
    }
  }).success, false);
  assert.equal(pageSectionSchema.safeParse({
    ...section,
    settings: {
      ...section.settings,
      background: { ...section.settings.background, imageUrl: "https://user:password@example.com/image.webp" }
    }
  }).success, false);
  assert.equal(pageSectionSchema.safeParse({
    ...section,
    settings: {
      ...section.settings,
      style: { ...section.settings.style, borderWidth: 9 }
    }
  }).success, false);
});
