import { expect, test, type APIRequestContext } from "@playwright/test";
import sharp from "sharp";

const adminEmail = process.env.INTEGRATION_ADMIN_EMAIL || "integration-owner@example.com";
const adminPassword = process.env.INTEGRATION_ADMIN_PASSWORD || "IntegrationOwner123!";

async function login(page: import("@playwright/test").Page) {
  await page.goto("/cy-admin");
  await page.getByLabel("Email").fill(adminEmail);
  await page.getByLabel("Password").fill(adminPassword);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByText(adminEmail, { exact: true })).toBeVisible();
}

async function resetTeamDirectoryFixture(request: APIRequestContext) {
  const loginResponse = await request.post("/api/v1/auth/login", {
    data: { email: adminEmail, password: adminPassword }
  });
  expect(loginResponse.ok()).toBeTruthy();
  const loginBody = await loginResponse.json();
  const headers = { authorization: `Bearer ${loginBody.data.tokens.accessToken}` };

  const extensionResponse = await request.get("/api/v1/cms/extensions", { headers });
  expect(extensionResponse.ok()).toBeTruthy();
  const extensionBody = await extensionResponse.json();
  const extensions = extensionBody.data.extensions as Array<{ id: string; installed: boolean }>;
  const teamExtension = extensions.find((extension) => extension.id === "codey.team-directory");
  if (teamExtension?.installed) {
    const disconnectResponse = await request.delete("/api/v1/cms/extensions/codey.team-directory", {
      headers,
      data: { confirmation: "codey.team-directory" }
    });
    expect(disconnectResponse.ok()).toBeTruthy();
  }

  const collectionsResponse = await request.get("/api/v1/cms/collections", { headers });
  expect(collectionsResponse.ok()).toBeTruthy();
  const collectionsBody = await collectionsResponse.json();
  const collections = collectionsBody.data.collections as Array<{ slug: string }>;
  if (collections.some((collection) => collection.slug === "team-members")) {
    const deleteResponse = await request.delete("/api/v1/cms/collections/team-members", {
      headers,
      data: { confirmation: "team-members" }
    });
    expect(deleteResponse.ok()).toBeTruthy();
  }
}

async function canvasSignature(canvas: import("@playwright/test").Locator) {
  const screenshot = await canvas.screenshot();
  const metadata = await sharp(screenshot).metadata();
  const { data: pixels, info } = await sharp(screenshot)
    .resize(64, 64, { fit: "fill" })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const colors = new Set<string>();
  let minimum = 255;
  let maximum = 0;
  let hash = 2166136261;
  const samples: number[] = [];
  const pixelCount = info.width * info.height;

  for (let pixel = 0; pixel < pixelCount; pixel += 1) {
    const index = pixel * info.channels;
    const red = pixels[index] || 0;
    const green = pixels[index + 1] || 0;
    const blue = pixels[index + 2] || 0;
    const quantizedRed = red >> 5;
    const quantizedGreen = green >> 5;
    const quantizedBlue = blue >> 5;
    const luminance = Math.round(red * 0.21 + green * 0.72 + blue * 0.07);
    samples.push(luminance);
    minimum = Math.min(minimum, luminance);
    maximum = Math.max(maximum, luminance);
    colors.add(`${quantizedRed}-${quantizedGreen}-${quantizedBlue}`);
    hash = Math.imul(hash ^ quantizedRed, 16777619);
    hash = Math.imul(hash ^ quantizedGreen, 16777619);
    hash = Math.imul(hash ^ quantizedBlue, 16777619);
  }

  return {
    colors: colors.size,
    hash: hash >>> 0,
    range: maximum - minimum,
    width: metadata.width || 0,
    height: metadata.height || 0,
    samples
  };
}

function canvasDifference(left: { samples: number[] }, right: { samples: number[] }) {
  if (left.samples.length !== right.samples.length || left.samples.length === 0) return Number.POSITIVE_INFINITY;
  const total = left.samples.reduce((difference, sample, index) => {
    return difference + Math.abs(sample - (right.samples[index] || 0));
  }, 0);
  return total / left.samples.length;
}

function triangleGlb() {
  const positions = Buffer.alloc(36);
  [-1, -1, 0, 1, -1, 0, 0, 1, 0].forEach((value, index) => positions.writeFloatLE(value, index * 4));
  const indices = Buffer.alloc(8);
  [0, 1, 2].forEach((value, index) => indices.writeUInt16LE(value, index * 2));
  const binary = Buffer.concat([positions, indices]);
  const document = {
    asset: { version: "2.0" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
    buffers: [{ byteLength: 42 }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: 36, target: 34962 },
      { buffer: 0, byteOffset: 36, byteLength: 6, target: 34963 }
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 3, type: "VEC3", min: [-1, -1, 0], max: [1, 1, 0] },
      { bufferView: 1, componentType: 5123, count: 3, type: "SCALAR", min: [0], max: [2] }
    ]
  };
  const source = Buffer.from(JSON.stringify(document), "utf8");
  const json = Buffer.concat([source, Buffer.alloc((4 - source.length % 4) % 4, 0x20)]);
  const body = Buffer.alloc(12 + 8 + json.length + 8 + binary.length);
  body.write("glTF", 0, "ascii");
  body.writeUInt32LE(2, 4);
  body.writeUInt32LE(body.length, 8);
  body.writeUInt32LE(json.length, 12);
  body.writeUInt32LE(0x4e4f534a, 16);
  json.copy(body, 20);
  const binaryOffset = 20 + json.length;
  body.writeUInt32LE(binary.length, binaryOffset);
  body.writeUInt32LE(0x004e4942, binaryOffset + 4);
  binary.copy(body, binaryOffset + 8);
  return body;
}

async function panoramaPng() {
  const source = Buffer.from(`
    <svg xmlns="http://www.w3.org/2000/svg" width="1200" height="600" viewBox="0 0 1200 600">
      <defs>
        <linearGradient id="sky" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#163c4a"/>
          <stop offset="0.45" stop-color="#48c9e8"/>
          <stop offset="1" stop-color="#f2c94c"/>
        </linearGradient>
      </defs>
      <rect width="1200" height="600" fill="url(#sky)"/>
      <path d="M0 420 C170 310 330 540 520 390 S900 300 1200 430 V600 H0 Z" fill="#13312d"/>
      <circle cx="230" cy="190" r="74" fill="#c9ff67"/>
      <rect x="760" y="170" width="230" height="180" rx="20" fill="#ff8066"/>
    </svg>
  `);
  return sharp(source).png().toBuffer();
}

test("admin settings and builder controls complete their primary workflows", async ({ page }) => {
  await login(page);

  const browserErrors: string[] = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(message.text());
  });

  await expect(page.getByRole("heading", { name: "Your website" })).toBeVisible();
  await expect(page.getByRole("link", { name: /Edit website/ })).toBeVisible();
  await expect(page.locator("details.dashboard-system-details")).not.toHaveAttribute("open", "");
  await expect(page.getByRole("link", { name: "Dashboard" })).toHaveAttribute("aria-current", "page");

  await page.getByRole("link", { name: "Settings" }).click();
  await expect(page).toHaveURL(/\/dashboard\/settings$/);
  await expect(page.locator("[data-launch-readiness]")).toBeVisible();
  await page.getByText("General settings", { exact: true }).click();
  const logoPicker = page.locator("[data-site-media-picker]").first();
  await expect(page.getByRole("heading", { name: "Website identity" })).toBeVisible();
  await page.locator('input[name="logoFile"]').setInputFiles({
    name: "logo.png",
    mimeType: "image/png",
    buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64")
  });
  await expect(logoPicker.locator("[data-site-image-preview] img")).toBeVisible();
  await logoPicker.getByRole("button", { name: "Remove" }).click();
  await expect(logoPicker.locator('[name="logoRemove"]')).toHaveValue("true");
  await expect(logoPicker.getByText("Upload image", { exact: true })).toBeVisible();
  await page.getByText("Email", { exact: true }).click();
  await expect(page.locator("[data-email-settings-form]")).toBeVisible();
  await expect(page.getByLabel("Provider API key")).toHaveAttribute("type", "password");
  await expect(page.getByText(/Transactional email (configured|not configured)/)).toBeVisible();

  await page.getByRole("link", { name: "Pages" }).click();
  const homeRow = page.getByRole("row").filter({
    has: page.getByRole("link", { name: "Home", exact: true })
  });
  await homeRow.getByRole("link", { name: "Edit structure" }).click();
  await expect(page).toHaveURL(/\/dashboard\/pages\/home\/builder/);
  const builder = page.locator("[data-page-builder]");
  await expect(builder).toBeVisible();
  await expect(page.getByRole("group", { name: "Canvas history" })).toBeVisible();
  await expect(page.getByRole("group", { name: "Preview device" })).toBeVisible();
  await expect(page.getByText("Section patterns", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Delete Hero", exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Mobile", exact: true }).click();
  await expect(page.getByRole("button", { name: "Mobile", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("[data-builder-canvas-dropzone]")).toHaveAttribute("data-builder-preview-device", "mobile");

  const sectionCount = await page.locator("[data-builder-section]").count();
  await page.getByRole("button", { name: "Add container" }).click();
  const containerDialog = page.getByRole("dialog", { name: "Choose container layout" });
  await expect(containerDialog).toBeVisible();
  await expect(containerDialog.getByRole("tab")).toHaveCount(3);
  await expect(containerDialog.getByRole("tab", { name: "Layout" })).toHaveAttribute("aria-selected", "true");
  await containerDialog.getByRole("tab", { name: "Style" }).click();
  await containerDialog.getByText("Background", { exact: true }).click();
  await expect(containerDialog.getByLabel("Upload or replace image")).toHaveAttribute("type", "file");
  await containerDialog.getByText("Surface", { exact: true }).click();
  await expect(containerDialog.locator('select[name="borderWidth"]')).toBeVisible();
  await containerDialog.getByText("Motion", { exact: true }).click();
  const sectionEffect = containerDialog.locator('select[name="animationEffect"]');
  await expect(sectionEffect).toBeVisible();
  await expect(sectionEffect.locator("option[value='reveal-up']")).toHaveCount(1);
  await containerDialog.getByRole("tab", { name: "Advanced" }).click();
  await expect(containerDialog.getByLabel("Show on mobile")).toBeChecked();
  await containerDialog.getByRole("tab", { name: "Layout" }).click();
  await containerDialog.getByRole("button", { name: "Add container" }).click();
  await expect(page.locator("[data-builder-section]")).toHaveCount(sectionCount + 1);
  await page.getByRole("button", { name: "Undo last canvas change" }).click();
  await expect(page.locator("[data-builder-section]")).toHaveCount(sectionCount);

  const blockCount = await page.locator("[data-builder-block-key]").count();
  await page.locator("[data-builder-block-key]").first().locator("[data-duplicate-builder-block]").click();
  await expect(page.locator("[data-builder-block-key]")).toHaveCount(blockCount + 1);
  await page.getByRole("button", { name: "Undo last canvas change" }).click();
  await expect(page.locator("[data-builder-block-key]")).toHaveCount(blockCount);

  const selectedBlock = page.locator("[data-builder-block-key]").first();
  await selectedBlock.click();
  await expect(selectedBlock).toHaveClass(/active/);
  await page.keyboard.press("Control+c");
  await page.keyboard.press("Control+v");
  await expect(page.locator("[data-builder-block-key]")).toHaveCount(blockCount + 1);
  await page.getByRole("button", { name: "Undo last canvas change" }).click();
  await expect(page.locator("[data-builder-block-key]")).toHaveCount(blockCount);

  expect(browserErrors).toEqual([]);
});

