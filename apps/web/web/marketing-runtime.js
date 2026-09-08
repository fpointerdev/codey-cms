const consentStorageKey = "codey_marketing_consent_v1";
const firstTouchStorageKey = "codey_marketing_first_touch_v1";
const lastTouchStorageKey = "codey_marketing_last_touch_v1";
const eventNames = new Set([
  "page_view",
  "view_item",
  "add_to_cart",
  "begin_checkout",
  "purchase",
  "generate_lead"
]);

let activeConfig = null;
let activeConsent = "unknown";
let providerReady = null;

function text(value, maximum = 160) {
  return typeof value === "string" ? value.trim().slice(0, maximum) : "";
}

function safeStorage(kind) {
  try {
    return kind === "session" ? window.sessionStorage : window.localStorage;
  } catch {
    return null;
  }
}

export function normalizeMarketingConfig(value = {}) {
  const requestedProvider = ["none", "google-analytics", "google-tag-manager", "plausible"].includes(value.provider)
    ? value.provider
    : "none";
  const analyticsId = text(value.analyticsId, 253);
  const validId = requestedProvider === "none"
    || (requestedProvider === "google-analytics" && /^G-[A-Z0-9]+$/i.test(analyticsId))
    || (requestedProvider === "google-tag-manager" && /^GTM-[A-Z0-9]+$/i.test(analyticsId))
    || (requestedProvider === "plausible" && /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/i.test(analyticsId));
  const provider = validId ? requestedProvider : "none";
  return {
    provider,
    analyticsId: validId ? analyticsId : "",
    metaPixelId: /^\d{1,32}$/.test(String(value.metaPixelId || "")) ? String(value.metaPixelId) : "",
    consentMode: value.consentMode === "not-required" ? "not-required" : "required",
    privacyUrl: safePublicLink(value.privacyUrl),
    trackPageViews: value.trackPageViews !== false,
    trackForms: value.trackForms !== false,
    trackCommerce: value.trackCommerce !== false
  };
}

function safePublicLink(value) {
  const link = text(value, 2_000);
  if (!link || (link.startsWith("/") && !link.startsWith("//"))) return link;
  try {
    return ["http:", "https:"].includes(new URL(link).protocol) ? link : "";
  } catch {
    return "";
  }
}

function escapeAttribute(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function configured(config) {
  return (config.provider !== "none" && config.analyticsId) || config.metaPixelId;
}

function configKey(config) {
  return [config.provider, config.analyticsId, config.metaPixelId, config.consentMode].join(":");
}

function readStoredJson(storage, key) {
  try {
    return JSON.parse(storage?.getItem(key) || "null");
  } catch {
    removeStorageValue(storage, key);
    return null;
  }
}

function storageValue(storage, key) {
  try {
    return storage?.getItem(key) || "";
  } catch {
    return "";
  }
}

function setStorageValue(storage, key, value) {
  try {
    storage?.setItem(key, value);
  } catch {
    // Keep the current-page choice when storage is unavailable.
  }
}

function removeStorageValue(storage, key) {
  try {
    storage?.removeItem(key);
  } catch {
    // Storage can be unavailable in privacy-restricted browser contexts.
  }
}

function consentFor(config) {
  if (config.consentMode === "not-required") return "granted";
  const stored = readStoredJson(safeStorage("local"), consentStorageKey);
  return stored?.configKey === configKey(config) && ["granted", "denied"].includes(stored.choice)
    ? stored.choice
    : "unknown";
}

function writeConsent(config, choice) {
  setStorageValue(safeStorage("local"), consentStorageKey, JSON.stringify({
    choice,
    configKey: configKey(config),
    updatedAt: new Date().toISOString()
  }));
}

function safeCampaignValue(value) {
  return text(value, 120).replace(/[^a-zA-Z0-9 ._~:@/+-]/g, "");
}

export function campaignFromLocation(search = "", referrer = "", currentHostname = "") {
  const params = new URLSearchParams(search);
  const campaign = {};
  for (const key of ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"]) {
    const value = safeCampaignValue(params.get(key) || "");
    if (value) campaign[key] = value;
  }
  if (referrer) {
    try {
      const referrerHostname = new URL(referrer).hostname.slice(0, 253);
      if (!currentHostname || referrerHostname !== currentHostname) campaign.referrer_host = referrerHostname;
    } catch {
      // Ignore malformed browser referrers.
    }
  }
  return campaign;
}

function captureAttribution() {
  const campaign = campaignFromLocation(window.location.search, document.referrer, window.location.hostname);
  if (!Object.keys(campaign).length) return;
  const local = safeStorage("local");
  const session = safeStorage("session");
  if (local && !storageValue(local, firstTouchStorageKey)) {
    setStorageValue(local, firstTouchStorageKey, JSON.stringify(campaign));
  }
  setStorageValue(session, lastTouchStorageKey, JSON.stringify(campaign));
}

function clearAttribution() {
  removeStorageValue(safeStorage("local"), firstTouchStorageKey);
  removeStorageValue(safeStorage("session"), lastTouchStorageKey);
}

function attribution() {
  const first = readStoredJson(safeStorage("local"), firstTouchStorageKey) || {};
  const last = readStoredJson(safeStorage("session"), lastTouchStorageKey) || {};
  return Object.fromEntries([
    ...Object.entries(first).map(([key, value]) => [`first_${key}`, value]),
    ...Object.entries(last).map(([key, value]) => [`last_${key}`, value])
  ]);
}

function safeProperties(properties = {}) {
  return Object.fromEntries(Object.entries(properties)
    .filter(([, value]) => ["string", "number", "boolean"].includes(typeof value))
    .slice(0, 20)
    .map(([key, value]) => [text(key, 60), typeof value === "string" ? text(value, 240) : value])
    .filter(([key]) => key));
}

function appendScript(src, attributes = {}) {
  const absoluteSource = new URL(src, window.location.href).href;
  if ([...document.scripts].some((script) => script.src === absoluteSource)) return Promise.resolve();

  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    Object.entries(attributes).forEach(([key, value]) => script.setAttribute(key, value));
    script.addEventListener("load", resolve, { once: true });
    script.addEventListener("error", () => reject(new Error("Analytics could not be loaded.")), { once: true });
    document.head.append(script);
  });
}

