import assert from "node:assert/strict";
import test from "node:test";
import { prisma } from "../../src/infrastructure/database/prisma.js";
import { AppError } from "../../src/core/errors/app-error.js";
import { ContentModelsService } from "../../src/modules/cms/content-models.service.js";
import type { ExtensionManifest } from "../../src/extensions/extension-manifest.js";
import { extensionManifestSha256 } from "../../src/extensions/extension-integrity.js";

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
  const replacementSlug = `replacement-${runId}`;
  const companionSlug = `companion-${runId}`;
  const importedAuthorSlug = `imported-authors-${runId}`;
  const importedResourceSlug = `imported-resources-${runId}`;
  const extensionId = `integration.lifecycle-${runId}`;
  const relationExtensionId = `integration.relations-${runId}`;
  const relationPackSlug = `relation-pack-${runId}`;
  const relationTargetSlug = `relation-target-${runId}`;
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

    const filtered = await service.listEntries(resourceSlug, {
      locale: "en",
      includeDrafts: true,
      filter: ["author=ada-lovelace"],
      sortBy: "title",
      sortOrder: "asc",
      page: 1,
      limit: 25
    }, true);
    assert.deepEqual(filtered.entries.map((entry) => entry.title), ["A practical introduction", "Published later"]);

    const bundle = await service.exportContentBundle([authorSlug, resourceSlug]);
    const importedBundle = structuredClone(bundle);
    const importedAuthors = importedBundle.collections.find((collection) => collection.model.slug === authorSlug)!;
    const importedResources = importedBundle.collections.find((collection) => collection.model.slug === resourceSlug)!;
    importedAuthors.model.slug = importedAuthorSlug;
    importedResources.model.slug = importedResourceSlug;
    const importedRelation = importedResources.model.fields.find((field) => field.type === "relation");
    if (importedRelation?.type === "relation") importedRelation.relationCollection = importedAuthorSlug;
    importedAuthors.model.fields.push({
      key: "favorite_resource",
      label: "Favorite resource",
      type: "relation",
      required: false,
      multiple: false,
      relationCollection: importedResourceSlug
    });
    const importedAda = importedAuthors.entries.find((entry) => entry.slug === "ada-lovelace");
    if (importedAda) importedAda.data.favorite_resource = "first-guide";
    importedBundle.collections.reverse();
    const imported = await service.importContentBundle(importedBundle, user);
    assert.equal(imported.collections.length, 2);
    assert.equal(imported.entries, bundle.collections.reduce((total, collection) => total + collection.entries.length, 0));
    assert.equal(
      (await service.getEntry(importedResourceSlug, "compiler-guide", "en", true)).entry.title,
      "A practical compiler history"
    );
    await assert.rejects(
      service.importContentBundle(importedBundle, user),
      (error: unknown) => error instanceof AppError && error.code === "extension_collection_conflict"
    );

    const extension = (version: string, contentModels: ExtensionManifest["contentModels"]): ExtensionManifest => ({
      schemaVersion: "1.0",
      id: extensionId,
      name: "Lifecycle pack",
      version,
      description: "Exercises safe extension lifecycle behavior.",
      license: "GPL-2.0-or-later",
      author: { name: "Integration" },
      requires: { cms: ">=1.1.0 <2.0.0" },
      contentModels
    });
    const firstManifest = extension("1.0.0", [{
      name: "Pack resources",
      slug: packSlug,
      titleField: "title",
      fields: [{ key: "title", label: "Title", type: "text", required: true, multiple: false }],
      publicRead: true
    }]);
    const concurrentInstall = await Promise.allSettled([
      service.installExtension(firstManifest),
      service.installExtension(firstManifest)
    ]);
    assert.equal(concurrentInstall.filter((result) => result.status === "fulfilled").length, 1);
    const successfulInstall = concurrentInstall.find((result) => result.status === "fulfilled");
    assert.ok(successfulInstall?.status === "fulfilled");
    assert.equal("manifest" in successfulInstall.value.installation, false);
    assert.equal("siteId" in successfulInstall.value.installation, false);
    assert.equal(
      concurrentInstall.some((result) => (
        result.status === "rejected" &&
        result.reason instanceof AppError &&
        result.reason.code === "extension_already_installed"
      )),
      true
    );
    assert.equal((await service.planExtension(firstManifest)).status, "installed");

    const secondManifest = extension("1.1.0", [{
      ...firstManifest.contentModels[0],
      fields: [
        ...firstManifest.contentModels[0].fields,
        { key: "summary", label: "Summary", type: "textarea", required: false, multiple: false }
      ]
    }]);
    assert.equal((await service.planExtension(secondManifest)).status, "updateAvailable");
    await service.updateExtension(secondManifest);
    await service.createEntry(packSlug, {
      slug: "installed-entry",
      locale: "en",
      data: { title: "Installed entry", summary: "" },
      status: "PUBLISHED"
    }, user);

    const incompatibleManifest = extension("1.2.0", [{
      ...secondManifest.contentModels[0],
      fields: secondManifest.contentModels[0].fields.map((field) => (
        field.key === "summary" ? { ...field, required: true } : field
      ))
    }]);
    await assert.rejects(
      service.updateExtension(incompatibleManifest),
      (error: unknown) => error instanceof AppError && error.code === "content_collection_schema_incompatible"
    );
    assert.equal(
      (await service.listExtensionInstallations()).find((installation) => installation.extensionId === extensionId)?.version,
      "1.1.0"
    );
    await prisma.cmsExtensionInstallation.update({
      where: { siteId_extensionId: { siteId: (await prisma.site.findUniqueOrThrow({ where: { slug: "default" } })).id, extensionId } },
      data: { manifestSha256: "0".repeat(64) }
    });
    assert.equal((await service.planExtension(secondManifest)).status, "receiptInvalid");
    await prisma.cmsExtensionInstallation.updateMany({
      where: { extensionId },
      data: { manifestSha256: extensionManifestSha256(secondManifest) }
    });

    await service.updateCollection(packSlug, { description: "Customized locally" });
    const retainedModelUpdate = extension("1.2.0", [{
      ...secondManifest.contentModels[0],
      fields: [
        ...secondManifest.contentModels[0].fields,
        { key: "category", label: "Category", type: "text", required: false, multiple: false }
      ]
    }]);
    assert.equal((await service.planExtension(retainedModelUpdate)).status, "customized");

    const replacementManifest = extension("1.3.0", [
      {
        name: "Replacement resources",
        slug: replacementSlug,
        titleField: "title",
        fields: [
          { key: "title", label: "Title", type: "text", required: true, multiple: false },
          { key: "companion", label: "Companion", type: "relation", required: false, multiple: false, relationCollection: companionSlug }
        ],
        publicRead: true
      },
      {
        name: "Companion resources",
        slug: companionSlug,
        titleField: "title",
        fields: [
          { key: "title", label: "Title", type: "text", required: true, multiple: false },
          { key: "replacement", label: "Replacement", type: "relation", required: false, multiple: false, relationCollection: replacementSlug }
        ],
        publicRead: true
      }
    ]);
    assert.equal((await service.planExtension(replacementManifest)).status, "updateAvailable");
    const updatedExtension = await service.updateExtension(replacementManifest);
    assert.deepEqual(updatedExtension.preservedCollections, [packSlug]);
    const disconnected = await service.disconnectExtension(extensionId, extensionId);
    assert.deepEqual(disconnected.preservedCollections.sort(), [companionSlug, replacementSlug].sort());
    assert.equal((await service.listCollections()).some((collection) => collection.slug === packSlug), true);

    await service.createCollection({
      name: "Relation targets",
      slug: relationTargetSlug,
      titleField: "title",
      fields: [{ key: "title", label: "Title", type: "text", required: true, multiple: false }],
      publicRead: true
    });
    const relationManifest = (version: string): ExtensionManifest => ({
      schemaVersion: "1.0",
      id: relationExtensionId,
      name: "Relation pack",
      version,
      description: "Verifies final relation integrity on update.",
      license: "GPL-2.0-or-later",
      author: { name: "Integration" },
      requires: { cms: ">=1.1.0 <2.0.0" },
      contentModels: [{
        name: "Related resources",
        slug: relationPackSlug,
        titleField: "title",
        fields: [
          { key: "title", label: "Title", type: "text", required: true, multiple: false },
          { key: "target", label: "Target", type: "relation", required: false, multiple: false, relationCollection: relationTargetSlug }
        ],
        publicRead: true
      }]
    });
    await service.installExtension(relationManifest("1.0.0"));
    await prisma.cmsCollection.deleteMany({ where: { slug: relationTargetSlug } });
    await assert.rejects(
      service.updateExtension(relationManifest("1.1.0")),
      (error: unknown) => error instanceof AppError && error.code === "content_collection_relation_invalid"
    );
    assert.equal(
      (await service.listExtensionInstallations()).find((installation) => installation.extensionId === relationExtensionId)?.version,
      "1.0.0"
    );
  } finally {
    await prisma.cmsExtensionInstallation.deleteMany({ where: { extensionId: { in: [extensionId, relationExtensionId] } } });
    await prisma.cmsCollection.deleteMany({
      where: {
        slug: {
          in: [
            resourceSlug,
            authorSlug,
            packSlug,
            replacementSlug,
            companionSlug,
            relationPackSlug,
            relationTargetSlug,
            importedAuthorSlug,
            importedResourceSlug
          ]
        }
      }
    });
    await prisma.$disconnect();
  }
});
