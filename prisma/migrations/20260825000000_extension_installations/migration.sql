CREATE TABLE "CmsExtensionInstallation" (
  "id" TEXT NOT NULL,
  "siteId" TEXT NOT NULL,
  "extensionId" TEXT NOT NULL,
  "version" TEXT NOT NULL,
  "manifestSha256" TEXT NOT NULL,
  "manifest" JSONB NOT NULL,
  "installedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "CmsExtensionInstallation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CmsExtensionInstallation_siteId_extensionId_key"
  ON "CmsExtensionInstallation"("siteId", "extensionId");
CREATE INDEX "CmsExtensionInstallation_siteId_updatedAt_idx"
  ON "CmsExtensionInstallation"("siteId", "updatedAt");
