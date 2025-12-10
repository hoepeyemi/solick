/**
 * Test script for Gasless Transaction Relay (x402 payments)
 * 
 * This script demonstrates the complete flow:
 * 1. Request payment quote from server
 * 2. Create USDC transfer transaction
 * 3. Send transaction with payment proof
 * 4. Server sponsors and executes transaction
 * 
 * Prerequisites:
 * - Server must be running with gasless service configured
 * - User wallet must have USDC balance
 * - Fee payer wallet must have SOL balance
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
import { readFileSync } from 'fs';

// Load environment variables
dotenv.config();

// Configuration
const SERVER_URL = process.env.SERVER_URL || 'http://localhost:3000';
const SOLANA_NETWORK = process.env.SOLANA_NETWORK || 'devnet';
const RPC_URL = SOLANA_NETWORK === 'devnet'
  ? 'https://api.devnet.solana.com'
  : 'https://api.mainnet-beta.solana.com';

const connection = new Connection(RPC_URL, 'confirmed');

// USDC mint addresses
const USDC_MINT_DEVNET = new PublicKey('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU');
const USDC_MINT_MAINNET = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
const USDC_MINT = SOLANA_NETWORK === 'devnet' ? USDC_MINT_DEVNET : USDC_MINT_MAINNET;

// Load user wallet (payer)
// You can either:
// 1. Set USER_PRIVATE_KEY in .env (base58 string)
// 2. Or load from a JSON file
let payer: Keypair;

if (process.env.USER_PRIVATE_KEY) {
  // Base58 format
  const bs58 = require('bs58');
  const secretKey = bs58.decode(process.env.USER_PRIVATE_KEY);
  payer = Keypair.fromSecretKey(secretKey);
} else if (process.env.USER_PRIVATE_KEY_FILE) {
  // JSON file format
  const keypairData = JSON.parse(readFileSync(process.env.USER_PRIVATE_KEY_FILE, 'utf-8'));
  payer = Keypair.fromSecretKey(Uint8Array.from(keypairData));
} else {
  console.error('ERROR: USER_PRIVATE_KEY or USER_PRIVATE_KEY_FILE must be set in .env');
  console.error('Example: USER_PRIVATE_KEY=your_base58_private_key_here');
  process.exit(1);
}

async function testGaslessTransaction() {
  try {
    console.log('🧪 Testing Gasless Transaction Relay');
    console.log('=====================================\n');
    console.log(`Server URL: ${SERVER_URL}`);
    console.log(`Network: ${SOLANA_NETWORK}`);
    console.log(`Payer: ${payer.publicKey.toBase58()}\n`);

    // Step 1: Request payment quote from server
    console.log('📋 Step 1: Requesting payment quote...');
    const quoteResponse = await fetch(`${SERVER_URL}/api/transaction/gasless`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (quoteResponse.status !== 402) {
      const text = await quoteResponse.text();
      throw new Error(`Expected 402 status, got ${quoteResponse.status}: ${text}`);
    }

    const quote = (await quoteResponse.json()) as {
      payment: {
        tokenAccount: string;
        mint: string;
        amount: number;
        amountUSDC: number;
        cluster: string;
        recipientWallet: string;
      };
      service: string;
      benefit: string;
    };

    console.log('✓ Payment quote received:');
    console.log(`  Recipient Token Account: ${quote.payment.tokenAccount}`);
    console.log(`  Mint (USDC): ${quote.payment.mint}`);
    console.log(`  Amount: ${quote.payment.amountUSDC} USDC (${quote.payment.amount} smallest units)\n`);

    const recipientTokenAccount = new PublicKey(quote.payment.tokenAccount);
    const mint = new PublicKey(quote.payment.mint);
    const amount = quote.payment.amount;

    // Step 2: Get or create payer's associated token account
    console.log('📋 Step 2: Checking payer token account...');
    const payerTokenAccount = await getOrCreateAssociatedTokenAccount(
      connection,
      payer,
      mint,
      payer.publicKey
    );

    console.log(`✓ Payer Token Account: ${payerTokenAccount.address.toBase58()}`);

    // Check balance
    const balance = await connection.getTokenAccountBalance(payerTokenAccount.address);
    console.log(`  Current Balance: ${balance.value.uiAmountString} USDC`);

    if (Number(balance.value.amount) < amount) {
      throw new Error(
        `Insufficient USDC balance. Have: ${balance.value.uiAmountString}, Need: ${quote.payment.amountUSDC}`
      );
    }

    // Step 3: Check if recipient token account exists
    console.log('\n📋 Step 3: Checking recipient token account...');
    let recipientAccountExists = false;
    try {
      await getAccount(connection, recipientTokenAccount);
      recipientAccountExists = true;
      console.log('  ✓ Recipient token account exists');
    } catch (error) {
      console.log('  ⚠ Recipient token account doesn\'t exist, will create it');
    }

    // Step 4: Create USDC transfer transaction
    console.log('\n📋 Step 4: Creating USDC transfer transaction...');
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');

    const tx = new Transaction({
      feePayer: payer.publicKey,
      blockhash,
      lastValidBlockHeight,
    });

    // Add create account instruction if needed
    if (!recipientAccountExists) {
      const recipientWallet = new PublicKey(quote.payment.recipientWallet);
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

    // Sign the transaction (but don't send it!)
    tx.sign(payer);
    console.log('  ✓ Transaction signed');

    // Serialize the signed transaction
    const serializedTx = tx.serialize().toString('base64');
    console.log(`  ✓ Transaction serialized (${serializedTx.length} bytes)\n`);

    // Step 5: Create x402 payment proof
    console.log('📋 Step 5: Creating x402 payment proof...');
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

    // Step 6: Send transaction with payment proof
    console.log('📋 Step 6: Sending transaction with payment proof...');
    const paidResponse = await fetch(`${SERVER_URL}/api/transaction/gasless`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Payment': xPaymentHeader,
      },
    });

    const result = await paidResponse.json();

    if (!paidResponse.ok) {
      console.error('❌ Transaction failed:');
      console.error(JSON.stringify(result, null, 2));
      throw new Error(`Transaction failed with status ${paidResponse.status}`);
    }

    console.log('✓ Transaction executed successfully!');
    console.log('\n📊 Result:');
    console.log(JSON.stringify(result, null, 2));

    if (result.explorerUrl) {
      console.log(`\n🔗 View transaction on Solana Explorer:`);
      console.log(result.explorerUrl);
    }

    console.log('\n✅ Gasless transaction test completed successfully!');
  } catch (error) {
    console.error('\n❌ Test failed:');
    console.error(error);
    process.exit(1);
  }
}

// Run the test
testGaslessTransaction();