async function loadAnalytics(config) {
  if (config.provider === "google-analytics") {
    window.dataLayer ||= [];
    window.gtag ||= function gtag() { window.dataLayer.push(arguments); };
    window.gtag("js", new Date());
    window.gtag("config", config.analyticsId, { send_page_view: false, anonymize_ip: true });
    await appendScript(`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(config.analyticsId)}`);
  } else if (config.provider === "google-tag-manager") {
    window.dataLayer ||= [];
    window.dataLayer.push({ "gtm.start": Date.now(), event: "gtm.js" });
    await appendScript(`https://www.googletagmanager.com/gtm.js?id=${encodeURIComponent(config.analyticsId)}`);
  }
}

function sendPlausibleEvent(config, name, properties) {
  return fetch("https://plausible.io/api/event", {
    method: "POST",
    keepalive: true,
    headers: { "content-type": "text/plain" },
    body: JSON.stringify({
      domain: config.analyticsId,
      name: name === "page_view" ? "pageview" : name,
      url: window.location.href,
      referrer: document.referrer || undefined,
      props: properties
    })
  }).catch(() => undefined);
}

async function loadMetaPixel(config) {
  if (!config.metaPixelId) return;
  window.fbq ||= function fbq() { (window.fbq.queue ||= []).push(arguments); };
  window.fbq.loaded = true;
  window.fbq.version = "2.0";
  window.fbq.queue ||= [];
  window.fbq("init", config.metaPixelId);
  await appendScript("https://connect.facebook.net/en_US/fbevents.js");
}

function ensureProviders(config) {
  providerReady ||= Promise.allSettled([loadAnalytics(config), loadMetaPixel(config)]);
  return providerReady;
}

const metaEventNames = {
  page_view: "PageView",
  view_item: "ViewContent",
  add_to_cart: "AddToCart",
  begin_checkout: "InitiateCheckout",
  purchase: "Purchase",
  generate_lead: "Lead"
};

function commerceItem(properties) {
  if (!properties.item_id) return null;
  return Object.fromEntries(Object.entries({
    item_id: properties.item_id,
    item_name: properties.item_name,
    item_variant: properties.variant_name || properties.variant_id,
    quantity: properties.quantity,
    price: properties.unit_price
  }).filter(([, value]) => value !== undefined && value !== ""));
}

