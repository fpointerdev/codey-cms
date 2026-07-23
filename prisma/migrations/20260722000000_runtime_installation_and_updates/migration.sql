CREATE TYPE "RuntimeInstallationStatus" AS ENUM ('PENDING', 'COMPLETE');
CREATE TYPE "RuntimeUpdateStatus" AS ENUM ('AVAILABLE', 'STAGED', 'APPLYING', 'SUCCEEDED', 'FAILED', 'ROLLED_BACK');

CREATE TABLE "RuntimeInstallation" (
  "id" TEXT NOT NULL DEFAULT 'primary',
  "status" "RuntimeInstallationStatus" NOT NULL DEFAULT 'PENDING',
  "runtimeVersion" TEXT NOT NULL,
  "releaseChannel" TEXT NOT NULL DEFAULT 'stable',
  "siteId" TEXT,
  "ownerUserId" TEXT,
  "completedAt" TIMESTAMP(3),
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "RuntimeInstallation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RuntimeUpdate" (
  "id" TEXT NOT NULL,
  "fromVersion" TEXT NOT NULL,
  "toVersion" TEXT NOT NULL,
  "status" "RuntimeUpdateStatus" NOT NULL DEFAULT 'AVAILABLE',
  "releaseManifest" JSONB,
  "backupId" TEXT,
  "requestedByUserId" TEXT,
  "error" TEXT,
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "RuntimeUpdate_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "RuntimeUpdate_status_createdAt_idx" ON "RuntimeUpdate"("status", "createdAt");
CREATE INDEX "RuntimeUpdate_toVersion_idx" ON "RuntimeUpdate"("toVersion");
CREATE UNIQUE INDEX "RuntimeUpdate_one_active_idx"
  ON "RuntimeUpdate" ((1))
  WHERE "status" IN ('STAGED', 'APPLYING');

INSERT INTO "RuntimeInstallation" (
  "id",
  "status",
  "runtimeVersion",
  "releaseChannel",
  "siteId",
  "ownerUserId",
  "completedAt",
  "createdAt",
  "updatedAt"
)
SELECT
  'primary',
  'COMPLETE'::"RuntimeInstallationStatus",
  '0.9.0',
  'stable',
  (SELECT "id" FROM "Site" WHERE "slug" = 'default' LIMIT 1),
  "User"."id",
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "User"
JOIN "UserRole" ON "UserRole"."userId" = "User"."id"
JOIN "Role" ON "Role"."id" = "UserRole"."roleId"
WHERE "Role"."name" = 'owner'
LIMIT 1
ON CONFLICT ("id") DO NOTHING;
