# Gasless Transaction Relay - Testing Guide

This guide explains how to test the Gasless Transaction Relay feature that allows users to pay for transaction fees in USDC instead of SOL.

## Quick Start

### Option 1: Regular Wallet (Simple)

```bash
# Step 1: Get payment quote
curl -X POST http://localhost:3000/api/transaction/gasless \
  -H "Content-Type: application/json"

# Step 2: Create and send payment (after updating script with quote details)
npm run test:gasless:step2
```

### Option 2: Grid Wallet (Recommended for Grid Users)

```bash
# Step 1: Prepare payment transaction for Grid wallet
curl -X POST http://localhost:3000/api/transaction/gasless/grid/prepare \
  -H "Content-Type: application/json" \
  -d '{"email": "user@example.com"}'

# Step 2: Sign with Grid SDK and execute
npm run test:gasless:grid
```

### Option 3: Automated Test (Regular Wallet)

```bash
npm run test:gasless
```

## Prerequisites

### 1. Environment Setup

Make sure your `.env` file has the following variables configured:

```env
# Server Configuration
SERVER_URL=http://localhost:3000
SOLANA_NETWORK=devnet  # or 'mainnet'

# Gasless Transaction Configuration
GASLESS_FEE_PAYER_PRIVATE_KEY=your_base58_private_key_here
GASLESS_RECIPIENT_WALLET=seFkxFkXEY9JGEpCyPfCWTuPZG9WK6ucf95zvKCfsRX
GASLESS_PRICE_USDC=0.0003

# User Wallet (for testing)
USER_PRIVATE_KEY=your_user_wallet_base58_private_key
```

### 2. Wallet Requirements

- **Fee Payer Wallet**: Must have SOL balance to pay for gas fees
- **User Wallet**: Must have USDC balance (at least 0.0003 USDC for testing)
- **Recipient Wallet**: Where USDC payments are sent (configured in `GASLESS_RECIPIENT_WALLET`)

### 3. Fund Wallets (Devnet)

For devnet testing, you can get free SOL and USDC:

```bash
# Get free SOL from faucet
# Visit: https://faucet.solana.com/

# Get free USDC on devnet
# You may need to swap SOL for USDC or use a devnet faucet
```

## Testing Methods

### Method 1: Using the Test Script (Recommended)

We've created a test script that handles the entire flow:

```bash
# 1. Make sure your server is running
npm run dev

# 2. In another terminal, run the test script
npx ts-node scripts/test-gasless-transaction.ts
```

The script will:
1. Request payment quote from server
2. Check user's USDC balance
3. Create USDC transfer transaction
4. Send transaction with x402 payment proof
5. Display results

### Method 2: Manual Testing (Two-Step Process)

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
    "cluster": "devnet",
    "message": "Send USDC to the token account to pay for gasless transaction execution"
  },
  "service": "Gasless transaction execution",
  "benefit": "No SOL needed - pay gas fee in USDC"
}
```

**Save the payment details** - you'll need them for Step 2.

#### Step 2: Create and Send Transaction

Use the standalone script to create and send the payment:

```bash
# Set the payment quote details from Step 1
export QUOTE_TOKEN_ACCOUNT="7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU"
export QUOTE_RECIPIENT_WALLET="seFkxFkXEY9JGEpCyPfCWTuPZG9WK6ucf95zvKCfsRX"
export QUOTE_AMOUNT="300"
export QUOTE_AMOUNT_USDC="0.0003"
export USER_PRIVATE_KEY="your_user_wallet_base58_private_key"

# Run the script
npx ts-node scripts/create-gasless-payment.ts
```

**Or update the script directly** with the quote values from Step 1, then run:

```bash
npx ts-node scripts/create-gasless-payment.ts
```

The script will:
1. Create a USDC transfer transaction
2. Sign it with your wallet
3. Create x402 payment proof
4. Send it to the server
5. Display the result with explorer link

### Method 3: Using Swagger UI

1. Start your server: `npm run dev`
2. Open Swagger UI: `http://localhost:3000/api-docs`
3. Find the `/api/transaction/gasless` endpoint
4. Click "Try it out"
5. First request (no X-Payment header): Will return 402 with payment quote
6. Second request: You'll need to create the x402 payment proof programmatically

## Test Script Details

The test script (`scripts/test-gasless-transaction.ts`) performs these steps:

1. **Request Quote**: Gets payment details from server
2. **Check Balance**: Verifies user has enough USDC
3. **Create Transaction**: Builds USDC transfer transaction
4. **Sign Transaction**: User signs the transaction
5. **Create Payment Proof**: Encodes transaction in x402 format
6. **Send to Server**: Server verifies, sponsors, and submits

