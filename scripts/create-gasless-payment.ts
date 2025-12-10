/**
 * Step 2: Create and Send Gasless Transaction Payment
 * 
 * This script creates a USDC transfer transaction and sends it to the server
 * with x402 payment proof. Use this after getting the payment quote from Step 1.
 * 
 * Usage:
 *   1. First, get payment quote: curl -X POST http://localhost:3000/api/transaction/gasless
 *   2. Copy the payment details from the response
 *   3. Set the quote data in this script or pass as environment variables
 *   4. Run: npx ts-node scripts/create-gasless-payment.ts
 */

import { Connection, Keypair, PublicKey, Transaction } from '@solana/web3.js';
import {
  createTransferInstruction,
  getOrCreateAssociatedTokenAccount,
  getAccount,
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
} from '@solana/spl-token';
import fetch from 'node-fetch';
import * as dotenv from 'dotenv';
import bs58 from 'bs58';

// Load environment variables
dotenv.config();

// ============================================
// CONFIGURATION - Update these values
// ============================================

const SERVER_URL = process.env.SERVER_URL || 'http://localhost:3000';
const SOLANA_NETWORK = process.env.SOLANA_NETWORK || 'devnet';
const RPC_URL = SOLANA_NETWORK === 'devnet'
  ? 'https://api.devnet.solana.com'
  : 'https://api.mainnet-beta.solana.com';

