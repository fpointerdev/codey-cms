import { Prisma, type PrismaClient } from "@prisma/client";
import { z } from "zod";
import { AppError } from "../../core/errors/app-error.js";
import {
  canonicalExtensionJson,
  extensionManifestSha256
} from "../../extensions/extension-integrity.js";
import {
  extensionManifestSchema,
  type ExtensionManifest
} from "../../extensions/extension-manifest.js";
import { compareSemanticVersions } from "../../extensions/extension-registry.js";
import { sanitizeRichText } from "./rich-text-sanitizer.js";
import {
  createContentCollectionSchema,
  contentBundleSchema,
  type ContentEntryQuery,
  type ContentBundle,
  type ContentField,
  type CreateContentCollectionInput,
  type CreateContentEntryInput,
  type UpdateContentCollectionInput,
  type UpdateContentEntryInput
} from "./content-models.schemas.js";

type ContentModelDatabase = PrismaClient | Prisma.TransactionClient;
type RequestUser = { id: string };
type EntryListQuery = Omit<ContentEntryQuery, "filter" | "sortBy" | "sortOrder"> &
  Partial<Pick<ContentEntryQuery, "filter" | "sortBy" | "sortOrder">>;

type ExtensionChangePlan = {
  status: "available" | "installed" | "updateAvailable" | "customized" | "conflict" | "versionConflict" | "ahead" | "receiptInvalid";
  installedVersion: string | null;
  availableVersion: string;
  installedDigest: string | null;
  availableDigest: string;
  added: string[];
  updated: string[];
  removed: string[];
  customized: string[];
  conflicts: string[];
};

type EntrySnapshot = {
  title: string;
  slug: string;
  locale: string;
  data: Record<string, unknown>;
  status: "DRAFT" | "PUBLISHED" | "ARCHIVED";
  publishedAt: string | null;
};

const extensionInstallationReceiptSelect = {
  id: true,
  extensionId: true,
  version: true,
  manifestSha256: true,
  installedAt: true,
  updatedAt: true
} satisfies Prisma.CmsExtensionInstallationSelect;

function json(value: unknown) {
  return value as Prisma.InputJsonValue;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isEmptyValue(value: unknown) {
  return value === undefined || value === null || value === "" || (Array.isArray(value) && value.length === 0);
}

function safeAssetUrl(value: unknown) {
  if (typeof value !== "string" || value.length > 4096 || value.includes("\\")) return false;
  if (value.startsWith("/") && !value.startsWith("//")) return true;

  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password;
  } catch {
    return false;
  }
}

const emailValueSchema = z.string().email().max(320);

function safeHttpUrl(value: string) {
  if (value.length > 2048) return false;
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password;
  } catch {
    return false;
  }
}

function validationError(field: ContentField, message: string): never {
  throw new AppError(422, "content_entry_invalid", message, {
    field: field.key,
    label: field.label
  });
}

function contentEntryFilters(fields: ContentField[], filters: string[]) {
  return filters.map((filter): Prisma.CmsCollectionEntryWhereInput => {
    const separator = filter.indexOf("=");
    const key = separator > 0 ? filter.slice(0, separator).trim() : "";
    const rawValue = separator > 0 ? filter.slice(separator + 1).trim() : "";
    const field = fields.find((candidate) => candidate.key === key);
    if (!field || !rawValue || ["richText", "image", "file"].includes(field.type)) {
      throw new AppError(
        422,
        "content_filter_invalid",
        "Filters must use filter=field=value with a scalar filterable field.",
        { filter }
      );
    }

    let value: string | number | boolean = rawValue;
    if (field.type === "number") {
      value = Number(rawValue);
      if (!Number.isFinite(value)) {
        throw new AppError(422, "content_filter_invalid", `${field.label} needs a numeric filter value.`);
      }
    } else if (field.type === "boolean") {
      if (!new Set(["true", "false"]).has(rawValue)) {
        throw new AppError(422, "content_filter_invalid", `${field.label} needs true or false.`);
      }
      value = rawValue === "true";
    }

    return {
      data: field.multiple
        ? { path: [field.key], array_contains: [value] }
        : { path: [field.key], equals: value }
    };
  });
}

function normalizeAsset(field: ContentField, value: unknown) {
  if (!isRecord(value) || !safeAssetUrl(value.url)) {
    validationError(field, `${field.label} must use an uploaded file or a safe HTTP URL.`);
  }

  return {
    url: String(value.url),
    ...(typeof value.assetId === "string" && value.assetId ? { assetId: value.assetId.slice(0, 120) } : {}),
    ...(typeof value.altText === "string" ? { altText: value.altText.trim().slice(0, 240) } : {}),
    ...(Number.isInteger(value.width) && Number(value.width) > 0 ? { width: Number(value.width) } : {}),
    ...(Number.isInteger(value.height) && Number(value.height) > 0 ? { height: Number(value.height) } : {})
  };
}

