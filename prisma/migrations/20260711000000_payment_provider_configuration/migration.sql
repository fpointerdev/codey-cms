-- CreateEnum
CREATE TYPE "PaymentProviderMode" AS ENUM ('SANDBOX', 'LIVE');

-- CreateTable
CREATE TABLE "PaymentProviderConfig" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "provider" "PaymentProvider" NOT NULL,
    "mode" "PaymentProviderMode" NOT NULL DEFAULT 'SANDBOX',
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "publishableKey" TEXT,
    "clientId" TEXT,
    "webhookId" TEXT,
    "encryptedCredentials" TEXT,
    "instructions" TEXT,
    "lastTestedAt" TIMESTAMP(3),
    "lastTestSucceeded" BOOLEAN,
    "lastTestMessage" TEXT,
    "lastWebhookAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentProviderConfig_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PaymentProviderConfig_siteId_provider_key" ON "PaymentProviderConfig"("siteId", "provider");

-- CreateIndex
CREATE INDEX "PaymentProviderConfig_siteId_enabled_idx" ON "PaymentProviderConfig"("siteId", "enabled");

-- CreateIndex
CREATE INDEX "PaymentProviderConfig_provider_enabled_idx" ON "PaymentProviderConfig"("provider", "enabled");
