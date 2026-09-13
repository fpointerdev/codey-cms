import assert from "node:assert/strict";
import test from "node:test";
import {
  assertContentOnlyBlock, assertContentOnlyUpdate, assertPublicationChange,
  claimContentVersion, contentEditingContract, editingCapabilities, editingPolicy,
  requireEditingPermission
} from "../src/modules/cms/content-editing.js";
import { updateCmsPageSchema, updateContentBlockSchema } from "../src/modules/cms/cms.schemas.js";
import { contentOnlyEditor } from "../apps/web/web/content-only-editor.js";
import { commerceReadiness, productAvailableStock } from "../apps/web/web/shop-readiness.js";

const editor = { id: "editor", permissions: [{ action: "update", subject: "cms" }] };
const designer = { id: "designer", permissions: [...editor.permissions, { action: "design", subject: "cms" }] };
const publisher = { id: "publisher", permissions: [...editor.permissions, { action: "publish", subject: "cms" }] };
const owner = { id: "owner", permissions: [{ action: "manage", subject: "all" }] };
const block = {
  key: "cards", type: "CUSTOM", editable: true, label: "Services", sortOrder: 0,
  settings: { customCss: "padding: 24px", animation: { effect: "none" } },
  value: {
    title: "Services", variant: "feature-cards", display: { columns: "3" },
    items: Array.from({ length: 12 }, (_, index) => ({ id: `row-${index}`, title: `Service ${index}`, body: "Copy", icon: "check" }))
  }
};

test("protected editing is opt-in with separate design and publishing privileges", () => {
  for (const value of [undefined, null, "", "unknown", "standard"]) assert.equal(editingPolicy(value), "standard");
  assert.equal(editingCapabilities("standard", editor).canDesign, true);
  assert.equal(editingCapabilities("standard", editor).canPublish, true);
  assert.equal(editingCapabilities("protected", editor).canDesign, false);
  assert.equal(editingCapabilities("protected", designer).canPublish, false);
  assert.equal(editingCapabilities("protected", publisher).canDesign, false);
  assert.equal(editingCapabilities("protected", owner).canPublish, true);
  assert.throws(() => requireEditingPermission("protected", editor, "design"), { code: "cms_design_forbidden" });
  assert.doesNotThrow(() => requireEditingPermission("standard", editor, "design"));
});

test("content-only edits preserve settings, collection shape, unknown properties, and locked blocks", () => {
  const edited = structuredClone(block);
  edited.value.title = "Our services";
  edited.value.items[11].body = "Updated last row";
  assert.doesNotThrow(() => assertContentOnlyBlock(block, edited));
  for (const change of [
    (value: typeof block) => { value.settings.customCss = "display: none"; },
    (value: typeof block) => { value.value.display.columns = "4"; },
    (value: typeof block) => { value.value.items.pop(); },
    (value: typeof block) => { value.value.items.reverse(); },
    (value: typeof block) => { value.value.items[0].icon = "star"; },
    (value: typeof block) => { Object.assign(value.value.items[0], { width: 120 }); },
    (value: typeof block) => { value.editable = false; }
  ]) {
    const next = structuredClone(block);
    change(next);
    assert.throws(() => assertContentOnlyBlock(block, next), { code: "cms_design_forbidden" });
  }
  for (const locked of [{ ...block, editable: false }, { ...block, type: "EMBED" }]) {
    assert.throws(() => assertContentOnlyBlock(locked, { ...locked, value: { title: "Changed" } }), { statusCode: 403 });
  }
  assert.throws(() => assertContentOnlyBlock({ ...block, type: "TEXT", value: "Copy" }, { ...block, type: "TEXT", value: { body: "Copy" } }), { statusCode: 403 });
});

test("whole-page content updates cannot remove sections, change layout, or bypass block protection", () => {
  const page = { slug: "home", locale: "en", content: { footerText: "Original", layout: "default" }, sections: [{ key: "main", settings: { layout: "one-column" }, blocks: [block] }] };
  assert.doesNotThrow(() => assertContentOnlyUpdate(page, { title: "New title", content: { ...page.content, footerText: "New footer" } }));
  for (const input of [{ sections: [] }, { slug: "other" }, { content: { ...page.content, layout: "wide" } }]) {
    assert.throws(() => assertContentOnlyUpdate(page, input), { statusCode: 403 });
  }
  const sections = structuredClone(page.sections);
  sections[0].blocks[0].settings.customCss = "color: red";
  assert.throws(() => assertContentOnlyUpdate(page, { sections }), { statusCode: 403 });
});

test("published, scheduled, and publication-changing edits require publishing access", () => {
  assert.doesNotThrow(() => assertPublicationChange("protected", editor, { status: "DRAFT" }, {}));
  for (const [previous, input] of [
    [{ status: "PUBLISHED" }, {}],
    [{ status: "DRAFT", publishedAt: new Date() }, {}],
    [{ status: "DRAFT" }, { status: "PUBLISHED" }],
    [{ status: "DRAFT" }, { publishedAt: new Date() }]
  ]) {
    assert.throws(() => assertPublicationChange("protected", designer, previous, input), { code: "cms_publish_forbidden" });
    assert.doesNotThrow(() => assertPublicationChange("protected", publisher, previous, input));
    assert.doesNotThrow(() => assertPublicationChange("standard", editor, previous, input));
  }
});