function normalizeSingleFieldValue(field: ContentField, value: unknown): unknown {
  if (isEmptyValue(value)) {
    if (field.required) validationError(field, `${field.label} is required.`);
    return null;
  }

  if (["text", "textarea", "richText", "email", "url", "date", "dateTime", "select", "relation"].includes(field.type)) {
    if (typeof value !== "string") validationError(field, `${field.label} must be text.`);
    const normalized = field.type === "richText" ? sanitizeRichText(value) : value.trim();
    if (field.minLength !== undefined && normalized.length < field.minLength) {
      validationError(field, `${field.label} must contain at least ${field.minLength} characters.`);
    }
    const defaultMaximum = field.type === "richText"
      ? 100_000
      : field.type === "textarea"
        ? 20_000
        : field.type === "email"
          ? 320
          : field.type === "url"
            ? 2048
            : 2_000;
    const maximum = field.maxLength ?? defaultMaximum;
    if (normalized.length > maximum) validationError(field, `${field.label} cannot exceed ${maximum} characters.`);

    if (field.type === "date") {
      const date = new Date(`${normalized}T00:00:00.000Z`);
      if (
        !/^\d{4}-\d{2}-\d{2}$/.test(normalized) ||
        Number.isNaN(date.getTime()) ||
        date.toISOString().slice(0, 10) !== normalized
      ) {
        validationError(field, `${field.label} must use a valid YYYY-MM-DD date.`);
      }
    }
    if (field.type === "dateTime" && Number.isNaN(Date.parse(normalized))) {
      validationError(field, `${field.label} must be a valid date and time.`);
    }
    if (field.type === "email" && !emailValueSchema.safeParse(normalized).success) {
      validationError(field, `${field.label} must be a valid email address.`);
    }
    if (field.type === "url" && !safeHttpUrl(normalized)) {
      validationError(field, `${field.label} must be a safe HTTP or HTTPS URL.`);
    }
    if (field.type === "select" && !field.options?.some((option) => option.value === normalized)) {
      validationError(field, `${field.label} must use one of its configured options.`);
    }
    return normalized;
  }

  if (field.type === "number") {
    if (typeof value !== "number" || !Number.isFinite(value)) validationError(field, `${field.label} must be a number.`);
    if (field.min !== undefined && value < field.min) validationError(field, `${field.label} cannot be less than ${field.min}.`);
    if (field.max !== undefined && value > field.max) validationError(field, `${field.label} cannot exceed ${field.max}.`);
    return value;
  }

  if (field.type === "boolean") {
    if (typeof value !== "boolean") validationError(field, `${field.label} must be on or off.`);
    return value;
  }

  if (field.type === "image" || field.type === "file") return normalizeAsset(field, value);

  validationError(field, `${field.label} uses an unsupported field type.`);
}

export function normalizeContentEntryData(fields: ContentField[], input: Record<string, unknown>) {
  const allowedKeys = new Set(fields.map((field) => field.key));
  const unknownKeys = Object.keys(input).filter((key) => !allowedKeys.has(key));
  if (unknownKeys.length) {
    throw new AppError(422, "content_entry_invalid", "Entry data contains fields that are not in this collection.", {
      fields: unknownKeys
    });
  }

  return Object.fromEntries(fields.map((field) => {
    const value = input[field.key];
    if (!field.multiple) return [field.key, normalizeSingleFieldValue(field, value)];
    if (isEmptyValue(value)) {
      if (field.required) validationError(field, `${field.label} is required.`);
      return [field.key, []];
    }
    if (!Array.isArray(value) || value.length > 100) {
      validationError(field, `${field.label} must contain no more than 100 values.`);
    }
    return [field.key, value.map((item) => normalizeSingleFieldValue({ ...field, multiple: false }, item))];
  }));
}

function fieldsFrom(value: Prisma.JsonValue | unknown) {
  const parsed = Array.isArray(value) ? value : [];
  return parsed as ContentField[];
}

function collectionModel(collection: {
  name: string;
  slug: string;
  description: string | null;
  titleField: string;
  fields: Prisma.JsonValue;
  publicRead: boolean;
}): CreateContentCollectionInput {
  return createContentCollectionSchema.parse({
    name: collection.name,
    slug: collection.slug,
    description: collection.description ?? undefined,
    titleField: collection.titleField,
    fields: fieldsFrom(collection.fields),
    publicRead: collection.publicRead
  });
}

function installedManifest(value: Prisma.JsonValue): ExtensionManifest {
  const parsed = extensionManifestSchema.safeParse(value);
  if (!parsed.success) {
    throw new AppError(500, "extension_installation_invalid", "The saved extension receipt is invalid.");
  }
  return parsed.data;
}

function extensionModelsEqual(left: unknown, right: unknown) {
  return canonicalExtensionJson(left) === canonicalExtensionJson(right);
}

function entrySnapshot(entry: {
  title: string;
  slug: string;
  locale: string;
  data: Prisma.JsonValue;
  status: "DRAFT" | "PUBLISHED" | "ARCHIVED";
  publishedAt: Date | null;
}): EntrySnapshot {
  return {
    title: entry.title,
    slug: entry.slug,
    locale: entry.locale,
    data: entry.data as Record<string, unknown>,
    status: entry.status,
    publishedAt: entry.publishedAt?.toISOString() ?? null
  };
}

function publicVisibility(now = new Date()) {
  return {
    status: "PUBLISHED" as const,
    OR: [{ publishedAt: null }, { publishedAt: { lte: now } }]
  };
}

function publicCollectionDto(collection: {
  name: string;
  slug: string;
  description: string | null;
  titleField: string;
  fields: Prisma.JsonValue;
  publicRead: boolean;
  updatedAt: Date;
}) {
  return {
    name: collection.name,
    slug: collection.slug,
    description: collection.description,
    titleField: collection.titleField,
    fields: collection.fields,
    publicRead: collection.publicRead,
    updatedAt: collection.updatedAt
  };
}

