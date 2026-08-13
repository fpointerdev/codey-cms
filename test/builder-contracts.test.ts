import assert from "node:assert/strict";
import test from "node:test";
import {
  builderElementRegistry,
  sectionPresetRegistry,
  builderSectionPatternRegistry,
  validateCustomCodeValue,
  validateBuilderSectionContract,
  validateBuilderTemplateContract
} from "../src/modules/builder/element-registry.js";

Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: () => null,
    removeItem: () => undefined,
    setItem: () => undefined
  }
});

const {
  buildSectionPattern,
  componentTemplates,
  sectionPatternTemplates
} = await import("../apps/web/web/core.js");
const { structuredContentEditor } = await import("../apps/web/web/structured-content-editor.js");
const { mediaKindForMimeType } = await import("../apps/web/web/content-actions.js");

test("frontend builder templates match the registered editor elements", () => {
  const editorIds = builderElementRegistry
    .filter((element) => element.editorAvailable !== false)
    .map((element) => element.id)
    .sort();
  const generatorIds = builderElementRegistry
    .filter((element) => element.generatorSafe)
    .map((element) => element.id)
    .sort();
  const frontendIds = componentTemplates.map((template) => template.id).sort();

  assert.deepEqual(frontendIds, editorIds);
  assert.equal(builderElementRegistry.length, 37);
  assert.equal(editorIds.length, 36);
  assert.equal(generatorIds.length, 35);
  assert.equal(generatorIds.includes("custom-code"), false);
  assert.deepEqual(
    ["heading", "rich-text", "image", "button"].filter((elementId) => !frontendIds.includes(elementId)),
    []
  );
});

test("custom code accepts bounded sandbox content and rejects unsafe libraries", () => {
  assert.deepEqual(validateCustomCodeValue({
    html: '<button id="example">Run</button>',
    css: "button { color: green; }",
    javascript: 'document.querySelector("#example").dataset.ready = "true";',
    libraries: ["https://cdn.example.com/library.min.js"],
    height: 360
  }).errors, []);

  const unsafe = validateCustomCodeValue({
    html: "<p>Unsafe dependency</p>",
    libraries: ["http://cdn.example.com/library.js"]
  });
  assert.equal(unsafe.errors[0]?.code, "invalid_custom_code_library");

  const missingHtml = validateCustomCodeValue({
    javascript: 'document.body.dataset.ready = "true";',
    libraries: []
  });
  assert.equal(missingHtml.errors[0]?.code, "empty_custom_code");
});

test("section presets advertise only generator-safe elements", () => {
  const elementsById = new Map(builderElementRegistry.map((element) => [element.id, element]));

  for (const preset of sectionPresetRegistry) {
    for (const elementId of preset.allowedElements) {
      assert.equal(
        elementsById.get(elementId)?.generatorSafe,
        true,
        `${preset.id} advertises non-generator-safe element ${elementId}`
      );
    }
  }
});

test("frontend builder templates satisfy the builder contract", () => {
  for (const template of componentTemplates) {
    const result = validateBuilderTemplateContract(template);
    assert.deepEqual(result.errors, [], `${template.id}: ${JSON.stringify(result.errors)}`);
  }
});

test("section patterns preserve block ownership and satisfy the builder contract", () => {
  const registeredPatternIds = builderSectionPatternRegistry.map((pattern) => pattern.id).sort();
  const frontendPatternIds = sectionPatternTemplates.map((pattern) => pattern.id).sort();
  assert.deepEqual(frontendPatternIds, registeredPatternIds);
  assert.equal(registeredPatternIds.length, 20);

  for (const pattern of sectionPatternTemplates) {
    const registeredPattern = builderSectionPatternRegistry.find((item) => item.id === pattern.id);
    const section = buildSectionPattern(pattern.id, { sections: [] });
    const result = validateBuilderSectionContract(section, {
      pageSlug: "builder-test",
      productSlugs: ["starter-product"],
      requireElementId: true
    });

    assert.ok(
      section.blocks.every((block) => typeof block.settings?.elementId === "string"),
      `${pattern.id} has a block without an element id`
    );
    assert.deepEqual(result.errors, [], `${pattern.id}: ${JSON.stringify(result.errors)}`);
    assert.ok(pattern.elements.length >= 2, `${pattern.id} must compose at least two elements`);
    assert.equal(pattern.settings.patternId, pattern.id);
    assert.ok(pattern.settings.layout);
    assert.ok(pattern.settings.container);
    assert.ok(pattern.settings.spacing);
    assert.ok(pattern.settings.gap);
    assert.ok(pattern.settings.responsive?.tablet);
    assert.ok(pattern.settings.responsive?.mobile);
    assert.ok(pattern.settings.style?.preset);
    assert.ok(pattern.settings.decoration?.type);
    assert.ok(registeredPattern);
    assert.equal(pattern.category.toLowerCase(), registeredPattern.category);
    assert.deepEqual(pattern.elements, registeredPattern.elements);
    const { patternId, ...fallbackSettings } = pattern.settings;
    assert.equal(patternId, pattern.id);
    assert.deepEqual(fallbackSettings, registeredPattern.defaultSettings);
  }
});

