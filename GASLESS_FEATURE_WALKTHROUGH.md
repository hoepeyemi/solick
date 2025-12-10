# Gasless Transaction Feature - Complete Walkthrough

## 🎯 Overview

The gasless transaction feature allows users to execute transactions **without needing SOL for gas fees**. Instead, users pay in **USDC**, and the server handles everything programmatically using the user's Grid wallet.

## 🔄 High-Level Flow

```
User Request → Server Processing → Grid SDK Signing → Blockchain Submission → Payment Verification → Success Response
```

## 📋 Step-by-Step Process

### **Step 1: User Initiates Request**

**User Action:**
```bash
curl -X POST http://localhost:3000/api/transaction/gasless \
  -H "Content-Type: application/json" \
  -d '{"email": "user@example.com"}'
```

**What Happens:**
- User provides their email address
- Server receives the request at `/api/transaction/gasless`

---

### **Step 2: Server Validates Configuration**

**Code Location:** `src/controllers/user.controller.ts:6159-6165`

**Checks:**
- ✅ Gasless service is configured (`GASLESS_FEE_PAYER_PRIVATE_KEY` and `GASLESS_RECIPIENT_WALLET` set)
- ✅ Email is provided
- ✅ User exists in database
- ✅ User account is active
- ✅ User has complete Grid account data (Grid address, auth result, session secrets)

**If validation fails:**
- Returns appropriate error (404, 401, 400, or 503)

---

### **Step 3: Get Payment Quote**

**Code Location:** `src/services/gasless.service.ts:151-185`

**What Happens:**
- Server calculates the payment amount (default: 0.0003 USDC = 300 smallest units)
- Gets the recipient's USDC token account address
- Returns payment quote with:
  - Recipient wallet address
  - Token account address (Associated Token Account)
  - USDC mint address
  - Amount in USDC and smallest units
  - Network/cluster information

**Payment Quote Structure:**
```json
{
  "payment": {
    "recipientWallet": "seFkxFkXEY9JGEpCyPfCWTuPZG9WK6ucf95zvKCfsRX",
    "tokenAccount": "<ATA address>",
    "mint": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    "amount": 300,
    "amountUSDC": 0.0003,
    "cluster": "devnet"
  }
}
```

---

### **Step 4: Create USDC Payment Transaction**

**Code Location:** `src/controllers/user.controller.ts:6261-6280`

**What Happens:**
- Server uses `blockchainService.createTransaction()` to create a USDC transfer transaction
- Transaction details:
  - **From:** User's Grid wallet address
  - **To:** Server's USDC token account (recipient)
  - **Token:** USDC
  - **Amount:** 0.0003 USDC (300 smallest units)
- Transaction is created but **not yet signed or submitted**

**Transaction Structure:**
- Contains SPL Token transfer instruction
- Includes all required accounts (source, destination, owner, token program)
- Has recent blockhash (for freshness)

---

### **Step 5: Prepare Transaction with Grid SDK**

**Code Location:** `src/controllers/user.controller.ts:6282-6304`

**What Happens:**
- Server calls `gridClient.prepareArbitraryTransaction()`
- Grid SDK prepares the transaction for multi-signature signing
- This step:
  - Analyzes the transaction
  - Identifies required signers
  - Prepares KMS (Key Management Service) payloads if needed
  - Returns transaction payload ready for signing

**Grid SDK Response:**
```json
{
  "success": true,
  "data": {
    "transaction": "<base64-encoded-transaction>",
    "transaction_signers": ["<signer-addresses>"],
    "kms_payloads": []
  }
}
```

---

### **Step 6: Sign and Submit Transaction with Grid SDK**

**Code Location:** `src/controllers/user.controller.ts:6306-6372`

**What Happens:**
- Server calls `gridClient.signAndSend()` with:
  - User's session secrets (from database)
  - User's authentication token (from database)
  - Prepared transaction payload
  - User's Grid address

**Grid SDK Processing:**
1. Grid SDK uses the user's stored session data to authenticate
2. Signs the transaction using the user's Grid wallet (multi-sig)
3. **Immediately submits** the transaction to the Solana blockchain
4. Returns transaction signature

**Important Notes:**
- ⚠️ Grid SDK's `signAndSend` **submits immediately** - we can't intercept it
- ⚠️ User's Grid wallet pays a **small amount of SOL** for the payment transaction's gas
- ✅ User pays **USDC** to the server (the actual payment)
- ✅ Transaction is now on-chain

**Response Structure:**
```json
{
  "transaction_signature": "4EijGfnTG7VPw7RG5WVr9ak92eFrGuEfzbcEB2SBbpnaPmJaP58hcJ18VZZogmKPKZh8Sonbx3gbdxrnBErfEe7o",
  "confirmed_at": "2025-12-04T19:26:55Z"
}
```

---

### **Step 7: Extract Transaction Signature**

**Code Location:** `src/controllers/user.controller.ts:6404-6438`

**What Happens:**
- Server extracts the transaction signature from Grid SDK response
- Tries multiple possible locations:
  - `transaction_signature` (top level) ✅ **Primary location**
  - `signature`
  - `data.signature`
  - `result.signature`
  - etc.

