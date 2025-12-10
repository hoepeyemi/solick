# Quick Start: Sponsor a Transaction

## 🎯 Simple 3-Step Process

### **Step 1: Make a Payment (Add Credit)**

```bash
curl -X POST http://localhost:3000/api/transaction/gasless \
  -H "Content-Type: application/json" \
  -d '{"email": "hoepeyemi@gmail.com"}'
```

This adds **0.0003 USDC credit** to your account.

---

### **Step 2: Create a Transaction**

#### **Option A: Use the Helper Script (Easiest)**

```bash
# Install dependencies if needed
npm install

# Create a transaction
npx ts-node scripts/create-transaction-for-sponsor.ts \
  YOUR_GRID_ADDRESS \
  RECIPIENT_ADDRESS \
  1.5

# Example:
npx ts-node scripts/create-transaction-for-sponsor.ts \
  7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU \
  9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM \
  1.5
```

The script will output a curl command with the transaction already filled in!

#### **Option B: Use Environment Variables**

```bash
export FROM_ADDRESS="YOUR_GRID_ADDRESS"
export TO_ADDRESS="RECIPIENT_ADDRESS"
export AMOUNT="1.5"
export SOLANA_NETWORK="devnet"

npx ts-node scripts/create-transaction-for-sponsor.ts
```

#### **Option C: Use an Existing Endpoint**

If you have an endpoint that creates transactions, use that:

```bash
curl -X POST http://localhost:3000/api/users/create-transaction \
  -H "Content-Type: application/json" \
  -d '{
    "fromAddress": "YOUR_GRID_ADDRESS",
    "toAddress": "RECIPIENT_ADDRESS",
    "tokenMint": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    "amount": 1.5
  }'
```

Copy the `transaction` field from the response.

---

### **Step 3: Sponsor the Transaction**

```bash
curl -X POST http://localhost:3000/api/transaction/gasless/sponsor \
  -H "Content-Type: application/json" \
  -d '{
    "email": "hoepeyemi@gmail.com",
    "transaction": "PASTE_BASE64_TRANSACTION_HERE",
    "type": "TRANSFER"
  }'
```

---

## 📋 Understanding the Fields

### **`type` Field**

This is just a label/category. You can use:

- `"USER_TRANSACTION"` - General user transaction
- `"TRANSFER"` - Token transfer (most common)
- `"YIELD_OPERATION"` - Yield farming operation
- `"CUSTOM"` - Custom transaction type

**It doesn't affect the transaction - it's just metadata.**

### **`transaction` Field**

This must be a **base64-encoded Solana transaction**. 

**How to get it:**
1. Use the helper script: `npx ts-node scripts/create-transaction-for-sponsor.ts`
2. Use an endpoint that creates transactions
3. Create it programmatically using Solana Web3.js

---

## 🔍 Complete Example

```bash
# 1. Make payment (adds credit)
curl -X POST http://localhost:3000/api/transaction/gasless \
  -H "Content-Type: application/json" \
  -d '{"email": "hoepeyemi@gmail.com"}'

# 2. Check credit balance
curl http://localhost:3000/api/transaction/gasless/credit/hoepeyemi@gmail.com

# 3. Create transaction
npx ts-node scripts/create-transaction-for-sponsor.ts \
  7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU \
  9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM \
  1.5

# 4. Copy the transaction from output and sponsor it
curl -X POST http://localhost:3000/api/transaction/gasless/sponsor \
  -H "Content-Type: application/json" \
  -d '{
    "email": "hoepeyemi@gmail.com",
    "transaction": "AQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABAAEDAgMEBQYHCAkKCwwNDg8QERITFBUWFxgZGhscHR4fICEiIyQlJic=",
    "type": "TRANSFER"
  }'
```

---

## ⚠️ Common Issues

### **Error: "Insufficient credit"**

**Solution:** Make a payment first (Step 1)

### **Error: "Invalid transaction format"**

**Solution:** Make sure you're using a real base64-encoded transaction, not the string `"string"`

### **Error: "Transaction must be base64-encoded"**

**Solution:** The transaction must be properly base64-encoded. Use the helper script to generate it correctly.

---

## 📚 More Information

- **Full Guide**: See `HOW_TO_CREATE_TRANSACTION_FOR_SPONSOR.md`
- **Credit System**: See `CREDIT_SYSTEM_USAGE_GUIDE.md`
- **Implementation**: See `CREDIT_SYSTEM_IMPLEMENTATION.md`

---

## 🎯 TL;DR

1. **Make payment** → Adds credit
2. **Create transaction** → Use helper script
3. **Sponsor transaction** → Use credit to pay for gas

That's it! 🚀