test("expanded structured elements expose focused collection and quote fields", () => {
  const resourceEditor = structuredContentEditor({
    key: "resources",
    type: "CUSTOM",
    settings: { elementId: "resource-list" },
    value: {
      variant: "resource-list",
      title: "Resources",
      items: [{ title: "Guide", body: "Read the guide.", label: "PDF", url: "/guide.pdf" }]
    }
  });
  const quoteEditor = structuredContentEditor({
    key: "quote",
    type: "CUSTOM",
    settings: { elementId: "quote-highlight" },
    value: {
      variant: "quote-highlight",
      title: "Customer perspective",
      body: "The process stayed clear.",
      attribution: "Alex, customer"
    }
  });
  const bentoEditor = structuredContentEditor({
    key: "bento",
    type: "CUSTOM",
    settings: { elementId: "bento-grid" },
    value: {
      variant: "bento-grid",
      title: "Capabilities",
      items: [{ title: "Fast", body: "Quick to launch.", featured: true }],
      display: { presentation: "spotlight" }
    }
  });

  assert.ok(resourceEditor?.fields.some((field) => field.name === "structuredItem1Url" && field.required));
  assert.ok(quoteEditor?.fields.some((field) => field.name === "structuredAttribution"));
  assert.ok(bentoEditor?.fields.some((field) => field.type === "section" && field.open === true));
  assert.ok(bentoEditor?.fields.some((field) => field.name === "structuredPresentation" && field.group === "Settings"));
  assert.ok(bentoEditor?.fields.some((field) => field.name === "structuredSurface" && field.group === "Style"));
  assert.equal(quoteEditor?.valueFrom({
    structuredTitle: "Customer perspective",
    structuredBody: "The result stayed simple.",
    structuredAttribution: "Sam, owner",
    structuredAlignment: "left",
    structuredDensity: "comfortable",
    structuredSurface: "plain"
  }).attribution, "Sam, owner");
});

test("structured custom objects expose additional common text fields", () => {
  const editor = structuredContentEditor({
    key: "details",
    type: "CUSTOM",
    value: {
      title: "Visit us",
      bodySecondary: "A second paragraph.",
      quote: "Made with care.",
      email: "hello@example.com",
      address: "10 High Street\nLondon",
      theme: "light"
    }
  });

  assert.ok(editor?.fields.some((field) => (
    field.name === "structuredSecondaryBody"
    && field.type === "richtext"
    && field.value === "A second paragraph."
  )));
  assert.ok(editor?.fields.some((field) => field.name === "structuredQuote" && field.type === "textarea"));
  assert.ok(editor?.fields.some((field) => field.name === "structuredEmail" && field.type === "email"));
  assert.ok(editor?.fields.some((field) => field.name === "structuredAddress" && field.type === "textarea"));

  const updated = editor?.valueFrom({
    structuredTitle: "Come inside",
    structuredSecondaryBody: "An updated second paragraph.",
    structuredQuote: "Every detail matters.",
    structuredEmail: "studio@example.com",
    structuredAddress: "12 New Street\nLondon"
  });

  assert.deepEqual(updated, {
    title: "Come inside",
    bodySecondary: "An updated second paragraph.",
    quote: "Every detail matters.",
    email: "studio@example.com",
    address: "12 New Street\nLondon",
    theme: "light"
  });

  const aliasEditor = structuredContentEditor({
    key: "secondary-copy",
    type: "CUSTOM",
    value: { secondaryBody: "Existing alias content." }
  });

  assert.equal(aliasEditor?.fields[0]?.value, "Existing alias content.");
  assert.deepEqual(aliasEditor?.valueFrom({
    structuredSecondaryBody: "Updated alias content."
  }), {
    secondaryBody: "Updated alias content."
  });
});

