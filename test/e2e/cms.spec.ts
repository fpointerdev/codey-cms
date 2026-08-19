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
  await homeRow.getByRole("link", { name: "Backend builder" }).click();
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

  await page.getByRole("link", { name: "Settings" }).click();
  await expect(page).toHaveURL(/\/dashboard\/settings$/);
  await page.locator('label[for="settings-tab-security"]').click();
  await expect(page.getByRole("heading", { name: "Security activity" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Account security" })).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("link", { name: "Account security" }).click();
  await expect(page.locator("[data-mfa-panel]")).toBeVisible();
  const horizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(horizontalOverflow).toBeLessThanOrEqual(1);
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
  await homeRow.getByRole("link", { name: "Backend builder" }).click();
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
  await homeRow.getByRole("link", { name: "Backend builder" }).click();
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
  await homeRow.getByRole("link", { name: "Backend builder" }).click();
  await page.getByRole("link", { name: "Visual editor", exact: true }).click();
  await expect(page).toHaveURL(/[?&]edit=1(?:&|$)/);
  await expect(page.locator("[data-editor-ui].visual-editor-bar")).toBeVisible();
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
  await page.getByRole("link", { name: "Customize", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard\/shop\/configuration$/);
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
  await page.getByRole("link", { name: "Create Product", exact: true }).first().click();
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