test("account protection stays discoverable without interrupting normal login", async ({ page }) => {
  await login(page);

  await page.getByRole("link", { name: "Profile" }).click();
  await expect(page).toHaveURL(/\/dashboard\/profile$/);
  await expect(page.getByText("Two-step verification", { exact: true })).toBeVisible();
  await expect(page.locator("[data-mfa-setup-form]")).toBeVisible();
  await expect(page.getByText("Recommended", { exact: true })).toBeVisible();
  await expect(page.getByText("Signed-in devices", { exact: true })).toBeVisible();
  await expect(page.getByText("This browser", { exact: true })).toBeVisible();
  await expect(page.locator("[data-revoke-session][data-current-session='true']")).toBeVisible();

  await page.getByRole("link", { name: "Settings" }).click();
  await expect(page).toHaveURL(/\/dashboard\/settings$/);
  await page.locator('label[for="settings-tab-security"]').click();
  await expect(page.getByRole("heading", { name: "Security activity" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Account security" })).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("link", { name: "Account security" }).click();
  await expect(page.locator("[data-mfa-panel]")).toBeVisible();
  await expect(page.locator("[data-session-actions]")).toBeVisible();
  const horizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(horizontalOverflow).toBeLessThanOrEqual(1);
});

test("editors can model and publish a custom collection without code", async ({ page, request }) => {
  const runId = Date.now();
  const collectionName = `Browser resources ${runId}`;
  const collectionSlug = `browser-resources-${runId}`;
  const entrySlug = `first-resource-${runId}`;
  const browserErrors: string[] = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(message.text());
  });

  await resetTeamDirectoryFixture(request);
  await login(page);
  await page.getByRole("link", { name: "Collections", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard\/collections$/);
  const teamExtension = page.locator(".content-extension-card").filter({ hasText: "Team directory" });
  await page.getByLabel("Find extensions").fill("not-a-real-pack");
  await expect(teamExtension).toBeHidden();
  await expect(page.getByText("No extensions match", { exact: true })).toBeVisible();
  await page.getByLabel("Find extensions").fill("leadership");
  await page.getByLabel("Category").selectOption("directory");
  await expect(teamExtension).toBeVisible();
  await expect(teamExtension.getByText("Catalog verified", { exact: true })).toBeVisible();
  await expect(teamExtension.getByRole("link", { name: "Documentation" })).toHaveAttribute("rel", "noopener noreferrer");
  await teamExtension.getByRole("button", { name: "Install" }).click();
  await expect(teamExtension.getByText("Installed", { exact: true })).toBeVisible();
  await teamExtension.getByRole("button", { name: "Disconnect" }).click();
  const disconnectDialog = page.getByRole("dialog", { name: "Disconnect extension" });
  await disconnectDialog.getByLabel("Type codey.team-directory").fill("codey.team-directory");
  await disconnectDialog.getByRole("button", { name: "Disconnect" }).click();
  await expect(page.getByText("Team members", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: /Team members/ }).click();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  const teamCollectionDialog = page.getByRole("dialog", { name: "Delete collection" });
  await teamCollectionDialog.getByLabel("Type team-members").fill("team-members");
  await teamCollectionDialog.getByRole("button", { name: "Delete" }).click();
  await expect(page).toHaveURL(/\/dashboard\/collections$/);
  await page.getByRole("link", { name: "New collection" }).click();
  await page.getByLabel("Name", { exact: true }).fill(collectionName);
  await expect(page.getByLabel("URL name", { exact: true })).toHaveValue(collectionSlug);
  await page.getByRole("button", { name: "Add field" }).click();
  const summaryField = page.locator("[data-content-field-row]").nth(1);
  await summaryField.locator('input[name="fieldLabel"]').fill("Summary");
  await expect(summaryField.locator('input[name="fieldKey"]')).toHaveValue("summary");
  await summaryField.locator('select[name="fieldType"]').selectOption("textarea");
  await summaryField.getByText("Guidance and validation", { exact: true }).click();
  await summaryField.locator('input[name="fieldMaxLength"]').fill("500");
  await summaryField.getByRole("button", { name: "Move Summary up" }).click();
  await expect(page.locator("[data-content-field-row]").first().locator(".content-field-row-heading strong")).toHaveText("Summary");
  await page.locator("[data-content-field-row]").first().getByRole("button", { name: "Move Summary down" }).click();
  await page.getByRole("button", { name: "Create collection" }).click();

  await expect(page).toHaveURL(new RegExp(`/dashboard/collections/${collectionSlug}$`));
  await expect(page.getByRole("heading", { name: collectionName })).toBeVisible();
  await page.getByRole("link", { name: "Add entry" }).click();
  await expect(page).toHaveURL(new RegExp(`/dashboard/collections/${collectionSlug}/entries/new$`));
  await page.getByLabel("Title", { exact: true }).fill(`First resource ${runId}`);
  await expect(page.getByLabel("URL name", { exact: true })).toHaveValue(entrySlug);
  await expect(page.getByLabel("Summary")).toHaveAttribute("maxlength", "500");
  await page.getByLabel("Summary").fill("A structured resource created through the dashboard.");
  await page.locator('select[name="status"]').selectOption("PUBLISHED");
  await page.getByRole("button", { name: "Create entry" }).click();

  await expect(page).toHaveURL(new RegExp(`/dashboard/collections/${collectionSlug}/entries/${entrySlug}`));
  await page.getByLabel("Summary").fill("Updated through the generated editor form.");
  const savedEntry = page.waitForResponse((response) => (
    response.request().method() === "PATCH" &&
    response.url().includes(`/api/v1/cms/collections/${collectionSlug}/entries/${entrySlug}`) &&
    response.ok()
  ));
  await page.getByRole("button", { name: "Save entry" }).click();
  await savedEntry;
  await expect(page.getByLabel("Summary")).toHaveValue("Updated through the generated editor form.");

  const publicResponse = await page.request.get(
    `/api/v1/cms/collections/${collectionSlug}/entries/${entrySlug}?locale=en`
  );
  expect(publicResponse.ok()).toBeTruthy();
  const publicBody = await publicResponse.json();
  expect(publicBody.data.entry.data.summary).toBe("Updated through the generated editor form.");

  await page.getByRole("button", { name: "Delete", exact: true }).click();
  const entryDialog = page.getByRole("dialog", { name: "Delete entry" });
  await entryDialog.getByLabel(`Type ${entrySlug}`).fill(entrySlug);
  await entryDialog.getByRole("button", { name: "Delete" }).click();
  await expect(page).toHaveURL(new RegExp(`/dashboard/collections/${collectionSlug}$`));
  await expect(page.getByRole("heading", { name: collectionName })).toBeVisible();

  await page.getByRole("button", { name: "Delete", exact: true }).click();
  const collectionDialog = page.getByRole("dialog", { name: "Delete collection" });
  await collectionDialog.getByLabel(`Type ${collectionSlug}`).fill(collectionSlug);
  await collectionDialog.getByRole("button", { name: "Delete" }).click();
  await expect(page).toHaveURL(/\/dashboard\/collections$/);
  await expect(page.getByText(collectionName, { exact: true })).toHaveCount(0);
  expect(browserErrors).toEqual([]);
});

test("customers can complete the real storefront journey", async ({ page }) => {
  const buyerEmail = `browser-commerce-${Date.now()}@example.com`;
  const apiLogin = await page.request.post("/api/v1/auth/login", {
    data: { email: adminEmail, password: adminPassword }
  });
  expect(apiLogin.ok()).toBeTruthy();
  const apiLoginBody = await apiLogin.json();
  const manualProvider = await page.request.put("/api/v1/payments/providers/manual", {
    headers: { authorization: `Bearer ${apiLoginBody.data.tokens.accessToken}` },
    data: {
      enabled: true,
      instructions: "Use the order number when arranging payment."
    }
  });
  expect(manualProvider.ok()).toBeTruthy();

  const browserErrors: string[] = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  await page.goto("/product/starter-product");
  await expect(page.getByRole("heading", { name: "Starter Product" })).toBeVisible();
  await page.getByLabel("Option").selectOption({ index: 0 });
  await page.getByRole("button", { name: "Add to cart" }).click();

  let cartDialog = page.locator("[data-commerce-dialog]");
  await expect(cartDialog).toBeVisible();
  await expect(cartDialog.getByText("Starter Product", { exact: true })).toBeVisible();

  await page.reload();
  await expect(page.locator("[data-commerce-cart-count]")).toHaveText("1");
  await page.getByRole("button", { name: /Cart 1/ }).click();
  cartDialog = page.locator("[data-commerce-dialog]");
  await expect(cartDialog.getByText("Starter Product", { exact: true })).toBeVisible();

  await cartDialog.getByRole("button", { name: "Checkout" }).click();
  await cartDialog.getByLabel("Name", { exact: true }).fill("Commerce Customer");
  await cartDialog.getByLabel("Email", { exact: true }).fill(buyerEmail);
  await cartDialog.getByLabel("Delivery country", { exact: true }).selectOption("US");
  await expect(cartDialog.getByText("Standard shipping", { exact: true })).toBeVisible();
  await cartDialog.getByLabel("Address", { exact: true }).fill("1 Browser Way");
  await cartDialog.getByLabel("City", { exact: true }).fill("New York");
  await cartDialog.getByLabel("Region", { exact: true }).fill("NY");
  await cartDialog.getByLabel("Postal code", { exact: true }).fill("10001");
  await cartDialog.getByLabel("Coupon code", { exact: true }).fill("WELCOME10");
  await expect(cartDialog.getByText("Manual payment", { exact: true })).toBeVisible();
  await cartDialog.getByRole("button", { name: "Review and pay" }).click();

  await expect(cartDialog.getByRole("heading", { name: "Order received" })).toBeVisible();
  await expect(cartDialog.getByText(/Use the order number/)).toBeVisible();
  await expect(page.locator("[data-commerce-cart-count]")).toHaveText("0");

  const orderResponse = await page.request.get("/api/v1/orders", {
    headers: { authorization: `Bearer ${apiLoginBody.data.tokens.accessToken}` }
  });
  const orderBody = await orderResponse.json();
  const order = orderBody.data.orders.find((item: { customerEmail: string }) => item.customerEmail === buyerEmail);
  expect(order).toBeTruthy();
  const trackingResponse = await page.request.patch(`/api/v1/orders/${order.id}/tracking`, {
    headers: { authorization: `Bearer ${apiLoginBody.data.tokens.accessToken}` },
    data: {
      status: "IN_TRANSIT",
      carrier: "Browser Parcel",
      trackingNumber: "BROWSER-TRACK-1",
      trackingUrl: "https://tracking.example/browser"
    }
  });
  expect(trackingResponse.ok()).toBeTruthy();

  await cartDialog.getByRole("link", { name: "View your order" }).click();
  await expect(page).toHaveURL(/\/account\/orders$/);
  await expect(page.getByRole("heading", { name: "Your orders", exact: true })).toBeVisible();
  await expect(page.getByText("Starter Product", { exact: true })).toBeVisible();
  await expect(page.getByText("Browser Parcel", { exact: false })).toBeVisible();
  await expect(page.getByRole("link", { name: "Track parcel" })).toHaveAttribute("href", "https://tracking.example/browser");

  await page.getByRole("button", { name: "Get help" }).click();
  let buyerDialog = page.locator("[data-commerce-dialog]");
  await buyerDialog.getByLabel("Subject").fill("Product question");
  await buyerDialog.getByLabel("What happened?").fill("Please confirm the delivery instructions for this order.");
  await buyerDialog.getByRole("button", { name: "Send request" }).click();
  await expect(page.getByText("Your request was sent to the shop.")).toBeVisible();
  await expect(page.getByText("Product question", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Cancel order" }).click();
  buyerDialog = page.locator("[data-commerce-dialog]");
  await buyerDialog.getByLabel("Reason").fill("I no longer need this order.");
  await buyerDialog.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByText("Cancellation request sent to the shop.")).toBeVisible();
  await expect(page.getByText("Cancellation request", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Forget this device" }).click();
  buyerDialog = page.locator("[data-commerce-dialog]");
  await expect(buyerDialog.getByRole("heading", { name: "Forget orders on this device?" })).toBeVisible();
  await buyerDialog.getByRole("button", { name: "Forget this device" }).click();
  await expect(page.getByText("This device no longer has access to saved orders.")).toBeVisible();
  await expect(page.getByText("No orders on this device", { exact: true })).toBeVisible();
  expect(browserErrors).toEqual([]);
});

test("login asks for a verification code only when the API requires it", async ({ page }) => {
  await page.route("**/api/v1/auth/login", async (route) => {
    await route.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify({
        success: false,
        data: null,
        error: {
          code: "mfa_required",
          message: "Enter the verification code for this account.",
          details: { mfaRequired: true }
        },
        meta: { requestId: "test-request" }
      })
    });
  });

  await page.goto("/cy-admin");
  await expect(page.getByLabel("Verification code")).toBeHidden();
  await page.getByLabel("Email").fill(adminEmail);
  await page.getByLabel("Password").fill(adminPassword);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByLabel("Verification code")).toBeVisible();
  await expect(page.getByLabel("Verification code")).toBeFocused();
});

test("builder discovery, structure navigation, and responsive preview stay usable", async ({ page }) => {
  const browserErrors: string[] = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(message.text());
  });

  await login(page);
  await page.getByRole("link", { name: "Pages", exact: true }).click();
  const homeRow = page.getByRole("row").filter({
    has: page.getByRole("link", { name: "Home", exact: true })
  });
  await homeRow.getByRole("link", { name: "Edit structure" }).click();
  await expect(page.locator("[data-page-builder]")).toBeVisible();

  const librarySearch = page.getByPlaceholder("Search sections and elements");
  await librarySearch.fill("rich text");
  await expect(page.locator("[data-builder-template='rich-text']")).toBeVisible();
  await librarySearch.fill("heading");
  await expect(page.locator("[data-builder-template='heading']")).toBeVisible();
  await librarySearch.fill("");
  await page.getByRole("button", { name: "Advanced", exact: true }).click();
  await expect(page.locator("[data-builder-template='custom-code']")).toBeVisible();
  await expect(page.locator("[data-builder-template='resource-list']")).toBeHidden();
  await page.getByRole("button", { name: "All", exact: true }).click();
  await librarySearch.fill("slider");
  await expect(page.locator("[data-builder-template='slider']")).toBeVisible();
  await expect(page.locator("[data-builder-template='gallery']")).toBeHidden();
  await librarySearch.fill("resource list");
  await expect(page.locator("[data-builder-template='resource-list']")).toBeVisible();
  await librarySearch.fill("story timeline");
  await expect(page.locator("[data-builder-section-pattern='story-timeline']")).toBeVisible();
  await librarySearch.fill("capability bento");
  await expect(page.locator("[data-builder-section-pattern='capability-bento']")).toBeVisible();
  await librarySearch.fill("glass interface banner");
  await expect(page.locator("[data-builder-section-pattern='glass-interface-banner']")).toBeVisible();
  await librarySearch.fill("kinetic product banner");
  await expect(page.locator("[data-builder-section-pattern='kinetic-product-banner']")).toBeVisible();
  await librarySearch.fill("floating product banner");
  await expect(page.locator("[data-builder-section-pattern='floating-product-banner']")).toBeVisible();
  const sectionCountBeforeBanner = await page.locator("[data-builder-section]").count();
  await librarySearch.fill("glass interface banner");
  await page.locator("[data-builder-section-pattern='glass-interface-banner']").click();
  await expect(page.locator("[data-builder-section]")).toHaveCount(sectionCountBeforeBanner + 1);
  const glassBannerSection = page.locator("[data-builder-section]").last();
  await glassBannerSection.locator("[data-edit-builder-section]").click();
  const bannerDialog = page.getByRole("dialog", { name: "Glass interface banner" });
  await bannerDialog.getByRole("tab", { name: "Style" }).click();
  await expect(bannerDialog.getByLabel("Banner design")).toHaveValue("glass-interface");
  await expect(bannerDialog.getByLabel("Banner design").locator("option")).toHaveCount(3);
  await bannerDialog.getByRole("button", { name: "Cancel" }).click();
  await page.getByRole("button", { name: "Undo last canvas change" }).click();
  await expect(page.locator("[data-builder-section]")).toHaveCount(sectionCountBeforeBanner);
  const sectionCountBeforeProductPattern = await page.locator("[data-builder-section]").count();
  await librarySearch.fill("product spotlight");
  await page.locator("[data-builder-section-pattern='product-spotlight']").click();
  const productPatternDialog = page.getByRole("dialog", { name: "Configure Featured product" });
  await expect(productPatternDialog).toBeVisible();
  await expect(productPatternDialog.getByRole("checkbox", { name: /Starter Product/ })).toBeChecked();
  await productPatternDialog.getByRole("button", { name: "Add section" }).click();
  await expect(page.locator("[data-builder-section]")).toHaveCount(sectionCountBeforeProductPattern + 1);
  await page.getByRole("button", { name: "Undo last canvas change" }).click();
  await expect(page.locator("[data-builder-section]")).toHaveCount(sectionCountBeforeProductPattern);
  await librarySearch.fill("navigation cards");
  await expect(page.locator("[data-builder-template='navigation-cards']")).toBeVisible();
  await librarySearch.fill("");

  const blockCount = await page.locator("[data-builder-block-key]").count();
  await librarySearch.fill("process steps");
  await expect(page.locator("[data-builder-template='process-steps']")).toBeVisible();
  await page.locator("[data-builder-template='process-steps']").click();
  await expect(page.locator("[data-builder-block-key]")).toHaveCount(blockCount + 1);

  const processBlock = page.locator("[data-builder-block-key]").filter({ hasText: "Process steps" }).last();
  await processBlock.locator("[data-builder-edit-block]").click();
  const editorDialog = page.getByRole("dialog", { name: "Process steps" });
  await expect(editorDialog.getByRole("tab", { name: "Content" })).toBeVisible();
  await expect(editorDialog.getByRole("tab", { name: "Settings" })).toBeVisible();
  await expect(editorDialog.getByRole("tab", { name: "Style" })).toBeVisible();
  await expect(editorDialog.getByRole("tab")).toHaveCount(3);
  const itemGroups = editorDialog.locator("details.modal-item-group");
  await expect(itemGroups.first()).toHaveAttribute("open", "");
  await expect(itemGroups.nth(1)).not.toHaveAttribute("open", "");
  await expect(itemGroups.nth(3).locator('input[name="structuredItem4Body"]')).toHaveValue("");
  await itemGroups.nth(1).locator("summary").click();
  const secondStepTitle = itemGroups.nth(1).getByLabel("Step title");
  const originalStepTitle = await secondStepTitle.inputValue();
  await secondStepTitle.fill("");
  await itemGroups.nth(1).locator("summary").click();
  await editorDialog.getByRole("button", { name: "Save" }).click();
  await expect(itemGroups.nth(1)).toHaveAttribute("open", "");
  await expect(secondStepTitle).toBeFocused();
  await secondStepTitle.fill(originalStepTitle);
  const secondStepBody = itemGroups.nth(1).locator("[data-rich-surface]");
  const originalStepBody = await secondStepBody.innerText();
  await secondStepBody.fill("");
  await itemGroups.nth(1).locator("summary").click();
  await editorDialog.getByRole("button", { name: "Save" }).click();
  await expect(itemGroups.nth(1)).toHaveAttribute("open", "");
  await expect(secondStepBody).toHaveAttribute("aria-invalid", "true");
  await expect(secondStepBody).toBeFocused();
  await secondStepBody.fill(originalStepBody);
  await editorDialog.getByRole("tab", { name: "Settings" }).click();
  await expect(editorDialog.getByLabel("Items per row")).toBeVisible();
  await expect(editorDialog.getByLabel("Show step numbers")).toBeVisible();
  await editorDialog.getByRole("tab", { name: "Style" }).click();
  await expect(editorDialog.locator('select[name="structuredAlignment"]')).toBeVisible();
  await expect(editorDialog.getByLabel("Item style")).toBeVisible();
  await expect(editorDialog.getByLabel("Item style").locator("option[value='liquid']")).toHaveCount(1);
  await expect(editorDialog.getByLabel("Corner style")).toBeVisible();
  await expect(editorDialog.getByLabel("Hover effect")).toBeVisible();
  await editorDialog.getByText("Motion", { exact: true }).click();
  await expect(editorDialog.locator('select[name="animationEffect"]')).toBeVisible();
  await editorDialog.getByRole("button", { name: "Cancel" }).click();
  await page.getByRole("button", { name: "Undo last canvas change" }).click();
  await expect(page.locator("[data-builder-block-key]")).toHaveCount(blockCount);

  await librarySearch.fill("custom code");
  await expect(page.locator("[data-builder-template='custom-code']")).toBeVisible();
  await page.locator("[data-builder-template='custom-code']").click();
  await expect(page.locator("[data-builder-block-key]")).toHaveCount(blockCount + 1);
  const customCodeBlock = page.locator("[data-builder-block-key]").filter({ hasText: "Custom code" }).last();
  await expect(customCodeBlock.getByText("Custom code preview paused.", { exact: true })).toBeVisible();
  await customCodeBlock.locator("[data-builder-edit-block]").click();
  const customCodeDialog = page.getByRole("dialog", { name: "Custom code" });
  await expect(customCodeDialog.locator('textarea[name="html"]')).toBeVisible();
  await customCodeDialog.getByRole("tab", { name: "Settings" }).click();
  await expect(customCodeDialog.locator('textarea[name="javascript"]')).toBeVisible();
  await expect(customCodeDialog.locator('textarea[name="libraries"]')).toBeVisible();
  await expect(customCodeDialog.locator('input[name="height"]')).toBeVisible();
  await customCodeDialog.getByRole("tab", { name: "Style" }).click();
  await expect(customCodeDialog.locator('textarea[name="css"]')).toBeVisible();
  await customCodeDialog.getByRole("button", { name: "Cancel" }).click();
  await page.getByRole("button", { name: "Undo last canvas change" }).click();
  await expect(page.locator("[data-builder-block-key]")).toHaveCount(blockCount);
  await librarySearch.fill("");

  await page.locator("[data-builder-rail-view='structure']").click();
  const firstStructureSection = page.locator("[data-builder-structure-section]").first();
  await expect(firstStructureSection).toBeVisible();
  await firstStructureSection.click();
  await expect(page.locator("[data-builder-section]").first()).toBeFocused();

  await page.locator("[data-builder-canvas-view='preview']").click();
  await expect(page.locator("[data-builder-live-preview]")).toBeVisible();
  await expect.poll(() => page.locator("[data-builder-preview-frame]").evaluate((frame) => frame.getBoundingClientRect().width)).toBe(1024);
  await page.getByRole("button", { name: "Mobile", exact: true }).click();
  await expect(page.locator("[data-builder-live-preview]")).toHaveAttribute("data-builder-preview-device", "mobile");
  await expect.poll(() => page.locator("[data-builder-preview-frame]").evaluate((frame) => frame.getBoundingClientRect().width)).toBe(390);

  const preview = page.locator("[data-builder-preview-frame]").contentFrame();
  await expect(preview.getByRole("heading", { name: "Home", exact: true })).toBeVisible();
  expect(browserErrors).toEqual([]);
});

