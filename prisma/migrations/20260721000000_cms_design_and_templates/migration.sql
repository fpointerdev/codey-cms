-- CreateEnum
CREATE TYPE "CmsTemplateType" AS ENUM ('SECTION', 'PAGE');

-- CreateTable
CREATE TABLE "CmsTemplate" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "type" "CmsTemplateType" NOT NULL,
    "content" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CmsTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CmsTemplate_siteId_type_name_key" ON "CmsTemplate"("siteId", "type", "name");

-- CreateIndex
CREATE INDEX "CmsTemplate_siteId_type_updatedAt_idx" ON "CmsTemplate"("siteId", "type", "updatedAt");
