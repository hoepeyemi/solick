/*
  Warnings:

  - You are about to drop the column `currentBillingCycleEnd` on the `users` table. All the data in the column will be lost.
  - You are about to drop the column `currentBillingCycleStart` on the `users` table. All the data in the column will be lost.
  - You are about to drop the column `monthlyTransactionCount` on the `users` table. All the data in the column will be lost.
  - You are about to drop the column `monthlyVolume` on the `users` table. All the data in the column will be lost.
  - You are about to drop the column `subscriptionEnd` on the `users` table. All the data in the column will be lost.
  - You are about to drop the column `subscriptionPlan` on the `users` table. All the data in the column will be lost.
  - You are about to drop the column `subscriptionStart` on the `users` table. All the data in the column will be lost.
  - You are about to drop the column `webhookSecret` on the `users` table. All the data in the column will be lost.
  - You are about to drop the column `webhookUrl` on the `users` table. All the data in the column will be lost.
  - You are about to drop the `payment_records` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `usage_logs` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `webhook_events` table. If the table is not empty, all the data it contains will be lost.

*/
-- CreateEnum
CREATE TYPE "UsagePeriodType" AS ENUM ('DAILY', 'MONTHLY');

-- AlterEnum
ALTER TYPE "PaymentStatus" ADD VALUE 'PROCESSING';

-- DropForeignKey
ALTER TABLE "payment_records" DROP CONSTRAINT "payment_records_userId_fkey";

-- DropForeignKey
ALTER TABLE "usage_logs" DROP CONSTRAINT "usage_logs_userId_fkey";

-- DropIndex
DROP INDEX "users_walletAddress_key";

-- AlterTable
ALTER TABLE "users" DROP COLUMN "currentBillingCycleEnd",
DROP COLUMN "currentBillingCycleStart",
DROP COLUMN "monthlyTransactionCount",
DROP COLUMN "monthlyVolume",
DROP COLUMN "subscriptionEnd",
DROP COLUMN "subscriptionPlan",
DROP COLUMN "subscriptionStart",
DROP COLUMN "webhookSecret",
DROP COLUMN "webhookUrl",
ADD COLUMN     "planExpiresAt" TIMESTAMP(3),
ADD COLUMN     "planId" TEXT,
ADD COLUMN     "planStartedAt" TIMESTAMP(3);

-- DropTable
DROP TABLE "payment_records";

-- DropTable
DROP TABLE "usage_logs";

-- DropTable
DROP TABLE "webhook_events";

-- DropEnum
DROP TYPE "SubscriptionPlan";

-- CreateTable
CREATE TABLE "user_plans" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,
    "priceId" TEXT,
    "monthlyTransactionLimit" INTEGER,
    "dailyVolumeLimit" DOUBLE PRECISION,
    "features" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "usage_tracking" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "periodType" "UsagePeriodType" NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "transactionCount" INTEGER NOT NULL DEFAULT 0,
    "totalVolume" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "lastTransactionAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "usage_tracking_pkey" PRIMARY KEY ("id")
);



-- CreateTable
CREATE TABLE "payments" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "mintAddress" TEXT NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "transactionSignature" TEXT,
    "paymentProof" TEXT,
    "planId" TEXT,
    "metadata" JSONB,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_plans_name_key" ON "user_plans"("name");

-- CreateIndex
CREATE UNIQUE INDEX "usage_tracking_userId_periodType_periodStart_key" ON "usage_tracking"("userId", "periodType", "periodStart");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_planId_fkey" FOREIGN KEY ("planId") REFERENCES "user_plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usage_tracking" ADD CONSTRAINT "usage_tracking_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_planId_fkey" FOREIGN KEY ("planId") REFERENCES "user_plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;