test("backend builder follows visual editor changes from another tab", async ({ page }) => {
  await login(page);
  await page.getByRole("link", { name: "Pages", exact: true }).click();
  const homeRow = page.getByRole("row").filter({
    has: page.getByRole("link", { name: "Home", exact: true })
  });
  await homeRow.getByRole("link", { name: "Edit structure" }).click();
  await expect(page.locator("[data-page-builder]")).toBeVisible();

  const visualEditor = await page.context().newPage();
  let originalText = "";
  let updatedText = "";
  try {
    await visualEditor.goto("/?edit=1");
    await expect(visualEditor.locator("[data-editor-ui].visual-editor-bar")).toBeVisible();
    const visualBlock = visualEditor.locator("[data-visual-block]").first();
    originalText = (await visualBlock.locator("[data-visual-edit-surface]").innerText()).trim();
    updatedText = `Cross-tab sync ${Date.now()}`;

    await visualBlock.click();
    await visualEditor.locator("[data-visual-start-inline]").first().click();
    await visualEditor.locator("[data-visual-inline-editor]").fill(updatedText);
    await visualEditor.locator("[data-visual-save-inline]").click();
    await expect(visualEditor.locator("[data-visual-edit-surface]").first()).toContainText(updatedText);

    await page.bringToFront();
    await expect(page.locator(".form-message:not([hidden])")).toHaveText("Updated with changes from the visual editor.");
    await expect(page.locator("[data-page-builder]").getByText(updatedText, { exact: true }).first()).toBeVisible();

    await visualEditor.bringToFront();
    await visualEditor.locator("[data-visual-undo]").click();
    await expect(visualEditor.locator("[data-visual-edit-surface]").first()).toContainText(originalText);

    await page.bringToFront();
    await expect(page.locator("[data-page-builder]").getByText(originalText, { exact: true }).first()).toBeVisible();
  } finally {
    if (!visualEditor.isClosed() && originalText && updatedText) {
      await visualEditor.bringToFront();
      const currentText = await visualEditor.locator("[data-visual-edit-surface]").first().innerText().catch(() => "");
      if (currentText.includes(updatedText)) {
        await visualEditor.locator("[data-visual-undo]").click();
        await expect(visualEditor.locator("[data-visual-edit-surface]").first()).toContainText(originalText);
      }
    }
    await visualEditor.close();
  }
});

