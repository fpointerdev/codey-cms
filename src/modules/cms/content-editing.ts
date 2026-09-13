import { isDeepStrictEqual } from "node:util";
import type { Prisma, PrismaClient } from "@prisma/client";
import { AppError } from "../../core/errors/app-error.js";

type Database = PrismaClient | Prisma.TransactionClient;
export type EditingUser = { id: string; permissions?: Array<{ action: string; subject: string }> };
export type EditingPolicy = "standard" | "protected";

export const contentEditingContract = {
  version: "1.0",
  scope: "pages-and-posts",
  policies: ["standard", "protected"],
  defaultPolicy: "standard",
  structurePermission: "design:cms",
  publishPermission: "publish:cms",
  concurrency: { field: "expectedUpdatedAt", source: "updatedAt", requiredWhenProtected: true },
  publishedEditsRequirePublish: true,
  separateLiveDraft: false,
  contentFields: [
    "title", "heading", "subtitle", "subheading", "eyebrow", "kicker", "text", "body",
    "description", "caption", "alt", "altText", "imageAlt", "imageAltText", "label",
    "name", "role", "quote", "attribution", "author", "value", "price", "firstValue",
    "secondValue", "firstColumnTitle", "secondColumnTitle", "url", "href", "link",
    "imageUrl", "posterUrl", "buttonLabel", "buttonText", "buttonUrl", "ctaLabel", "ctaUrl",
    "category", "footerText", "subject", "mediaAssetId"
  ],
  containers: [
    "items", "slides", "cards", "features", "stats", "metrics", "people", "logos",
    "quotes", "plans", "steps", "rows", "links", "image", "poster", "cta", "button",
    "primaryCta", "secondaryCta", "primaryButton", "secondaryButton"
  ]
} as const;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}

export function editingPolicy(value: unknown): EditingPolicy {
  return value === "protected" ? "protected" : "standard";
}

export async function readEditingPolicy(database: Database): Promise<EditingPolicy> {
  const setting = await database.moduleSetting.findFirst({
    where: { moduleId: "config", key: "site", site: { slug: "default" } },
    select: { value: true }
  });
  return editingPolicy(record(setting?.value).editingPolicy);
}

export function hasEditingPermission(user: EditingUser | undefined, action: string) {
  return Boolean(user?.permissions?.some((permission) =>
    permission.action === "manage" && ["all", "cms"].includes(permission.subject) ||
    permission.action === action && permission.subject === "cms"
  ));
}

export function editingCapabilities(policy: EditingPolicy, user?: EditingUser) {
  return {
    ...contentEditingContract,
    policy,
    canDesign: policy === "standard" || hasEditingPermission(user, "design"),
    canPublish: policy === "standard" || hasEditingPermission(user, "publish")
  };
}

export function requireEditingPermission(policy: EditingPolicy, user: EditingUser | undefined, action: "design" | "publish") {
  if (policy === "protected" && !hasEditingPermission(user, action)) {
    throw new AppError(403, `cms_${action}_forbidden`, action === "design"
      ? "This site's design is protected. Design access is required for this change."
      : "Publishing access is required to change published content or its publication state.");
  }
}

// Content editors keep the existing collection shape and all unrecognized configuration.
function protectedValue(value: unknown, media = false): unknown {
  if (Array.isArray(value)) return value.map((item) =>
    item && typeof item === "object" ? protectedValue(item, media) : null
  );
  if (!value || typeof value !== "object") return value;
  const result: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(record(value))) {
    if (media && ["width", "height"].includes(key) && typeof child === "number") continue;
    if ((contentEditingContract.contentFields as readonly string[]).includes(key) &&
        (child === null || ["string", "number", "boolean"].includes(typeof child))) continue;
    if (["image", "poster"].includes(key)) {
      const protectedMedia = typeof child === "string" || child == null ? {} : protectedValue(child, true);
      if (!isDeepStrictEqual(protectedMedia, {})) result[key] = protectedMedia;
    } else {
      result[key] = (contentEditingContract.containers as readonly string[]).includes(key)
        ? protectedValue(child, media) : child;
    }
  }
  return result;
}

