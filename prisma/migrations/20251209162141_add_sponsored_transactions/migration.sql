-- CreateEnum
CREATE TYPE "SponsoredTransactionType" AS ENUM ('USER_TRANSACTION', 'TRANSFER', 'YIELD_OPERATION', 'CUSTOM');

-- CreateEnum
CREATE TYPE "TransactionStatus" AS ENUM ('PENDING', 'SUBMITTED', 'CONFIRMED', 'FAILED');

-- CreateTable
CREATE TABLE "sponsored_transactions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "paymentId" TEXT,
    "type" "SponsoredTransactionType" NOT NULL,
    "signature" TEXT,
    "solFeePaid" DOUBLE PRECISION,
    "usdcCreditUsed" DOUBLE PRECISION,
    "serializedTransaction" TEXT,
    "transactionSignature" TEXT,
    "status" "TransactionStatus" NOT NULL DEFAULT 'PENDING',
    "errorMessage" TEXT,
    "network" TEXT NOT NULL,
    "explorerUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sponsored_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sponsored_transactions_signature_key" ON "sponsored_transactions"("signature");

-- AddForeignKey
ALTER TABLE "sponsored_transactions" ADD CONSTRAINT "sponsored_transactions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sponsored_transactions" ADD CONSTRAINT "sponsored_transactions_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "gasless_payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
