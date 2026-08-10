ALTER TABLE "Order"
ADD COLUMN "lookupTokenHash" TEXT;

ALTER TABLE "OrderNotification"
ADD COLUMN "secretEnvelope" TEXT;

DROP INDEX IF EXISTS "Order_orderNumber_customerEmail_idx";

CREATE UNIQUE INDEX "Order_lookupTokenHash_key"
ON "Order"("lookupTokenHash");
