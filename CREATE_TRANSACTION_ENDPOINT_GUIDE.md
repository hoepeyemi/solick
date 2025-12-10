# Create Transaction for Sponsorship - API Endpoint Guide

## 🎉 New Endpoint Available!

The transaction creation functionality from `scripts/create-transaction-for-sponsor.ts` is now available as a **programmatic API endpoint**!

---

## 📍 Endpoint

```
POST /api/transaction/gasless/create-transaction
```

---

## 🚀 Usage

### **Request**

```bash
curl -X POST http://localhost:3000/api/transaction/gasless/create-transaction \
  -H "Content-Type: application/json" \
  -d '{
    "fromAddress": "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU",
    "toAddress": "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM",
    "amount": 1.5
  }'
```

### **Request Body**

```json
{
  "fromAddress": "string (required)",  // Sender's Solana address
  "toAddress": "string (required)",    // Recipient's Solana address
  "amount": 1.5,                       // Amount in USDC (required)
  "tokenMint": "string (optional)"     // Token mint address (defaults to USDC)
}
```

### **Response**

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

---

## 🔄 Complete Flow

### **Step 1: Make Payment (Add Credit)**

```bash
curl -X POST http://localhost:3000/api/transaction/gasless \
  -H "Content-Type: application/json" \
  -d '{"email": "hoepeyemi@gmail.com"}'
```

### **Step 2: Create Transaction**

```bash
curl -X POST http://localhost:3000/api/transaction/gasless/create-transaction \
  -H "Content-Type: application/json" \
  -d '{
    "fromAddress": "YOUR_GRID_ADDRESS",
    "toAddress": "RECIPIENT_ADDRESS",
    "amount": 1.5
  }'
```

**Copy the `transaction` field from the response.**

### **Step 3: Sponsor Transaction**

```bash
curl -X POST http://localhost:3000/api/transaction/gasless/sponsor \
  -H "Content-Type: application/json" \
  -d '{
    "email": "hoepeyemi@gmail.com",
    "transaction": "PASTE_TRANSACTION_FROM_STEP_2",
    "type": "TRANSFER"
  }'
```

---

## 📋 Example: Complete Workflow

```bash
# 1. Make payment (adds 0.0003 USDC credit)
curl -X POST http://localhost:3000/api/transaction/gasless \
  -H "Content-Type: application/json" \
  -d '{"email": "hoepeyemi@gmail.com"}'

# 2. Create transaction
RESPONSE=$(curl -X POST http://localhost:3000/api/transaction/gasless/create-transaction \
  -H "Content-Type: application/json" \
  -d '{
    "fromAddress": "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU",
    "toAddress": "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM",
    "amount": 1.5
  }')

# Extract transaction from response (in real usage, parse JSON)
TRANSACTION="AQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABAAEDAgMEBQYHCAkKCwwNDg8QERITFBUWFxgZGhscHR4fICEiIyQlJic="

# 3. Sponsor transaction
curl -X POST http://localhost:3000/api/transaction/gasless/sponsor \
  -H "Content-Type: application/json" \
  -d "{
    \"email\": \"hoepeyemi@gmail.com\",
    \"transaction\": \"$TRANSACTION\",
    \"type\": \"TRANSFER\"
  }"
```

---

## 🎯 Benefits

1. **No Script Required**: No need to run Node.js scripts
2. **Programmatic**: Can be called from any HTTP client
3. **Integrated**: Works seamlessly with the sponsor endpoint
4. **Automatic**: Handles USDC mint selection based on network
5. **Ready to Use**: Returns transaction ready for sponsorship

---

## ⚙️ Implementation Details

### **Service Method**

Added to `src/services/gasless.service.ts`:
- `createTransactionForSponsor()` - Creates unsigned transaction for sponsorship

### **Controller Function**

Added to `src/controllers/user.controller.ts`:
- `createTransactionForSponsor()` - Handles the API request

### **Route**

Added to `src/routes/transaction.routes.ts`:
- `POST /api/transaction/gasless/create-transaction`

### **Schema**

Added to `src/schemas/transaction.schemas.ts`:
- `createTransactionForSponsorSchema` - Validates input

---

## 🔍 Features

- ✅ **Automatic USDC Mint Selection**: Uses devnet or mainnet USDC based on network
- ✅ **Token Account Resolution**: Automatically gets associated token accounts
- ✅ **Unsigned Transaction**: Transaction is ready for server to sign as fee payer
- ✅ **Base64 Encoding**: Returns transaction in base64 format ready for sponsorship
- ✅ **Error Handling**: Comprehensive error handling and validation
- ✅ **Next Step Guidance**: Response includes example for next step

---

## 📝 Notes

1. **Transaction is Unsigned**: The transaction is not signed - the server will sign it as fee payer when sponsoring
2. **Default Token**: If `tokenMint` is not provided, defaults to USDC (devnet or mainnet based on network)
3. **Amount Format**: Amount is in USDC (e.g., 1.5 = 1.5 USDC)
4. **Network Detection**: Automatically uses the correct network based on `SOLANA_NETWORK` environment variable

---

## 🚀 Quick Start

```bash
# Create a transaction
curl -X POST http://localhost:3000/api/transaction/gasless/create-transaction \
  -H "Content-Type: application/json" \
  -d '{
    "fromAddress": "YOUR_ADDRESS",
    "toAddress": "RECIPIENT_ADDRESS",
    "amount": 1.0
  }'
```

That's it! The transaction is ready to use with the sponsor endpoint! 🎉

