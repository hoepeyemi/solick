import { Router } from 'express';
import * as userController from '../controllers/user.controller';
import { validateRequest } from '../middleware/validation.middleware';
import {
  gaslessTransactionSchema,
  getCreditBalanceSchema,
  getPaymentHistorySchema,
  sponsorTransactionSchema,
  createTransactionForSponsorSchema,
} from '../schemas/transaction.schemas';

const router = Router();

/**
 * @swagger
 * /api/transaction/gasless:
 *   post:
 *     summary: Gasless Transaction Relay (Grid Wallet Only - Fully Programmatic)
 *     description: |
 *       Execute transactions without needing SOL for gas fees. Users pay in USDC instead.
 *       This endpoint is fully programmatic - the server handles everything including signing.
 *       
 *       **How it works:**
 *       1. User provides email address
 *       2. Server creates USDC payment transaction
 *       3. Server prepares transaction with Grid SDK
 *       4. Server signs transaction with Grid SDK (using user's session data)
 *       5. Server verifies payment
 *       6. Server sponsors transaction (pays SOL gas)
 *       7. Server submits transaction
 *       8. Returns result
 *       
 *       **Benefits:**
 *       - No SOL needed - pay gas fees in USDC
 *       - Fully automated - no client-side signing required
 *       - Seamless user experience
 *       - Server sponsors the transaction
 *       
 *       **Requirements:**
 *       - User must have Grid account with complete session data
 *       - User must have USDC balance
 *       - User account must be active
 *     tags: [Transactions, Gasless, Grid]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email]
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *                 description: User email address (must have Grid account)
 *                 example: "user@example.com"
 *     responses:
 *       200:
 *         description: Transaction executed successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                   example: "Transaction executed! You paid 0 SOL (signed with Grid wallet)"
 *                 signature:
 *                   type: string
 *                   description: Transaction signature on blockchain
 *                 explorerUrl:
 *                   type: string
 *                   description: Solana Explorer URL
 *                 paymentDetails:
 *                   type: object
 *                   properties:
 *                     signature:
 *                       type: string
 *                     amount:
 *                       type: number
 *                     amountUSDC:
 *                       type: number
 *                     recipient:
 *                       type: string
 *                     explorerUrl:
 *                       type: string
 *                 transactionInfo:
 *                   type: object
 *                   properties:
 *                     network:
 *                       type: string
 *                     cluster:
 *                       type: string
 *                     feePayer:
 *                       type: string
 *                     userPaid:
 *                       type: string
 *                     usdcSpent:
 *                       type: number
 *                     signedWith:
 *                       type: string
 *                       example: "Grid Wallet"
 *                     user:
 *                       type: object
 *       400:
 *         description: Bad request - missing email or incomplete Grid account
 *       401:
 *         description: User account is inactive
 *       402:
 *         description: Payment verification or simulation failed
 *       404:
 *         description: User not found
 *       500:
 *         description: Internal server error
 *       503:
 *         description: Service unavailable - Gasless service not configured
 */
router.post('/gasless', validateRequest(gaslessTransactionSchema), userController.gaslessTransaction);

/**
 * @swagger
 * /api/transaction/gasless/credit/{email}:
 *   get:
 *     summary: Get user's credit balance
 *     description: Retrieve the total available credit balance and payment history for a user
 *     tags: [Transactions, Gasless, Credit]
 *     parameters:
 *       - in: path
 *         name: email
 *         required: true
 *         schema:
 *           type: string
 *           format: email
 *         description: User email address
 *     responses:
 *       200:
 *         description: Credit balance retrieved successfully
 *       404:
 *         description: User not found
 *       500:
 *         description: Internal server error
 */
router.get('/gasless/credit/:email', userController.getCreditBalance);

/**
 * @swagger
 * /api/transaction/gasless/payments/{email}:
 *   get:
 *     summary: Get payment history for a user
 *     description: Retrieve payment history with optional limit
 *     tags: [Transactions, Gasless, Credit]
 *     parameters:
 *       - in: path
 *         name: email
 *         required: true
 *         schema:
 *           type: string
 *           format: email
 *         description: User email address
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 100
 *           default: 50
 *         description: Maximum number of payments to return
 *     responses:
 *       200:
 *         description: Payment history retrieved successfully
 *       404:
 *         description: User not found
 *       500:
 *         description: Internal server error
 */
