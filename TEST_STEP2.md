# Testing Step 2: Create and Send Gasless Payment

This guide shows you exactly how to test Step 2 of the gasless transaction relay.

## Prerequisites

1. **Server must be running** (`npm run dev`)
2. **You must have completed Step 1** and have the payment quote response
3. **Your user wallet must have USDC balance** (at least 0.0003 USDC)

## Step-by-Step Instructions

### Step 1: Get Payment Quote (if you haven't already)

```bash
curl -X POST http://localhost:3000/api/transaction/gasless \
  -H "Content-Type: application/json"
```

**Save the response** - you'll need these values:
- `payment.tokenAccount` 
- `payment.recipientWallet`
- `payment.amount`
- `payment.amountUSDC`

Example response:
```json
{
  "payment": {
    "recipientWallet": "seFkxFkXEY9JGEpCyPfCWTuPZG9WK6ucf95zvKCfsRX",
    "tokenAccount": "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU",
    "mint": "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
    "amount": 300,
    "amountUSDC": 0.0003,
    "cluster": "devnet"
  }
}
```

### Step 2: Configure Your .env File

Add these variables to your `.env` file:

```env
# Server Configuration
SERVER_URL=http://localhost:3000
SOLANA_NETWORK=devnet

# User Wallet (must have USDC balance)
USER_PRIVATE_KEY=your_user_wallet_base58_private_key_here

# Payment Quote from Step 1 (copy from the response)
QUOTE_TOKEN_ACCOUNT=7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU
QUOTE_RECIPIENT_WALLET=seFkxFkXEY9JGEpCyPfCWTuPZG9WK6ucf95zvKCfsRX
QUOTE_AMOUNT=300
QUOTE_AMOUNT_USDC=0.0003
```

**Important:** Replace the values above with the actual values from your Step 1 response!

### Step 3: Run the Step 2 Script

```bash
npm run test:gasless:step2
```

Or directly:
```bash
npx ts-node scripts/create-gasless-payment.ts
```

## What the Script Does

1. ✅ Loads your wallet from `USER_PRIVATE_KEY`
2. ✅ Gets/creates your USDC token account
3. ✅ Checks your USDC balance
4. ✅ Creates USDC transfer transaction to server's token account
5. ✅ Signs the transaction
6. ✅ Creates x402 payment proof
7. ✅ Sends to server with `X-Payment` header
8. ✅ Displays transaction signature and explorer link

## Expected Output

```
🚀 Creating Gasless Transaction Payment
========================================

Server URL: http://localhost:3000
Network: devnet
Payment Amount: 0.0003 USDC

Payer Wallet: 7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU

📋 Step 1: Getting payer token account...
✓ Payer Token Account: 7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU
  Balance: 10.0 USDC

📋 Step 2: Checking recipient token account...
  ✓ Recipient token account exists

📋 Step 3: Creating USDC transfer transaction...
  + Added USDC transfer instruction
  ✓ Transaction signed
  ✓ Transaction serialized (1234 bytes)

📋 Step 4: Creating x402 payment proof...
  ✓ Payment proof created and encoded

📋 Step 5: Sending transaction to server...
✅ Transaction executed successfully!

📊 Result:
{
  "success": true,
  "message": "Transaction executed! You paid 0 SOL",
  "signature": "5Kd3N8vQz7R9xY2wP4mN6bH8jK1L3M5Q7R9T1V3W5X7Y9Z1A3C5E7G9I1K3M5O",
  "explorerUrl": "https://explorer.solana.com/tx/5Kd3N8vQz7R9xY2wP4mN6bH8jK1L3M5Q7R9T1V3W5X7Y9Z1A3C5E7G9I1K3M5O?cluster=devnet"
}

🔗 View transaction on Solana Explorer:
https://explorer.solana.com/tx/5Kd3N8vQz7R9xY2wP4mN6bH8jK1L3M5Q7R9T1V3W5X7Y9Z1A3C5E7G9I1K3M5O?cluster=devnet

✅ Gasless payment completed successfully!
```

## Troubleshooting

### Error: "USER_PRIVATE_KEY must be set"

**Solution:** Add `USER_PRIVATE_KEY` to your `.env` file with your wallet's base58 private key.

### Error: "QUOTE_TOKEN_ACCOUNT must be set"

**Solution:** 
1. Run Step 1 to get the payment quote
2. Copy the `tokenAccount` value from the response
3. Add it to `.env` as `QUOTE_TOKEN_ACCOUNT=...`

### Error: "Insufficient USDC balance"

**Solution:** 
- Ensure your user wallet has at least 0.0003 USDC (or the amount specified in the quote)
- For devnet, get USDC from a faucet or swap SOL for USDC

### Error: "Transaction failed with status 402"

**Solution:**
- Check that the `QUOTE_TOKEN_ACCOUNT` matches the one from Step 1
- Verify the amount is correct
- Ensure the server is running and configured correctly

### Error: "Transaction failed with status 500"

**Solution:**
- Check server logs for detailed error messages
- Ensure fee payer wallet has SOL balance
- Verify server configuration is correct

## Alternative: Edit Script Directly

If you prefer not to use environment variables, you can edit the script directly:

1. Open `scripts/create-gasless-payment.ts`
2. Find the `PAYMENT_QUOTE` object (around line 40)
3. Update the values with your Step 1 response:
   ```typescript
   const PAYMENT_QUOTE = {
     recipientWallet: 'seFkxFkXEY9JGEpCyPfCWTuPZG9WK6ucf95zvKCfsRX', // from Step 1
     tokenAccount: '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU', // from Step 1
     mint: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
     amount: 300, // from Step 1
     amountUSDC: 0.0003, // from Step 1
   };
   ```
4. Make sure `USER_PRIVATE_KEY` is set in `.env`
5. Run: `npm run test:gasless:step2`

## Quick Test Checklist

- [ ] Server is running (`npm run dev`)
- [ ] Completed Step 1 and have payment quote
- [ ] Added `USER_PRIVATE_KEY` to `.env`
- [ ] Added quote values to `.env` (or edited script)
- [ ] User wallet has USDC balance
- [ ] Run `npm run test:gasless:step2`
- [ ] Check transaction on Solana Explorer

## Next Steps

After successful Step 2 testing:
- ✅ Transaction should appear on Solana Explorer
- ✅ Server should have received USDC payment
- ✅ You can verify the transaction signature
- ✅ Test with different amounts
- ✅ Test error scenarios (insufficient balance, etc.)