test("collection editors preserve imported items beyond their visible row limit", () => {
  const cases = [
    { elementId: "timeline", collectionKey: "milestones" },
    { elementId: "checklist", collectionKey: "points" },
    { elementId: "resource-list", collectionKey: "resources" },
    { elementId: "location-cards", collectionKey: "locations" },
    { elementId: "bento-grid", collectionKey: "cards" },
    { elementId: "navigation-cards", collectionKey: "cards" }
  ];

  for (const { elementId, collectionKey } of cases) {
    const items = Array.from({ length: 10 }, (_, index) => ({
      title: `Item ${index + 1}`,
      body: `Details ${index + 1}`,
      label: `Label ${index + 1}`,
      url: `/item-${index + 1}`,
      featured: index === 0
    }));
    const editor = structuredContentEditor({
      key: elementId,
      type: "CUSTOM",
      settings: { elementId },
      value: { title: "Imported collection", [collectionKey]: items }
    });
    const values: Record<string, unknown> = {
      structuredTitle: "Updated title",
      structuredAlignment: "left",
      structuredDensity: "comfortable",
      structuredSurface: "outline"
    };

    for (let index = 0; index < 8; index += 1) {
      values[`structuredItem${index + 1}Title`] = items[index].title;
      values[`structuredItem${index + 1}Body`] = items[index].body;
      values[`structuredItem${index + 1}Label`] = items[index].label;
      values[`structuredItem${index + 1}Url`] = items[index].url;
      values[`structuredItem${index + 1}Featured`] = items[index].featured;
    }

    const updated = editor?.valueFrom(values);
    const updatedItems = updated?.[collectionKey];
    assert.equal(updatedItems.length, 10, elementId);
    assert.equal(updatedItems[9].title, "Item 10", elementId);
  }
});

test("v1 structured elements expose simple settings and preserve comparison content", () => {
  const editor = structuredContentEditor({
    key: "comparison",
    type: "CUSTOM",
    settings: { elementId: "comparison-table" },
    value: {
      variant: "comparison-table",
      title: "Compare plans",
      firstColumnTitle: "Basic",
      secondColumnTitle: "Pro",
      items: [{ title: "Support", firstValue: "Email", secondValue: "Priority" }],
      display: { alignment: "left", density: "comfortable", surface: "outline", striped: true }
    }
  });

  assert.ok(editor);
  assert.ok(editor.fields.some((field) => field.name === "structuredAlignment" && field.group === "Style"));
  assert.ok(editor.fields.some((field) => field.name === "structuredStripedRows" && field.group === "Settings"));

  const value = editor.valueFrom({
    structuredTitle: "Compare plans",
    structuredFirstColumnTitle: "Starter",
    structuredSecondColumnTitle: "Business",
    structuredItem1Title: "Support",
    structuredItem1FirstValue: "Email",
    structuredItem1SecondValue: "Priority",
    structuredAlignment: "center",
    structuredDensity: "compact",
    structuredSurface: "soft",
    structuredStripedRows: true
  });

  assert.equal(value.firstColumnTitle, "Starter");
  assert.equal(value.secondColumnTitle, "Business");
  assert.deepEqual(value.items, [{ title: "Support", firstValue: "Email", secondValue: "Priority" }]);
  assert.deepEqual(value.display, {
    alignment: "center",
    density: "compact",
    surface: "soft",
    striped: true
  });
});

test("interactive images expose positioned placements and validate product targets", () => {
  const hotspots = Array.from({ length: 10 }, (_, index) => ({
    title: `Placement ${index + 1}`,
    x: 10 + index,
    y: 25 + index,
    productSlug: "starter-product"
  }));
  const editor = structuredContentEditor({
    key: "scene",
    type: "CUSTOM",
    settings: { elementId: "image-hotspots" },
    value: {
      variant: "image-hotspots",
      title: "Explore",
      image: { url: "/uploads/scene.webp", alt: "Showroom" },
      hotspots,
      display: { ratio: "16 / 10" }
    }
  });

  assert.ok(editor?.fields.some((field) => field.name === "structuredItem10X" && field.type === "number"));
  assert.ok(editor?.fields.some((field) => field.name === "structuredItem11Title"));
  assert.ok(editor?.fields.some((field) => field.name === "structuredSceneRatio"));

  const invalid = validateBuilderSectionContract({
    key: "scene",
    settings: { elementId: "image-hotspots" },
    blocks: [{
      key: "scene-content",
      type: "CUSTOM",
      settings: { elementId: "image-hotspots" },
      value: {
        title: "Explore",
        image: { url: "/uploads/scene.webp", alt: "Showroom" },
        hotspots: [{ title: "Missing item", x: 120, y: 50, productSlug: "missing-product" }]
      }
    }]
  }, {
    pageSlug: "home",
    productSlugs: ["starter-product"],
    requireElementId: true
  });

  assert.ok(invalid.errors.some((error) => error.code === "invalid_hotspot_position"));
  assert.ok(invalid.errors.some((error) => error.code === "missing_product_reference"));
});