function publicEntryDto(entry: {
  title: string;
  slug: string;
  locale: string;
  data: Prisma.JsonValue;
  publishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    title: entry.title,
    slug: entry.slug,
    locale: entry.locale,
    data: entry.data,
    publishedAt: entry.publishedAt,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt
  };
}

export class ContentModelsService {
  constructor(private readonly prisma: ContentModelDatabase) {}

  private transaction<T>(operation: (transaction: Prisma.TransactionClient) => Promise<T>) {
    if ("$transaction" in this.prisma) return this.prisma.$transaction(operation);
    return operation(this.prisma);
  }

  private async defaultSiteId(database: ContentModelDatabase = this.prisma) {
    const site = await database.site.findUnique({ where: { slug: "default" }, select: { id: true } });
    if (!site) throw new AppError(503, "site_not_initialized", "Complete site setup before managing collections.");
    return site.id;
  }

  private async lockExtension(
    database: ContentModelDatabase,
    siteId: string,
    extensionId: string
  ) {
    await database.$queryRaw(Prisma.sql`
      SELECT pg_advisory_xact_lock(hashtext(${`${siteId}:${extensionId}`}))::text AS "lock"
    `);
  }

  private async collectionBySlug(collectionSlug: string, database: ContentModelDatabase = this.prisma) {
    const siteId = await this.defaultSiteId(database);
    const collection = await database.cmsCollection.findUnique({
      where: { siteId_slug: { siteId, slug: collectionSlug } }
    });
    if (!collection) throw new AppError(404, "content_collection_not_found", "Collection not found.");
    return collection;
  }

  private async assertRelationCollections(
    database: ContentModelDatabase,
    siteId: string,
    collectionSlug: string,
    fields: ContentField[],
    additionalSlugs: string[] = []
  ) {
    const targets = [...new Set(fields
      .filter((field) => field.type === "relation" && field.relationCollection)
      .map((field) => field.relationCollection!))];
    const allowed = new Set([collectionSlug, ...additionalSlugs]);
    const externalTargets = targets.filter((slug) => !allowed.has(slug));
    if (!externalTargets.length) return;
    const existing = await database.cmsCollection.findMany({
      where: { siteId, slug: { in: externalTargets } },
      select: { slug: true }
    });
    const existingSlugs = new Set(existing.map((collection) => collection.slug));
    const missing = externalTargets.filter((slug) => !existingSlugs.has(slug));
    if (missing.length) {
      throw new AppError(422, "content_collection_relation_invalid", "One or more relation collections do not exist.", {
        collections: missing
      });
    }
  }

  async listCollections() {
    const siteId = await this.defaultSiteId();
    return this.prisma.cmsCollection.findMany({
      where: { siteId },
      include: { _count: { select: { entries: true } } },
      orderBy: [{ name: "asc" }, { slug: "asc" }]
    });
  }

  async getCollection(collectionSlug: string) {
    const collection = await this.collectionBySlug(collectionSlug);
    return this.prisma.cmsCollection.findUniqueOrThrow({
      where: { id: collection.id },
      include: { _count: { select: { entries: true } } }
    });
  }

  async createCollection(input: CreateContentCollectionInput) {
    const siteId = await this.defaultSiteId();
    await this.assertRelationCollections(this.prisma, siteId, input.slug, input.fields);
    try {
      return await this.prisma.cmsCollection.create({
        data: {
          siteId,
          name: input.name,
          slug: input.slug,
          description: input.description,
          titleField: input.titleField,
          fields: json(input.fields),
          publicRead: input.publicRead
        }
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new AppError(409, "content_collection_exists", "A collection already uses this slug.");
      }
      throw error;
    }
  }

  async updateCollection(collectionSlug: string, input: UpdateContentCollectionInput) {
    return this.transaction(async (transaction) => {
      const existing = await this.collectionBySlug(collectionSlug, transaction);
      const nextSlug = input.slug ?? existing.slug;
      const nextFields = (input.fields ?? fieldsFrom(existing.fields)).map((field) => (
        field.type === "relation" && field.relationCollection === existing.slug
          ? { ...field, relationCollection: nextSlug }
          : field
      ));
      const merged = createContentCollectionSchema.parse({
        name: input.name ?? existing.name,
        slug: nextSlug,
        description: input.description === undefined
          ? existing.description ?? undefined
          : input.description ?? undefined,
        titleField: input.titleField ?? existing.titleField,
        fields: nextFields,
        publicRead: input.publicRead ?? existing.publicRead
      });
      await this.assertRelationCollections(transaction, existing.siteId, merged.slug, merged.fields);

      if (merged.slug !== existing.slug) {
        const relatedCollections = await transaction.cmsCollection.findMany({
          where: { siteId: existing.siteId, id: { not: existing.id } },
          select: { name: true, fields: true }
        });
        const referencedBy = relatedCollections
          .filter((collection) => fieldsFrom(collection.fields).some((field) => (
            field.type === "relation" && field.relationCollection === existing.slug
          )))
          .map((collection) => collection.name);
        if (referencedBy.length) {
          throw new AppError(409, "content_collection_in_use", "Update relation fields before changing this collection slug.", {
            collections: referencedBy
          });
        }
      }

      const entries = await transaction.cmsCollectionEntry.findMany({
        where: { collectionId: existing.id },
        select: { id: true, slug: true, locale: true, data: true }
      });
      for (const entry of entries) {
        try {
          const normalized = normalizeContentEntryData(
            merged.fields,
            entry.data as Record<string, unknown>
          );
          if (!String(normalized[merged.titleField] ?? "").trim()) {
            throw new AppError(422, "content_entry_invalid", "The display title field is empty.");
          }
          await this.validateRelations(
            transaction,
            existing.siteId,
            merged.fields,
            normalized,
            entry.locale
          );
        } catch (error) {
          if (error instanceof AppError) {
            throw new AppError(409, "content_collection_schema_incompatible", `The new fields are incompatible with entry ${entry.slug}.`, {
              entry: entry.slug,
              cause: error.message,
              details: error.details
            });
          }
          throw error;
        }
      }

      try {
        const collection = await transaction.cmsCollection.update({
          where: { id: existing.id },
          data: {
            name: merged.name,
            slug: merged.slug,
            description: merged.description ?? null,
            titleField: merged.titleField,
            fields: json(merged.fields),
            publicRead: merged.publicRead
          }
        });
        if (merged.titleField !== existing.titleField) {
          for (const entry of entries) {
            const data = entry.data as Record<string, unknown>;
            await transaction.cmsCollectionEntry.update({
              where: { id: entry.id },
              data: { title: String(data[merged.titleField]).trim() }
            });
          }
        }
        return collection;
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
          throw new AppError(409, "content_collection_exists", "A collection already uses this slug.");
        }
        throw error;
      }
    });
  }

