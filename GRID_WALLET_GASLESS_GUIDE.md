# Gasless Transactions with Grid Wallets

This guide explains how to use Grid wallets for signing gasless transaction payments.

## Overview

The gasless transaction feature supports **two wallet types**:

1. **Regular Solana Wallets** - Uses standard Keypair signing
2. **Grid Wallets** - Uses Grid SDK for signing (recommended for Grid account users)

## Grid Wallet Flow

### Step 1: Prepare Payment Transaction

**Endpoint:** `POST /api/transaction/gasless/grid/prepare`

**Request:**
```bash
curl -X POST http://localhost:3000/api/transaction/gasless/grid/prepare \
  -H "Content-Type: application/json" \
  -d '{"email": "user@example.com"}'
```

**Response:**
```json
{
  "message": "Payment transaction prepared for Grid wallet signing",
  "user": {
    "id": "...",
    "email": "user@example.com",
    "gridAddress": "..."
  },
  "paymentQuote": {
    "tokenAccount": "...",
    "mint": "...",
    "amount": 300,
    "amountUSDC": 0.0003
  },
  "transactionPayload": {
    "transaction": "...",
    "transaction_signers": [...],
    "kms_payloads": [...]
  },
  "instructions": {
    "step1": "Sign this transaction using Grid SDK signAndSend method",
    "step2": "Send the signed transaction to /api/transaction/gasless/grid/execute",
    "gridData": {
      "sessionSecrets": {...},
      "session": "...",
      "address": "..."
    }
  }
}
```

### Step 2: Sign Transaction with Grid SDK

On the **client side**, use Grid SDK to sign the transaction:

```typescript
import { GridClient } from '@sqds/grid';

const gridClient = new GridClient({
  environment: 'sandbox', // or 'production'
  apiKey: 'your-grid-api-key',
});

// Sign the transaction
const signedTxResponse = await gridClient.signAndSend({
  sessionSecrets: instructions.gridData.sessionSecrets,
  session: instructions.gridData.session,
  transactionPayload: transactionPayload,
  address: instructions.gridData.address,
});

// Extract the signed transaction
const signedTransaction = signedTxResponse.data?.transaction || signedTxResponse.transaction;
```

### Step 3: Execute Gasless Payment

**Endpoint:** `POST /api/transaction/gasless/grid/execute`

**Request:**
```bash
curl -X POST http://localhost:3000/api/transaction/gasless/grid/execute \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "signedTransaction": "base64_encoded_signed_transaction"
  }'
```

**Response:**
```json
{
  "success": true,
  "message": "Transaction executed! You paid 0 SOL (signed with Grid wallet)",
  "signature": "...",
  "explorerUrl": "...",
  "paymentDetails": {...},
  "transactionInfo": {
    "signedWith": "Grid Wallet"
  }
}
```

## Complete Example (Client-Side)

```typescript
// Step 1: Prepare
const prepareResponse = await fetch('http://localhost:3000/api/transaction/gasless/grid/prepare', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'user@example.com' }),
});

const { transactionPayload, instructions } = await prepareResponse.json();

// Step 2: Sign with Grid SDK
const signedTx = await gridClient.signAndSend({
  sessionSecrets: instructions.gridData.sessionSecrets,
  session: instructions.gridData.session,
  transactionPayload: transactionPayload,
  address: instructions.gridData.address,
});

// Extract signed transaction (base64)
const signedTransaction = signedTx.data?.transaction || signedTx.transaction;

// Step 3: Execute
const executeResponse = await fetch('http://localhost:3000/api/transaction/gasless/grid/execute', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    email: 'user@example.com',
    signedTransaction: signedTransaction,
  }),
});

const result = await executeResponse.json();
console.log('Transaction signature:', result.signature);
```

## Differences: Regular Wallet vs Grid Wallet

| Feature | Regular Wallet | Grid Wallet |
|---------|---------------|-------------|
| **Signing** | Client-side Keypair | Grid SDK |
| **Preparation** | Client creates transaction | Server prepares with Grid SDK |
| **Security** | User manages private key | Grid manages signing |
| **Use Case** | Simple wallets | Grid account users |
| **Endpoints** | `/api/transaction/gasless` | `/api/transaction/gasless/grid/*` |

## Benefits of Grid Wallet Approach

1. ✅ **No Private Key Management** - Grid SDK handles signing
2. ✅ **Multi-Signature Support** - Works with Grid's multi-sig features
3. ✅ **Session-Based** - Uses existing Grid authentication
4. ✅ **Consistent** - Same signing method as other Grid transactions
5. ✅ **Secure** - Leverages Grid's security infrastructure

## Prerequisites

- User must have completed Grid account creation
- User must have Grid session data (sessionSecrets, authentication)
- User's Grid account must have USDC balance
- Server fee payer must have SOL balance

## Testing

Use the test script:
```bash
npm run test:gasless:grid
```

Or manually:
1. Call prepare endpoint
2. Sign transaction with Grid SDK (client-side)
3. Call execute endpoint with signed transaction


