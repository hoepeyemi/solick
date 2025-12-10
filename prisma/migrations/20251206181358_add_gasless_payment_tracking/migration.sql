/*
  Warnings:

  - You are about to drop the `proposals` table. If the table is not empty, all the data it contains will be lost.

*/
-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'VERIFIED', 'CONFIRMED', 'FAILED', 'CANCELLED');

-- DropForeignKey
ALTER TABLE "proposals" DROP CONSTRAINT "proposals_userId_fkey";

-- DropTable
DROP TABLE "proposals";

-- DropEnum
DROP TYPE "ExecutionType";

-- DropEnum
DROP TYPE "ProposalStatus";

-- CreateTable
CREATE TABLE "gasless_payments" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "amountUSDC" DOUBLE PRECISION NOT NULL,
    "amount" TEXT NOT NULL,
    "signature" TEXT NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "creditRemaining" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "creditUsed" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "recipientTokenAccount" TEXT NOT NULL,
    "recipientWallet" TEXT NOT NULL,
    "fromAddress" TEXT,
    "network" TEXT NOT NULL,
    "tokenMint" TEXT NOT NULL,
    "paymentProof" JSONB,
    "explorerUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "gasless_payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "gasless_payments_signature_key" ON "gasless_payments"("signature");

-- AddForeignKey
ALTER TABLE "gasless_payments" ADD CONSTRAINT "gasless_payments_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
