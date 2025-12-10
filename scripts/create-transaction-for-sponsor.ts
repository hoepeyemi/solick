// scripts/create-transaction-for-sponsor.ts
// Helper script to create a transaction for sponsorship

import { Connection, Transaction, PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddress, createTransferInstruction } from '@solana/spl-token';
import * as dotenv from 'dotenv';

dotenv.config();

const SOLANA_NETWORK = process.env.SOLANA_NETWORK || 'devnet';
const RPC_URL = SOLANA_NETWORK === 'devnet' 
  ? 'https://api.devnet.solana.com'
  : 'https://api.mainnet-beta.solana.com';

// USDC mint addresses
const USDC_DEVNET = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
const USDC_MAINNET = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

async function createTransactionForSponsor() {
  try {
    // Get configuration from environment or use defaults
    const fromAddressStr = process.env.FROM_ADDRESS || process.argv[2];
    const toAddressStr = process.env.TO_ADDRESS || process.argv[3];
    const amountStr = process.env.AMOUNT || process.argv[4] || '1.0';

    if (!fromAddressStr || !toAddressStr) {
      console.error('❌ Error: Missing required parameters');
      console.error('\nUsage:');
      console.error('  npx ts-node scripts/create-transaction-for-sponsor.ts <FROM_ADDRESS> <TO_ADDRESS> [AMOUNT]');
      console.error('\nOr set environment variables:');
      console.error('  FROM_ADDRESS=<address> TO_ADDRESS=<address> AMOUNT=<amount> npx ts-node scripts/create-transaction-for-sponsor.ts');
      console.error('\nExample:');
      console.error('  npx ts-node scripts/create-transaction-for-sponsor.ts 7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU 9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM 1.5');
      process.exit(1);
    }

    const connection = new Connection(RPC_URL, 'confirmed');
    const fromAddress = new PublicKey(fromAddressStr);
    const toAddress = new PublicKey(toAddressStr);
    const amount = parseFloat(amountStr);

    // Use appropriate USDC mint based on network
    const tokenMint = new PublicKey(
      SOLANA_NETWORK === 'devnet' ? USDC_DEVNET : USDC_MAINNET
    );

    console.log('\n📋 Creating transaction for sponsorship...');
    console.log(`Network: ${SOLANA_NETWORK}`);
    console.log(`From: ${fromAddress.toBase58()}`);
    console.log(`To: ${toAddress.toBase58()}`);
    console.log(`Amount: ${amount} USDC`);
    console.log(`Token Mint: ${tokenMint.toBase58()}\n`);

    // Get token accounts
    console.log('🔍 Getting token accounts...');
    const fromTokenAccount = await getAssociatedTokenAddress(tokenMint, fromAddress);
    const toTokenAccount = await getAssociatedTokenAddress(tokenMint, toAddress);
    console.log(`  From Token Account: ${fromTokenAccount.toBase58()}`);
    console.log(`  To Token Account: ${toTokenAccount.toBase58()}\n`);

    // Get recent blockhash
    console.log('🔍 Getting recent blockhash...');
    const { blockhash } = await connection.getLatestBlockhash('confirmed');
    console.log(`  Blockhash: ${blockhash}\n`);

    // Create transaction
    console.log('📝 Creating transaction...');
    const transaction = new Transaction({
      feePayer: fromAddress,
      recentBlockhash: blockhash,
    });

    // Add transfer instruction
    const amountSmallestUnits = Math.floor(amount * 1000000); // USDC has 6 decimals
    console.log(`  Amount in smallest units: ${amountSmallestUnits}`);
    
    const transferIx = createTransferInstruction(
      fromTokenAccount,
      toTokenAccount,
      fromAddress,
      amountSmallestUnits
    );

    transaction.add(transferIx);
    console.log('  ✓ Transfer instruction added\n');

    // Serialize (don't sign - server will sign as fee payer)
    console.log('🔐 Serializing transaction...');
    const serialized = transaction.serialize({ requireAllSignatures: false });
    const base64 = serialized.toString('base64');
    console.log(`  ✓ Transaction serialized (${base64.length} characters)\n`);

    // Output
    console.log('✅ Transaction created successfully!\n');
    console.log('📋 Use this in your sponsor request:\n');
    console.log('curl -X POST http://localhost:3000/api/transaction/gasless/sponsor \\');
    console.log('  -H "Content-Type: application/json" \\');
    console.log('  -d \'{');
    console.log(`    "email": "hoepeyemi@gmail.com",`);
    console.log(`    "transaction": "${base64}",`);
    console.log(`    "type": "TRANSFER"`);
    console.log('  }\'\n');

    // Also output just the transaction for easy copying
    console.log('📄 Transaction (base64):');
    console.log(base64);
    console.log('');

    return base64;
  } catch (error) {
    console.error('\n❌ Error creating transaction:');
    if (error instanceof Error) {
      console.error(`  ${error.message}`);
      if (error.stack) {
        console.error('\nStack trace:');
        console.error(error.stack);
      }
    } else {
      console.error(error);
    }
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  createTransactionForSponsor();
}

export { createTransactionForSponsor };

