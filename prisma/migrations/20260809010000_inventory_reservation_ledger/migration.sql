ALTER TABLE "Product"
ADD COLUMN "reservedQuantity" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "ProductVariant"
ADD COLUMN "reservedQuantity" INTEGER NOT NULL DEFAULT 0;

CREATE TYPE "InventoryReservationStatus" AS ENUM (
  'ACTIVE',
  'CONSUMED',
  'RELEASED',
  'EXPIRED'
);

CREATE TABLE "InventoryReservation" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "selectionKey" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "variantId" TEXT,
  "quantity" INTEGER NOT NULL,
  "status" "InventoryReservationStatus" NOT NULL DEFAULT 'ACTIVE',
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "consumedAt" TIMESTAMP(3),
  "releasedAt" TIMESTAMP(3),
  "releaseReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "InventoryReservation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "InventoryReservation_orderId_fkey"
    FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "InventoryReservation_quantity_positive" CHECK ("quantity" > 0)
);

CREATE UNIQUE INDEX "InventoryReservation_orderId_selectionKey_key"
ON "InventoryReservation"("orderId", "selectionKey");

CREATE INDEX "InventoryReservation_status_expiresAt_idx"
ON "InventoryReservation"("status", "expiresAt");

CREATE INDEX "InventoryReservation_productId_variantId_status_idx"
ON "InventoryReservation"("productId", "variantId", "status");
