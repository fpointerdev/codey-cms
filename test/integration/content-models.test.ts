import assert from "node:assert/strict";
import test from "node:test";
import { prisma } from "../../src/infrastructure/database/prisma.js";
import { AppError } from "../../src/core/errors/app-error.js";
import { ContentModelsService } from "../../src/modules/cms/content-models.service.js";

test("custom collections persist, protect schema changes, revise entries, and publish safely", async () => {
  const service = new ContentModelsService(prisma);
  await prisma.site.upsert({
    where: { slug: "default" },
    update: {},
    create: { slug: "default", name: "Integration site", deploymentProfile: "cms" }
  });
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const authorSlug = `authors-${runId}`;
  const resourceSlug = `resources-${runId}`;
  const packSlug = `pack-${runId}`;
  const user = { id: `integration-${runId}` };
  const authorFields = [{
    key: "name",
    label: "Name",
    type: "text" as const,
    required: true,
    multiple: false,
    maxLength: 120
  }];
  const resourceFields = [
    {
      key: "title",
      label: "Title",
      type: "text" as const,
      required: true,
      multiple: false,
      maxLength: 160
    },
    {
      key: "subtitle",
      label: "Subtitle",
      type: "text" as const,
      required: true,
      multiple: false,
      maxLength: 160
    },
    {
      key: "body",
      label: "Body",
      type: "richText" as const,
      required: false,
      multiple: false
    },
    {
      key: "author",
      label: "Author",
      type: "relation" as const,
      required: true,
      multiple: false,
      relationCollection: authorSlug
    }
  ];

  try {
    await service.createCollection({
      name: "Authors",
      slug: authorSlug,
      titleField: "name",
      fields: authorFields,
      publicRead: true
    });
    await service.createEntry(authorSlug, {
      slug: "ada-lovelace",
      locale: "en",
      data: { name: "Ada Lovelace" },
      status: "PUBLISHED"
    }, user);
    await service.createCollection({
      name: "Resources",
      slug: resourceSlug,
      titleField: "title",
      fields: resourceFields,
      publicRead: true
    });
    await service.createEntry(resourceSlug, {
      slug: "first-guide",
      locale: "en",
      data: {
        title: "First guide",
        subtitle: "A practical introduction",
        body: "<p>Original body</p>",
        author: "ada-lovelace"
      },
      status: "DRAFT"
    }, user);

    const publicList = await service.listEntries(resourceSlug, {
      locale: "en",
      includeDrafts: false,
      page: 1,
      limit: 25
    }, false);
    assert.equal(publicList.entries.length, 0);

    const publicAuthor = await service.getEntry(authorSlug, "ada-lovelace", "en", false);
    assert.equal("createdById" in publicAuthor.entry, false);
    assert.equal("siteId" in publicAuthor.collection, false);

    const editorList = await service.listEntries(resourceSlug, {
      locale: "en",
      includeDrafts: true,
      page: 1,
      limit: 25
    }, true);
    assert.equal(editorList.entries.length, 1);

    await assert.rejects(
      service.updateCollection(resourceSlug, {
        fields: resourceFields.filter((field) => field.key !== "body")
      }),
      (error: unknown) => error instanceof AppError && error.code === "content_collection_schema_incompatible"
    );

    await service.updateCollection(resourceSlug, {
      titleField: "subtitle"
    });
    assert.equal(
      (await service.getEntry(resourceSlug, "first-guide", "en", true)).entry.title,
      "A practical introduction"
    );

    await service.updateEntry(resourceSlug, "first-guide", "en", {
      data: { body: "<p>Updated body</p>" },
      status: "PUBLISHED"
    }, user);
    const revisions = await service.listRevisions(resourceSlug, "first-guide", "en");
    assert.equal(revisions.length, 2);
    const restored = await service.restoreRevision(
      resourceSlug,
      "first-guide",
      "en",
      revisions.at(-1)!.id,
      user
    );
    assert.equal((restored.data as Record<string, unknown>).body, "<p>Original body</p>");
    assert.equal((await service.listRevisions(resourceSlug, "first-guide", "en")).length, 3);

    const publishAt = new Date(Date.now() + 60_000);
    await service.createEntry(resourceSlug, {
      slug: "scheduled-guide",
      locale: "en",
      data: {
        title: "Scheduled guide",
        subtitle: "Published later",
        body: "",
        author: "ada-lovelace"
      },
      status: "DRAFT",
      publishedAt: publishAt
    }, user);
    assert.equal((await service.listScheduledEntries()).some((entry) => entry.slug === "scheduled-guide"), true);
    assert.equal(await service.publishScheduledEntries(new Date(publishAt.getTime() + 1)), 1);

    await assert.rejects(
      service.updateEntry(authorSlug, "ada-lovelace", "en", { slug: "ada-byron" }, user),
      (error: unknown) => error instanceof AppError && error.code === "content_entry_in_use"
    );
    await service.createEntry(authorSlug, {
      slug: "grace-hopper",
      locale: "en",
      data: { name: "Grace Hopper" },
      status: "PUBLISHED"
    }, user);
    const graceRevision = (await service.listRevisions(authorSlug, "grace-hopper", "en"))[0];
    await service.updateEntry(authorSlug, "grace-hopper", "en", { slug: "grace-hopper-updated" }, user);
    await service.createEntry(resourceSlug, {
      slug: "compiler-guide",
      locale: "en",
      data: {
        title: "Compiler guide",
        subtitle: "A practical compiler history",
        body: "",
        author: "grace-hopper-updated"
      },
      status: "PUBLISHED"
    }, user);
    await assert.rejects(
      service.restoreRevision(authorSlug, "grace-hopper-updated", "en", graceRevision.id, user),
      (error: unknown) => error instanceof AppError && error.code === "content_entry_in_use"
    );
    assert.equal(
      (await service.getEntry(authorSlug, "grace-hopper-updated", "en", true)).entry.slug,
      "grace-hopper-updated"
    );
    await assert.rejects(
      service.deleteEntry(authorSlug, "ada-lovelace", "en"),
      (error: unknown) => error instanceof AppError && error.code === "content_entry_in_use"
    );
    await assert.rejects(
      service.deleteCollection(authorSlug, authorSlug),
      (error: unknown) => error instanceof AppError && error.code === "content_collection_in_use"
    );
    await assert.rejects(
      service.installCollectionPack([
        {
          name: "Pack",
          slug: packSlug,
          titleField: "title",
          fields: [{ key: "title", label: "Title", type: "text", required: true, multiple: false }],
          publicRead: true
        },
        {
          name: "Authors conflict",
          slug: authorSlug,
          titleField: "name",
          fields: authorFields,
          publicRead: true
        }
      ]),
      (error: unknown) => error instanceof AppError && error.code === "extension_collection_conflict"
    );
    assert.equal((await service.listCollections()).some((collection) => collection.slug === packSlug), false);
  } finally {
    await prisma.cmsCollection.deleteMany({
      where: { slug: { in: [resourceSlug, authorSlug, packSlug] } }
    });
    await prisma.$disconnect();
  }
});
