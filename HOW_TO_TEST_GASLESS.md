# How to Test Gasless Transaction Feature

Complete step-by-step guide to test the gasless transaction relay feature.

## Prerequisites Checklist

Before testing, ensure you have:

- [ ] Server is running (`npm run dev`)
- [ ] Environment variables configured in `.env`
- [ ] Fee payer wallet has SOL balance
- [ ] User wallet has USDC balance (at least 0.0003 USDC)
- [ ] Network configured (devnet or mainnet)

## Environment Setup

Add these to your `.env` file:

```env
# Server Configuration
SERVER_URL=http://localhost:3000
SOLANA_NETWORK=devnet

# Gasless Transaction Configuration
GASLESS_FEE_PAYER_PRIVATE_KEY=your_fee_payer_base58_private_key
GASLESS_RECIPIENT_WALLET=seFkxFkXEY9JGEpCyPfCWTuPZG9WK6ucf95zvKCfsRX
GASLESS_PRICE_USDC=0.0003

# User Wallet (for regular wallet testing)
USER_PRIVATE_KEY=your_user_wallet_base58_private_key

# User Email (for Grid wallet testing)
USER_EMAIL=user@example.com
```

## Testing Method 1: Regular Wallet (Easiest)

### Quick Test (Automated)

```bash
# Terminal 1: Start server
npm run dev

# Terminal 2: Run automated test
npm run test:gasless
```

This script does everything automatically!

### Manual Test (Step by Step)

#### Step 1: Get Payment Quote

```bash
curl -X POST http://localhost:3000/api/transaction/gasless \
  -H "Content-Type: application/json"
```

**Expected Response (402):**
```json
{
  "payment": {
    "recipientWallet": "seFkxFkXEY9JGEpCyPfCWTuPZG9WK6ucf95zvKCfsRX",
    "tokenAccount": "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU",
    "mint": "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
    "amount": 300,
    "amountUSDC": 0.0003,
    "cluster": "devnet"
  },
  "service": "Gasless transaction execution",
  "benefit": "No SOL needed - pay gas fee in USDC"
}
```

**Save these values:**
- `tokenAccount` → Set as `QUOTE_TOKEN_ACCOUNT` in `.env`
- `recipientWallet` → Set as `QUOTE_RECIPIENT_WALLET` in `.env`
- `amount` → Set as `QUOTE_AMOUNT` in `.env`
- `amountUSDC` → Set as `QUOTE_AMOUNT_USDC` in `.env`

#### Step 2: Create and Send Payment

```bash
npm run test:gasless:step2
```

**Or manually update `.env` and run:**
```bash
# Add to .env:
QUOTE_TOKEN_ACCOUNT=7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU
QUOTE_RECIPIENT_WALLET=seFkxFkXEY9JGEpCyPfCWTuPZG9WK6ucf95zvKCfsRX
QUOTE_AMOUNT=300
QUOTE_AMOUNT_USDC=0.0003

# Then run:
npx ts-node scripts/create-gasless-payment.ts
```

## Testing Method 2: Grid Wallet

### Step 1: Prepare Payment Transaction

```bash
curl -X POST http://localhost:3000/api/transaction/gasless/grid/prepare \
  -H "Content-Type: application/json" \
  -d '{"email": "user@example.com"}'
```

**Expected Response (200):**
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
    "gridData": {
      "sessionSecrets": {...},
      "session": "...",
      "address": "..."
    }
  }
}
```

### Step 2: Sign with Grid SDK (Client-Side)

**Important:** This must be done on the client side using Grid SDK.

```typescript
import { GridClient } from '@sqds/grid';

const gridClient = new GridClient({
  environment: 'sandbox',
  apiKey: 'your-grid-api-key',
});

// Sign the transaction
const signedTx = await gridClient.signAndSend({
  sessionSecrets: instructions.gridData.sessionSecrets,
  session: instructions.gridData.session,
  transactionPayload: transactionPayload,
  address: instructions.gridData.address,
});

// Extract signed transaction (base64)
const signedTransaction = signedTx.data?.transaction || signedTx.transaction;
```

### Step 3: Execute Gasless Payment

```bash
curl -X POST http://localhost:3000/api/transaction/gasless/grid/execute \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "signedTransaction": "base64_encoded_signed_transaction_here"
  }'
```

## Testing with Swagger UI

1. **Start server:** `npm run dev`
2. **Open Swagger:** `http://localhost:3000/api-docs`
3. **Find endpoints:**
   - `/api/transaction/gasless` - Regular wallet
   - `/api/transaction/gasless/grid/prepare` - Grid wallet prepare
   - `/api/transaction/gasless/grid/execute` - Grid wallet execute
4. **Test each endpoint** using the interactive UI

## Quick Test Commands Summary

```bash
# 1. Start server
npm run dev

# 2. Test regular wallet (automated)
npm run test:gasless

# 3. Test regular wallet (manual - 2 steps)
# Step 1: Get quote
curl -X POST http://localhost:3000/api/transaction/gasless -H "Content-Type: application/json"

# Step 2: Send payment
npm run test:gasless:step2

# 4. Test Grid wallet
# Step 1: Prepare
curl -X POST http://localhost:3000/api/transaction/gasless/grid/prepare \
  -H "Content-Type: application/json" \
  -d '{"email": "user@example.com"}'

# Step 2: Sign with Grid SDK (client-side)
# Step 3: Execute
curl -X POST http://localhost:3000/api/transaction/gasless/grid/execute \
  -H "Content-Type: application/json" \
  -d '{"email": "user@example.com", "signedTransaction": "..."}'
```

## Expected Results

### Successful Transaction

```json
{
  "success": true,
  "message": "Transaction executed! You paid 0 SOL",
  "signature": "5Kd3N8vQz7R9xY2wP4mN6bH8jK1L3M5Q7R9T1V3W5X7Y9Z1A3C5E7G9I1K3M5O",
  "explorerUrl": "https://explorer.solana.com/tx/...?cluster=devnet",
  "paymentDetails": {
    "signature": "...",
    "amount": 300,
    "amountUSDC": 0.0003,
    "recipient": "...",
    "explorerUrl": "..."
  },
  "transactionInfo": {
    "network": "devnet",
    "feePayer": "Server (sponsored)",
    "userPaid": "0 SOL",
    "usdcSpent": 0.0003
  }
}
```

## Troubleshooting

### Error: "Gasless transaction service not configured"

**Solution:** Check your `.env` file has:
- `GASLESS_FEE_PAYER_PRIVATE_KEY`
- `GASLESS_RECIPIENT_WALLET`
- `GASLESS_PRICE_USDC`

### Error: "Insufficient USDC balance"

**Solution:**
- Ensure user wallet has at least 0.0003 USDC
- Check balance matches the quoted amount

### Error: "Payment verification failed"

**Solution:**
- Verify USDC transfer amount matches quote
- Check recipient token account is correct
- Ensure transaction includes USDC transfer instruction

### Error: "Transaction sponsorship failed"

**Solution:**
- Ensure fee payer wallet has SOL balance
- Check private key format (base58 string)
- Verify network configuration

## Verification Steps

After successful transaction:

1. ✅ Check transaction signature is returned
2. ✅ Visit explorer URL to verify transaction
3. ✅ Verify USDC was transferred to recipient
4. ✅ Verify server paid SOL gas fees
5. ✅ Check server logs for confirmation

## Next Steps

- Test with different amounts
- Test error scenarios
- Test on mainnet (with real funds)
- Monitor fee payer SOL balance
- Set up alerts for low balance


