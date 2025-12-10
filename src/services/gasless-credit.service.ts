// src/services/gasless-credit.service.ts
import prisma from '../lib/prisma';
import Logger from '../utils/logger';

export interface CreditBalance {
  totalCredit: number;
  creditUSDC: number;
  payments: Array<{
    id: string;
    amountUSDC: number;
    creditRemaining: number;
    creditUsed: number;
    signature: string;
    status: string;
    createdAt: Date;
  }>;
}

export interface UseCreditResult {
  success: boolean;
  paymentId?: string;
  remainingCredit?: number;
  error?: string;
}

export class GaslessCreditService {
  /**
   * Record payment and add credit to user
   */
  async recordPayment(
    userId: string,
    paymentData: {
      signature: string;
      amountUSDC: number;
      amount: string;
      recipientTokenAccount: string;
      recipientWallet: string;
      fromAddress?: string;
      network: string;
      tokenMint: string;
      explorerUrl?: string;
    }
  ) {
    try {
      const payment = await prisma.gaslessPayment.create({
        data: {
          userId,
          amountUSDC: paymentData.amountUSDC,
          amount: paymentData.amount,
          signature: paymentData.signature,
          status: 'VERIFIED',
          creditRemaining: paymentData.amountUSDC, // Full amount available as credit
          creditUsed: 0,
          recipientTokenAccount: paymentData.recipientTokenAccount,
          recipientWallet: paymentData.recipientWallet,
          fromAddress: paymentData.fromAddress,
          network: paymentData.network,
          tokenMint: paymentData.tokenMint,
          explorerUrl: paymentData.explorerUrl,
        },
      });

      Logger.info(`Payment recorded and credit added for user ${userId}: ${payment.id}`);
      return payment;
    } catch (error) {
      Logger.error('Error recording payment:', error);
      throw error;
    }
  }

  /**
   * Get user's total available credit
   */
  async getUserCredit(userId: string): Promise<CreditBalance> {
    try {
      const payments = await prisma.gaslessPayment.findMany({
        where: {
          userId,
          status: 'VERIFIED',
        },
        orderBy: {
          createdAt: 'desc',
        },
        select: {
          id: true,
          amountUSDC: true,
          creditRemaining: true,
          creditUsed: true,
          signature: true,
          status: true,
          createdAt: true,
        },
      });

      // Calculate total credit from all verified payments
      const totalCredit = payments.reduce((sum, payment) => sum + payment.creditRemaining, 0);

      return {
        totalCredit,
        creditUSDC: totalCredit,
        payments: payments.map((p) => ({
          id: p.id,
          amountUSDC: p.amountUSDC,
          creditRemaining: p.creditRemaining,
          creditUsed: p.creditUsed,
          signature: p.signature,
          status: p.status,
          createdAt: p.createdAt,
        })),
      };
    } catch (error) {
      Logger.error('Error getting user credit:', error);
      throw error;
    }
  }