test("video elements expose hover playback and poster settings", () => {
  const editor = structuredContentEditor({
    key: "campaign",
    type: "CUSTOM",
    settings: { elementId: "video" },
    value: {
      variant: "video",
      title: "Campaign",
      url: "/uploads/campaign.mp4",
      posterUrl: "/uploads/campaign.webp",
      display: { presentation: "hero", playback: "hover-focus", ratio: "16 / 9", preload: "none", loop: true }
    }
  });

  assert.ok(editor?.fields.some((field) => field.name === "structuredVideoPlayback"));
  assert.ok(editor?.fields.some((field) => field.name === "structuredVideoPosterUrl"));
  assert.ok(editor?.fields.some((field) => field.name === "structuredPresentation" && field.value === "hero"));
});

test("media uploads classify supported video and document formats correctly", () => {
  assert.equal(mediaKindForMimeType("image/webp"), "IMAGE");
  assert.equal(mediaKindForMimeType("video/mp4"), "VIDEO");
  assert.equal(mediaKindForMimeType("application/pdf"), "DOCUMENT");
  assert.equal(mediaKindForMimeType("text/plain"), "OTHER");
});

test("repeatable image elements use uploads and preserve uploaded media references", () => {
  const editor = structuredContentEditor({
    key: "team",
    type: "CUSTOM",
    settings: { elementId: "team-section" },
    value: {
      variant: "team-section",
      title: "Team",
      items: [{ title: "Alex", label: "Founder", image: { url: "/uploads/alex.webp", alt: "Alex" } }]
    }
  });
  const photoField = editor?.fields.find((field) => field.name === "structuredItem1ImageUrl");

  assert.equal(photoField?.type, "file");
  assert.equal(photoField?.imagePicker, true);
  assert.equal(photoField?.previewUrl, "/uploads/alex.webp");
  assert.equal(editor?.mediaFields[0]?.name, "structuredItem1ImageUrl");
  assert.ok(editor?.fields.some((field) => field.name === "structuredItem1Remove"));

  const value = editor?.valueFrom({
    structuredTitle: "Team",
    structuredItem1Title: "Alex",
    structuredItem1Label: "Founder",
    structuredItem1Body: "",
    structuredItem1ImageAlt: "Alex in the studio",
    structuredAlignment: "left",
    structuredDensity: "comfortable",
    structuredSurface: "outline",
    structuredColumns: "3"
  }, null, {
    structuredItem1ImageUrl: {
      id: "media-2",
      url: "/uploads/alex-new.webp",
      altText: "Alex"
    }
  });

  assert.deepEqual(value?.items[0].image, {
    url: "/uploads/alex-new.webp",
    alt: "Alex in the studio",
    mediaAssetId: "media-2"
  });

  const removed = editor?.valueFrom({
    structuredTitle: "Team",
    structuredItem1Remove: true,
    structuredAlignment: "left",
    structuredDensity: "comfortable",
    structuredSurface: "outline",
    structuredColumns: "3"
  });
  assert.equal(removed?.items.length, 0);
});

test("image comparison exposes exactly two upload-first items", () => {
  const editor = structuredContentEditor({
    key: "comparison",
    type: "CUSTOM",
    settings: { elementId: "image-comparison" },
    value: {
      variant: "image-comparison",
      title: "Before and after",
      items: [
        { title: "Before", image: { url: "/uploads/before.webp", alt: "Before" } },
        { title: "After", image: { url: "/uploads/after.webp", alt: "After" } }
      ],
      display: { presentation: "split" }
    }
  });

  assert.equal(editor?.fields.filter((field) => field.type === "section").length, 2);
  assert.equal(editor?.fields.filter((field) => field.imagePicker).length, 2);
  assert.equal(editor?.fields.some((field) => field.name.endsWith("Remove")), false);
  assert.ok(editor?.fields.some((field) => field.name === "structuredPresentation" && field.value === "split"));
});
