ALTER TYPE "ContentBlockType" ADD VALUE 'CONTACT_FORM';

CREATE TYPE "ContactSubmissionStatus" AS ENUM ('NEW', 'READ', 'SPAM');

CREATE TABLE "CmsCategory" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CmsCategory_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CmsPostCategory" (
    "postId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CmsPostCategory_pkey" PRIMARY KEY ("postId","categoryId")
);

CREATE TABLE "CmsRedirect" (
    "id" TEXT NOT NULL,
    "sourcePath" TEXT NOT NULL,
    "targetPath" TEXT NOT NULL,
    "statusCode" INTEGER NOT NULL DEFAULT 301,
    "preserveQuery" BOOLEAN NOT NULL DEFAULT true,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CmsRedirect_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ContactSubmission" (
    "id" TEXT NOT NULL,
    "formKey" TEXT NOT NULL DEFAULT 'contact',
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "subject" TEXT,
    "message" TEXT NOT NULL,
    "metadata" JSONB,
    "status" "ContactSubmissionStatus" NOT NULL DEFAULT 'NEW',
    "spamReason" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContactSubmission_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CmsCategory_slug_key" ON "CmsCategory"("slug");
CREATE INDEX "CmsCategory_name_idx" ON "CmsCategory"("name");
CREATE INDEX "CmsPost_tags_idx" ON "CmsPost" USING GIN ("tags");
CREATE INDEX "CmsPostCategory_categoryId_idx" ON "CmsPostCategory"("categoryId");
CREATE UNIQUE INDEX "CmsRedirect_sourcePath_key" ON "CmsRedirect"("sourcePath");
CREATE INDEX "CmsRedirect_active_idx" ON "CmsRedirect"("active");
CREATE INDEX "ContactSubmission_formKey_createdAt_idx" ON "ContactSubmission"("formKey", "createdAt");
CREATE INDEX "ContactSubmission_status_createdAt_idx" ON "ContactSubmission"("status", "createdAt");

ALTER TABLE "CmsPostCategory" ADD CONSTRAINT "CmsPostCategory_postId_fkey" FOREIGN KEY ("postId") REFERENCES "CmsPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CmsPostCategory" ADD CONSTRAINT "CmsPostCategory_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "CmsCategory"("id") ON DELETE CASCADE ON UPDATE CASCADE;
