import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  marketingSettingsSchema,
  normalizeMarketingSettings
} from "../src/modules/config/config.schemas.js";

const { campaignFromLocation, normalizeMarketingConfig, providerEventPayloads } = await import("../apps/web/web/marketing-runtime.js");

test("marketing settings keep consent safe by default and validate provider IDs", () => {
  const defaults = marketingSettingsSchema.parse({});
  assert.equal(defaults.provider, "none");
  assert.equal(defaults.consentMode, "required");
  assert.equal(defaults.trackCommerce, true);

  assert.equal(marketingSettingsSchema.safeParse({
    provider: "google-analytics",
    analyticsId: "UA-legacy"
  }).success, false);
  assert.equal(marketingSettingsSchema.safeParse({
    provider: "google-tag-manager",
    analyticsId: "GTM-ABC123"
  }).success, true);
  assert.equal(marketingSettingsSchema.safeParse({
    provider: "plausible",
    analyticsId: "shop.example.com"
  }).success, true);
});

test("invalid stored marketing configuration fails closed", () => {
  const result = normalizeMarketingSettings({
    provider: "unknown-provider",
    analyticsId: "unsafe"
  });

  assert.equal(result.provider, "none");
  assert.equal(result.analyticsId, "");
  assert.equal(result.consentMode, "required");
});

test("the browser runtime bounds campaign attribution and strips unsafe values", () => {
  const campaign = campaignFromLocation(
    "?utm_source=newsletter&utm_campaign=Fall%20launch%3Cscript%3E&utm_medium=email",
    "https://referrer.example/private/path?customer=1"
  );

  assert.deepEqual(campaign, {
    utm_source: "newsletter",
    utm_medium: "email",
    utm_campaign: "Fall launchscript",
    referrer_host: "referrer.example"
  });
  assert.equal(normalizeMarketingConfig({ provider: "other" }).provider, "none");
  assert.equal(normalizeMarketingConfig({
    provider: "google-analytics",
    analyticsId: "invalid",
    privacyUrl: "javascript:alert(1)"
  }).provider, "none");
  assert.deepEqual(campaignFromLocation("", "https://shop.example.com/product", "shop.example.com"), {});
});

test("commerce events use provider-standard payload shapes", () => {
  const payloads = providerEventPayloads("add_to_cart", {
    item_id: "product-1",
    item_name: "Canvas bag",
    variant_id: "variant-1",
    quantity: 2,
    currency: "EUR",
    value: 48,
    unit_price: 24
  });

  assert.deepEqual(payloads.google.items, [{
    item_id: "product-1",
    item_name: "Canvas bag",
    item_variant: "variant-1",
    quantity: 2,
    price: 24
  }]);
  assert.equal(payloads.tagManager.ecommerce.currency, "EUR");
  assert.deepEqual(payloads.meta.content_ids, ["product-1"]);
  assert.equal(payloads.meta.content_type, "product");
  assert.equal(payloads.meta.num_items, 2);
});

test("marketing integrations use consent and emit no customer form values", async () => {
  const [runtime, publicRuntime, commerce, admin] = await Promise.all([
    readFile("apps/web/web/marketing-runtime.js", "utf8"),
    readFile("apps/web/web/public-runtime.js", "utf8"),
    readFile("apps/web/web/public-commerce.js", "utf8"),
    readFile("apps/web/web/admin-views.js", "utf8")
  ]);

  assert.match(runtime, /consentMode === "not-required"/);
  assert.match(runtime, /new Set\(\[[\s\S]*"purchase"[\s\S]*"generate_lead"/);
  assert.match(runtime, /https:\/\/plausible\.io\/api\/event/);
  assert.doesNotMatch(publicRuntime, /payload\.email|payload\.name|payload\.message/);
  assert.match(commerce, /marketingEvent\("add_to_cart"/);
  assert.match(commerce, /marketingEvent\("purchase"/);
  assert.match(admin, /data-marketing-settings-form/);
  assert.match(admin, /It never sends form values, customer names, email addresses, or payment details/);
});

test("the main document CSP permits only the supported marketing origins", async () => {
  const security = await readFile("src/core/security-middleware.ts", "utf8");

  assert.match(security, /https:\/\/www\.googletagmanager\.com/);
  assert.match(security, /https:\/\/connect\.facebook\.net/);
  assert.match(security, /https:\/\/plausible\.io/);
  const scriptSources = security.match(/const marketingScriptSources = \[([\s\S]*?)\];/)?.[1] || "";
  assert.doesNotMatch(scriptSources, /"https:"/);
});