test("content version claims atomically reject concurrent and stale updates", async () => {
  const before = { id: "page", updatedAt: new Date() };
  let current = before.updatedAt;
  const model = {
    async updateMany({ where, data }: { where: { id: string; updatedAt?: Date }; data: { updatedAt: Date } }) {
      if (where.updatedAt && where.updatedAt.getTime() !== current.getTime()) return { count: 0 };
      current = data.updatedAt;
      return { count: 1 };
    }
  };
  await assert.rejects(claimContentVersion(model, before, undefined, true), { statusCode: 428 });
  await assert.rejects(claimContentVersion(model, before, "invalid", false), { statusCode: 409 });
  const results = await Promise.allSettled([
    claimContentVersion(model, before, before.updatedAt.toISOString(), true),
    claimContentVersion(model, before, before.updatedAt.toISOString(), true)
  ]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.ok(current.getTime() > before.updatedAt.getTime());
  await assert.rejects(claimContentVersion(model, { ...before, updatedAt: current }, before.updatedAt.toISOString(), true), { code: "cms_content_conflict" });
  await assert.doesNotReject(claimContentVersion(model, { ...before, updatedAt: current }, undefined, false));
  assert.equal(updateCmsPageSchema.parse({ title: "Legacy" }).expectedUpdatedAt, undefined);
  assert.equal(updateContentBlockSchema.safeParse({ expectedUpdatedAt: "invalid" }).success, false);
});

test("content-only modal preserves all twelve rows and never exposes design configuration", async () => {
  const ui = contentOnlyEditor(block, contentEditingContract);
  assert.equal(ui.fields.filter((field: any) => field.type === "section").length, 12);
  assert.ok(ui.fields.some((field: any) => field.value === "Service 11"));
  assert.ok(ui.fields.some((field: any) => field.type === "richtext"));
  assert.ok(ui.fields.every((field: any) => !["Columns", "Icon", "Variant", "Id"].includes(field.label)));
  const titleField = ui.fields.find((field: any) => field.value === "Service 11");
  const value = await ui.valueFrom({ [titleField.name]: "Last service" });
  assert.equal(value.items.length, 12);
  assert.equal(value.items[11].title, "Last service");
  assertContentOnlyBlock(block, { ...block, value });
  assert.deepEqual(value.display, block.value.display);
  assert.equal(block.value.items[11].title, "Service 11");
});

test("content-only image replacement supports a preview and updates media metadata", async () => {
  const image = { ...block, type: "IMAGE", value: { url: "/old.png", alt: "Image", width: 100, height: 50 } };
  const ui = contentOnlyEditor(image, contentEditingContract);
  const picker = ui.fields.find((field: any) => field.type === "file");
  assert.equal(picker.previewUrl, "/old.png");
  assert.ok(!ui.fields.some((field: any) => field.type === "text" && field.value === "/old.png"));
  const value = await ui.valueFrom({ [picker.name]: { size: 10 } }, async () => ({ id: "media", url: "/new.png", width: 300, height: 150 }));
  assert.equal(value.url, "/new.png");
  assert.equal(value.width, 300);
  assertContentOnlyBlock(image, { ...image, value });
});

const product = { status: "ACTIVE", name: "Product", images: [{ url: "/image.png" }], priceCents: 2000, stockQuantity: 5, reservedQuantity: 1 };
test("commerce configuration distinguishes catalog, quote, sandbox, live, manual, mixed, and unknown", () => {
  const cases = [
    [[], "catalog"],
    [[{ provider: "STRIPE", mode: "SANDBOX" }], "test"],
    [[{ provider: "STRIPE", mode: "LIVE" }], "live"],
    [[{ provider: "MANUAL", mode: "SANDBOX" }], "manual"],
    [[{ provider: "STRIPE", mode: "LIVE" }, { provider: "PAYPAL", mode: "SANDBOX" }], "mixed"],
    [[{ provider: "MANUAL" }, { provider: "PAYPAL", mode: "SANDBOX" }], "mixed"],
    [[{ provider: "STRIPE" }], "unknown"]
  ] as const;
  for (const [providers, mode] of cases) {
    const readiness = commerceReadiness([product], { providers });
    assert.equal(readiness.mode, mode);
    assert.equal(readiness.paymentJourneyVerified, false);
    assert.doesNotMatch(readiness.title, /Ready to sell/);
    if (["test", "mixed", "catalog", "unknown"].includes(mode)) assert.notEqual(readiness.status, "configured");
  }
  assert.equal(commerceReadiness([], {}).mode, "empty");
  assert.equal(commerceReadiness([{ ...product, metadata: { purchaseMode: "quote" }, priceCents: 0, stockQuantity: 0 }]).mode, "quote");
  assert.equal(commerceReadiness([product], { providers: [{ provider: "STRIPE", mode: "LIVE" }] }, "Network error").status, "unknown");
  assert.equal(productAvailableStock(product), 4);
  assert.equal(commerceReadiness([{ ...product, reservedQuantity: 5 }], { providers: [{ provider: "MANUAL" }] }).status, "attention");
});
