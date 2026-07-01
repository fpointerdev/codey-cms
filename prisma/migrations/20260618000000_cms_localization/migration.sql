ALTER TABLE "CmsPage" ADD COLUMN "locale" TEXT NOT NULL DEFAULT 'en';
ALTER TABLE "CmsPage" ADD COLUMN "translationGroupId" TEXT;
ALTER TABLE "CmsPost" ADD COLUMN "locale" TEXT NOT NULL DEFAULT 'en';
ALTER TABLE "CmsPost" ADD COLUMN "translationGroupId" TEXT;
ALTER TABLE "CmsCategory" ADD COLUMN "locale" TEXT NOT NULL DEFAULT 'en';
ALTER TABLE "CmsCategory" ADD COLUMN "translationGroupId" TEXT;
ALTER TABLE "Menu" ADD COLUMN "locale" TEXT NOT NULL DEFAULT 'en';

DROP INDEX "CmsPage_slug_key";
DROP INDEX "CmsPost_slug_key";
DROP INDEX "CmsCategory_slug_key";
DROP INDEX "Menu_slug_key";

CREATE UNIQUE INDEX "CmsPage_locale_slug_key" ON "CmsPage"("locale", "slug");
CREATE INDEX "CmsPage_locale_status_publishedAt_idx" ON "CmsPage"("locale", "status", "publishedAt");
CREATE INDEX "CmsPage_translationGroupId_idx" ON "CmsPage"("translationGroupId");

CREATE UNIQUE INDEX "CmsPost_locale_slug_key" ON "CmsPost"("locale", "slug");
CREATE INDEX "CmsPost_locale_status_publishedAt_idx" ON "CmsPost"("locale", "status", "publishedAt");
CREATE INDEX "CmsPost_translationGroupId_idx" ON "CmsPost"("translationGroupId");

CREATE UNIQUE INDEX "CmsCategory_locale_slug_key" ON "CmsCategory"("locale", "slug");
CREATE INDEX "CmsCategory_locale_name_idx" ON "CmsCategory"("locale", "name");
CREATE INDEX "CmsCategory_translationGroupId_idx" ON "CmsCategory"("translationGroupId");

CREATE UNIQUE INDEX "Menu_locale_slug_key" ON "Menu"("locale", "slug");
CREATE INDEX "Menu_locale_location_idx" ON "Menu"("locale", "location");
