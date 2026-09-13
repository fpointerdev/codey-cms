import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";

test("owner setup keeps an installed site recoverable when automatic sign-in fails", async ({ page }) => {
  const html = await readFile("apps/web/install.html", "utf8");
  let installs = 0;
  await page.route("**/install", (route) => route.fulfill({ contentType: "text/html", body: html }));
  await page.route("**/api/v1/install/status", (route) => route.fulfill({ json: { success: true, data: {
    installed: false, runtimeVersion: "1.5.0", channel: "stable", defaultProfile: "cms", claimTokenRequired: true,
    requirements: { database: "Connected", storage: "local" }
  } } }));
  await page.route("**/api/v1/install/complete", (route) => {
    installs += 1;
    return route.fulfill({ json: { success: true, data: { installed: true } } });
  });
  await page.route("**/api/v1/auth/login", (route) => route.fulfill({ status: 503, json: { success: false, error: { message: "Temporarily unavailable" } } }));
  await page.goto("/install#token=browser-install-test-token");
  await expect(page).not.toHaveURL(/token=/);
  await page.getByLabel("Site name", { exact: true }).fill("Owner website");
  await page.getByLabel("Your name", { exact: true }).fill("Owner");
  await page.getByLabel("Email", { exact: true }).fill("owner@example.com");
  await page.getByLabel("Password", { exact: true }).fill("OwnerPassword123!");
  await page.getByLabel("Confirm password", { exact: true }).fill("OwnerPassword123!");
  await page.getByRole("button", { name: "Install CodeY CMS" }).click();
  await expect(page.getByRole("heading", { name: "Your website is installed" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Sign in", exact: true })).toHaveAttribute("href", "/cy-admin");
  await expect(page.locator("[data-install-form]")).toBeHidden();
  expect(installs).toBe(1);
});

test("owner handover report and backup controls are usable on desktop and mobile", async ({ page }, testInfo) => {
  await page.goto("/cy-admin");
  await page.getByLabel("Email", { exact: true }).fill(process.env.INTEGRATION_ADMIN_EMAIL || "integration-owner@example.com");
  await page.getByLabel("Password", { exact: true }).fill(process.env.INTEGRATION_ADMIN_PASSWORD || "IntegrationOwner123!");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  let requested = false;
  await page.route("**/api/v1/config/backup", async (route) => {
    if (route.request().method() === "POST") requested = true;
    await route.fulfill({ json: { success: true, data: {
      control: { available: true, canRequest: !requested, busy: false, status: requested ? "succeeded" : "idle" },
      health: { status: "fail", blocking: true, message: "Off-site protection is not configured.", details: { offsiteProtected: false } }
    } } });
  });
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/dashboard/settings#launch");
    await expect(page.locator("[data-launch-readiness]")).toBeVisible();
    await expect(page.locator("[data-launch-readiness]")).not.toContainText("Ready to publish");
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download handover report" }).click();
    const download = await downloadPromise;
    const file = await download.path();
    const report = JSON.parse(await readFile(file!, "utf8"));
    expect(report.contract).toBe("codey-cms.owner-handover");
    expect(report.readiness.evidence.ownerJourneyVerified).toBe(false);
    expect(report.readiness.evidence.restoreDrillVerified).toBe(false);
    await page.locator('label[for="settings-tab-updates"]').click();
    if (!requested) await page.getByRole("button", { name: "Create backup", exact: true }).click();
    await expect(page.locator("[data-backup-message]")).toContainText("requested backup completed");
    await expect(page.locator("[data-backup-panel]")).not.toContainText("Backups are protected off-site");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBeTruthy();
    await page.screenshot({ path: `/private/tmp/codey-owner-handover-${testInfo.project.name}-${width}.png`, fullPage: true });
  }
});