  /**
   * Get payment history for a user
   */
  async getPaymentHistory(userId: string, limit: number = 50) {
    try {
      const payments = await prisma.gaslessPayment.findMany({
        where: {
          userId,
        },
        orderBy: {
          createdAt: 'desc',
        },
        take: limit,
        select: {
          id: true,
          amountUSDC: true,
          amount: true,
          signature: true,
          status: true,
          creditRemaining: true,
          creditUsed: true,
          recipientTokenAccount: true,
          recipientWallet: true,
          fromAddress: true,
          network: true,
          tokenMint: true,
          explorerUrl: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      return payments;
    } catch (error) {
      Logger.error('Error getting payment history:', error);
      throw error;
    }
  }

  /**
   * Use credit to sponsor a transaction (FIFO - First In, First Out)
   * Deducts credit from oldest payment first
   */
  async useCredit(
    userId: string,
    amountUSDC: number,
    transactionType: string = 'USER_TRANSACTION'
  ): Promise<UseCreditResult> {
    try {
      // Get all verified payments with remaining credit, ordered by creation date (oldest first)
      const payments = await prisma.gaslessPayment.findMany({
        where: {
          userId,
          status: 'VERIFIED',
          creditRemaining: {
            gt: 0, // Greater than 0
          },
        },
        orderBy: {
          createdAt: 'asc', // Oldest first (FIFO)
        },
      });

      // Calculate total available credit
      const totalCredit = payments.reduce((sum, p) => sum + p.creditRemaining, 0);

      if (totalCredit < amountUSDC) {
        return {
          success: false,
          error: `Insufficient credit. Available: ${totalCredit} USDC, Required: ${amountUSDC} USDC`,
        };
      }

      // Deduct credit from payments (FIFO)
      let remainingToDeduct = amountUSDC;
      let paymentId: string | undefined;

      for (const payment of payments) {
        if (remainingToDeduct <= 0) break;

        const deductAmount = Math.min(payment.creditRemaining, remainingToDeduct);
        const newCreditRemaining = payment.creditRemaining - deductAmount;
        const newCreditUsed = payment.creditUsed + deductAmount;

        await prisma.gaslessPayment.update({
          where: { id: payment.id },
          data: {
            creditRemaining: newCreditRemaining,
            creditUsed: newCreditUsed,
          },
        });

        if (!paymentId) {
          paymentId = payment.id; // Track the first payment used
        }

        remainingToDeduct -= deductAmount;
        Logger.info(
          `Deducted ${deductAmount} USDC credit from payment ${payment.id} for user ${userId}`
        );
      }

      // Calculate remaining total credit
      const updatedPayments = await prisma.gaslessPayment.findMany({
        where: {
          userId,
          status: 'VERIFIED',
          creditRemaining: {
            gt: 0,
          },
        },
      });
      const remainingCredit = updatedPayments.reduce((sum, p) => sum + p.creditRemaining, 0);

      Logger.info(
        `Credit used successfully: ${amountUSDC} USDC for user ${userId}. Remaining: ${remainingCredit} USDC`
      );

      return {
        success: true,
        paymentId,
        remainingCredit,
      };
    } catch (error) {
      Logger.error('Error using credit:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Record sponsored transaction
   */
  async recordSponsoredTransaction(
    userId: string,
    data: {
      paymentId?: string;
      type: string;
      signature: string;
      solFeePaid?: number;
      usdcCreditUsed: number;
      transactionData?: any;
      network: string;
      explorerUrl?: string;
      status?: string;
    }
  ) {
    try {
      Logger.info(`Recording sponsored transaction for user ${userId}:`, {
        signature: data.signature,
        creditUsed: data.usdcCreditUsed,
        type: data.type,
        status: data.status || 'CONFIRMED',
      });

      // Map status string to TransactionStatus enum
      let transactionStatus: 'PENDING' | 'SUBMITTED' | 'CONFIRMED' | 'FAILED' = 'CONFIRMED';
      if (data.status) {
        const statusUpper = data.status.toUpperCase();
        if (['PENDING', 'SUBMITTED', 'CONFIRMED', 'FAILED'].includes(statusUpper)) {
          transactionStatus = statusUpper as 'PENDING' | 'SUBMITTED' | 'CONFIRMED' | 'FAILED';
        }
      }

      // Map type string to SponsoredTransactionType enum
      let transactionType: 'USER_TRANSACTION' | 'TRANSFER' | 'YIELD_OPERATION' | 'CUSTOM' = 'USER_TRANSACTION';
      if (data.type) {
        const typeUpper = data.type.toUpperCase();
        if (['USER_TRANSACTION', 'TRANSFER', 'YIELD_OPERATION', 'CUSTOM'].includes(typeUpper)) {
          transactionType = typeUpper as 'USER_TRANSACTION' | 'TRANSFER' | 'YIELD_OPERATION' | 'CUSTOM';
        }
      }

      const sponsoredTx = await prisma.sponsoredTransaction.create({
        data: {
          userId,
          paymentId: data.paymentId,
          type: transactionType,
          signature: data.signature,
          solFeePaid: data.solFeePaid,
          usdcCreditUsed: data.usdcCreditUsed,
          serializedTransaction: data.transactionData ? JSON.stringify(data.transactionData) : null,
          transactionSignature: data.signature, // Same as signature for compatibility
          status: transactionStatus,
          network: data.network,
          explorerUrl: data.explorerUrl,
        },
      });

      Logger.info(`Sponsored transaction saved to database: ${sponsoredTx.id}`);
      return sponsoredTx;
    } catch (error) {
      Logger.error('Error recording sponsored transaction:', error);
      throw error;
    }
  }

  /**
   * Check if user has sufficient credit
   */
  async hasSufficientCredit(userId: string, requiredAmountUSDC: number): Promise<boolean> {
    try {
      const creditBalance = await this.getUserCredit(userId);
      return creditBalance.totalCredit >= requiredAmountUSDC;
    } catch (error) {
      Logger.error('Error checking credit:', error);
      return false;
    }
  }
}

// Export singleton instance
const gaslessCreditService = new GaslessCreditService();
export default gaslessCreditService;