**Signature Format:**
- Base58-encoded string
- Example: `4EijGfnTG7VPw7RG5WVr9ak92eFrGuEfzbcEB2SBbpnaPmJaP58hcJ18VZZogmKPKZh8Sonbx3gbdxrnBErfEe7o`

---

### **Step 8: Verify Payment from On-Chain Transaction**

**Code Location:** `src/controllers/user.controller.ts:6440-6494` and `src/services/gasless.service.ts:417-492`

**What Happens:**
- Server waits for transaction confirmation (5 seconds initially, then retries)
- Fetches the confirmed transaction from Solana blockchain
- Analyzes token balance changes in the transaction metadata
- Verifies that:
  - ✅ USDC was transferred to the recipient's token account
  - ✅ Amount received >= expected amount (300 smallest units)

**Verification Process:**
1. **Wait for Confirmation:** 5 seconds, then retry up to 5 times (3 seconds between retries)
2. **Fetch Transaction:** Get confirmed transaction using signature
3. **Check Token Balances:**
   - Get `postTokenBalances` and `preTokenBalances` from transaction metadata
   - Find recipient's token account in the balance changes
   - Calculate: `amountReceived = postAmount - preAmount`
4. **Validate Amount:** Ensure `amountReceived >= expectedAmount`

**Verification Methods:**
- Direct account key match
- Owner + mint check (calculates associated token account)
- Handles both versioned (v0) and legacy transactions

