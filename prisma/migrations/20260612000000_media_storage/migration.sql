ALTER TABLE "MediaAsset" ADD COLUMN "siteId" TEXT;
ALTER TABLE "MediaAsset" ADD COLUMN "originalFilename" TEXT;
ALTER TABLE "MediaAsset" ADD COLUMN "checksumSha256" TEXT;
ALTER TABLE "MediaAsset" ADD COLUMN "variants" JSONB;
ALTER TABLE "MediaAsset" ADD COLUMN "deletedAt" TIMESTAMP(3);

CREATE INDEX "MediaAsset_siteId_createdAt_idx" ON "MediaAsset"("siteId", "createdAt");
CREATE INDEX "MediaAsset_storageKey_idx" ON "MediaAsset"("storageKey");
CREATE INDEX "MediaAsset_deletedAt_idx" ON "MediaAsset"("deletedAt");
