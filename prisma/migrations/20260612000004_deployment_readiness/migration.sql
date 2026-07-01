CREATE TYPE "SiteDomainType" AS ENUM ('PLATFORM_SUBDOMAIN', 'CUSTOM');

CREATE TYPE "SiteDomainStatus" AS ENUM ('PENDING', 'ACTIVE', 'FAILED', 'DISABLED');

CREATE TABLE "SiteDomain" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "hostname" TEXT NOT NULL,
    "type" "SiteDomainType" NOT NULL,
    "status" "SiteDomainStatus" NOT NULL DEFAULT 'PENDING',
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "verificationToken" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "lastCheckedAt" TIMESTAMP(3),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SiteDomain_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SiteDomain_hostname_key" ON "SiteDomain"("hostname");
CREATE UNIQUE INDEX "SiteDomain_siteId_primary_key" ON "SiteDomain"("siteId") WHERE "isPrimary" = true;
CREATE INDEX "SiteDomain_siteId_type_idx" ON "SiteDomain"("siteId", "type");
CREATE INDEX "SiteDomain_status_idx" ON "SiteDomain"("status");
CREATE INDEX "SiteDomain_isPrimary_idx" ON "SiteDomain"("isPrimary");

ALTER TABLE "SiteDomain" ADD CONSTRAINT "SiteDomain_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;
