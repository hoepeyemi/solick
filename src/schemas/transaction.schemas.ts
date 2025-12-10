import { z } from 'zod';

// Transaction schemas for Grid SDK transaction operations

// Base transaction input schema
const baseTransactionSchema = z.object({
  fromEmail: z.string().email('Invalid sender email address'),
  toEmail: z.string().email('Invalid recipient email address'),
  amount: z.string().regex(/^\d+(\.\d+)?$/, 'Amount must be a valid number'),
  memo: z.string().optional(),
});

// Prepare transaction schema
export const prepareTransactionSchema = baseTransactionSchema.extend({
  tokenMint: z.string().min(1, 'Token mint address is required'),
});

// Execute transaction schema
export const executeTransactionSchema = z.object({
  fromEmail: z.string().email('Invalid sender email address'),
  transactionPayload: z.object({
    transaction: z.string().min(1, 'Transaction data is required'),
    transaction_signers: z.array(z.string()).min(1, 'Transaction signers are required'),
    kms_payloads: z.array(z.object({
      provider: z.string(),
      address: z.string(),
      payload: z.string(),
    })).optional(),
  }),
  memo: z.string().optional(),
});

// Send transaction schema (combines prepare and execute)
export const sendTransactionSchema = baseTransactionSchema.extend({
  tokenMint: z.string().min(1, 'Token mint address is required'),
});

// SOL transaction schema
export const sendSolTransactionSchema = baseTransactionSchema.extend({
  tokenMint: z.literal('So11111111111111111111111111111111111111112').optional(),
});

// USDC transaction schema
export const sendUsdcTransactionSchema = baseTransactionSchema.extend({
  tokenMint: z.literal('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v').optional(),
});

// Grid-to-Wallet transaction schema (Grid account to external wallet)
export const sendGridToWalletTransactionSchema = z.object({
  fromEmail: z.string().email('Invalid sender email address'),
  toWalletAddress: z.string().min(1, 'Recipient wallet address is required'),
  amount: z.string().regex(/^\d+(\.\d+)?$/, 'Amount must be a valid number'),
  tokenMint: z.string().min(1, 'Token mint address is required'),
  memo: z.string().optional(),
});

// Gasless transaction schema (Grid wallet only - fully programmatic)
export const gaslessTransactionSchema = z.object({
  email: z.string().email('Invalid email address'),
  useCredit: z.boolean().optional().default(false), // Option to use existing credit instead of making payment
});

// Credit management schemas
export const getCreditBalanceSchema = z.object({
  email: z.string().email('Invalid email address'),
});

export const getPaymentHistorySchema = z.object({
  email: z.string().email('Invalid email address'),
  limit: z.number().int().positive().max(100).optional().default(50),
});

export const sponsorTransactionSchema = z.object({
  email: z.string().email('Invalid email address'),
  transaction: z.string().min(1, 'Transaction data is required'),
  type: z.enum(['USER_TRANSACTION', 'TRANSFER', 'YIELD_OPERATION', 'CUSTOM']).optional().default('USER_TRANSACTION'),
});

export const createTransactionForSponsorSchema = z.object({
  fromAddress: z.string().min(1, 'From address is required'),
  toAddress: z.string().min(1, 'To address is required'),
  amount: z.number().positive('Amount must be positive'),
  tokenMint: z.string().optional(), // If not provided, defaults to USDC
});

// Type exports
export type PrepareTransactionInput = z.infer<typeof prepareTransactionSchema>;
export type ExecuteTransactionInput = z.infer<typeof executeTransactionSchema>;
export type SendTransactionInput = z.infer<typeof sendTransactionSchema>;
export type SendSolTransactionInput = z.infer<typeof sendSolTransactionSchema>;
export type SendUsdcTransactionInput = z.infer<typeof sendUsdcTransactionSchema>;
export type SendGridToWalletTransactionInput = z.infer<typeof sendGridToWalletTransactionSchema>;
export type GaslessTransactionInput = z.infer<typeof gaslessTransactionSchema>;
export type GetCreditBalanceInput = z.infer<typeof getCreditBalanceSchema>;
export type GetPaymentHistoryInput = z.infer<typeof getPaymentHistorySchema>;
export type SponsorTransactionInput = z.infer<typeof sponsorTransactionSchema>;
export type CreateTransactionForSponsorInput = z.infer<typeof createTransactionForSponsorSchema>;