export function providerEventPayloads(name, properties = {}) {
  const item = commerceItem(properties);
  const commerce = ["view_item", "add_to_cart", "begin_checkout", "purchase"].includes(name);
  const google = item ? { ...properties, items: [item] } : { ...properties };
  const meta = { ...properties };

  if (item) {
    meta.content_ids = [item.item_id];
    meta.content_type = "product";
    if (item.item_name) meta.content_name = item.item_name;
  }
  if (properties.quantity || properties.item_count) {
    meta.num_items = Number(properties.quantity || properties.item_count);
  }

  return {
    google,
    tagManager: commerce ? { ...properties, ecommerce: google } : { ...properties },
    meta
  };
}

export async function trackMarketingEvent(name, properties = {}) {
  if (!activeConfig || activeConsent !== "granted" || !eventNames.has(name)) return false;
  if (name === "page_view" && !activeConfig.trackPageViews) return false;
  if (name === "generate_lead" && !activeConfig.trackForms) return false;
  if (["view_item", "add_to_cart", "begin_checkout", "purchase"].includes(name) && !activeConfig.trackCommerce) return false;

  await ensureProviders(activeConfig);
  const payload = { ...safeProperties(properties), ...attribution() };
  const providerPayloads = providerEventPayloads(name, payload);
  if (activeConfig.provider === "google-analytics") window.gtag?.("event", name, providerPayloads.google);
  if (activeConfig.provider === "google-tag-manager") window.dataLayer?.push({ event: name, ...providerPayloads.tagManager });
  if (activeConfig.provider === "plausible") void sendPlausibleEvent(activeConfig, name, payload);
  if (activeConfig.metaPixelId) window.fbq?.("track", metaEventNames[name], providerPayloads.meta);
  return true;
}

function consentMarkup(config) {
  const privacyLink = config.privacyUrl
    ? `<a href="${escapeAttribute(config.privacyUrl)}">Privacy policy</a>`
    : "";
  return `
    <section class="codey-consent" role="region" aria-label="Analytics privacy choices" data-codey-consent>
      <div><strong>Privacy choices</strong><p>Allow analytics and marketing tools to help improve this website. ${privacyLink}</p></div>
      <div class="codey-consent-actions">
        <button type="button" class="secondary-button" data-codey-consent-choice="denied">Decline</button>
        <button type="button" data-codey-consent-choice="granted">Allow analytics</button>
      </div>
    </section>`;
}

function showConsent(config) {
  document.querySelector("[data-codey-consent]")?.remove();
  document.body.insertAdjacentHTML("beforeend", consentMarkup(config));
}

function showPrivacyControl(config) {
  if (config.consentMode !== "required" || document.querySelector("[data-codey-privacy-settings]")) return;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "codey-privacy-settings";
  button.dataset.codeyPrivacySettings = "";
  button.textContent = "Privacy";
  button.addEventListener("click", () => showConsent(config));
  document.body.append(button);
}

function grantConsent(config) {
  captureAttribution();
  void ensureProviders(config).then(() => trackMarketingEvent("page_view", {
    page_path: window.location.pathname,
    page_title: document.title
  }));
}

export function readMarketingConfig(documentRoot = document) {
  const element = documentRoot.querySelector("#codey-marketing-config");
  if (!element?.textContent) return normalizeMarketingConfig();
  try {
    return normalizeMarketingConfig(JSON.parse(element.textContent));
  } catch {
    return normalizeMarketingConfig();
  }
}

export function startMarketingRuntime() {
  const config = readMarketingConfig();
  if (!configured(config)) return;
  activeConfig = config;
  window.codeyTrack = trackMarketingEvent;
  document.addEventListener("codey:marketing", (event) => {
    void trackMarketingEvent(event.detail?.name, event.detail?.properties);
  });
  document.addEventListener("click", (event) => {
    const choice = event.target?.closest?.("[data-codey-consent-choice]")?.dataset.codeyConsentChoice;
    if (!choice) return;
    const previousConsent = activeConsent;
    activeConsent = choice;
    writeConsent(config, choice);
    document.querySelector("[data-codey-consent]")?.remove();
    if (choice === "granted" && previousConsent !== "granted") grantConsent(config);
    if (choice === "denied") clearAttribution();
    showPrivacyControl(config);
    if (choice === "denied" && previousConsent === "granted") window.location.reload();
  });

  const consent = consentFor(config);
  activeConsent = consent;
  if (consent === "granted") grantConsent(config);
  if (consent === "unknown") showConsent(config);
  if (consent !== "unknown") showPrivacyControl(config);
}
