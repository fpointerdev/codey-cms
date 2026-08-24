CREATE TABLE "CmsCollection" (
  "id" TEXT NOT NULL,
  "siteId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "description" TEXT,
  "titleField" TEXT NOT NULL DEFAULT 'title',
  "fields" JSONB NOT NULL,
  "publicRead" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "CmsCollection_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CmsCollectionEntry" (
  "id" TEXT NOT NULL,
  "collectionId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "locale" TEXT NOT NULL DEFAULT 'en',
  "data" JSONB NOT NULL,
  "status" "CmsPublishStatus" NOT NULL DEFAULT 'DRAFT',
  "publishedAt" TIMESTAMP(3),
  "createdById" TEXT,
  "updatedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "CmsCollectionEntry_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CmsCollectionEntry_collectionId_fkey"
    FOREIGN KEY ("collectionId") REFERENCES "CmsCollection"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "CmsCollectionEntryRevision" (
  "id" TEXT NOT NULL,
  "entryId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "action" TEXT NOT NULL,
  "snapshot" JSONB NOT NULL,
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "CmsCollectionEntryRevision_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CmsCollectionEntryRevision_entryId_fkey"
    FOREIGN KEY ("entryId") REFERENCES "CmsCollectionEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "CmsCollection_siteId_slug_key" ON "CmsCollection"("siteId", "slug");
CREATE INDEX "CmsCollection_siteId_updatedAt_idx" ON "CmsCollection"("siteId", "updatedAt");
CREATE UNIQUE INDEX "CmsCollectionEntry_collectionId_locale_slug_key" ON "CmsCollectionEntry"("collectionId", "locale", "slug");
CREATE INDEX "CmsCollectionEntry_collectionId_locale_status_publishedAt_idx" ON "CmsCollectionEntry"("collectionId", "locale", "status", "publishedAt");
CREATE INDEX "CmsCollectionEntry_collectionId_updatedAt_idx" ON "CmsCollectionEntry"("collectionId", "updatedAt");
CREATE UNIQUE INDEX "CmsCollectionEntryRevision_entryId_version_key" ON "CmsCollectionEntryRevision"("entryId", "version");
CREATE INDEX "CmsCollectionEntryRevision_entryId_createdAt_idx" ON "CmsCollectionEntryRevision"("entryId", "createdAt");
