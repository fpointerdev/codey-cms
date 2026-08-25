import assert from "node:assert/strict";
import test from "node:test";
import { AppError } from "../src/core/errors/app-error.js";
import {
  contentBundleSchema,
  contentEntryQuerySchema,
  createContentCollectionSchema,
  updateContentCollectionSchema
} from "../src/modules/cms/content-models.schemas.js";
import { normalizeContentEntryData } from "../src/modules/cms/content-models.service.js";

const fields = [
  {
    key: "title",
    label: "Title",
    type: "text" as const,
    required: true,
    multiple: false,
    maxLength: 120
  },
  {
    key: "body",
    label: "Body",
    type: "richText" as const,
    required: false,
    multiple: false
  },
  {
    key: "category",
    label: "Category",
    type: "select" as const,
    required: false,
    multiple: false,
    options: [
      { label: "News", value: "news" },
      { label: "Guides", value: "guides" }
    ]
  }
];

test("content collection contracts enforce stable field keys and a text title", () => {
  const collection = createContentCollectionSchema.parse({
    name: "Resources",
    slug: "resources",
    titleField: "title",
    fields,
    publicRead: true
  });

  assert.equal(collection.fields.length, 3);
  assert.equal(collection.publicRead, true);
  assert.equal(createContentCollectionSchema.safeParse({
    ...collection,
    fields: [...fields, { ...fields[0] }]
  }).success, false);
  assert.equal(createContentCollectionSchema.safeParse({
    ...collection,
    titleField: "category"
  }).success, false);
  assert.equal(createContentCollectionSchema.safeParse({
    ...collection,
    fields: [{ ...fields[0], key: "Title With Spaces" }]
  }).success, false);
  assert.equal(updateContentCollectionSchema.parse({ description: null }).description, null);
});

test("entry validation sanitizes rich text and rejects unknown or invalid values", () => {
  const normalized = normalizeContentEntryData(fields, {
    title: "Launch notes",
    body: '<p>Safe</p><script>alert("no")</script>',
    category: "news"
  });

  assert.equal(normalized.title, "Launch notes");
  assert.match(String(normalized.body), /<p>Safe<\/p>/);
  assert.doesNotMatch(String(normalized.body), /script|alert/);
  assert.throws(
    () => normalizeContentEntryData(fields, { title: "Entry", category: "unknown" }),
    (error: unknown) => error instanceof AppError && error.code === "content_entry_invalid"
  );
  assert.throws(
    () => normalizeContentEntryData(fields, { title: "Entry", removed_field: "preserve me" }),
    (error: unknown) => error instanceof AppError && error.code === "content_entry_invalid"
  );
  assert.throws(
    () => normalizeContentEntryData(fields, { title: "" }),
    (error: unknown) => error instanceof AppError && error.code === "content_entry_invalid"
  );
});

test("date fields reject impossible calendar dates", () => {
  const dateFields = [{
    key: "event_date",
    label: "Event date",
    type: "date" as const,
    required: true,
    multiple: false
  }];

  assert.equal(normalizeContentEntryData(dateFields, { event_date: "2028-02-29" }).event_date, "2028-02-29");
  assert.throws(
    () => normalizeContentEntryData(dateFields, { event_date: "2027-02-29" }),
    (error: unknown) => error instanceof AppError && error.code === "content_entry_invalid"
  );
});

test("email and URL fields normalize valid contact data and reject unsafe values", () => {
  const contactFields = [
    {
      key: "email",
      label: "Email",
      type: "email" as const,
      required: true,
      multiple: false
    },
    {
      key: "website",
      label: "Website",
      type: "url" as const,
      required: false,
      multiple: false
    }
  ];

  assert.deepEqual(normalizeContentEntryData(contactFields, {
    email: "editor@example.com",
    website: "https://example.com/about"
  }), {
    email: "editor@example.com",
    website: "https://example.com/about"
  });
  assert.throws(
    () => normalizeContentEntryData(contactFields, { email: "not-an-email", website: "https://example.com" }),
    (error: unknown) => error instanceof AppError && error.code === "content_entry_invalid"
  );
  assert.throws(
    () => normalizeContentEntryData(contactFields, { email: "editor@example.com", website: "javascript:alert(1)" }),
    (error: unknown) => error instanceof AppError && error.code === "content_entry_invalid"
  );
  assert.throws(
    () => normalizeContentEntryData(contactFields, { email: "editor@example.com", website: "https://user:secret@example.com" }),
    (error: unknown) => error instanceof AppError && error.code === "content_entry_invalid"
  );
  assert.equal(createContentCollectionSchema.safeParse({
    name: "Contacts",
    slug: "contacts",
    titleField: "name",
    fields: [
      { key: "name", label: "Name", type: "text", required: true },
      { key: "email", label: "Email", type: "email", maxLength: 321 }
    ]
  }).success, false);
});

test("multiple content values remain bounded and preserve their configured order", () => {
  const galleryField = [{
    key: "gallery",
    label: "Gallery",
    type: "image" as const,
    required: false,
    multiple: true
  }];
  const normalized = normalizeContentEntryData(galleryField, {
    gallery: [
      { url: "/uploads/one.webp", altText: "One", width: 800, height: 600 },
      { url: "https://cdn.example.com/two.webp", altText: "Two" }
    ]
  });

  assert.deepEqual((normalized.gallery as Array<{ altText: string }>).map((item) => item.altText), ["One", "Two"]);
  assert.throws(() => normalizeContentEntryData(galleryField, {
    gallery: Array.from({ length: 101 }, () => ({ url: "/uploads/image.webp" }))
  }), /no more than 100/);
});

test("collection queries expose bounded filters and deterministic sorting", () => {
  const query = contentEntryQuerySchema.parse({
    filter: ["category=news", "featured=true"],
    sortBy: "title",
    sortOrder: "asc"
  });

  assert.deepEqual(query.filter, ["category=news", "featured=true"]);
  assert.equal(query.sortBy, "title");
  assert.equal(query.sortOrder, "asc");
  assert.equal(contentEntryQuerySchema.safeParse({ filter: Array.from({ length: 11 }, () => "field=value") }).success, false);
});

test("content bundles reject duplicate identities and unbounded payloads", () => {
  const bundle = {
    schemaVersion: "1.0",
    kind: "codey-cms.content-bundle",
    collections: [{
      model: {
        name: "Resources",
        slug: "resources",
        titleField: "title",
        fields: [fields[0]],
        publicRead: true
      },
      entries: [{ slug: "guide", locale: "en", data: { title: "Guide" }, status: "PUBLISHED" }]
    }]
  };

  assert.equal(contentBundleSchema.safeParse(bundle).success, true);
  assert.equal(contentBundleSchema.safeParse({
    ...bundle,
    collections: [bundle.collections[0], bundle.collections[0]]
  }).success, false);
  assert.equal(contentBundleSchema.safeParse({
    ...bundle,
    collections: [{
      ...bundle.collections[0],
      entries: [bundle.collections[0].entries[0], bundle.collections[0].entries[0]]
    }]
  }).success, false);
});
