import assert from "node:assert/strict";
import test from "node:test";
import { completeOwnerSetup } from "../apps/web/web/install-flow.js";
import { browserStorage } from "../apps/web/web/browser-storage.js";
import { selectSettingsTab } from "../apps/web/web/settings-navigation.js";

const input = { siteName: "Owner site", admin: { email: "owner@example.test", password: "owner-test-password" } };

test("disabled browser storage does not interrupt setup or sign-in hints", () => {
  assert.equal(browserStorage.getItem("cms_session_hint"), null);
  assert.doesNotThrow(() => browserStorage.setItem("cms_session_hint", "1"));
  assert.doesNotThrow(() => browserStorage.removeItem("cms_session_hint"));
});

test("settings links select only known tabs and ignore missing settings views", () => {
  const inputs = new Map(["settings-tab-launch", "settings-tab-updates"].map((id) => [id, { checked: false }]));
  const root = { getElementById: (id: string) => inputs.get(id) };
  assert.equal(selectSettingsTab("#updates", root), true);
  assert.equal(inputs.get("settings-tab-updates")?.checked, true);
  assert.equal(selectSettingsTab("#unknown", root), true);
  assert.equal(inputs.get("settings-tab-launch")?.checked, true);
  assert.equal(selectSettingsTab("#updates", {}), false);
});

test("owner setup installs once and then authenticates", async () => {
  const paths: string[] = [];
  const result = await completeOwnerSetup(async (path: string) => {
    paths.push(path);
    return { data: { tokens: { accessToken: "session" } } };
  }, input);
  assert.deepEqual(paths, ["/install/complete", "/auth/login"]);
  assert.deepEqual(result, { installed: true, signedIn: true });
});

test("setup reconciles a lost response without repeating installation", async () => {
  const paths: string[] = [];
  const result = await completeOwnerSetup(async (path: string) => {
    paths.push(path);
    if (path === "/install/complete") throw new Error("Connection lost");
    return { data: { installed: true, tokens: { accessToken: "session" } } };
  }, input);
  assert.equal(result.signedIn, true);
  assert.deepEqual(paths, ["/install/complete", "/install/status", "/auth/login"]);
});

test("login failures and MFA challenges leave a completed installation at sign-in", async () => {
  for (const fails of [true, false]) {
    const result = await completeOwnerSetup(async (path: string) => {
      if (path === "/auth/login" && fails) throw new Error("Login unavailable");
      return { data: { mfaRequired: true } };
    }, input);
    assert.deepEqual(result, { installed: true, signedIn: false });
  }
});

test("unconfirmed installation failure preserves the original error and does not attempt login", async () => {
  for (const unavailable of [false, true]) {
    const error = new Error("Invalid claim token");
    await assert.rejects(completeOwnerSetup(async (path: string) => {
      assert.notEqual(path, "/auth/login");
      if (path === "/install/complete" || unavailable) throw error;
      return { data: { installed: false } };
    }, input), error);
  }
});
