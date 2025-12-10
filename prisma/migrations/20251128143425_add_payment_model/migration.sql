/*
  Warnings:

  - The values [COMPLETED,REFUNDED,PROCESSING] on the enum `PaymentStatus` will be removed. If these variants are still used in the database, this will fail.
  - The values [ADMIN,SUPER_ADMIN] on the enum `UserRole` will be removed. If these variants are still used in the database, this will fail.
  - You are about to drop the column `metadata` on the `payments` table. All the data in the column will be lost.
  - You are about to drop the column `planId` on the `payments` table. All the data in the column will be lost.
  - The `paymentProof` column on the `payments` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - You are about to drop the column `planExpiresAt` on the `users` table. All the data in the column will be lost.
  - You are about to drop the column `planId` on the `users` table. All the data in the column will be lost.
  - You are about to drop the column `planStartedAt` on the `users` table. All the data in the column will be lost.
  - You are about to drop the `usage_tracking` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `user_plans` table. If the table is not empty, all the data it contains will be lost.
  - Added the required column `amountUSDC` to the `payments` table without a default value. This is not possible if the table is not empty.
  - Added the required column `decimals` to the `payments` table without a default value. This is not possible if the table is not empty.
  - Added the required column `toAddress` to the `payments` table without a default value. This is not possible if the table is not empty.
  - Added the required column `tokenAccount` to the `payments` table without a default value. This is not possible if the table is not empty.
  - Added the required column `tokenType` to the `payments` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "PaymentType" AS ENUM ('X402_PAYMENT', 'SUBSCRIPTION', 'OTHER');

-- AlterEnum
BEGIN;
CREATE TYPE "PaymentStatus_new" AS ENUM ('PENDING', 'VERIFIED', 'CONFIRMED', 'FAILED', 'CANCELLED');
ALTER TABLE "payments" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "payments" ALTER COLUMN "status" TYPE "PaymentStatus_new" USING ("status"::text::"PaymentStatus_new");
ALTER TYPE "PaymentStatus" RENAME TO "PaymentStatus_old";
ALTER TYPE "PaymentStatus_new" RENAME TO "PaymentStatus";
DROP TYPE "PaymentStatus_old";
ALTER TABLE "payments" ALTER COLUMN "status" SET DEFAULT 'PENDING';
COMMIT;

-- AlterEnum
BEGIN;
CREATE TYPE "UserRole_new" AS ENUM ('USER');
ALTER TABLE "users" ALTER COLUMN "role" DROP DEFAULT;
ALTER TABLE "users" ALTER COLUMN "role" TYPE "UserRole_new" USING ("role"::text::"UserRole_new");
ALTER TYPE "UserRole" RENAME TO "UserRole_old";
ALTER TYPE "UserRole_new" RENAME TO "UserRole";
DROP TYPE "UserRole_old";
ALTER TABLE "users" ALTER COLUMN "role" SET DEFAULT 'USER';
COMMIT;

-- DropForeignKey
ALTER TABLE "payments" DROP CONSTRAINT "payments_planId_fkey";

-- DropForeignKey
ALTER TABLE "payments" DROP CONSTRAINT "payments_userId_fkey";

-- DropForeignKey
ALTER TABLE "usage_tracking" DROP CONSTRAINT "usage_tracking_userId_fkey";

-- DropForeignKey
ALTER TABLE "users" DROP CONSTRAINT "users_planId_fkey";

-- AlterTable
ALTER TABLE "payments" DROP COLUMN "metadata",
DROP COLUMN "planId",
ADD COLUMN     "amountUSDC" DOUBLE PRECISION NOT NULL,
ADD COLUMN     "decimals" INTEGER NOT NULL,
ADD COLUMN     "explorerUrl" TEXT,
ADD COLUMN     "fromAddress" TEXT,
ADD COLUMN     "network" TEXT,
ADD COLUMN     "scheme" TEXT,
ADD COLUMN     "serializedTransaction" TEXT,
ADD COLUMN     "toAddress" TEXT NOT NULL,
ADD COLUMN     "tokenAccount" TEXT NOT NULL,
ADD COLUMN     "tokenType" "TokenType" NOT NULL,
ADD COLUMN     "type" "PaymentType" NOT NULL DEFAULT 'X402_PAYMENT',
ADD COLUMN     "x402Version" INTEGER,
ALTER COLUMN "userId" DROP NOT NULL,
DROP COLUMN "paymentProof",
ADD COLUMN     "paymentProof" JSONB;

-- AlterTable
ALTER TABLE "users" DROP COLUMN "planExpiresAt",
DROP COLUMN "planId",
DROP COLUMN "planStartedAt";

-- DropTable
DROP TABLE "usage_tracking";

-- DropTable
DROP TABLE "user_plans";

-- DropEnum
DROP TYPE "UsagePeriodType";

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