  async deleteCollection(collectionSlug: string, confirmation: string) {
    if (confirmation !== collectionSlug) {
      throw new AppError(422, "confirmation_mismatch", "Type the collection slug to confirm deletion.");
    }

    return this.transaction(async (transaction) => {
      const collection = await this.collectionBySlug(collectionSlug, transaction);
      const collections = await transaction.cmsCollection.findMany({
        where: { siteId: collection.siteId, id: { not: collection.id } },
        select: { name: true, fields: true }
      });
      const referencedBy = collections
        .filter((item) => fieldsFrom(item.fields).some((field) => field.relationCollection === collection.slug))
        .map((item) => item.name);
      if (referencedBy.length) {
        throw new AppError(409, "content_collection_in_use", "Remove relation fields before deleting this collection.", {
          collections: referencedBy
        });
      }
      await transaction.cmsCollection.delete({ where: { id: collection.id } });
      return { deleted: true };
    });
  }

  async listEntries(collectionSlug: string, query: EntryListQuery, allowDrafts: boolean) {
    const collection = await this.collectionBySlug(collectionSlug);
    if (!allowDrafts && !collection.publicRead) {
      throw new AppError(404, "content_collection_not_found", "Collection not found.");
    }

    const fields = fieldsFrom(collection.fields);
    const where: Prisma.CmsCollectionEntryWhereInput = {
      collectionId: collection.id,
      ...(query.locale ? { locale: query.locale } : {}),
      ...(query.q ? { title: { contains: query.q, mode: "insensitive" } } : {}),
      ...(!allowDrafts || !query.includeDrafts ? publicVisibility() : {}),
      ...(query.filter?.length ? { AND: contentEntryFilters(fields, query.filter) } : {})
    };
    const skip = (query.page - 1) * query.limit;
    const [entries, total] = await Promise.all([
      this.prisma.cmsCollectionEntry.findMany({
        where,
        orderBy: [
          { [query.sortBy ?? "publishedAt"]: query.sortOrder ?? "desc" },
          { id: query.sortOrder ?? "desc" }
        ],
        skip,
        take: query.limit
      }),
      this.prisma.cmsCollectionEntry.count({ where })
    ]);

    return {
      collection: allowDrafts ? collection : publicCollectionDto(collection),
      entries: allowDrafts ? entries : entries.map(publicEntryDto),
      pagination: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / query.limit))
      }
    };
  }

  async getEntry(collectionSlug: string, entrySlug: string, locale: string, allowDrafts: boolean) {
    const collection = await this.collectionBySlug(collectionSlug);
    if (!allowDrafts && !collection.publicRead) throw new AppError(404, "content_entry_not_found", "Entry not found.");
    const entry = await this.prisma.cmsCollectionEntry.findFirst({
      where: {
        collectionId: collection.id,
        slug: entrySlug,
        locale,
        ...(!allowDrafts ? publicVisibility() : {})
      }
    });
    if (!entry) throw new AppError(404, "content_entry_not_found", "Entry not found.");
    return allowDrafts
      ? { collection, entry }
      : { collection: publicCollectionDto(collection), entry: publicEntryDto(entry) };
  }

  private async validateRelations(
    database: ContentModelDatabase,
    siteId: string,
    fields: ContentField[],
    data: Record<string, unknown>,
    locale: string
  ) {
    for (const field of fields.filter((item) => item.type === "relation")) {
      const values = (field.multiple ? data[field.key] : [data[field.key]]) as unknown[];
      const slugs = values.filter((value): value is string => typeof value === "string" && Boolean(value));
      if (!slugs.length) continue;
      const target = await database.cmsCollection.findUnique({
        where: { siteId_slug: { siteId, slug: field.relationCollection! } },
        select: { id: true }
      });
      if (!target) validationError(field, `${field.label} references a collection that does not exist.`);
      const matches = await database.cmsCollectionEntry.count({
        where: { collectionId: target.id, locale, slug: { in: [...new Set(slugs)] } }
      });
      if (matches !== new Set(slugs).size) validationError(field, `${field.label} contains an entry that does not exist.`);
    }
  }

  private async assertEntryNotReferenced(
    database: ContentModelDatabase,
    siteId: string,
    collectionSlug: string,
    entrySlug: string,
    locale: string,
    excludeEntryId?: string
  ) {
    const collections = await database.cmsCollection.findMany({
      where: { siteId },
      select: { id: true, name: true, fields: true }
    });
    const references = [];

    for (const collection of collections) {
      const relationFields = fieldsFrom(collection.fields).filter((field) => (
        field.type === "relation" && field.relationCollection === collectionSlug
      ));
      if (!relationFields.length) continue;
      const conditions: Prisma.CmsCollectionEntryWhereInput[] = relationFields.map((field) => ({
        data: field.multiple
          ? { path: [field.key], array_contains: [entrySlug] }
          : { path: [field.key], equals: entrySlug }
      }));
      const reference = await database.cmsCollectionEntry.findFirst({
        where: {
          collectionId: collection.id,
          locale,
          ...(excludeEntryId ? { id: { not: excludeEntryId } } : {}),
          OR: conditions
        },
        select: { slug: true, title: true }
      });
      if (reference) references.push({
        collection: collection.name,
        entry: reference.title,
        slug: reference.slug
      });
    }

    if (references.length) {
      throw new AppError(409, "content_entry_in_use", "Update related entries before renaming or deleting this entry.", {
        references
      });
    }
  }

  private async createRevision(
    database: ContentModelDatabase,
    entry: Parameters<typeof entrySnapshot>[0] & { id: string },
    action: string,
    user?: RequestUser
  ) {
    const latest = await database.cmsCollectionEntryRevision.findFirst({
      where: { entryId: entry.id },
      orderBy: { version: "desc" },
      select: { version: true }
    });
    await database.cmsCollectionEntryRevision.create({
      data: {
        entryId: entry.id,
        version: (latest?.version ?? 0) + 1,
        action,
        snapshot: json(entrySnapshot(entry)),
        createdById: user?.id
      }
    });
  }

  async createEntry(collectionSlug: string, input: CreateContentEntryInput, user?: RequestUser) {
    return this.transaction(async (transaction) => {
      const collection = await this.collectionBySlug(collectionSlug, transaction);
      const fields = fieldsFrom(collection.fields);
      const data = normalizeContentEntryData(fields, input.data);
      await this.validateRelations(transaction, collection.siteId, fields, data, input.locale);
      const title = String(data[collection.titleField] ?? "").trim();
      if (!title) throw new AppError(422, "content_entry_invalid", "The display title field is required.");

      try {
        const entry = await transaction.cmsCollectionEntry.create({
          data: {
            collectionId: collection.id,
            title,
            slug: input.slug,
            locale: input.locale,
            data: json(data),
            status: input.status,
            publishedAt: input.publishedAt,
            createdById: user?.id,
            updatedById: user?.id
          }
        });
        await this.createRevision(transaction, entry, "CREATE", user);
        return entry;
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
          throw new AppError(409, "content_entry_exists", "An entry already uses this slug and language.");
        }
        throw error;
      }
    });
  }

  async updateEntry(
    collectionSlug: string,
    entrySlug: string,
    locale: string,
    input: UpdateContentEntryInput,
    user?: RequestUser
  ) {
    return this.transaction(async (transaction) => {
      const collection = await this.collectionBySlug(collectionSlug, transaction);
      const existing = await transaction.cmsCollectionEntry.findUnique({
        where: { collectionId_locale_slug: { collectionId: collection.id, locale, slug: entrySlug } }
      });
      if (!existing) throw new AppError(404, "content_entry_not_found", "Entry not found.");
      if (input.slug && input.slug !== existing.slug) {
        await this.assertEntryNotReferenced(
          transaction,
          collection.siteId,
          collection.slug,
          existing.slug,
          locale
        );
      }
      const fields = fieldsFrom(collection.fields);
      const data = normalizeContentEntryData(fields, {
        ...(existing.data as Record<string, unknown>),
        ...(input.data ?? {})
      });
      await this.validateRelations(transaction, collection.siteId, fields, data, locale);
      const title = String(data[collection.titleField] ?? "").trim();
      if (!title) throw new AppError(422, "content_entry_invalid", "The display title field is required.");

      try {
        const entry = await transaction.cmsCollectionEntry.update({
          where: { id: existing.id },
          data: {
            title,
            slug: input.slug,
            data: json(data),
            status: input.status,
            publishedAt: input.publishedAt,
            updatedById: user?.id
          }
        });
        await this.createRevision(transaction, entry, "UPDATE", user);
        return entry;
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
          throw new AppError(409, "content_entry_exists", "An entry already uses this slug and language.");
        }
        throw error;
      }
    });
  }

  async deleteEntry(collectionSlug: string, entrySlug: string, locale: string) {
    return this.transaction(async (transaction) => {
      const collection = await this.collectionBySlug(collectionSlug, transaction);
      const entry = await transaction.cmsCollectionEntry.findUnique({
        where: { collectionId_locale_slug: { collectionId: collection.id, locale, slug: entrySlug } },
        select: { id: true }
      });
      if (!entry) throw new AppError(404, "content_entry_not_found", "Entry not found.");
      await this.assertEntryNotReferenced(
        transaction,
        collection.siteId,
        collection.slug,
        entrySlug,
        locale,
        entry.id
      );
      await transaction.cmsCollectionEntry.delete({ where: { id: entry.id } });
      return { deleted: true };
    });
  }

  async listRevisions(collectionSlug: string, entrySlug: string, locale: string) {
    const collection = await this.collectionBySlug(collectionSlug);
    const entry = await this.prisma.cmsCollectionEntry.findFirst({
      where: { collectionId: collection.id, slug: entrySlug, locale },
      select: { id: true }
    });
    if (!entry) throw new AppError(404, "content_entry_not_found", "Entry not found.");
    return this.prisma.cmsCollectionEntryRevision.findMany({
      where: { entryId: entry.id },
      orderBy: { version: "desc" }
    });
  }

  async restoreRevision(
    collectionSlug: string,
    entrySlug: string,
    locale: string,
    revisionId: string,
    user?: RequestUser
  ) {
    return this.transaction(async (transaction) => {
      const collection = await this.collectionBySlug(collectionSlug, transaction);
      const existing = await transaction.cmsCollectionEntry.findUnique({
        where: { collectionId_locale_slug: { collectionId: collection.id, locale, slug: entrySlug } }
      });
      if (!existing) throw new AppError(404, "content_entry_not_found", "Entry not found.");
      const revision = await transaction.cmsCollectionEntryRevision.findFirst({
        where: { id: revisionId, entryId: existing.id }
      });
      if (!revision || !isRecord(revision.snapshot)) {
        throw new AppError(404, "content_revision_not_found", "Revision not found.");
      }
      const snapshot = revision.snapshot as EntrySnapshot;
      if (snapshot.slug !== existing.slug || snapshot.locale !== existing.locale) {
        await this.assertEntryNotReferenced(
          transaction,
          collection.siteId,
          collection.slug,
          existing.slug,
          existing.locale,
          existing.id
        );
      }
      const fields = fieldsFrom(collection.fields);
      const data = normalizeContentEntryData(fields, snapshot.data);
      await this.validateRelations(transaction, collection.siteId, fields, data, snapshot.locale);
      try {
        const entry = await transaction.cmsCollectionEntry.update({
          where: { id: existing.id },
          data: {
            title: String(data[collection.titleField] ?? snapshot.title),
            slug: snapshot.slug,
            locale: snapshot.locale,
            data: json(data),
            status: snapshot.status,
            publishedAt: snapshot.publishedAt ? new Date(snapshot.publishedAt) : null,
            updatedById: user?.id
          }
        });
        await this.createRevision(transaction, entry, "RESTORE", user);
        return entry;
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
          throw new AppError(409, "content_entry_exists", "An entry already uses the restored slug and language.");
        }
        throw error;
      }
    });
  }

  async listScheduledEntries(now = new Date()) {
    const siteId = await this.defaultSiteId();
    return this.prisma.cmsCollectionEntry.findMany({
      where: {
        collection: { siteId },
        status: "DRAFT",
        publishedAt: { gt: now }
      },
      include: { collection: { select: { name: true, slug: true } } },
      orderBy: { publishedAt: "asc" }
    });
  }

  async publishScheduledEntries(now = new Date()) {
    const siteId = await this.defaultSiteId();
    const result = await this.prisma.cmsCollectionEntry.updateMany({
      where: {
        collection: { siteId },
        status: "DRAFT",
        publishedAt: { lte: now }
      },
      data: { status: "PUBLISHED" }
    });
    return result.count;
  }

  async exportContentBundle(collectionSlugs: string[]) {
    const siteId = await this.defaultSiteId();
    const collections = await this.prisma.cmsCollection.findMany({
      where: { siteId, slug: { in: collectionSlugs } },
      include: { entries: { orderBy: [{ locale: "asc" }, { slug: "asc" }] } }
    });
    const bySlug = new Map(collections.map((collection) => [collection.slug, collection]));
    const missing = collectionSlugs.filter((slug) => !bySlug.has(slug));
    if (missing.length) {
      throw new AppError(404, "content_collection_not_found", "One or more collections were not found.", {
        collections: missing
      });
    }

    return contentBundleSchema.parse({
      schemaVersion: "1.0",
      kind: "codey-cms.content-bundle",
      collections: collectionSlugs.map((slug) => {
        const collection = bySlug.get(slug)!;
        return {
          model: collectionModel(collection),
          entries: collection.entries.map((entry) => ({
            slug: entry.slug,
            locale: entry.locale,
            data: entry.data,
            status: entry.status,
            publishedAt: entry.publishedAt
          }))
        };
      })
    });
  }

  async importContentBundle(bundle: ContentBundle, user?: RequestUser) {
    return this.transaction(async (transaction) => {
      const siteId = await this.defaultSiteId(transaction);
      const collectionSlugs = bundle.collections.map((collection) => collection.model.slug).sort();
      for (const slug of collectionSlugs) {
        await this.lockExtension(transaction, siteId, `content-bundle:${slug}`);
      }

      const nextService = new ContentModelsService(transaction);
      const collections = await nextService.installCollectionPack(
        bundle.collections.map((collection) => collection.model)
      );
      const collectionBySlug = new Map(collections.map((collection) => [collection.slug, collection]));
      const created: Array<{
        entry: Parameters<typeof entrySnapshot>[0] & { id: string };
        fields: ContentField[];
        siteId: string;
      }> = [];

      for (const collectionBundle of bundle.collections) {
        const collection = collectionBySlug.get(collectionBundle.model.slug)!;
        const fields = fieldsFrom(collection.fields);
        for (const input of collectionBundle.entries) {
          const data = normalizeContentEntryData(fields, input.data);
          const title = String(data[collection.titleField] ?? "").trim();
          if (!title) throw new AppError(422, "content_entry_invalid", "The display title field is required.");
          const entry = await transaction.cmsCollectionEntry.create({
            data: {
              collectionId: collection.id,
              title,
              slug: input.slug,
              locale: input.locale,
              data: json(data),
              status: input.status,
              publishedAt: input.publishedAt,
              createdById: user?.id,
              updatedById: user?.id
            }
          });
          created.push({ entry, fields, siteId });
        }
      }

      for (const item of created) {
        await this.validateRelations(
          transaction,
          item.siteId,
          item.fields,
          item.entry.data as Record<string, unknown>,
          item.entry.locale
        );
        await this.createRevision(transaction, item.entry, "IMPORT", user);
      }

      return {
        imported: true,
        collections: collections.map((collection) => collection.slug),
        entries: created.length
      };
    });
  }

  async listExtensionInstallations() {
    const siteId = await this.defaultSiteId();
    return this.prisma.cmsExtensionInstallation.findMany({
      where: { siteId },
      orderBy: [{ updatedAt: "desc" }, { extensionId: "asc" }]
    });
  }

  private async extensionPlan(
    database: ContentModelDatabase,
    extension: ExtensionManifest
  ): Promise<ExtensionChangePlan> {
    const siteId = await this.defaultSiteId(database);
    const availableDigest = extensionManifestSha256(extension);
    const installation = await database.cmsExtensionInstallation.findUnique({
      where: { siteId_extensionId: { siteId, extensionId: extension.id } }
    });

    if (!installation) {
      const conflicts = await database.cmsCollection.findMany({
        where: { siteId, slug: { in: extension.contentModels.map((model) => model.slug) } },
        select: { slug: true }
      });
      return {
        status: conflicts.length ? "conflict" : "available",
        installedVersion: null,
        availableVersion: extension.version,
        installedDigest: null,
        availableDigest,
        added: extension.contentModels.map((model) => model.slug),
        updated: [],
        removed: [],
        customized: [],
        conflicts: conflicts.map((collection) => collection.slug)
      };
    }

    const parsedReceipt = extensionManifestSchema.safeParse(installation.manifest);
    if (
      !parsedReceipt.success ||
      parsedReceipt.data.id !== installation.extensionId ||
      parsedReceipt.data.version !== installation.version ||
      extensionManifestSha256(parsedReceipt.data) !== installation.manifestSha256
    ) {
      return {
        status: "receiptInvalid",
        installedVersion: installation.version,
        availableVersion: extension.version,
        installedDigest: installation.manifestSha256,
        availableDigest,
        added: [],
        updated: [],
        removed: [],
        customized: [],
        conflicts: []
      };
    }
    const previous = parsedReceipt.data;
    const previousBySlug = new Map(previous.contentModels.map((model) => [model.slug, model]));
    const availableBySlug = new Map(extension.contentModels.map((model) => [model.slug, model]));
    const previousSlugs = [...previousBySlug.keys()];
    const availableSlugs = [...availableBySlug.keys()];
    const currentCollections = await database.cmsCollection.findMany({
      where: { siteId, slug: { in: [...new Set([...previousSlugs, ...availableSlugs])] } }
    });
    const currentBySlug = new Map(currentCollections.map((collection) => [collection.slug, collection]));
    const customized = previousSlugs.filter((slug) => availableBySlug.has(slug)).filter((slug) => {
      const current = currentBySlug.get(slug);
      return !current || !extensionModelsEqual(collectionModel(current), previousBySlug.get(slug));
    });
    const added = availableSlugs.filter((slug) => !previousBySlug.has(slug));
    const updated = availableSlugs.filter((slug) => {
      const prior = previousBySlug.get(slug);
      return prior && !extensionModelsEqual(prior, availableBySlug.get(slug));
    });
    const removed = previousSlugs.filter((slug) => !availableBySlug.has(slug));
    const conflicts = added.filter((slug) => currentBySlug.has(slug));
    const versionComparison = compareSemanticVersions(extension.version, installation.version);
    let status: ExtensionChangePlan["status"];

    if (customized.length) status = "customized";
    else if (conflicts.length) status = "conflict";
    else if (versionComparison === null || (versionComparison === 0 && installation.manifestSha256 !== availableDigest)) {
      status = "versionConflict";
    } else if (versionComparison < 0) status = "ahead";
    else if (versionComparison > 0) status = "updateAvailable";
    else status = "installed";

    return {
      status,
      installedVersion: installation.version,
      availableVersion: extension.version,
      installedDigest: installation.manifestSha256,
      availableDigest,
      added,
      updated,
      removed,
      customized,
      conflicts
    };
  }

  async planExtension(extension: ExtensionManifest) {
    return this.extensionPlan(this.prisma, extension);
  }

  async installExtension(extension: ExtensionManifest) {
    return this.transaction(async (transaction) => {
      const siteId = await this.defaultSiteId(transaction);
      await this.lockExtension(transaction, siteId, extension.id);
      const plan = await this.extensionPlan(transaction, extension);
      if (plan.installedVersion) {
        throw new AppError(409, "extension_already_installed", "This extension is already installed.", { plan });
      }
      if (plan.conflicts.length) {
        throw new AppError(409, "extension_collection_conflict", "One or more extension collections already exist.", {
          collections: plan.conflicts
        });
      }

      const collections = await new ContentModelsService(transaction).installCollectionPack(extension.contentModels);
      const installation = await transaction.cmsExtensionInstallation.create({
        data: {
          siteId,
          extensionId: extension.id,
          version: extension.version,
          manifestSha256: extensionManifestSha256(extension),
          manifest: json(extension)
        },
        select: extensionInstallationReceiptSelect
      });
      return { installation, collections, plan };
    });
  }

  async updateExtension(extension: ExtensionManifest) {
    return this.transaction(async (transaction) => {
      const siteId = await this.defaultSiteId(transaction);
      await this.lockExtension(transaction, siteId, extension.id);
      const plan = await this.extensionPlan(transaction, extension);
      if (!plan.installedVersion) {
        throw new AppError(404, "extension_not_installed", "Install this extension before updating it.");
      }
      if (plan.status === "installed") {
        const installation = await transaction.cmsExtensionInstallation.findUniqueOrThrow({
          where: { siteId_extensionId: { siteId, extensionId: extension.id } },
          select: extensionInstallationReceiptSelect
        });
        return { installation, collections: [], preservedCollections: [], plan };
      }
      if (plan.status !== "updateAvailable") {
        throw new AppError(409, "extension_update_blocked", "The extension cannot be updated safely.", { plan });
      }

      const previous = installedManifest((await transaction.cmsExtensionInstallation.findUniqueOrThrow({
        where: { siteId_extensionId: { siteId, extensionId: extension.id } },
        select: { manifest: true }
      })).manifest);
      const previousSlugs = new Set(previous.contentModels.map((model) => model.slug));
      const nextService = new ContentModelsService(transaction);
      const collections = [];
      const addedModels = extension.contentModels.filter((model) => !previousSlugs.has(model.slug));
      if (addedModels.length) {
        collections.push(...await nextService.installCollectionPack(addedModels));
      }
      for (const model of extension.contentModels.filter((item) => plan.updated.includes(item.slug))) {
        collections.push(await nextService.updateCollection(model.slug, model));
      }
      const nextModelSlugs = extension.contentModels.map((model) => model.slug);
      for (const model of extension.contentModels) {
        await nextService.assertRelationCollections(
          transaction,
          siteId,
          model.slug,
          model.fields,
          nextModelSlugs
        );
      }

      const installation = await transaction.cmsExtensionInstallation.update({
        where: { siteId_extensionId: { siteId, extensionId: extension.id } },
        data: {
          version: extension.version,
          manifestSha256: extensionManifestSha256(extension),
          manifest: json(extension)
        },
        select: extensionInstallationReceiptSelect
      });
      return { installation, collections, preservedCollections: plan.removed, plan };
    });
  }

  async disconnectExtension(extensionId: string, confirmation: string) {
    if (confirmation !== extensionId) {
      throw new AppError(422, "confirmation_mismatch", "Type the extension ID to confirm disconnection.");
    }

    return this.transaction(async (transaction) => {
      const siteId = await this.defaultSiteId(transaction);
      await this.lockExtension(transaction, siteId, extensionId);
      const installation = await transaction.cmsExtensionInstallation.findUnique({
        where: { siteId_extensionId: { siteId, extensionId } }
      });
      if (!installation) throw new AppError(404, "extension_not_installed", "Extension installation not found.");
      const manifest = extensionManifestSchema.safeParse(installation.manifest);
      const preservedCollections = await transaction.cmsCollection.findMany({
        where: {
          siteId,
          slug: { in: manifest.success ? manifest.data.contentModels.map((model) => model.slug) : [] }
        },
        select: { slug: true }
      });
      await transaction.cmsExtensionInstallation.delete({ where: { id: installation.id } });
      return {
        disconnected: true,
        extensionId,
        preservedCollections: preservedCollections.map((collection) => collection.slug)
      };
    });
  }

  async installCollectionPack(collections: CreateContentCollectionInput[]) {
    return this.transaction(async (transaction) => {
      const siteId = await this.defaultSiteId(transaction);
      const existing = await transaction.cmsCollection.findMany({
        where: { siteId, slug: { in: collections.map((collection) => collection.slug) } },
        select: { slug: true }
      });
      if (existing.length) {
        throw new AppError(409, "extension_collection_conflict", "One or more extension collections already exist.", {
          collections: existing.map((collection) => collection.slug)
        });
      }
      const packSlugs = collections.map((collection) => collection.slug);
      for (const collection of collections) {
        await this.assertRelationCollections(
          transaction,
          siteId,
          collection.slug,
          collection.fields,
          packSlugs
        );
      }
      const installed = [];
      for (const collection of collections) {
        installed.push(await transaction.cmsCollection.create({
          data: {
            siteId,
            name: collection.name,
            slug: collection.slug,
            description: collection.description,
            titleField: collection.titleField,
            fields: json(collection.fields),
            publicRead: collection.publicRead
          }
        }));
      }
      return installed;
    });
  }
}