## Expected Flow

```
Client                          Server
  |                               |
  |-- Request Quote (POST) ------>|
  |<-- 402 Payment Required ------|
  |                               |
  |-- Create USDC Transfer -------|
  |-- Sign Transaction ------------|
  |-- Create x402 Proof ----------|
  |                               |
  |-- Send with X-Payment ------->|
  |                               |
  |                               |-- Verify Payment
  |                               |-- Simulate Transaction
  |                               |-- Sponsor (Pay SOL Gas)
  |                               |-- Submit to Blockchain
  |                               |-- Verify Payment Received
  |                               |
  |<-- 200 Success ---------------|
  |   (with signature)            |
```

## Troubleshooting

### Error: "Gasless transaction service not configured"

**Solution**: Make sure all environment variables are set:
- `GASLESS_FEE_PAYER_PRIVATE_KEY`
- `GASLESS_RECIPIENT_WALLET`
- `GASLESS_PRICE_USDC`

### Error: "Insufficient USDC balance"

**Solution**: 
- Ensure your user wallet has enough USDC
- Check the required amount in the payment quote
- For devnet, get USDC from a faucet or swap SOL for USDC

### Error: "Transaction simulation failed"

**Solution**:
- Check that the transaction is valid
- Ensure all accounts exist
- Verify the USDC transfer amount matches the quote

### Error: "Transaction sponsorship failed"

**Solution**:
- Ensure fee payer wallet has SOL balance
- Check that the private key is correctly formatted
- Verify network configuration matches

### Error: "Payment verification failed"

**Solution**:
- Ensure USDC transfer amount matches or exceeds quoted price
- Verify recipient token account is correct
- Check that transaction includes the USDC transfer instruction

## Testing Checklist

- [ ] Server is running and accessible
- [ ] Environment variables are configured
- [ ] Fee payer wallet has SOL balance
- [ ] User wallet has USDC balance
- [ ] Network configuration is correct (devnet/mainnet)
- [ ] Test script runs without errors
- [ ] Transaction appears on Solana Explorer
- [ ] Payment is verified and received

## Example Test Output

```
🧪 Testing Gasless Transaction Relay
=====================================

Server URL: http://localhost:3000
Network: devnet
Payer: 7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU

📋 Step 1: Requesting payment quote...
✓ Payment quote received:
  Recipient Token Account: 7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU
  Mint (USDC): 4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU
  Amount: 0.0003 USDC (300 smallest units)

📋 Step 2: Checking payer token account...
✓ Payer Token Account: 7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU
  Current Balance: 10.0 USDC

📋 Step 3: Checking recipient token account...
  ✓ Recipient token account exists

📋 Step 4: Creating USDC transfer transaction...
  + Added USDC transfer instruction
  ✓ Transaction signed
  ✓ Transaction serialized (1234 bytes)

📋 Step 5: Creating x402 payment proof...
  ✓ Payment proof created and encoded

📋 Step 6: Sending transaction with payment proof...
✓ Transaction executed successfully!

📊 Result:
{
  "success": true,
  "message": "Transaction executed! You paid 0 SOL",
  "signature": "5Kd3N8vQz7R9xY2wP4mN6bH8jK1L3M5Q7R9T1V3W5X7Y9Z1A3C5E7G9I1K3M5O",
  "explorerUrl": "https://explorer.solana.com/tx/5Kd3N8vQz7R9xY2wP4mN6bH8jK1L3M5Q7R9T1V3W5X7Y9Z1A3C5E7G9I1K3M5O?cluster=devnet"
}

🔗 View transaction on Solana Explorer:
https://explorer.solana.com/tx/5Kd3N8vQz7R9xY2wP4mN6bH8jK1L3M5Q7R9T1V3W5X7Y9Z1A3C5E7G9I1K3M5O?cluster=devnet

✅ Gasless transaction test completed successfully!
```

## Next Steps

After successful testing:

1. **Production Setup**: Update environment variables for mainnet
2. **Monitor**: Set up monitoring for fee payer SOL balance
3. **Scale**: Consider rate limiting and cost management
4. **Security**: Review and audit the payment verification logic

## Additional Resources

- [x402 Payment Standard](https://x402.dev/)
- [Solana Web3.js Documentation](https://solana-labs.github.io/solana-web3.js/)
- [SPL Token Documentation](https://spl.solana.com/token)

