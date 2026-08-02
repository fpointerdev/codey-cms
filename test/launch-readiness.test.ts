import assert from "node:assert/strict";
import test from "node:test";
import { buildLaunchReadiness } from "../src/modules/config/launch-readiness.js";

function publicSite(overrides: Record<string, unknown> = {}) {
  return {
    publicUrl: "https://www.example.com",
    siteUrl: "https://www.example.com",
    searchIndexing: true,
    sitemapEnabled: true,
    metaDescription: "A complete public website.",
    storageDriver: "s3" as const,
    email: {
      configured: true,
      recoveryEnabled: true,
      lastTestSucceeded: true
    },
    backup: {
      status: "pass" as const,
      blocking: false,
      details: { offsiteProtected: true }
    },
    ownerMfaEnabled: true,
    updatesEnabled: true,
    ...overrides
  };
}

test("a public site is ready only when every launch protection passes", () => {
  const readiness = buildLaunchReadiness(publicSite());

  assert.equal(readiness.status, "ready");
  assert.equal(readiness.target, "public");
  assert.equal(readiness.summary.blocked, 0);
  assert.ok(readiness.checks.every((check) => check.status === "pass"));
});

test("public launch is blocked by recovery, backup, MFA, and metadata gaps", () => {
  const readiness = buildLaunchReadiness(publicSite({
    metaDescription: "",
    email: { configured: true, recoveryEnabled: false, lastTestSucceeded: true },
    backup: {
      status: "fail",
      blocking: true,
      message: "Off-site backup protection has not been confirmed.",
      details: { offsiteProtected: false }
    },
    ownerMfaEnabled: false
  }));

  assert.equal(readiness.status, "blocked");
  assert.deepEqual(
    readiness.checks.filter((check) => check.status === "blocked").map((check) => check.id),
    ["metadata", "email", "backup", "owner-mfa"]
  );
});

test("public search indexing requires a sitemap", () => {
  const readiness = buildLaunchReadiness(publicSite({ sitemapEnabled: false }));
  const seo = readiness.checks.find((check) => check.id === "seo");

  assert.equal(readiness.status, "blocked");
  assert.equal(seo?.status, "blocked");
  assert.match(seo?.message || "", /sitemap/i);
});

test("local installations show setup actions without pretending to be public", () => {
  const readiness = buildLaunchReadiness(publicSite({
    publicUrl: "http://localhost:4000",
    siteUrl: "",
    email: { configured: false, recoveryEnabled: false },
    backup: { status: "skipped", blocking: false },
    ownerMfaEnabled: false,
    storageDriver: "local"
  }));

  assert.equal(readiness.status, "attention");
  assert.equal(readiness.target, "local");
  assert.equal(readiness.summary.blocked, 0);
  assert.ok(readiness.summary.actions >= 3);
});
