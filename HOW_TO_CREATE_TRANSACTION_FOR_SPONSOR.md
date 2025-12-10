# How to Create a Transaction for Sponsorship

## 📋 Understanding the Requirements

### **1. Transaction Type (`type` field)**

The `type` field is just a label/category for your transaction. You can use:

- `"USER_TRANSACTION"` - General user transaction
- `"TRANSFER"` - Token transfer transaction
- `"YIELD_OPERATION"` - Yield farming operation
- `"CUSTOM"` - Custom transaction type

**This is just metadata - it doesn't affect the transaction itself.**

---

### **2. Base64 Transaction (`transaction` field)**

The `transaction` field must be a **base64-encoded Solana transaction**. This is the actual transaction data that will be sponsored.

---

## 🚀 Method 1: Use Existing Endpoint to Create Transaction

The easiest way is to use an existing endpoint that creates transactions, then use that transaction for sponsorship.

### **Option A: Create a Transfer Transaction**

```bash
# Step 1: Create a transaction using the blockchain service
# This endpoint creates a transaction and returns it as base64
curl -X POST http://localhost:3000/api/users/create-transaction \
  -H "Content-Type: application/json" \
  -d '{
    "fromAddress": "YOUR_GRID_ADDRESS",
    "toAddress": "RECIPIENT_ADDRESS",
    "tokenMint": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    "amount": 1.5
  }'
```

**Response:**
```json
{
  "transaction": "AQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABAAEDAgMEBQYHCAkKCwwNDg8QERITFBUWFxgZGhscHR4fICEiIyQlJic="
}
```

**Step 2: Use that transaction for sponsorship:**
```bash
curl -X POST http://localhost:3000/api/transaction/gasless/sponsor \
  -H "Content-Type: application/json" \
  -d '{
    "email": "hoepeyemi@gmail.com",
    "transaction": "AQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABAAEDAgMEBQYHCAkKCwwNDg8QERITFBUWFxgZGhscHR4fICEiIyQlJic=",
    "type": "TRANSFER"
  }'
```

---

## 🛠️ Method 2: Create Transaction Programmatically (Node.js/TypeScript)

If you want to create a transaction in your own code:

### **Example: Create a Simple Transfer Transaction**

```typescript
import { Connection, Transaction, SystemProgram, PublicKey, Keypair } from '@solana/web3.js';
import { getAssociatedTokenAddress, createTransferInstruction, TOKEN_PROGRAM_ID } from '@solana/spl-token';

async function createTransaction() {
  // 1. Setup connection
  const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
  
  // 2. Define addresses
  const fromAddress = new PublicKey('YOUR_GRID_ADDRESS');
  const toAddress = new PublicKey('RECIPIENT_ADDRESS');
  const tokenMint = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'); // USDC devnet
  
  // 3. Get token accounts
  const fromTokenAccount = await getAssociatedTokenAddress(tokenMint, fromAddress);
  const toTokenAccount = await getAssociatedTokenAddress(tokenMint, toAddress);
  
  // 4. Get recent blockhash
  const { blockhash } = await connection.getLatestBlockhash('confirmed');
  
  // 5. Create transaction
  const transaction = new Transaction({
    feePayer: fromAddress,
    recentBlockhash: blockhash,
  });
  
  // 6. Add transfer instruction
  // Amount in smallest units (USDC has 6 decimals)
  // 1.5 USDC = 1500000 smallest units
  const amount = 1.5 * 1000000; // 1500000
  
  const transferIx = createTransferInstruction(
    fromTokenAccount,  // source
    toTokenAccount,    // destination
    fromAddress,       // owner
    amount             // amount in smallest units
  );
  
  transaction.add(transferIx);
  
  // 7. Serialize to base64 (DO NOT SIGN - server will sign as fee payer)
  const serialized = transaction.serialize({ requireAllSignatures: false });
  const base64 = serialized.toString('base64');
  
  console.log('Base64 Transaction:', base64);
  return base64;
}
```

---

## 📝 Method 3: Create a Helper Script

Create a script that generates a transaction for you:

### **File: `scripts/create-transaction-for-sponsor.ts`**

