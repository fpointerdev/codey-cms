import { expect, test } from "@playwright/test";

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

test("admin settings and builder controls complete their primary workflows", async ({ page }) => {
  await login(page);

  const browserErrors: string[] = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(message.text());
  });

  await page.getByRole("link", { name: "Settings" }).click();
  await expect(page).toHaveURL(/\/dashboard\/settings$/);
  await page.getByText("Email", { exact: true }).click();
  await expect(page.locator("[data-email-settings-form]")).toBeVisible();
  await expect(page.getByLabel("Bearer token")).toHaveAttribute("type", "password");
  await expect(page.getByText(/Transactional email (configured|not configured)/)).toBeVisible();

  await page.getByRole("link", { name: "Pages" }).click();
  const homeRow = page.getByRole("row").filter({
    has: page.getByRole("link", { name: "Home", exact: true })
  });
  await homeRow.getByRole("link", { name: "Backend builder" }).click();
  await expect(page).toHaveURL(/\/dashboard\/pages\/home\/builder/);
  const builder = page.locator("[data-page-builder]");
  await expect(builder).toBeVisible();
  await expect(page.getByRole("group", { name: "Canvas history" })).toBeVisible();
  await expect(page.getByRole("group", { name: "Preview device" })).toBeVisible();
  await expect(page.getByText("Reusable sections", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Delete Hero", exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Mobile", exact: true }).click();
  await expect(page.getByRole("button", { name: "Mobile", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("[data-builder-canvas-dropzone]")).toHaveAttribute("data-builder-preview-device", "mobile");

  const sectionCount = await page.locator("[data-builder-section]").count();
  await page.getByRole("button", { name: "Add container" }).click();
  const containerDialog = page.getByRole("dialog", { name: "Choose container layout" });
  await expect(containerDialog).toBeVisible();
  await containerDialog.getByRole("button", { name: "Add container" }).click();
  await expect(page.locator("[data-builder-section]")).toHaveCount(sectionCount + 1);
  await page.getByRole("button", { name: "Undo last canvas change" }).click();
  await expect(page.locator("[data-builder-section]")).toHaveCount(sectionCount);

  const blockCount = await page.locator("[data-builder-block-key]").count();
  await page.locator("[data-builder-block-key]").first().getByRole("button", { name: "Duplicate" }).click();
  await expect(page.locator("[data-builder-block-key]")).toHaveCount(blockCount + 1);
  await page.getByRole("button", { name: "Undo last canvas change" }).click();
  await expect(page.locator("[data-builder-block-key]")).toHaveCount(blockCount);

  expect(browserErrors).toEqual([]);
});

test("shop customization and product creation keep advanced controls out of the primary flow", async ({ page }) => {
  await login(page);

  const browserErrors: string[] = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(message.text());
  });

  await page.getByRole("link", { name: "Shop", exact: true }).click();
  await page.getByRole("link", { name: "Customize", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard\/shop\/configuration$/);
  await expect(page.locator("[data-shop-settings-form]")).toBeVisible();
  await expect(page.getByText("Live preview", { exact: true })).toBeVisible();

  await page.locator('input[name="catalogLayout"][value="compact"]').check();
  await expect(page.locator("[data-shop-preview]")).toHaveAttribute("data-catalog-layout", "compact");

  await page.getByRole("link", { name: "Products", exact: true }).click();
  await page.getByRole("link", { name: "Create Product", exact: true }).click();
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
  await page.locator("[data-page]").evaluate((element) => {
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

    const missing = await page.goto(`${baseURL}/browser-test-missing-page`);
    expect(missing?.status()).toBe(404);
    await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex, nofollow");
  } finally {
    await context.close();
  }
});
