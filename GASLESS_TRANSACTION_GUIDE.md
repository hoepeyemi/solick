# Gasless Transaction Relay - Complete Guide

## Overview

The gasless transaction relay feature allows users to execute transactions without needing SOL for gas fees. Users pay in USDC instead, and the server sponsors the transaction by paying SOL gas fees.

**Key Features:**
- ✅ Grid wallet only (fully programmatic)
- ✅ Server handles everything (no client-side signing required)
- ✅ Users pay in USDC, server pays SOL gas
- ✅ Seamless user experience

## How It Works

The implementation is fully programmatic - the server handles all steps:

1. **User provides email** → Server looks up user's Grid account
2. **Server creates USDC payment transaction** → Transfers USDC from user to server
3. **Server prepares transaction with Grid SDK** → Prepares for multi-sig signing
4. **Server signs and submits transaction with Grid SDK** → Uses user's stored session data
   - Grid SDK's `signAndSend` submits the transaction immediately
   - User's Grid wallet pays SOL gas for the payment transaction (small amount)
   - User pays USDC to server (the actual payment)
5. **Server verifies payment** → Confirms USDC was received from the on-chain transaction
6. **Returns result** → Transaction signature and details

**Note:** The user's Grid wallet needs a small amount of SOL to pay for the payment transaction's gas fees. However, the main benefit is that users don't need SOL for their actual transactions - they can pay in USDC instead.

## Prerequisites

Before using this feature, ensure:

- [ ] Server is running (`npm run dev`)
- [ ] Environment variables configured in `.env`
- [ ] Fee payer wallet has SOL balance
- [ ] User has Grid account with complete session data
- [ ] User's Grid wallet has USDC balance (at least 0.0003 USDC)
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

# User Email (for testing)
USER_EMAIL=user@example.com
```

### Environment Variables Explained

- **`GASLESS_FEE_PAYER_PRIVATE_KEY`**: Server's private key (base58 format) that pays SOL gas fees
- **`GASLESS_RECIPIENT_WALLET`**: Wallet address that receives USDC payments from users
- **`GASLESS_PRICE_USDC`**: Price in USDC for gasless transaction execution (default: 0.0003)
- **`SOLANA_NETWORK`**: Network to use (`devnet` or `mainnet`)

## API Endpoint

### POST `/api/transaction/gasless`

**Description:** Execute a gasless transaction using Grid wallet. Fully programmatic - server handles everything.

**Request Body:**
```json
{
  "email": "user@example.com"
}
```

**Success Response (200):**
```json
{
  "success": true,
  "message": "Transaction executed! You paid 0 SOL (signed with Grid wallet)",
  "signature": "5Kd3N8vQz7R9xY2wP4mN6bH8jK1L3M5Q7R9T1V3W5X7Y9Z1A3C5E7G9I1K3M5O...",
  "explorerUrl": "https://explorer.solana.com/tx/5Kd3N8vQz7R9xY2wP4mN6bH8jK1L3M5Q7R9T1V3W5X7Y9Z1A3C5E7G9I1K3M5O",
  "paymentDetails": {
    "signature": "5Kd3N8vQz7R9xY2wP4mN6bH8jK1L3M5Q7R9T1V3W5X7Y9Z1A3C5E7G9I1K3M5O...",
    "amount": 300,
    "amountUSDC": 0.0003,
    "recipient": "seFkxFkXEY9JGEpCyPfCWTuPZG9WK6ucf95zvKCfsRX",
    "explorerUrl": "https://explorer.solana.com/tx/5Kd3N8vQz7R9xY2wP4mN6bH8jK1L3M5Q7R9T1V3W5X7Y9Z1A3C5E7G9I1K3M5O"
  },
  "transactionInfo": {
    "network": "devnet",
    "cluster": "devnet",
    "feePayer": "Server (sponsored)",
    "userPaid": "0 SOL",
    "usdcSpent": 0.0003,
    "signedWith": "Grid Wallet",
    "user": {
      "email": "user@example.com",
      "gridAddress": "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU"
    }
  }
}
```

**Error Responses:**

- **400 Bad Request**: Missing email or incomplete Grid account
- **401 Unauthorized**: User account is inactive
- **402 Payment Required**: Payment verification or simulation failed
- **404 Not Found**: User not found
- **500 Internal Server Error**: Transaction processing failed
- **503 Service Unavailable**: Gasless service not configured

## Testing

### Method 1: Using cURL

```bash
# Start server first
npm run dev

