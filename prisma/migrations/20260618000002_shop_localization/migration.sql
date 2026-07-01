ALTER TABLE "ProductCategory" ADD COLUMN "locale" TEXT NOT NULL DEFAULT 'en';
ALTER TABLE "ProductCategory" ADD COLUMN "translationGroupId" TEXT;
ALTER TABLE "ProductAttribute" ADD COLUMN "locale" TEXT NOT NULL DEFAULT 'en';
ALTER TABLE "ProductAttribute" ADD COLUMN "translationGroupId" TEXT;
ALTER TABLE "Product" ADD COLUMN "locale" TEXT NOT NULL DEFAULT 'en';
ALTER TABLE "Product" ADD COLUMN "translationGroupId" TEXT;

DROP INDEX "ProductCategory_slug_key";
DROP INDEX "ProductAttribute_slug_key";
DROP INDEX "Product_slug_key";

CREATE UNIQUE INDEX "ProductCategory_locale_slug_key" ON "ProductCategory"("locale", "slug");
CREATE INDEX "ProductCategory_locale_sortOrder_idx" ON "ProductCategory"("locale", "sortOrder");
CREATE INDEX "ProductCategory_translationGroupId_idx" ON "ProductCategory"("translationGroupId");

CREATE UNIQUE INDEX "ProductAttribute_locale_slug_key" ON "ProductAttribute"("locale", "slug");
CREATE INDEX "ProductAttribute_locale_sortOrder_idx" ON "ProductAttribute"("locale", "sortOrder");
CREATE INDEX "ProductAttribute_translationGroupId_idx" ON "ProductAttribute"("translationGroupId");

CREATE UNIQUE INDEX "Product_locale_slug_key" ON "Product"("locale", "slug");
CREATE INDEX "Product_locale_status_createdAt_idx" ON "Product"("locale", "status", "createdAt");
CREATE INDEX "Product_translationGroupId_idx" ON "Product"("translationGroupId");