// Payment quote from Step 1 (update these with actual values from Step 1 response)
const PAYMENT_QUOTE = {
  recipientWallet: process.env.QUOTE_RECIPIENT_WALLET || 'seFkxFkXEY9JGEpCyPfCWTuPZG9WK6ucf95zvKCfsRX',
  tokenAccount: process.env.QUOTE_TOKEN_ACCOUNT || '', // Get from Step 1 response
  mint: process.env.QUOTE_MINT || (SOLANA_NETWORK === 'devnet' 
    ? '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU' 
    : 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'),
  amount: parseInt(process.env.QUOTE_AMOUNT || '300'), // Amount in smallest units
  amountUSDC: parseFloat(process.env.QUOTE_AMOUNT_USDC || '0.0003'),
};

// User wallet private key (base58 format)
const USER_PRIVATE_KEY = process.env.USER_PRIVATE_KEY || '';

if (!USER_PRIVATE_KEY) {
  console.error('❌ ERROR: USER_PRIVATE_KEY must be set in .env');
  console.error('Example: USER_PRIVATE_KEY=your_base58_private_key_here');
  process.exit(1);
}

if (!PAYMENT_QUOTE.tokenAccount) {
  console.error('❌ ERROR: QUOTE_TOKEN_ACCOUNT must be set');
  console.error('Get this from Step 1 response (payment.tokenAccount field)');
  console.error('Or set QUOTE_TOKEN_ACCOUNT in .env');
  process.exit(1);
}

// ============================================
// MAIN FUNCTION
// ============================================

async function createAndSendGaslessPayment() {
  try {
    console.log('🚀 Creating Gasless Transaction Payment');
    console.log('========================================\n');
    console.log(`Server URL: ${SERVER_URL}`);
    console.log(`Network: ${SOLANA_NETWORK}`);
    console.log(`Payment Amount: ${PAYMENT_QUOTE.amountUSDC} USDC\n`);

    // Initialize connection
    const connection = new Connection(RPC_URL, 'confirmed');

    // Load user wallet
    const secretKey = bs58.decode(USER_PRIVATE_KEY);
    const payer = Keypair.fromSecretKey(secretKey);
    console.log(`Payer Wallet: ${payer.publicKey.toBase58()}\n`);

    // Parse payment quote
    const recipientTokenAccount = new PublicKey(PAYMENT_QUOTE.tokenAccount);
    const mint = new PublicKey(PAYMENT_QUOTE.mint);
    const amount = PAYMENT_QUOTE.amount;
    const recipientWallet = new PublicKey(PAYMENT_QUOTE.recipientWallet);

    // Step 1: Get or create payer's associated token account
    console.log('📋 Step 1: Getting payer token account...');
    const payerTokenAccount = await getOrCreateAssociatedTokenAccount(
      connection,
      payer,
      mint,
      payer.publicKey
    );
    console.log(`✓ Payer Token Account: ${payerTokenAccount.address.toBase58()}`);

    // Check balance
    const balance = await connection.getTokenAccountBalance(payerTokenAccount.address);
    console.log(`  Balance: ${balance.value.uiAmountString} USDC`);

    if (Number(balance.value.amount) < amount) {
      throw new Error(
        `Insufficient USDC balance. Have: ${balance.value.uiAmountString}, Need: ${PAYMENT_QUOTE.amountUSDC}`
      );
    }

    // Step 2: Check if recipient token account exists
    console.log('\n📋 Step 2: Checking recipient token account...');
    let recipientAccountExists = false;
    try {
      await getAccount(connection, recipientTokenAccount);
      recipientAccountExists = true;
      console.log('  ✓ Recipient token account exists');
    } catch (error) {
      console.log('  ⚠ Recipient token account doesn\'t exist, will create it');
    }

    // Step 3: Create USDC transfer transaction
    console.log('\n📋 Step 3: Creating USDC transfer transaction...');
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');

    const tx = new Transaction({
      feePayer: payer.publicKey,
      blockhash,
      lastValidBlockHeight,
    });

    // Add create account instruction if needed
    if (!recipientAccountExists) {
      const createAccountIx = createAssociatedTokenAccountInstruction(
        payer.publicKey, // payer
        recipientTokenAccount, // associated token account address
        recipientWallet, // owner
        mint // mint
      );
      tx.add(createAccountIx);
      console.log('  + Added create token account instruction');
    }

    // Add transfer instruction
    const transferIx = createTransferInstruction(
      payerTokenAccount.address, // source
      recipientTokenAccount, // destination
      payer.publicKey, // owner
      amount // amount in smallest units
    );
    tx.add(transferIx);
    console.log('  + Added USDC transfer instruction');

    // Sign the transaction
    tx.sign(payer);
    console.log('  ✓ Transaction signed');

    // Serialize the signed transaction
    const serializedTx = tx.serialize().toString('base64');
    console.log(`  ✓ Transaction serialized (${serializedTx.length} bytes)\n`);

    // Step 4: Create x402 payment proof
    console.log('📋 Step 4: Creating x402 payment proof...');
    const paymentProof = {
      x402Version: 1,
      scheme: 'exact',
      network: SOLANA_NETWORK === 'devnet' ? 'solana-devnet' : 'solana-mainnet',
      payload: {
        serializedTransaction: serializedTx,
      },
    };

    // Base64 encode the payment proof
    const xPaymentHeader = Buffer.from(JSON.stringify(paymentProof)).toString('base64');
    console.log('  ✓ Payment proof created and encoded\n');

    // Step 5: Send transaction with payment proof to server
    console.log('📋 Step 5: Sending transaction to server...');
    const response = await fetch(`${SERVER_URL}/api/transaction/gasless`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Payment': xPaymentHeader,
      },
    });

    const result = await response.json();

    if (!response.ok) {
      console.error('❌ Transaction failed:');
      console.error(JSON.stringify(result, null, 2));
      throw new Error(`Transaction failed with status ${response.status}`);
    }

    console.log('✅ Transaction executed successfully!');
    console.log('\n📊 Result:');
    console.log(JSON.stringify(result, null, 2));

    if (result.explorerUrl) {
      console.log(`\n🔗 View transaction on Solana Explorer:`);
      console.log(result.explorerUrl);
    }

    console.log('\n✅ Gasless payment completed successfully!');
  } catch (error) {
    console.error('\n❌ Error:');
    console.error(error);
    process.exit(1);
  }
}

// Run the script
createAndSendGaslessPayment();