function assertSame(previous: unknown, next: unknown) {
  if (!isDeepStrictEqual(previous ?? null, next ?? null)) {
    throw new AppError(403, "cms_design_forbidden", "This change would alter protected layout or configuration. Only content and existing media can be edited.");
  }
}

export function assertContentOnlyBlock(previous: Record<string, unknown>, next: Record<string, unknown>) {
  for (const key of ["key", "type", "label", "sortOrder", "editable"]) assertSame(previous[key], next[key]);
  assertSame(previous.settings || {}, next.settings || {});
  if (previous.editable === false || previous.type === "EMBED") {
    assertSame(previous.value, next.value);
    assertSame(previous.mediaAssetId, next.mediaAssetId);
    return;
  }
  if (["TEXT", "RICH_TEXT"].includes(String(previous.type)) && typeof previous.value === "string" && typeof next.value === "string") return;
  const media = ["IMAGE", "GALLERY"].includes(String(previous.type));
  assertSame(protectedValue(previous.value, media), protectedValue(next.value, media));
}

export function assertContentOnlyUpdate(previous: Record<string, unknown>, input: Record<string, unknown>) {
  for (const key of ["slug", "locale", "translationGroupId"]) {
    if (input[key] !== undefined) assertSame(previous[key], input[key]);
  }
  for (const key of ["content", "seo"]) {
    if (input[key] !== undefined) assertSame(protectedValue(previous[key] || {}), protectedValue(input[key]));
  }
  if (input.sections === undefined) return;
  const before = previous.sections as Array<Record<string, unknown>>;
  const after = input.sections as Array<Record<string, unknown>>;
  assertSame(before.length, after.length);
  before.forEach((section, index) => {
    const next = after[index];
    for (const key of ["key", "label", "sortOrder"]) assertSame(section[key], next[key]);
    assertSame(section.settings || {}, next.settings || {});
    const blocks = section.blocks as Array<Record<string, unknown>>;
    const nextBlocks = next.blocks as Array<Record<string, unknown>>;
    assertSame(blocks.length, nextBlocks.length);
    blocks.forEach((block, blockIndex) => assertContentOnlyBlock(block, nextBlocks[blockIndex]));
  });
}

export function assertPublicationChange(policy: EditingPolicy, user: EditingUser | undefined, previous: { status?: string; publishedAt?: unknown }, input: { status?: string; publishedAt?: unknown }) {
  if (previous.status === "PUBLISHED" || previous.publishedAt != null || input.status !== undefined && input.status !== previous.status ||
      input.publishedAt !== undefined && String(input.publishedAt) !== String(previous.publishedAt)) {
    requireEditingPermission(policy, user, "publish");
  }
}

export async function claimContentVersion(
  model: { updateMany: (args: { where: { id: string; updatedAt?: Date }; data: { updatedAt: Date } }) => Promise<{ count: number }> },
  content: { id: string; updatedAt: Date },
  expectedUpdatedAt: string | undefined,
  required: boolean
) {
  if (required && !expectedUpdatedAt) {
    throw new AppError(428, "cms_version_required", "Reload this content before saving. Its current version is required.");
  }
  const expected = expectedUpdatedAt ? new Date(expectedUpdatedAt) : undefined;
  if (expected && (!Number.isFinite(expected.getTime()) || expected.getTime() !== content.updatedAt.getTime())) {
    throw new AppError(409, "cms_content_conflict", "Someone else changed this content. Reload and review their changes before saving again.");
  }
  const updatedAt = new Date(Math.max(Date.now(), content.updatedAt.getTime() + 1));
  const result = await model.updateMany({
    where: { id: content.id, updatedAt: expected || content.updatedAt },
    data: { updatedAt }
  });
  if (result.count !== 1) {
    throw new AppError(409, "cms_content_conflict", "Someone else changed this content. Reload and review their changes before saving again.");
  }
  return updatedAt;
}
