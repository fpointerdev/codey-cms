import { Prisma, type PrismaClient } from "@prisma/client";
import { z } from "zod";
import { AppError } from "../../core/errors/app-error.js";
import { sanitizeRichText } from "./rich-text-sanitizer.js";
import {
  createContentCollectionSchema,
  type ContentEntryQuery,
  type ContentField,
  type CreateContentCollectionInput,
  type CreateContentEntryInput,
  type UpdateContentCollectionInput,
  type UpdateContentEntryInput
} from "./content-models.schemas.js";

type ContentModelDatabase = PrismaClient | Prisma.TransactionClient;
type RequestUser = { id: string };

type EntrySnapshot = {
  title: string;
  slug: string;
  locale: string;
  data: Record<string, unknown>;
  status: "DRAFT" | "PUBLISHED" | "ARCHIVED";
  publishedAt: string | null;
};

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

  async listEntries(collectionSlug: string, query: ContentEntryQuery, allowDrafts: boolean) {
    const collection = await this.collectionBySlug(collectionSlug);
    if (!allowDrafts && !collection.publicRead) {
      throw new AppError(404, "content_collection_not_found", "Collection not found.");
    }

    const where: Prisma.CmsCollectionEntryWhereInput = {
      collectionId: collection.id,
      ...(query.locale ? { locale: query.locale } : {}),
      ...(query.q ? { title: { contains: query.q, mode: "insensitive" } } : {}),
      ...(!allowDrafts || !query.includeDrafts ? publicVisibility() : {})
    };
    const skip = (query.page - 1) * query.limit;
    const [entries, total] = await Promise.all([
      this.prisma.cmsCollectionEntry.findMany({
        where,
        orderBy: [{ publishedAt: "desc" }, { updatedAt: "desc" }, { id: "desc" }],
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