test("visual editing, design tokens, and reusable sections work without hover", async ({ page }) => {
  const browserErrors: string[] = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(message.text());
  });

  await login(page);
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await page.getByText("Style", { exact: true }).click();
  const designForm = page.locator("[data-design-system-form]");
  const designPreview = page.locator("[data-design-preview]");
  await expect(designForm).toBeVisible();
  await expect(designPreview).toBeVisible();
  await designForm.locator("[data-design-preset='liquid']").click();
  await expect(designPreview).toHaveAttribute("data-surface-style", "liquid");
  await expect(designForm.getByLabel("Surface style")).toHaveValue("liquid");
  await designForm.locator("[data-design-preset='editorial']").click();
  await expect(designForm.locator("[data-design-preset='editorial']")).toHaveAttribute("aria-pressed", "true");
  const typographyDisclosure = designForm.locator("[data-design-summary='typography']");
  await expect(typographyDisclosure).not.toHaveAttribute("open", "");
  await expect(typographyDisclosure.locator("[data-design-summary-value]")).toHaveText("Georgia + Inter");
  await typographyDisclosure.locator(":scope > summary").click();
  await expect(designForm.getByLabel("Heading font")).toBeVisible();
  await expect.poll(() => designPreview.evaluate((element) => element.style.getPropertyValue("--accent"))).toBe("#a33d2d");
  const primaryHexInput = designForm.getByLabel("Primary hex value", { exact: true });
  await primaryHexInput.fill("#2463eb");
  await expect(primaryHexInput).toHaveValue("#2463EB");
  await expect(designForm.locator('input[name="design.colors.primary"]')).toHaveValue("#2463eb");
  await expect.poll(() => designPreview.evaluate((element) => element.style.getPropertyValue("--accent"))).toBe("#2463eb");
  const cssDisclosure = designForm.locator("[data-design-summary='css']");
  await expect(cssDisclosure).not.toHaveAttribute("open", "");
  await expect(cssDisclosure.locator("[data-design-summary-value]")).toHaveText("Not set");
  await designForm.getByRole("button", { name: "Save design system" }).click();
  await expect(designForm.locator("[data-form-message]")).toHaveText("Settings saved.");

  await page.getByRole("link", { name: "Pages", exact: true }).click();
  const homeRow = page.getByRole("row").filter({
    has: page.getByRole("link", { name: "Home", exact: true })
  });
  await homeRow.getByRole("link", { name: "Edit structure" }).click();
  const structureModeSwitch = page.getByRole("navigation", { name: "Editing mode" });
  await expect(structureModeSwitch.getByText("Structure", { exact: true })).toHaveAttribute("aria-current", "page");
  await structureModeSwitch.getByRole("link", { name: "On-page" }).click();
  await expect(page).toHaveURL(/[?&]edit=1(?:&|$)/);
  await expect(page.locator("[data-editor-ui].visual-editor-bar")).toBeVisible();
  const onPageModeSwitch = page.getByRole("navigation", { name: "Editing mode" });
  await expect(onPageModeSwitch.getByText("On-page", { exact: true })).toHaveAttribute("aria-current", "page");
  await expect(onPageModeSwitch.getByRole("link", { name: "Structure" })).toBeVisible();
  await expect(page.locator("[data-visual-section]").first()).toBeVisible();
  await expect(page.locator("[data-visual-block]").first()).toBeVisible();
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.body).getPropertyValue("--accent").trim())).toBe("#2463eb");
  await expect(page.getByRole("status", { name: "Page is published" })).toBeVisible();

  const library = page.locator(".visual-library-menu");
  await library.locator(":scope > summary").click();
  await page.getByRole("button", { name: "Section", exact: true }).click();
  const addSectionDialog = page.getByRole("dialog", { name: "Choose a section layout" });
  await expect(page.locator("html")).toHaveClass(/modal-open/);
  await expect(page.locator("body")).toHaveClass(/modal-open/);
  await expect(addSectionDialog.getByRole("group", { name: "Layout" })).toBeVisible();
  await expect(addSectionDialog.getByText("Container CSS", { exact: true })).toHaveCount(0);
  await addSectionDialog.getByRole("button", { name: "Cancel" }).click();
  await expect(page.locator("html")).not.toHaveClass(/modal-open/);
  await expect(page.locator("body")).not.toHaveClass(/modal-open/);

  await library.locator(":scope > summary").click();
  await page.getByRole("button", { name: "Element", exact: true }).click();
  const addElementDialog = page.getByRole("dialog", { name: "Add an element" });
  await expect(addElementDialog.getByLabel("Element")).toHaveValue("text-layout");
  await addElementDialog.getByRole("button", { name: "Cancel" }).click();

  const visualBlock = page.locator("[data-visual-block]").first();
  const originalText = (await visualBlock.locator("[data-visual-edit-surface]").innerText()).trim();
  const directEdit = page.locator("[data-visual-start-inline]").first();
  await visualBlock.click();
  await expect(visualBlock).toHaveAttribute("aria-selected", "true");
  await expect(directEdit).toBeVisible();
  await directEdit.click();
  await expect(page.locator("[data-visual-inline-editor]")).toBeVisible();
  await expect(visualBlock.locator("[data-visual-inline-default]")).toBeHidden();
  await page.locator("[data-visual-cancel-inline]").click();
  await expect(page.locator("[data-visual-inline-editor]")).toHaveCount(0);
  await expect(visualBlock.locator("[data-visual-inline-actions]")).toBeHidden();

  const updatedText = `Visual editor save ${Date.now()}`;
  await page.locator("[data-visual-start-inline]").first().click();
  await page.locator("[data-visual-inline-editor]").fill(updatedText);
  await page.locator("[data-visual-save-inline]").click();
  await expect(page.locator("[data-visual-edit-surface]").first()).toContainText(updatedText);
  await page.locator("[data-visual-undo]").click();
  await expect(page.locator("[data-visual-edit-surface]").first()).toContainText(originalText);

  const templateName = `E2E reusable ${Date.now()}`;
  const visualSection = page.locator("[data-visual-section]").first();
  const sectionCount = await page.locator("[data-visual-section]").count();
  await visualSection.focus();
  await page.locator("[data-visual-save-section]").first().click();
  const saveDialog = page.getByRole("dialog", { name: "Save section to library" });
  await saveDialog.getByLabel("Template name").fill(templateName);
  await saveDialog.getByRole("button", { name: "Save template" }).click();
  await expect(page.locator("[data-status]")).toContainText(`${templateName} saved to reusable sections.`);
  if (!(await library.evaluate((element: HTMLDetailsElement) => element.open))) {
    await library.locator(":scope > summary").click();
  }
  const savedTemplate = page.locator(".visual-library-item").filter({ hasText: templateName });
  await expect(savedTemplate).toBeVisible();
  await savedTemplate.locator("[data-visual-insert-template]").click();
  await expect(page.locator("[data-visual-section]")).toHaveCount(sectionCount + 1);
  await page.locator("[data-visual-undo]").click();
  await expect(page.locator("[data-visual-section]")).toHaveCount(sectionCount);
  if (!(await library.evaluate((element: HTMLDetailsElement) => element.open))) {
    await library.locator(":scope > summary").click();
  }
  await savedTemplate.getByRole("button", { name: `Delete ${templateName}` }).click();
  const deleteDialog = page.getByRole("dialog", { name: `Delete ${templateName}?` });
  await deleteDialog.getByRole("button", { name: "Delete template" }).click();
  await expect(page.locator(".visual-library-item").filter({ hasText: templateName })).toHaveCount(0);

  const pageTemplateName = `E2E page ${Date.now()}`;
  const moreMenu = page.locator(".visual-more-menu");
  await moreMenu.locator(":scope > summary").click();
  await page.locator("[data-visual-save-page-template]").click();
  const savePageDialog = page.getByRole("dialog", { name: "Save page as template" });
  await savePageDialog.getByLabel("Template name").fill(pageTemplateName);
  await savePageDialog.getByRole("button", { name: "Save template" }).click();
  await expect(page.locator("[data-status]")).toContainText(`${pageTemplateName} saved as a page template.`);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator(".visual-more-menu > summary").click();
  await page.getByRole("button", { name: "Mobile", exact: true }).click();
  await library.locator(":scope > summary").click();
  await expect(page.locator(".visual-library-panel")).toBeVisible();
  const mobilePreview = await page.evaluate(() => {
    const pageShell = document.querySelector<HTMLElement>(".page-shell");
    const section = document.querySelector<HTMLElement>("[data-visual-section]");
    const libraryPanel = document.querySelector<HTMLElement>(".visual-library-panel");
    const panelBounds = libraryPanel?.getBoundingClientRect();
    return {
      pageWidth: pageShell?.getBoundingClientRect().width || 0,
      sectionWidth: section?.getBoundingClientRect().width || 0,
      sectionScrollWidth: section?.scrollWidth || 0,
      libraryLeft: panelBounds?.left || 0,
      libraryRight: panelBounds?.right || 0
    };
  });
  expect(mobilePreview.pageWidth).toBeLessThanOrEqual(390);
  expect(mobilePreview.sectionScrollWidth).toBeLessThanOrEqual(Math.ceil(mobilePreview.sectionWidth));
  expect(mobilePreview.libraryLeft).toBeGreaterThanOrEqual(0);
  expect(mobilePreview.libraryRight).toBeLessThanOrEqual(390);
  await visualSection.focus();
  const touchControlHeight = await page.locator("[data-visual-section] .visual-icon-button").first().evaluate((element) => element.getBoundingClientRect().height);
  expect(touchControlHeight).toBeGreaterThanOrEqual(40);
  await expect(page.locator("[data-visual-section] .visual-item-toolbar").first()).toBeVisible();

  await page.goto("/dashboard/pages/new");
  const createPageForm = page.locator("[data-page-create-form]");
  await expect(createPageForm).toBeVisible();
  const pageTemplateSelect = createPageForm.locator("[data-page-template-select]");
  await pageTemplateSelect.selectOption({ label: pageTemplateName });
  await createPageForm.getByLabel("Page layout").selectOption("grid");
  await createPageForm.getByLabel("Excerpt").fill("Discard this template override");
  await pageTemplateSelect.selectOption("");
  await expect(createPageForm.getByLabel("Page layout")).toHaveValue("full-width");
  await expect(createPageForm.getByLabel("Excerpt")).toHaveValue("");
  await pageTemplateSelect.selectOption({ label: pageTemplateName });
  await createPageForm.getByLabel("Title").fill("Preserve this draft title");
  let pageTemplateRow = createPageForm.locator("[data-page-template-row]").filter({ hasText: pageTemplateName });
  await pageTemplateRow.getByRole("button", { name: "Rename" }).click();
  const renamedPageTemplate = `${pageTemplateName} renamed`;
  const renameDialog = page.getByRole("dialog", { name: `Rename ${pageTemplateName}` });
  await renameDialog.getByLabel("Template name").fill(renamedPageTemplate);
  await renameDialog.getByRole("button", { name: "Save template" }).click();
  await expect(createPageForm.getByLabel("Title")).toHaveValue("Preserve this draft title");
  await expect(pageTemplateSelect.locator("option:checked")).toHaveText(renamedPageTemplate);
  pageTemplateRow = createPageForm.locator("[data-page-template-row]").filter({ hasText: renamedPageTemplate });
  await pageTemplateRow.getByRole("button", { name: `Delete ${renamedPageTemplate}` }).click();
  const deletePageDialog = page.getByRole("dialog", { name: `Delete ${renamedPageTemplate}?` });
  await deletePageDialog.getByRole("button", { name: "Delete template" }).click();
  await expect(createPageForm.getByLabel("Title")).toHaveValue("Preserve this draft title");
  await expect(createPageForm.locator("[data-page-template-row]").filter({ hasText: renamedPageTemplate })).toHaveCount(0);

  expect(browserErrors).toEqual([]);
});

