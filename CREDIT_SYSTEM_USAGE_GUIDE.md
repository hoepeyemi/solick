# Credit System Usage Guide

## 🎯 Complete Flow: From Payment to Sponsored Transaction

### **Step 1: Make a Payment to Add Credit**

First, you need to make a payment that will add credit to your account:

```bash
curl -X POST http://localhost:3000/api/transaction/gasless \
  -H "Content-Type: application/json" \
  -d '{
    "email": "hoepeyemi@gmail.com"
  }'
```

**What happens:**
- User pays 0.0003 USDC
- Payment is verified on-chain
- Credit (0.0003 USDC) is added to your account
- Payment is recorded in database

**Response:**
```json
{
  "success": true,
  "message": "Payment transaction executed! You paid 0 SOL (signed with Grid wallet)",
  "signature": "...",
  "explorerUrl": "...",
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

---

### **Step 2: Check Your Credit Balance**

Verify that credit was added to your account:

```bash
curl http://localhost:3000/api/transaction/gasless/credit/hoepeyemi@gmail.com
```

**Response:**
```json
{
  "success": true,
  "email": "hoepeyemi@gmail.com",
  "credit": {
    "totalCredit": 0.0003,
    "creditUSDC": 0.0003,
    "payments": [
      {
        "id": "...",
        "amountUSDC": 0.0003,
        "creditRemaining": 0.0003,
        "creditUsed": 0,
        "signature": "...",
        "status": "VERIFIED",
        "createdAt": "2024-01-01T00:00:00.000Z"
      }
    ]
  }
}
```

---

### **Step 3: Sponsor a Transaction Using Credit**

Now you can sponsor a transaction using your credit. **Important:** You need a real base64-encoded transaction, not the string "string".

```bash
curl -X POST http://localhost:3000/api/transaction/gasless/sponsor \
  -H "Content-Type: application/json" \
  -d '{
    "email": "hoepeyemi@gmail.com",
    "transaction": "AQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABAAEDAgMEBQYHCAkKCwwNDg8QERITFBUWFxgZGhscHR4fICEiIyQlJic=",
    "type": "USER_TRANSACTION"
  }'
```

**Note:** The `transaction` field must be a **base64-encoded Solana transaction**, not the literal string "string".

---

## 🔍 Troubleshooting

### **Error: "Insufficient credit"**

**Cause:** You haven't made a payment yet, or you've used all your credit.

**Solution:**
1. Make a payment first using Step 1
2. Check your credit balance using Step 2
3. If you have credit, try sponsoring again

### **Error: "Invalid transaction format"**

**Cause:** The `transaction` field is not a valid base64-encoded transaction.

**Solution:** 
- You need to create a real Solana transaction first
- Encode it as base64
- Then use that base64 string in the request

### **How to Create a Transaction**

If you need to create a transaction to sponsor, you can:

1. **Use Solana Web3.js to create a transaction:**
```typescript
import { Transaction, SystemProgram, PublicKey } from '@solana/web3.js';

// Create your transaction
const transaction = new Transaction();
// Add instructions...
// ... your transaction logic

// Serialize and encode
const serialized = transaction.serialize();
const base64 = Buffer.from(serialized).toString('base64');
```

2. **Or use an existing transaction from another endpoint** that returns a transaction

---

## 📊 Complete Example Flow

```bash
# 1. Make payment (adds 0.0003 USDC credit)
curl -X POST http://localhost:3000/api/transaction/gasless \
  -H "Content-Type: application/json" \
  -d '{"email": "hoepeyemi@gmail.com"}'

# 2. Check credit balance
curl http://localhost:3000/api/transaction/gasless/credit/hoepeyemi@gmail.com

# 3. Get payment history
curl "http://localhost:3000/api/transaction/gasless/payments/hoepeyemi@gmail.com?limit=10"

# 4. Sponsor transaction (requires valid base64 transaction)
curl -X POST http://localhost:3000/api/transaction/gasless/sponsor \
  -H "Content-Type: application/json" \
  -d '{
    "email": "hoepeyemi@gmail.com",
    "transaction": "YOUR_BASE64_TRANSACTION_HERE",
    "type": "USER_TRANSACTION"
  }'
```

---

## 💡 Quick Reference

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/transaction/gasless` | POST | Make payment (adds credit) |
| `/api/transaction/gasless/credit/:email` | GET | Check credit balance |
| `/api/transaction/gasless/payments/:email` | GET | Get payment history |
| `/api/transaction/gasless/sponsor` | POST | Sponsor transaction using credit |

---

## ⚠️ Important Notes

1. **Credit Amount:** Each payment adds 0.0003 USDC credit
2. **Credit Usage:** Each sponsored transaction uses 0.0003 USDC credit
3. **FIFO Deduction:** Credit is deducted from oldest payment first
4. **Transaction Format:** Must be a valid base64-encoded Solana transaction
5. **Grid Account Required:** User must have an active Grid account

---

## 🎯 Your Current Situation

Based on your error, you need to:

1. **First, make a payment:**
   ```bash
   curl -X POST http://localhost:3000/api/transaction/gasless \
     -H "Content-Type: application/json" \
     -d '{"email": "hoepeyemi@gmail.com"}'
   ```

2. **Then check your credit:**
   ```bash
   curl http://localhost:3000/api/transaction/gasless/credit/hoepeyemi@gmail.com
   ```

3. **Finally, sponsor with a REAL transaction:**
   - Replace `"string"` with an actual base64-encoded transaction
   - Or create a transaction first using Solana Web3.js

---

## 🔗 Related Documentation

- `CREDIT_SYSTEM_IMPLEMENTATION.md` - Full implementation details
- `GASLESS_TRANSACTION_GUIDE.md` - Gasless transaction guide
- `TEST_GASLESS_CURL.md` - Testing guide

