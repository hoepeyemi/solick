# Complete Guide: Gasless Transactions & Credit System

## 📚 Table of Contents

1. [Overview](#overview)
2. [Prerequisites](#prerequisites)
3. [Step-by-Step Guide](#step-by-step-guide)
4. [API Endpoints Reference](#api-endpoints-reference)
5. [Complete Examples](#complete-examples)
6. [Troubleshooting](#troubleshooting)

---

## 🎯 Overview

The gasless transaction system allows users to:
- **Pay for gas fees in USDC** instead of SOL
- **Build up credit** by making payments
- **Use credit** to sponsor future transactions
- **Track payment history** and credit balance

---

## ✅ Prerequisites

### **1. User Requirements**
- ✅ User account exists in the system
- ✅ User has a **Grid account** (created via `/api/users/grid/initiate` and `/api/users/grid/complete`)
- ✅ User has **USDC balance** in their Grid account
- ✅ User account is **active**

### **2. Server Configuration**
- ✅ `GASLESS_FEE_PAYER_PRIVATE_KEY` is set (server's fee payer)
- ✅ `GASLESS_RECIPIENT_WALLET` is set (where payments go)
- ✅ `GASLESS_PRICE_USDC` is set (default: 0.0003 USDC)
- ✅ `SOLANA_NETWORK` is set (devnet or mainnet)

### **3. Check Your Setup**

```bash
# Check if user exists and has Grid account
curl http://localhost:3000/api/users/email/your-email@example.com

# Response should include:
# - gridAddress
# - authResult
# - sessionSecrets
```

---

## 📋 Step-by-Step Guide

### **STEP 1: Make a Payment (Add Credit)**

**Purpose:** Add credit to your account by making a USDC payment.

**Endpoint:** `POST /api/transaction/gasless`

**Request:**
```bash
curl -X POST http://localhost:3000/api/transaction/gasless \
  -H "Content-Type: application/json" \
  -d '{
    "email": "your-email@example.com"
  }'
```

**What Happens:**
1. Server creates a USDC payment transaction (0.0003 USDC by default)
2. Server signs transaction with your Grid wallet
3. Server verifies payment on-chain
4. **Credit is added to your account** (0.0003 USDC)
5. Payment is recorded in database

**Response:**
```json
{
  "success": true,
  "message": "Payment transaction executed! You paid 0 SOL (signed with Grid wallet)",
  "signature": "5RbggD9v5x4qwKjHbksbH6hmzbp8tUPEXce7dmcqvcKFRdRwhj5YmFEM9Xe8ktsQDXcMmpvYBETuJY1AGnRHCqNA",
  "explorerUrl": "https://explorer.solana.com/tx/...",
  "paymentDetails": {
    "signature": "...",
    "amount": 300,
    "amountUSDC": 0.0003,
    "recipient": "...",
    "explorerUrl": "..."
  },
  "transactionInfo": {
    "network": "devnet",
    "cluster": "devnet",
    "feePayer": "Grid Wallet (user paid USDC, Grid paid SOL)",
    "userPaid": "0 SOL",
    "usdcSpent": 0.0003,
    "signedWith": "Grid Wallet"
  }
}
```

**✅ Success Indicators:**
- `success: true`
- Transaction signature returned
- Explorer URL provided

---

### **STEP 2: Check Your Credit Balance**

**Purpose:** Verify that credit was added and see your total available credit.

**Endpoint:** `GET /api/transaction/gasless/credit/:email`

**Request:**
```bash
curl http://localhost:3000/api/transaction/gasless/credit/your-email@example.com
```

**Response:**
```json
{
  "success": true,
  "email": "your-email@example.com",
  "credit": {
    "totalCredit": 0.0003,
    "creditUSDC": 0.0003,
    "payments": [
      {
        "id": "clx1234567890",
        "amountUSDC": 0.0003,
        "creditRemaining": 0.0003,
        "creditUsed": 0,
        "signature": "5RbggD9v5x4qwKjHbksbH6hmzbp8tUPEXce7dmcqvcKFRdRwhj5YmFEM9Xe8ktsQDXcMmpvYBETuJY1AGnRHCqNA",
        "status": "VERIFIED",
        "createdAt": "2024-01-01T00:00:00.000Z"
      }
    ]
  }
}
```

**✅ What to Check:**
- `totalCredit` should match the payment amount
- `creditRemaining` should be greater than 0
- Payment status should be `VERIFIED`

---

### **STEP 3: Create a Transaction for Sponsorship**

**Purpose:** Create an unsigned transaction that you want to sponsor using credit.

**Endpoint:** `POST /api/transaction/gasless/create-transaction`

**Request:**
```bash
curl -X POST http://localhost:3000/api/transaction/gasless/create-transaction \
  -H "Content-Type: application/json" \
  -d '{
    "fromAddress": "YOUR_GRID_ADDRESS",
    "toAddress": "RECIPIENT_ADDRESS",
    "amount": 1.5
  }'
```

**Parameters:**
- `fromAddress` (required): Your Grid address or wallet address
- `toAddress` (required): Recipient's address
- `amount` (required): Amount in USDC (e.g., 1.5 = 1.5 USDC)
- `tokenMint` (optional): Token mint address (defaults to USDC)

**Response:**
```json
{
  "success": true,
  "message": "Transaction created for sponsorship",
  "transaction": "AQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABAAEDAgMEBQYHCAkKCwwNDg8QERITFBUWFxgZGhscHR4fICEiIyQlJic=",
  "transactionInfo": {
    "fromAddress": "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU",
    "toAddress": "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM",
    "amount": 1.5,
    "tokenMint": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    "fromTokenAccount": "...",
    "toTokenAccount": "...",
    "network": "devnet"
  },
  "nextStep": {
    "message": "Use this transaction in the sponsor endpoint",
    "endpoint": "/api/transaction/gasless/sponsor",
    "example": {
      "email": "user@example.com",
      "transaction": "AQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABAAEDAgMEBQYHCAkKCwwNDg8QERITFBUWFxgZGhscHR4fICEiIyQlJic=",
      "type": "TRANSFER"
    }
  }
}
```

**✅ Important:**
- Copy the `transaction` field (base64 string)
- This transaction is **unsigned** (server will sign it when sponsoring)
- Use this transaction in the next step

---

### **STEP 4: Sponsor Transaction Using Credit**

**Purpose:** Execute a transaction using your credit balance (no SOL needed).

**Endpoint:** `POST /api/transaction/gasless/sponsor`

**Request:**
```bash
curl -X POST http://localhost:3000/api/transaction/gasless/sponsor \
  -H "Content-Type: application/json" \
  -d '{
    "email": "your-email@example.com",
    "transaction": "AQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABAAEDAgMEBQYHCAkKCwwNDg8QERITFBUWFxgZGhscHR4fICEiIyQlJic=",
    "type": "TRANSFER"
  }'
```

**Parameters:**
- `email` (required): Your email address
- `transaction` (required): Base64-encoded transaction from Step 3
- `type` (optional): Transaction type - `USER_TRANSACTION`, `TRANSFER`, `YIELD_OPERATION`, or `CUSTOM` (default: `USER_TRANSACTION`)

**What Happens:**
1. Server checks if you have sufficient credit (0.0003 USDC)
2. Server deducts credit from your account (FIFO - oldest first)
3. Server signs transaction as fee payer (pays SOL gas)
4. Server submits transaction to blockchain
5. Transaction is executed

**Response:**
```json
{
  "success": true,
  "message": "Transaction sponsored using credit",
  "signature": "4NQHyp84ThSEa9hEpUNF48jLB9TmuGyieJEpsqVHPkuRmoFpuLjj4uMEoX7nsbYPLaYnLwd9aMLg9QdmUxkR2Vdh",
  "explorerUrl": "https://explorer.solana.com/tx/...",
  "credit": {
    "used": 0.0003,
    "remaining": 0.0
  }
}
```

**✅ Success Indicators:**
- `success: true`
- Transaction signature returned
- Credit deducted (`used: 0.0003`)
- Remaining credit shown

**❌ Common Errors:**
- `402 Insufficient credit`: Make another payment (Step 1)
- `400 Invalid transaction format`: Check that transaction is valid base64
- `404 User not found`: Verify email address

---

### **STEP 5: View Payment History (Optional)**

**Purpose:** See all your payments and credit usage history.

**Endpoint:** `GET /api/transaction/gasless/payments/:email`

**Request:**
```bash
curl "http://localhost:3000/api/transaction/gasless/payments/your-email@example.com?limit=10"
```

**Query Parameters:**
- `limit` (optional): Number of payments to return (default: 50, max: 100)

**Response:**
```json
{
  "success": true,
  "email": "your-email@example.com",
  "payments": [
    {
      "id": "clx1234567890",
      "amountUSDC": 0.0003,
      "amount": "300",
      "signature": "5RbggD9v5x4qwKjHbksbH6hmzbp8tUPEXce7dmcqvcKFRdRwhj5YmFEM9Xe8ktsQDXcMmpvYBETuJY1AGnRHCqNA",
      "status": "VERIFIED",
      "creditRemaining": 0.0,
      "creditUsed": 0.0003,
      "recipientTokenAccount": "...",
      "recipientWallet": "...",
      "fromAddress": "...",
      "network": "devnet",
      "tokenMint": "...",
      "explorerUrl": "...",
      "createdAt": "2024-01-01T00:00:00.000Z",
      "updatedAt": "2024-01-01T00:00:00.000Z"
    }
  ],
  "count": 1
}
```

---

## 🔄 Complete Workflow Example

### **Scenario: Send 1.5 USDC to Another Address**

```bash
# Step 1: Make payment (add credit)
curl -X POST http://localhost:3000/api/transaction/gasless \
  -H "Content-Type: application/json" \
  -d '{"email": "hoepeyemi@gmail.com"}'

# Step 2: Check credit balance
curl http://localhost:3000/api/transaction/gasless/credit/hoepeyemi@gmail.com

# Step 3: Create transaction
TRANSACTION_RESPONSE=$(curl -X POST http://localhost:3000/api/transaction/gasless/create-transaction \
  -H "Content-Type: application/json" \
  -d '{
    "fromAddress": "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU",
    "toAddress": "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM",
    "amount": 1.5
  }')

# Extract transaction from response (in real usage, parse JSON)
# For this example, assume we got: "AQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABAAEDAgMEBQYHCAkKCwwNDg8QERITFBUWFxgZGhscHR4fICEiIyQlJic="

# Step 4: Sponsor transaction
curl -X POST http://localhost:3000/api/transaction/gasless/sponsor \
  -H "Content-Type: application/json" \
  -d '{
    "email": "hoepeyemi@gmail.com",
    "transaction": "AQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABAAEDAgMEBQYHCAkKCwwNDg8QERITFBUWFxgZGhscHR4fICEiIyQlJic=",
    "type": "TRANSFER"
  }'

# Step 5: Verify transaction (optional)
# Check the explorer URL from the response
```

---

## 📊 API Endpoints Reference

| Endpoint | Method | Purpose | Credit Required |
|----------|--------|---------|----------------|
| `/api/transaction/gasless` | POST | Make payment (add credit) | ❌ No |
| `/api/transaction/gasless/credit/:email` | GET | Check credit balance | ❌ No |
| `/api/transaction/gasless/payments/:email` | GET | View payment history | ❌ No |
| `/api/transaction/gasless/create-transaction` | POST | Create transaction for sponsorship | ❌ No |
| `/api/transaction/gasless/sponsor` | POST | Sponsor transaction using credit | ✅ Yes |

---

## 💡 Key Concepts

### **Credit System**
- **Credit Amount**: Each payment adds 0.0003 USDC credit (configurable)
- **Credit Usage**: Each sponsored transaction uses 0.0003 USDC credit
- **FIFO Deduction**: Credit is deducted from oldest payment first
- **Multiple Payments**: You can make multiple payments to build up credit

### **Transaction Types**
- `USER_TRANSACTION`: General user transaction
- `TRANSFER`: Token transfer (most common)
- `YIELD_OPERATION`: Yield farming operation
- `CUSTOM`: Custom transaction type

### **Payment Flow**
1. User makes payment → Credit added
2. User creates transaction → Gets base64 transaction
3. User sponsors transaction → Credit deducted, transaction executed

---

## 🔍 Troubleshooting

### **Error: "Insufficient credit"**

**Problem:** You don't have enough credit to sponsor a transaction.

**Solution:**
1. Make a payment: `POST /api/transaction/gasless`
2. Check your credit: `GET /api/transaction/gasless/credit/:email`
3. Make another payment if needed

### **Error: "Invalid transaction format"**

**Problem:** The transaction is not valid base64.

**Solution:**
1. Use the create-transaction endpoint to generate a valid transaction
2. Make sure you're copying the entire base64 string
3. Don't modify the transaction string

### **Error: "User not found"**

**Problem:** Email address doesn't exist in the system.

**Solution:**
1. Verify the email address is correct
2. Check if user exists: `GET /api/users/email/:email`
3. Create user if needed

### **Error: "User does not have complete Grid account data"**

**Problem:** User hasn't completed Grid account setup.

**Solution:**
1. Initiate Grid account: `POST /api/users/grid/initiate`
2. Complete Grid account: `POST /api/users/grid/complete`
3. Verify Grid account data exists

### **Error: "Transaction signing failed"**

**Problem:** Grid session expired or invalid.

**Solution:**
1. Refresh Grid session: `POST /api/users/refresh-session`
2. Complete session refresh: `POST /api/users/complete-session-refresh`
3. Try again

### **Error: "Payment verification failed"**

**Problem:** Payment transaction couldn't be verified on-chain.

**Solution:**
1. Check transaction on Solana Explorer (use explorerUrl from response)
2. Wait a few seconds and try again (transaction might be pending)
3. Verify payment was actually sent

---

## 📈 Building Up Credit

You can make multiple payments to build up credit:

```bash
# Payment 1: Adds 0.0003 USDC credit
curl -X POST http://localhost:3000/api/transaction/gasless \
  -H "Content-Type: application/json" \
  -d '{"email": "your-email@example.com"}'

# Payment 2: Adds another 0.0003 USDC credit (total: 0.0006)
curl -X POST http://localhost:3000/api/transaction/gasless \
  -H "Content-Type: application/json" \
  -d '{"email": "your-email@example.com"}'

# Payment 3: Adds another 0.0003 USDC credit (total: 0.0009)
curl -X POST http://localhost:3000/api/transaction/gasless \
  -H "Content-Type: application/json" \
  -d '{"email": "your-email@example.com"}'

# Now you have 0.0009 USDC credit (can sponsor 3 transactions)
```

---

## 🎯 Quick Reference

### **Minimum Requirements for One Transaction:**
1. ✅ User account with Grid account
2. ✅ 0.0003 USDC credit (make one payment)
3. ✅ Valid transaction to sponsor

### **Complete Flow (One Transaction):**
```bash
# 1. Make payment
POST /api/transaction/gasless

# 2. Create transaction
POST /api/transaction/gasless/create-transaction

# 3. Sponsor transaction
POST /api/transaction/gasless/sponsor
```

### **Check Status:**
```bash
# Check credit
GET /api/transaction/gasless/credit/:email

# Check payment history
GET /api/transaction/gasless/payments/:email
```

---

## 📚 Additional Resources

- **Credit System Implementation**: `CREDIT_SYSTEM_IMPLEMENTATION.md`
- **Credit Usage Guide**: `CREDIT_SYSTEM_USAGE_GUIDE.md`
- **Create Transaction Guide**: `CREATE_TRANSACTION_ENDPOINT_GUIDE.md`
- **Quick Start**: `QUICK_START_SPONSOR_TRANSACTION.md`
- **Gasless Feature Walkthrough**: `GASLESS_FEATURE_WALKTHROUGH.md`

---

## ✅ Summary

**The Complete Flow:**

1. **Make Payment** → Adds credit to your account
2. **Check Credit** → Verify credit balance
3. **Create Transaction** → Generate transaction for sponsorship
4. **Sponsor Transaction** → Use credit to execute transaction
5. **View History** → Track all payments and transactions

**Key Benefits:**
- ✅ No SOL needed - pay in USDC
- ✅ Build up credit for multiple transactions
- ✅ Track all payments and credit usage
- ✅ Fully programmatic - no manual steps

**That's it! You're ready to use the gasless transaction and credit system! 🚀**