test("admin pages stay contained and use compact navigation on small screens", async ({ page }) => {
  await login(page);

  for (const viewport of [
    { width: 390, height: 844 },
    { width: 768, height: 1024 }
  ]) {
    await page.setViewportSize(viewport);
    await page.goto("/dashboard/users");
    await expect(page.locator("[data-admin-layout]")).toBeVisible();
    await expect(page.locator("[data-admin-sidebar]")).toHaveClass(/collapsed/);
    await expect(page.locator(".table-card").first()).toBeVisible();

    const sizes = await page.evaluate(() => ({
      viewport: window.innerWidth,
      document: document.documentElement.scrollWidth,
      workspace: document.querySelector(".admin-workspace")?.getBoundingClientRect().width || 0
    }));
    expect(sizes.document).toBeLessThanOrEqual(sizes.viewport);
    expect(sizes.workspace).toBeLessThanOrEqual(sizes.viewport);
  }
});

test("shop customization and product creation keep advanced controls out of the primary flow", async ({ page }) => {
  await login(page);

  const browserErrors: string[] = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(message.text());
  });

  await page.getByRole("link", { name: "Shop", exact: true }).click();
  await expect(page.getByRole("navigation", { name: "Shop sections" }).getByRole("link")).toHaveCount(4);
  await expect(page.getByRole("link", { name: "Add product", exact: true })).toBeVisible();
  await page.getByRole("link", { name: "View shop", exact: true }).click();
  await expect(page).toHaveURL(/\/shop$/);
  const editShopDesign = page.getByRole("link", { name: "Edit shop design", exact: true });
  await expect(editShopDesign).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  const publicShopLayout = await page.evaluate(() => {
    const editLink = document.querySelector(".shop-admin-entry")?.getBoundingClientRect();
    const cartButton = document.querySelector("[data-commerce-cart-toggle]")?.getBoundingClientRect();
    return {
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth,
      overlapsCart: Boolean(editLink && cartButton && !(
        editLink.right <= cartButton.left ||
        editLink.left >= cartButton.right ||
        editLink.bottom <= cartButton.top ||
        editLink.top >= cartButton.bottom
      ))
    };
  });
  expect(publicShopLayout.documentWidth).toBeLessThanOrEqual(publicShopLayout.viewportWidth);
  expect(publicShopLayout.overlapsCart).toBe(false);
  await page.setViewportSize({ width: 1280, height: 720 });
  await editShopDesign.click();
  await expect(page).toHaveURL(/\/dashboard\/shop\/configuration$/);
  await expect(page.getByRole("navigation", { name: "Shop sections" }).getByRole("link", { name: "Settings", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(page.locator("[data-shop-settings-form]")).toBeVisible();
  await expect(page.getByText("Live preview", { exact: true })).toBeVisible();
  await expect(page.locator('input[name="catalogHeroMediaFile"]')).toHaveAttribute("type", "file");
  await expect(page.locator('input[name="catalogHeroMediaUrl"]')).toHaveAttribute("type", "hidden");

  await page.locator('input[name="catalogLayout"][value="compact"]').check();
  await expect(page.locator("[data-shop-preview]")).toHaveAttribute("data-catalog-layout", "compact");
  await page.locator('select[name="catalogSort"]').selectOption("price-low");
  await expect(page.locator('select[name="catalogSort"]')).toHaveValue("price-low");
  await page.locator('input[name="showDescriptions"]').uncheck();
  await expect(page.locator("[data-shop-preview-card-description]").first()).toBeHidden();
  await page.locator('input[name="catalogHeroEnabled"]').check();
  await page.locator('select[name="catalogHeroMediaType"]').selectOption("IMAGE");
  await page.locator('input[name="catalogHeroAltText"]').fill("Single pixel test storefront hero");
  await page.locator('input[name="catalogHeroCtaLabel"]').fill("Browse products");
  await page.locator('input[name="catalogHeroCtaUrl"]').fill("/shop");
  const heroMediaInput = page.locator('input[name="catalogHeroMediaFile"]');
  let shopMediaUploads = 0;
  page.on("request", (request) => {
    if (request.method() === "POST" && new URL(request.url()).pathname.endsWith("/cms/media/upload")) shopMediaUploads += 1;
  });
  await heroMediaInput.setInputFiles({
    name: "storefront-hero.png",
    mimeType: "image/png",
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      "base64"
    )
  });
  const saveStorefront = page.getByRole("button", { name: "Save storefront" });
  await Promise.all([
    page.waitForResponse((response) => response.request().method() === "PATCH" && new URL(response.url()).pathname.endsWith("/products/settings")),
    saveStorefront.click()
  ]);
  await expect(page.getByText("Storefront saved.", { exact: true })).toBeVisible();
  await expect(heroMediaInput).toHaveValue("");
  await expect(page.locator('input[name="catalogHeroMediaUrl"]')).toHaveValue(/\/uploads\//);
  expect(shopMediaUploads).toBe(1);

  await Promise.all([
    page.waitForResponse((response) => response.request().method() === "PATCH" && new URL(response.url()).pathname.endsWith("/products/settings")),
    saveStorefront.click()
  ]);
  await expect(page.getByText("Storefront saved.", { exact: true })).toBeVisible();
  expect(shopMediaUploads).toBe(1);

  await page.reload();
  await expect(page.locator("[data-shop-settings-form]")).toBeVisible();
  await expect(page.locator('select[name="catalogSort"]')).toHaveValue("price-low");
  await expect(page.locator('input[name="showDescriptions"]')).not.toBeChecked();
  await expect(page.locator('input[name="catalogHeroMediaUrl"]')).toHaveValue(/\/uploads\//);

  await page.getByRole("link", { name: "Products", exact: true }).click();
  await expect(page.getByRole("navigation", { name: "Catalog tools" })).toBeVisible();
  await page.getByRole("link", { name: "Add product", exact: true }).first().click();
  await expect(page).toHaveURL(/\/dashboard\/shop\/products\/new$/);
  await expect(page.getByRole("heading", { name: "Product details", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Product images", exact: true })).toBeVisible();
  await expect(page.locator("details").filter({ hasText: "Search and sharing" })).not.toHaveAttribute("open", "");
  await page.locator('input[name="images"]').setInputFiles({
    name: "<b>diagram.png",
    mimeType: "image/png",
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      "base64"
    )
  });
  await expect(page.locator("[data-file-preview]")).toContainText("<b>diagram.png");
  await expect(page.locator("[data-file-preview] b")).toHaveCount(0);

  await page.getByLabel("Name", { exact: true }).fill("Simple test product");
  await expect(page.getByLabel("Slug", { exact: true })).toHaveValue("simple-test-product");
  await page.locator('select[name="categoryId"]').selectOption("__new");
  await expect(page.getByLabel("New category name", { exact: true })).toBeVisible();

  expect(browserErrors).toEqual([]);
});

test("public structured tabs support keyboard navigation", async ({ page }) => {
  await page.goto("/");
  const pageRoot = page.locator("[data-page]");
  await expect(pageRoot).toHaveAttribute("data-server-rendered", "true");
  await pageRoot.evaluate((element) => {
    element.innerHTML = `
      <div data-structured-tabs>
        <div role="tablist">
          <button type="button" role="tab" id="tab-one" aria-controls="panel-one" aria-selected="true" data-structured-tab>Overview</button>
          <button type="button" role="tab" id="tab-two" aria-controls="panel-two" aria-selected="false" data-structured-tab>Details</button>
        </div>
        <article id="panel-one" role="tabpanel" aria-labelledby="tab-one" data-structured-tab-panel>Overview panel</article>
        <article id="panel-two" role="tabpanel" aria-labelledby="tab-two" data-structured-tab-panel>Details panel</article>
      </div>
    `;
  });
  await page.evaluate(async () => {
    const { enhanceStructuredTabs } = await import("/web/structured-tabs.js");
    enhanceStructuredTabs(document.querySelector("[data-page]"));
  });

  const overview = page.getByRole("tab", { name: "Overview" });
  const details = page.getByRole("tab", { name: "Details" });
  await overview.focus();
  await overview.press("ArrowRight");

  await expect(details).toBeFocused();
  await expect(details).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#panel-one")).toBeHidden();
  await expect(page.locator("#panel-two")).toBeVisible();
});

test("custom code executes in a sandbox without access to the CMS page", async ({ page }) => {
  await page.context().route("https://cdn.example.test/codey-widget.js", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/javascript",
      body: "window.codeyExternalLibraryLoaded = true;"
    });
  });
  const apiLogin = await page.request.post("/api/v1/auth/login", {
    data: { email: adminEmail, password: adminPassword }
  });
  expect(apiLogin.ok()).toBeTruthy();
  const apiLoginBody = await apiLogin.json();
  const authorization = { authorization: `Bearer ${apiLoginBody.data.tokens.accessToken}` };
  const slug = `custom-code-${Date.now()}`;

  const created = await page.request.post("/api/v1/cms/pages", {
    headers: authorization,
    data: {
      title: "Custom code isolation",
      slug,
      content: {},
      status: "PUBLISHED",
      sections: [{
        key: "widget",
        label: "Widget",
        sortOrder: 0,
        settings: { template: "custom", elementId: "custom-code" },
        blocks: [{
          key: "sandbox-widget",
          type: "EMBED",
          label: "Sandbox widget",
          value: {
            html: '<p id="sandbox-status">Starting</p>',
            css: "#sandbox-status { font: 700 18px system-ui; }",
            javascript: `
              const status = document.querySelector("#sandbox-status");
              let parentBlocked = parent === window;
              let storageBlocked = false;
              if (!parentBlocked) {
                try {
                  parent.document.body.dataset.customCodeEscaped = "true";
                } catch {
                  parentBlocked = true;
                }
              }
              try {
                localStorage.setItem("custom-code-origin-test", "unsafe");
              } catch {
                storageBlocked = true;
              }
              const dependencyLoaded = window.codeyExternalLibraryLoaded === true;
              status.textContent = parentBlocked && storageBlocked && dependencyLoaded
                ? "Ready and isolated"
                : "Origin access allowed";
            `,
            libraries: ["https://cdn.example.test/codey-widget.js"],
            height: 240
          },
          settings: { elementId: "custom-code" },
          sortOrder: 0,
          editable: true
        }]
      }]
    }
  });
  expect(created.ok()).toBeTruthy();
  const createdBody = await created.json();
  const blockId = createdBody.data.page.sections[0].blocks[0].id;

  try {
    const frameResponsePromise = page.waitForResponse((response) =>
      response.url().includes("/api/v1/cms/custom-code/")
    );
    const response = await page.goto(`/${slug}`);
    expect(response?.headers()["content-security-policy"]).toContain("frame-src 'self' blob:");
    expect(response?.headers()["content-security-policy"]).not.toContain("frame-src 'self' blob: data:");
    const frameResponse = await frameResponsePromise;
    expect(frameResponse.headers()["content-security-policy"]).toContain("sandbox allow-scripts allow-forms");
    expect(frameResponse.headers()["content-security-policy"]).not.toContain("allow-same-origin");
    const frame = page.locator("[data-custom-code-frame]").contentFrame();
    await expect(frame.getByText("Ready and isolated", { exact: true })).toBeVisible();
    await expect(page.locator("body")).not.toHaveAttribute("data-custom-code-escaped", "true");

    const directPage = await page.context().newPage();
    try {
      const directResponse = await directPage.goto(`/api/v1/cms/custom-code/${blockId}`);
      expect(directResponse?.headers()["content-security-policy"]).toContain("sandbox allow-scripts allow-forms");
      await expect(directPage.getByText("Ready and isolated", { exact: true })).toBeVisible();
    } finally {
      await directPage.close();
    }

    const archived = await page.request.post(`/api/v1/cms/pages/${slug}/archive`, {
      headers: authorization
    });
    expect(archived.ok()).toBeTruthy();
    const archivedCode = await page.request.get(`/api/v1/cms/custom-code/${blockId}`);
    expect(archivedCode.status()).toBe(404);
  } finally {
    await page.request.delete(`/api/v1/cms/pages/${slug}`, {
      headers: authorization
    });
  }
});

test("premium 3D scenes and 360 panoramas render, move, pause, and remain framed", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Canvas pixel acceptance runs once in Chromium.");
  const visualOutput = process.env.CODEY_VISUAL_OUTPUT?.replace(/\/$/, "");
  const apiLogin = await page.request.post("/api/v1/auth/login", {
    data: { email: adminEmail, password: adminPassword }
  });
  expect(apiLogin.ok()).toBeTruthy();
  const apiLoginBody = await apiLogin.json();
  const authorization = { authorization: `Bearer ${apiLoginBody.data.tokens.accessToken}` };
  const slug = `three-scene-${Date.now()}`;
  const modelUpload = await page.request.post("/api/v1/cms/media/upload", {
    headers: authorization,
    data: {
      filename: "acceptance-model.glb",
      mimeType: "model/gltf-binary",
      kind: "OTHER",
      dataBase64: triangleGlb().toString("base64"),
      altText: "Browser acceptance 3D model"
    }
  });
  expect(modelUpload.ok()).toBeTruthy();
  const modelUploadBody = await modelUpload.json();
  const modelAsset = modelUploadBody.data.asset;
  const panoramaUpload = await page.request.post("/api/v1/cms/media/upload", {
    headers: authorization,
    data: {
      filename: "acceptance-panorama.png",
      mimeType: "image/png",
      kind: "IMAGE",
      dataBase64: (await panoramaPng()).toString("base64"),
      altText: "Colorful 360-degree acceptance landscape"
    }
  });
  expect(panoramaUpload.ok()).toBeTruthy();
  const panoramaUploadBody = await panoramaUpload.json();
  const panoramaAsset = panoramaUploadBody.data.asset;
  const created = await page.request.post("/api/v1/cms/pages", {
    headers: authorization,
    data: {
      title: "Dimensional studio",
      slug,
      content: {},
      status: "PUBLISHED",
      sections: [{
        key: "visual-intro",
        label: "Dimensional introduction",
        sortOrder: 0,
        settings: {
          template: "custom",
          layout: "one-column",
          container: "wide",
          spacing: "sm",
          minHeight: 1200
        },
        blocks: [{
          key: "visual-intro-copy",
          type: "TEXT",
          label: "Introduction",
          value: "Scroll to explore the dimensional studio.",
          sortOrder: 0,
          editable: true
        }]
      }, {
        key: "three-stage",
        label: "3D experience",
        sortOrder: 1,
        settings: {
          template: "custom",
          elementId: "three-scene",
          layout: "full-bleed",
          container: "wide",
          spacing: "lg",
          animation: { effect: "fade-up", durationMs: 320, delayMs: 0 }
        },
        blocks: [{
          key: "three-scene",
          type: "CUSTOM",
          label: "3D scene",
          value: {
            variant: "three-scene",
            title: "Form in motion",
            body: "A responsive Three.js scene with a semantic server-rendered introduction.",
            display: {
              preset: "product-stage",
              tone: "dark",
              accent: "#c9ff67",
              motion: "dynamic",
              interactive: true,
              ratio: "16 / 10",
              camera: "close",
              lighting: "dramatic",
              finish: "chrome"
            }
          },
          settings: { elementId: "three-scene" },
          sortOrder: 0,
          editable: true
        }, {
          key: "three-model",
          type: "CUSTOM",
          label: "3D model",
          value: {
            variant: "three-model",
            title: "Uploaded model",
            body: "This GLB is loaded from CMS-managed storage.",
            modelUrl: modelAsset.url,
            modelAssetId: modelAsset.id,
            display: {
              preset: "product-stage",
              tone: "light",
              accent: "#087f76",
              motion: "none",
              interactive: true,
              ratio: "4 / 3",
              camera: "front",
              lighting: "soft",
              finish: "brand"
            }
          },
          settings: { elementId: "three-model" },
          sortOrder: 1,
          editable: true
        }, {
          key: "three-panorama",
          type: "CUSTOM",
          label: "360 panorama",
          value: {
            variant: "three-panorama",
            title: "Explore the full space",
            body: "Use the arrow keys or drag to look around the panorama.",
            image: {
              url: panoramaAsset.url,
              alt: panoramaAsset.altText,
              width: panoramaAsset.width,
              height: panoramaAsset.height
            },
            display: {
              tone: "dark",
              motion: "none",
              interactive: true,
              ratio: "16 / 9",
              startView: "left"
            }
          },
          settings: { elementId: "three-panorama" },
          sortOrder: 2,
          editable: true
        }]
      }]
    }
  });
  expect(created.ok()).toBeTruthy();

  try {
    let threeRuntimeRequested = false;
    page.on("request", (request) => {
      if (request.url().endsWith("/vendor/three-runtime.js")) threeRuntimeRequested = true;
    });
    const motionRuntime = page.waitForResponse((response) => response.url().endsWith("/vendor/motion-runtime.js"));
    await page.goto(`/${slug}`);
    await motionRuntime;
    await page.waitForTimeout(150);
    expect(threeRuntimeRequested).toBeFalsy();

    const stages = page.locator("[data-three-scene]");
    const stage = stages.first();
    const canvas = stage.locator("canvas[data-three-canvas]");
    await expect(page.getByRole("heading", { name: "Form in motion" })).toBeVisible();
    const threeRuntime = page.waitForResponse((response) => response.url().endsWith("/vendor/three-runtime.js"));
    await stage.scrollIntoViewIfNeeded();
    await threeRuntime;
    await expect(stage).toHaveAttribute("data-three-status", "ready");
    await expect(canvas).toBeVisible();
    const modelStage = stages.nth(1);
    await modelStage.scrollIntoViewIfNeeded();
    await expect(modelStage).toHaveAttribute("data-three-model-status", "ready");
    const modelPixels = await canvasSignature(modelStage.locator("canvas[data-three-canvas]"));
    expect(modelPixels.colors).toBeGreaterThan(3);
    expect(modelPixels.range).toBeGreaterThan(20);
    const panoramaStage = stages.nth(2);
    await panoramaStage.scrollIntoViewIfNeeded();
    await expect(panoramaStage).toHaveAttribute("data-three-panorama-status", "ready");
    const panoramaCanvas = panoramaStage.locator("canvas[data-three-canvas]");
    const panoramaPixels = await canvasSignature(panoramaCanvas);
    expect(panoramaPixels.colors).toBeGreaterThan(8);
    expect(panoramaPixels.range).toBeGreaterThan(30);
    await panoramaStage.focus();
    const panoramaBefore = await canvasSignature(panoramaCanvas);
    await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(80);
    expect(canvasDifference(panoramaBefore, await canvasSignature(panoramaCanvas))).toBeGreaterThan(0.5);
    await testInfo.attach("three-panorama-desktop", {
      body: await page.screenshot({ path: visualOutput ? `${visualOutput}/codey-panorama-desktop.png` : undefined }),
      contentType: "image/png"
    });
    await stage.evaluate((element) => element.scrollIntoView({ block: "center" }));
    await page.waitForTimeout(120);
    await expect(page.locator(".codey-animate")).toHaveAttribute("data-motion-enhanced", "true");

    const desktopPixels = await canvasSignature(canvas);
    expect(desktopPixels.width).toBeGreaterThan(500);
    expect(desktopPixels.height).toBeGreaterThan(300);
    expect(desktopPixels.colors).toBeGreaterThan(8);
    expect(desktopPixels.range).toBeGreaterThan(30);
    await testInfo.attach("three-scene-desktop", {
      body: await page.screenshot({ path: visualOutput ? `${visualOutput}/codey-three-desktop.png` : undefined }),
      contentType: "image/png"
    });

    const beforeMotion = await canvasSignature(canvas);
    await page.waitForTimeout(280);
    const afterMotion = await canvasSignature(canvas);
    expect(canvasDifference(beforeMotion, afterMotion)).toBeGreaterThan(0.5);

    const motionToggle = page.locator("[data-three-toggle]");
    await expect(motionToggle).toHaveAccessibleName("Pause motion");
    await motionToggle.click();
    await expect(motionToggle).toHaveAccessibleName("Play motion");
    await page.waitForTimeout(80);
    const paused = await canvasSignature(canvas);
    await page.waitForTimeout(280);
    expect(canvasDifference(paused, await canvasSignature(canvas))).toBeLessThan(0.5);

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(stage).toBeVisible();
    await stage.evaluate((element) => element.scrollIntoView({ block: "center" }));
    await page.waitForTimeout(120);
    const mobileFrame = await stage.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      return {
        top: bounds.top,
        right: bounds.right,
        bottom: bounds.bottom,
        left: bounds.left,
        viewportHeight: window.innerHeight,
        viewportWidth: window.innerWidth
      };
    });
    expect(mobileFrame.top).toBeLessThan(mobileFrame.viewportHeight);
    expect(mobileFrame.bottom).toBeGreaterThan(0);
    expect(mobileFrame.left).toBeLessThan(mobileFrame.viewportWidth);
    expect(mobileFrame.right).toBeGreaterThan(0);
    const mobilePixels = await canvasSignature(canvas);
    expect(mobilePixels.width).toBeGreaterThan(300);
    expect(mobilePixels.height).toBeGreaterThan(220);
    expect(mobilePixels.colors).toBeGreaterThan(8);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    await testInfo.attach("three-scene-mobile", {
      body: await page.screenshot({ path: visualOutput ? `${visualOutput}/codey-three-mobile.png` : undefined }),
      contentType: "image/png"
    });

    await panoramaStage.evaluate((element) => element.scrollIntoView({ block: "center" }));
    await page.waitForTimeout(120);
    const mobilePanoramaFrame = await panoramaStage.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      return {
        top: bounds.top,
        right: bounds.right,
        bottom: bounds.bottom,
        left: bounds.left,
        viewportHeight: window.innerHeight,
        viewportWidth: window.innerWidth
      };
    });
    expect(mobilePanoramaFrame.top).toBeLessThan(mobilePanoramaFrame.viewportHeight);
    expect(mobilePanoramaFrame.bottom).toBeGreaterThan(0);
    expect(mobilePanoramaFrame.left).toBeLessThan(mobilePanoramaFrame.viewportWidth);
    expect(mobilePanoramaFrame.right).toBeGreaterThan(0);
    const mobilePanoramaPixels = await canvasSignature(panoramaCanvas);
    expect(mobilePanoramaPixels.width).toBeGreaterThan(300);
    expect(mobilePanoramaPixels.height).toBeGreaterThan(220);
    expect(mobilePanoramaPixels.colors).toBeGreaterThan(8);
    await testInfo.attach("three-panorama-mobile", {
      body: await page.screenshot({ path: visualOutput ? `${visualOutput}/codey-panorama-mobile.png` : undefined }),
      contentType: "image/png"
    });
  } finally {
    await page.request.delete(`/api/v1/cms/pages/${slug}`, { headers: authorization });
    await page.request.delete(`/api/v1/cms/media/${modelAsset.id}`, { headers: authorization });
    await page.request.delete(`/api/v1/cms/media/${panoramaAsset.id}`, { headers: authorization });
  }
});