# In another terminal, test the endpoint
curl -X POST http://localhost:3000/api/transaction/gasless \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com"
  }'
```

### Method 2: Using Test Script

Create a test script `test-gasless.ts`:

```typescript
import dotenv from 'dotenv';
dotenv.config();
import fetch from 'node-fetch';

async function testGaslessTransaction() {
  const serverUrl = process.env.SERVER_URL || 'http://localhost:3000';
  const userEmail = process.env.USER_EMAIL;

  if (!userEmail) {
    console.error('USER_EMAIL not set in .env');
    process.exit(1);
  }

  try {
    console.log(`\n🚀 Testing gasless transaction for ${userEmail}...\n`);

    const response = await fetch(`${serverUrl}/api/transaction/gasless`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: userEmail,
      }),
    });

    const data = await response.json();

    if (response.ok) {
      console.log('✅ Success!');
      console.log(`📝 Message: ${data.message}`);
      console.log(`🔐 Signature: ${data.signature}`);
      console.log(`🔗 Explorer: ${data.explorerUrl}`);
      console.log(`💰 USDC Spent: ${data.transactionInfo.usdcSpent} USDC`);
      console.log(`💸 User Paid: ${data.transactionInfo.userPaid}`);
    } else {
      console.error('❌ Error:', data.error);
      console.error('Details:', data.details);
    }
  } catch (error) {
    console.error('❌ Request failed:', error);
  }
}

testGaslessTransaction();
```

Run it:
```bash
ts-node test-gasless.ts
```

### Method 3: Using Postman or Similar

1. Create a new POST request
2. URL: `http://localhost:3000/api/transaction/gasless`
3. Headers: `Content-Type: application/json`
4. Body (JSON):
```json
{
  "email": "user@example.com"
}
```

## Troubleshooting

### Error: "Gasless transaction service not configured"

**Solution:** Ensure `GASLESS_FEE_PAYER_PRIVATE_KEY` and `GASLESS_RECIPIENT_WALLET` are set in `.env`

### Error: "User does not have complete Grid account data"

**Solution:** User must have completed Grid account creation with full session data stored

### Error: "Transaction signing failed"

**Solution:** 
- Check that user's Grid session data is valid
- Ensure Grid API key is configured correctly
- Verify user's Grid account is active

### Error: "Payment verification failed"

**Solution:**
- Ensure user's Grid wallet has sufficient USDC balance
- Check that USDC token account exists for user's Grid wallet
- Verify recipient wallet address is correct

### Error: "Transaction simulation failed"

**Solution:**
- Check transaction details
- Ensure all accounts exist
- Verify network configuration matches

## How It Differs from Previous Implementation

### Previous (Two Methods)
- **Regular Wallet**: Required client-side signing with x402 header
- **Grid Wallet**: Two-step process (prepare + execute)

### Current (Single Method)
- **Grid Wallet Only**: Fully programmatic
- **Single Endpoint**: One API call does everything
- **Server-Side Signing**: Uses Grid SDK on server with user's session data
- **Simpler Integration**: No client-side code needed

## Security Considerations

1. **Session Data**: User's Grid session data is stored securely in the database
2. **Server-Side Signing**: All signing happens on the server using stored credentials
3. **Payment Verification**: Double verification (before and after transaction)
4. **Transaction Simulation**: All transactions are simulated before submission
5. **Fee Payer**: Server's fee payer key should be kept secure

## Cost Structure

- **User Pays**: 
  - USDC (default: 0.0003 USDC per transaction) - the payment amount
  - Small amount of SOL from Grid wallet (for payment transaction gas) - typically ~0.000005 SOL
- **Server Provides**: Payment verification and processing
- **Net Result**: User pays USDC instead of SOL for transactions, with minimal SOL needed for payment transaction gas

## Support

For issues or questions:
1. Check the troubleshooting section above
2. Review server logs for detailed error messages
3. Verify all environment variables are set correctly
4. Ensure user has completed Grid account setup

