-- CreateEnum
CREATE TYPE "OrderTrackingStatus" AS ENUM ('PREPARING', 'SHIPPED', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERED', 'DELAYED');

-- CreateEnum
CREATE TYPE "OrderSupportCaseType" AS ENUM ('CANCELLATION', 'COMPLAINT', 'RETURN', 'OTHER');

-- CreateEnum
CREATE TYPE "OrderSupportCaseStatus" AS ENUM ('OPEN', 'IN_REVIEW', 'RESOLVED', 'CLOSED');

-- CreateTable
CREATE TABLE "BuyerSession" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BuyerSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BuyerSessionOrder" (
    "sessionId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "claimedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BuyerSessionOrder_pkey" PRIMARY KEY ("sessionId","orderId")
);

-- CreateTable
CREATE TABLE "OrderTracking" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "status" "OrderTrackingStatus" NOT NULL DEFAULT 'PREPARING',
    "carrier" TEXT,
    "trackingNumber" TEXT,
    "trackingUrl" TEXT,
    "estimatedDeliveryAt" TIMESTAMP(3),
    "shippedAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrderTracking_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderSupportCase" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "type" "OrderSupportCaseType" NOT NULL,
    "status" "OrderSupportCaseStatus" NOT NULL DEFAULT 'OPEN',
    "subject" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "merchantResponse" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrderSupportCase_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BuyerSession_tokenHash_key" ON "BuyerSession"("tokenHash");
CREATE INDEX "BuyerSession_expiresAt_idx" ON "BuyerSession"("expiresAt");
CREATE INDEX "BuyerSessionOrder_orderId_idx" ON "BuyerSessionOrder"("orderId");
CREATE UNIQUE INDEX "OrderTracking_orderId_key" ON "OrderTracking"("orderId");
CREATE INDEX "OrderTracking_status_updatedAt_idx" ON "OrderTracking"("status", "updatedAt");
CREATE INDEX "OrderSupportCase_orderId_status_createdAt_idx" ON "OrderSupportCase"("orderId", "status", "createdAt");
CREATE INDEX "OrderSupportCase_status_createdAt_idx" ON "OrderSupportCase"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "BuyerSessionOrder" ADD CONSTRAINT "BuyerSessionOrder_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "BuyerSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BuyerSessionOrder" ADD CONSTRAINT "BuyerSessionOrder_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OrderTracking" ADD CONSTRAINT "OrderTracking_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OrderSupportCase" ADD CONSTRAINT "OrderSupportCase_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