test("public pages are useful without JavaScript and missing routes return 404", async ({ browser, baseURL }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();

  try {
    const home = await page.goto(`${baseURL}/`);
    expect(home?.status()).toBe(200);
    await expect(page.getByRole("heading", { name: "Home" })).toBeVisible();
    await expect(page.getByText("Start editing this page directly from the website.")).toBeVisible();

    const shop = await page.goto(`${baseURL}/shop`);
    expect(shop?.status()).toBe(200);
    await expect(page.getByRole("heading", { name: "Shop" })).toBeVisible();
    await expect(page.getByText("Starter Product", { exact: true }).first()).toBeVisible();

    const product = await page.goto(`${baseURL}/product/starter-product`);
    expect(product?.status()).toBe(200);
    await expect(page.getByRole("heading", { name: "Starter Product" })).toBeVisible();

    const buyerAccount = await page.goto(`${baseURL}/account/orders`);
    expect(buyerAccount?.status()).toBe(200);
    await expect(page.getByRole("heading", { name: "Your orders", exact: true })).toBeVisible();
    await expect(page.getByText("Purchases on this device", { exact: true })).toBeVisible();
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex, nofollow");

    const missing = await page.goto(`${baseURL}/browser-test-missing-page`);
    expect(missing?.status()).toBe(404);
    await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex, nofollow");
  } finally {
    await context.close();
  }
});