router.get('/gasless/payments/:email', userController.getPaymentHistory);

/**
 * @swagger
 * /api/transaction/gasless/sponsor:
 *   post:
 *     summary: Sponsor a transaction using credit
 *     description: |
 *       Execute a transaction using existing credit balance instead of making a new payment.
 *       The transaction will be sponsored by the server (SOL gas paid by server).
 *       
 *       **Requirements:**
 *       - User must have sufficient credit balance
 *       - Transaction must be base64-encoded
 *       - User must have active Grid account
 *     tags: [Transactions, Gasless, Credit]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, transaction]
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *                 description: User email address
 *               transaction:
 *                 type: string
 *                 description: Base64-encoded transaction
 *               type:
 *                 type: string
 *                 enum: [USER_TRANSACTION, TRANSFER, YIELD_OPERATION, CUSTOM]
 *                 default: USER_TRANSACTION
 *                 description: Type of transaction
 *     responses:
 *       200:
 *         description: Transaction sponsored successfully
 *       400:
 *         description: Bad request - invalid transaction format
 *       402:
 *         description: Insufficient credit
 *       404:
 *         description: User not found
 *       500:
 *         description: Internal server error
 */
router.post('/gasless/sponsor', validateRequest(sponsorTransactionSchema), userController.sponsorTransaction);

/**
 * @swagger
 * /api/transaction/gasless/create-transaction:
 *   post:
 *     summary: Create a transaction for sponsorship
 *     description: |
 *       Creates an unsigned transaction that can be sponsored using credit.
 *       The transaction is returned as base64-encoded data ready to be used with the sponsor endpoint.
 *       
 *       **Use Case:**
 *       - Create a transaction without signing it
 *       - Use the returned transaction with the sponsor endpoint
 *       - Pay for gas using credit instead of SOL
 *       
 *       **Transaction Details:**
 *       - Creates a USDC transfer transaction by default
 *       - Transaction is unsigned (server will sign as fee payer when sponsoring)
 *       - Returns base64-encoded transaction ready for sponsorship
 *       
 *       **Requirements:**
 *       - Valid Solana addresses
 *       - Positive amount
 *       - Gasless service must be configured
 *     tags: [Transactions, Gasless, Credit]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [fromAddress, toAddress, amount]
 *             properties:
 *               fromAddress:
 *                 type: string
 *                 description: Sender's Solana address (Grid address or wallet)
 *                 example: "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU"
 *               toAddress:
 *                 type: string
 *                 description: Recipient's Solana address
 *                 example: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM"
 *               amount:
 *                 type: number
 *                 description: Amount in USDC (e.g., 1.5 for 1.5 USDC)
 *                 example: 1.5
 *               tokenMint:
 *                 type: string
 *                 description: Token mint address (optional, defaults to USDC)
 *                 example: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
 *           examples:
 *             usdcTransfer:
 *               summary: Create USDC transfer transaction
 *               value:
 *                 fromAddress: "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU"
 *                 toAddress: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM"
 *                 amount: 1.5
 *     responses:
 *       200:
 *         description: Transaction created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 transaction:
 *                   type: string
 *                   description: Base64-encoded transaction ready for sponsorship
 *                 transactionInfo:
 *                   type: object
 *                   properties:
 *                     fromAddress:
 *                       type: string
 *                     toAddress:
 *                       type: string
 *                     amount:
 *                       type: number
 *                     tokenMint:
 *                       type: string
 *                     fromTokenAccount:
 *                       type: string
 *                     toTokenAccount:
 *                       type: string
 *                     network:
 *                       type: string
 *                 nextStep:
 *                   type: object
 *                   description: Instructions for using the transaction
 *       400:
 *         description: Bad request - Invalid input
 *       500:
 *         description: Internal server error
 *       503:
 *         description: Service unavailable - Gasless service not configured
 */
router.post('/gasless/create-transaction', validateRequest(createTransactionForSponsorSchema), userController.createTransactionForSponsor);

export default router;