**If Verification Fails:**
- Returns error with transaction signature
- Provides explorer URL for manual verification
- Transaction is already on-chain (can't be reversed)

---

### **Step 9: Return Success Response**

**Code Location:** `src/controllers/user.controller.ts:6496-6530`

**What Happens:**
- Server constructs success response with:
  - Success message
  - Transaction signature
  - Explorer URL
  - Payment details
  - Transaction info

**Success Response:**
```json
{
  "success": true,
  "message": "Payment transaction executed! You paid 0 SOL (signed with Grid wallet)",
  "signature": "4EijGfnTG7VPw7RG5WVr9ak92eFrGuEfzbcEB2SBbpnaPmJaP58hcJ18VZZogmKPKZh8Sonbx3gbdxrnBErfEe7o",
  "explorerUrl": "https://explorer.solana.com/tx/4EijGfnTG7VPw7RG5WVr9ak92eFrGuEfzbcEB2SBbpnaPmJaP58hcJ18VZZogmKPKZh8Sonbx3gbdxrnBErfEe7o?cluster=devnet",
  "paymentDetails": {
    "signature": "4EijGfnTG7VPw7RG5WVr9ak92eFrGuEfzbcEB2SBbpnaPmJaP58hcJ18VZZogmKPKZh8Sonbx3gbdxrnBErfEe7o",
    "amount": 300,
    "amountUSDC": 0.0003,
    "recipient": "<recipient-token-account>",
    "explorerUrl": "https://explorer.solana.com/tx/..."
  },
  "transactionInfo": {
    "network": "devnet",
    "cluster": "devnet",
    "feePayer": "Grid Wallet (user paid USDC, Grid paid SOL)",
    "userPaid": "0 SOL",
    "usdcSpent": 0.0003,
    "signedWith": "Grid Wallet",
    "user": {
      "email": "user@example.com",
      "gridAddress": "<user-grid-address>"
    }
  }
}
```

---

## 🔑 Key Components

### **1. GaslessTransactionService** (`src/services/gasless.service.ts`)

**Responsibilities:**
- Manages server fee payer keypair
- Manages recipient wallet configuration
- Generates payment quotes
- Verifies payments from on-chain transactions
- Provides explorer URLs

**Key Methods:**
- `getPaymentQuote()` - Returns payment quote with recipient details
- `verifyPaymentFromTransaction()` - Verifies USDC payment was received
- `getExplorerUrl()` - Generates Solana Explorer URL
- `isConfigured()` - Checks if service is properly configured

### **2. Gasless Transaction Controller** (`src/controllers/user.controller.ts:6155-6530`)

**Responsibilities:**
- Handles HTTP requests
- Validates user and configuration
- Orchestrates the entire flow
- Calls Grid SDK for signing
- Handles errors and returns responses

### **3. Grid SDK Integration**

**Used Methods:**
- `prepareArbitraryTransaction()` - Prepares transaction for signing
- `signAndSend()` - Signs and submits transaction

**Data Required:**
- User's session secrets (from database)
- User's authentication token (from database)
- User's Grid address
- Transaction payload

---

## 💰 Cost Structure

### **User Pays:**
- **USDC:** 0.0003 USDC (default, configurable via `GASLESS_PRICE_USDC`)
- **SOL (small amount):** ~0.000005 SOL for the payment transaction's gas (paid by Grid wallet)

### **Server Provides:**
- Payment verification
- Transaction processing
- Service infrastructure

### **Net Result:**
- User pays **USDC instead of SOL** for transactions
- User needs minimal SOL (only for payment transaction gas)
- Server receives USDC payment

---

## 🔒 Security Considerations

### **1. Session Management**
- User's Grid session data is stored securely in database
- Sessions can expire (24 hours typically)
- Expired sessions return helpful error messages with refresh endpoints

### **2. Payment Verification**
- Double verification:
  - Before submission (transaction structure)
  - After submission (on-chain verification)
- Retry logic ensures transaction is confirmed before verification

### **3. Transaction Signing**
- All signing happens server-side using stored credentials
- Grid SDK handles multi-signature requirements
- No client-side private keys exposed

### **4. Error Handling**
- Comprehensive error messages
- Transaction signatures provided even on verification failure
- Explorer URLs for manual verification

---

## 🚨 Error Scenarios

### **1. Service Not Configured**
- **Error:** `503 Service Unavailable`
- **Cause:** Missing `GASLESS_FEE_PAYER_PRIVATE_KEY` or `GASLESS_RECIPIENT_WALLET`
- **Solution:** Configure environment variables

### **2. User Not Found**
- **Error:** `404 Not Found`
- **Cause:** Email doesn't exist in database
- **Solution:** Create user account first

### **3. Incomplete Grid Account**
- **Error:** `400 Bad Request`
- **Cause:** User hasn't completed Grid account creation
- **Solution:** Complete Grid account setup

### **4. Session Expired**
- **Error:** `401 Unauthorized`
- **Cause:** Grid session has expired (24 hours)
- **Solution:** Refresh session using `/api/users/refresh-session`

### **5. Payment Verification Failed**
- **Error:** `500 Internal Server Error`
- **Cause:** Transaction submitted but payment couldn't be verified
- **Note:** Transaction is already on-chain, check explorer URL
- **Solution:** Check transaction on Solana Explorer manually

### **6. Insufficient USDC Balance**
- **Error:** `402 Payment Required` or Grid SDK error
- **Cause:** User's Grid wallet doesn't have enough USDC
- **Solution:** User needs to add USDC to their Grid wallet

---

## 📊 Transaction Flow Diagram

```
┌─────────────┐
│   User      │
│  (Email)    │
└──────┬──────┘
       │
       │ POST /api/transaction/gasless
       ▼
┌─────────────────────────────────────┐
│   Server Validation                 │
│  - Check configuration              │
│  - Validate user                    │
│  - Get payment quote                │
└──────┬──────────────────────────────┘
       │
       │ Create USDC Transfer Transaction
       ▼
┌─────────────────────────────────────┐
│   Blockchain Service                │
│  - Create transaction               │
│  - Include USDC transfer            │
└──────┬──────────────────────────────┘
       │
       │ Prepare with Grid SDK
       ▼
┌─────────────────────────────────────┐
│   Grid SDK                          │
│  - prepareArbitraryTransaction()    │
│  - Analyze transaction              │
│  - Prepare for signing              │
└──────┬──────────────────────────────┘
       │
       │ Sign and Submit
       ▼
┌─────────────────────────────────────┐
│   Grid SDK                          │
│  - signAndSend()                    │
│  - Sign with user's Grid wallet     │
│  - Submit to blockchain             │
│  - Return signature                 │
└──────┬──────────────────────────────┘
       │
       │ Wait for Confirmation
       ▼
┌─────────────────────────────────────┐
│   Payment Verification              │
│  - Fetch transaction                │
│  - Check token balances             │
│  - Verify USDC received             │
└──────┬──────────────────────────────┘
       │
       │ Success
       ▼
┌─────────────────────────────────────┐
│   Response to User                   │
│  - Transaction signature            │
│  - Explorer URL                     │
│  - Payment details                  │
└─────────────────────────────────────┘
```

---

## 🎯 Key Benefits

1. **No SOL Required (for main transactions):** Users pay in USDC instead
2. **Fully Automated:** Server handles everything, no client-side code needed
3. **Seamless UX:** Single API call, simple integration
4. **Grid Wallet Integration:** Uses existing Grid account infrastructure
5. **Secure:** Server-side signing with stored session data
6. **Verified:** Double verification ensures payment was received

---

## 🔧 Configuration

### **Required Environment Variables:**

```env
# Server fee payer (pays SOL gas - currently not used but required)
GASLESS_FEE_PAYER_PRIVATE_KEY=your_base58_private_key

# Recipient wallet (receives USDC payments)
GASLESS_RECIPIENT_WALLET=seFkxFkXEY9JGEpCyPfCWTuPZG9WK6ucf95zvKCfsRX

# Price in USDC (default: 0.0003)
GASLESS_PRICE_USDC=0.0003

# Network (devnet or mainnet)
SOLANA_NETWORK=devnet
```

---

## 📝 Summary

The gasless transaction feature is a **fully programmatic solution** that:

1. ✅ Takes user email as input
2. ✅ Creates USDC payment transaction
3. ✅ Signs with Grid SDK using stored session data
4. ✅ Submits transaction to blockchain
5. ✅ Verifies payment was received
6. ✅ Returns transaction details

**Key Point:** The user's Grid wallet pays a tiny amount of SOL for the payment transaction's gas, but the main benefit is that users can pay for transactions in USDC instead of needing SOL for their actual operations.