```typescript
import { Connection, Transaction, PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddress, createTransferInstruction } from '@solana/spl-token';

const SOLANA_NETWORK = process.env.SOLANA_NETWORK || 'devnet';
const RPC_URL = SOLANA_NETWORK === 'devnet' 
  ? 'https://api.devnet.solana.com'
  : 'https://api.mainnet-beta.solana.com';

async function createTransactionForSponsor() {
  const connection = new Connection(RPC_URL, 'confirmed');
  
  // Configuration
  const fromAddress = new PublicKey(process.env.FROM_ADDRESS || 'YOUR_GRID_ADDRESS');
  const toAddress = new PublicKey(process.env.TO_ADDRESS || 'RECIPIENT_ADDRESS');
  const tokenMint = new PublicKey(
    SOLANA_NETWORK === 'devnet'
      ? '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU' // USDC devnet
      : 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' // USDC mainnet
  );
  const amount = parseFloat(process.env.AMOUNT || '1.0'); // USDC amount
  
  console.log('Creating transaction...');
  console.log(`From: ${fromAddress.toBase58()}`);
  console.log(`To: ${toAddress.toBase58()}`);
  console.log(`Amount: ${amount} USDC`);
  
  // Get token accounts
  const fromTokenAccount = await getAssociatedTokenAddress(tokenMint, fromAddress);
  const toTokenAccount = await getAssociatedTokenAddress(tokenMint, toAddress);
  
  // Get recent blockhash
  const { blockhash } = await connection.getLatestBlockhash('confirmed');
  
  // Create transaction
  const transaction = new Transaction({
    feePayer: fromAddress,
    recentBlockhash: blockhash,
  });
  
  // Add transfer instruction
  const amountSmallestUnits = Math.floor(amount * 1000000); // USDC has 6 decimals
  const transferIx = createTransferInstruction(
    fromTokenAccount,
    toTokenAccount,
    fromAddress,
    amountSmallestUnits
  );
  
  transaction.add(transferIx);
  
  // Serialize (don't sign - server will sign as fee payer)
  const serialized = transaction.serialize({ requireAllSignatures: false });
  const base64 = serialized.toString('base64');
  
  console.log('\n✅ Transaction created!');
  console.log('\n📋 Use this in your sponsor request:');
  console.log('\ncurl -X POST http://localhost:3000/api/transaction/gasless/sponsor \\');
  console.log('  -H "Content-Type: application/json" \\');
  console.log('  -d \'{');
  console.log(`    "email": "hoepeyemi@gmail.com",`);
  console.log(`    "transaction": "${base64}",`);
  console.log(`    "type": "TRANSFER"`);
  console.log('  }\'');
  
  return base64;
}

createTransactionForSponsor().catch(console.error);
```

**Run it:**
```bash
# Set environment variables
export FROM_ADDRESS="YOUR_GRID_ADDRESS"
export TO_ADDRESS="RECIPIENT_ADDRESS"
export AMOUNT="1.5"
export SOLANA_NETWORK="devnet"

# Run script
npx ts-node scripts/create-transaction-for-sponsor.ts
```

---

## 🎯 Method 4: Use Blockchain Service Directly

You can also call the blockchain service's `createTransaction` method programmatically:

```typescript
import { blockchainService } from './src/services/blockchain.service';

async function getTransaction() {
  const result = await blockchainService.createTransaction(
    'YOUR_GRID_ADDRESS',      // fromAddress
    'RECIPIENT_ADDRESS',      // toAddress
    'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // tokenMint (USDC)
    1.5,                      // amount
  );
  
  if (result) {
    console.log('Transaction:', result.transaction);
    return result.transaction;
  }
}
```

---

## ⚠️ Important Notes

### **1. Don't Sign the Transaction**

When creating a transaction for sponsorship:
- ✅ **DO**: Serialize with `requireAllSignatures: false`
- ❌ **DON'T**: Sign the transaction yourself
- ✅ **WHY**: The server will sign it as the fee payer

### **2. Transaction Must Be Valid**

- Must have valid addresses
- Must have valid instructions
- Must have recent blockhash (server will update it)
- Must not be expired

### **3. Fee Payer**

- The transaction's `feePayer` should be set to your address
- The server will change it to the server's fee payer when sponsoring
- This is handled automatically

---

## 🔍 Quick Test

### **Step 1: Create a simple transaction**

```bash
# Using the blockchain service endpoint (if available)
curl -X POST http://localhost:3000/api/users/create-transaction \
  -H "Content-Type: application/json" \
  -d '{
    "fromAddress": "YOUR_GRID_ADDRESS",
    "toAddress": "RECIPIENT_ADDRESS",
    "tokenMint": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    "amount": 0.1
  }'
```

### **Step 2: Copy the transaction from response**

### **Step 3: Use it for sponsorship**

```bash
curl -X POST http://localhost:3000/api/transaction/gasless/sponsor \
  -H "Content-Type: application/json" \
  -d '{
    "email": "hoepeyemi@gmail.com",
    "transaction": "PASTE_TRANSACTION_HERE",
    "type": "TRANSFER"
  }'
```

---

## 📚 Summary

1. **Transaction Type**: Just use `"USER_TRANSACTION"`, `"TRANSFER"`, `"YIELD_OPERATION"`, or `"CUSTOM"` - it's just a label

2. **Base64 Transaction**: 
   - Create using Solana Web3.js
   - Serialize with `requireAllSignatures: false`
   - Don't sign it yourself
   - Convert to base64 string

3. **Easiest Method**: Use an existing endpoint that creates transactions, then use that transaction for sponsorship

---

## 🚀 Next Steps

1. Make sure you have credit: `GET /api/transaction/gasless/credit/:email`
2. Create a transaction (using any method above)
3. Sponsor the transaction: `POST /api/transaction/gasless/sponsor`

Good luck! 🎉

