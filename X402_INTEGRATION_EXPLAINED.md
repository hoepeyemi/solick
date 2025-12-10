# x402 Integration Explained

## 📋 Overview

The **x402 Payment Standard** is a protocol that allows users to pay for transaction fees in tokens (like USDC) instead of the native blockchain currency (SOL). In this codebase, x402 is implemented in a **fully programmatic way** for Grid wallets, eliminating the need for client-side HTTP headers.

---

## 🔄 How x402 Works in This Implementation

### **Traditional x402 Flow (Not Used Here)**

The original x402 standard works with HTTP headers:

1. Client sends request → Server responds with `402 Payment Required`
2. Server provides payment quote (recipient, amount, etc.)
3. Client creates payment transaction
4. Client sends request again with `X-Payment` header containing base64-encoded payment proof
5. Server verifies payment and processes the request

### **Our Programmatic Implementation (Current)**

Instead of HTTP headers, we use a **fully server-side programmatic flow**:

```
User → Server → Grid SDK → Blockchain → Verification → Credit System
```

---

## 🏗️ Architecture Components

### **1. x402 Payment Proof Structure**

The x402 payment proof is defined in `src/services/gasless.service.ts`:

```typescript
export interface X402PaymentProof {
  x402Version: number;        // Version of x402 standard
  scheme: string;             // Payment scheme (e.g., "solana-spl-token")
  network: string;            // Network (e.g., "mainnet", "devnet")
  payload: {
    serializedTransaction: string;  // Base64-encoded transaction
  };
}
```

**Location:** ```102:109:src/services/gasless.service.ts```

### **2. Payment Quote Generation**

The server generates a payment quote following x402 principles:

```typescript
async getPaymentQuote(): Promise<GaslessPaymentQuote | null> {
  // Returns:
  // - Recipient wallet address
  // - Recipient token account (USDC)
  // - Token mint address (USDC)
  // - Amount in smallest units (e.g., 300 for 0.0003 USDC)
  // - Amount in USDC (e.g., 0.0003)
  // - Network/cluster information
}
```

**Location:** ```155:182:src/services/gasless.service.ts```

**Key Points:**
- Uses HTTP status `402` concept (Payment Required)
- Provides all information needed to create payment
- Amount is configurable via `GASLESS_PRICE_USDC` env variable

### **3. Payment Verification**

The system verifies x402 payments in two ways:

#### **A. Transaction Verification (Current Method)**

After Grid SDK submits the payment transaction, the server verifies it on-chain:

```typescript
async verifyPaymentFromTransaction(signature: string): Promise<{
  verified: boolean;
  amountReceived?: number;
  error?: string;
}>
```

**Verification Methods:**
1. **Token Balance Changes**: Checks pre/post token balances
2. **Account Keys Matching**: Verifies recipient token account
3. **Owner/Mint Verification**: Calculates ATA and verifies
4. **Transaction Logs**: Parses transfer events from logs
5. **Inner Instructions**: Checks CPI (Cross-Program Invocation) transfers
6. **Parsed Instructions**: For parsed transaction format

**Location:** ```417:859:src/services/gasless.service.ts```

#### **B. x402 Header Verification (Legacy - Not Currently Used)**

The code includes a method to verify x402 payment proofs from headers:

```typescript
async verifyPayment(xPaymentHeader: string): Promise<{
  valid: boolean;
  transaction?: Transaction;
  paymentProof?: X402PaymentProof;
  error?: string;
}>
```

**How it works:**
1. Decodes base64-encoded x402 payment proof
2. Parses JSON structure
3. Deserializes the transaction
4. Verifies USDC transfer instruction

**Location:** ```187:234:src/services/gasless.service.ts```

---

## 🔀 Complete Flow Diagram

```
┌─────────┐
│  User  │
└───┬────┘
    │ POST /api/transaction/gasless
    │ { "email": "user@example.com" }
    ▼
┌─────────────────────┐
│   Server Controller │
│  (user.controller)  │
└───┬─────────────────┘
    │
    │ 1. Get Payment Quote (x402 concept)
    ▼
┌─────────────────────┐
│  GaslessService     │
│  getPaymentQuote()  │
└───┬─────────────────┘
    │ Returns: recipient, amount, token account
    │
    │ 2. Create USDC Transfer Transaction
    ▼
┌─────────────────────┐
│  BlockchainService  │
│  createTransaction() │
└───┬─────────────────┘
    │ Returns: base64 transaction
    │
    │ 3. Prepare with Grid SDK
    ▼
┌─────────────────────┐
│   Grid SDK          │
│  prepareArbitrary...│
└───┬─────────────────┘
    │ Returns: prepared transaction payload
    │
    │ 4. Sign & Submit with Grid SDK
    ▼
┌─────────────────────┐
│   Grid SDK          │
│  signAndSend()      │
└───┬─────────────────┘
    │ Submits to blockchain
    │ Returns: transaction signature
    │
    │ 5. Verify Payment (x402 verification)
    ▼
┌─────────────────────┐
│  GaslessService     │
│  verifyPaymentFrom  │
│  Transaction()      │
└───┬─────────────────┘
    │ Checks on-chain transaction
    │ Verifies USDC transfer
    │
    │ 6. Record Payment & Credit
    ▼
┌─────────────────────┐
│  GaslessCredit      │
│  Service            │
│  recordPayment()    │
└───┬─────────────────┘
    │ Creates GaslessPayment record
    │ Sets creditRemaining = amountUSDC
    │
    │ 7. Return Success
    ▼
┌─────────┐
│  User   │
│ Response│
└─────────┘
```

---

## 💳 Credit System Integration

The x402 payment is integrated with a **credit system**:

### **Payment → Credit Flow**

1. **User makes payment** (via `/api/transaction/gasless`)
   - Server creates USDC transfer transaction
   - Grid SDK signs and submits
   - Payment verified on-chain
   - **Credit added to user account**

2. **Credit stored in database**
   ```prisma
   model GaslessPayment {
     amountUSDC: Float          // e.g., 0.0003
     creditRemaining: Float     // Initially = amountUSDC
     creditUsed: Float          // Initially = 0
   }
   ```

3. **User can use credit** (via `/api/transaction/gasless/sponsor`)
   - User provides transaction to sponsor
   - Server checks credit balance
   - Server sponsors transaction (pays SOL)
   - **Credit deducted** (FIFO - First In, First Out)

### **Credit Management**

- **FIFO Deduction**: Oldest credit is used first
- **Per-Payment Tracking**: Each payment has its own credit balance
- **Total Credit**: Sum of all `creditRemaining` from verified payments

**Location:** `src/services/gasless-credit.service.ts`

---

## 🔐 Security & Verification

### **Payment Verification Robustness**

The system uses **multiple verification methods** to ensure payment is valid:

1. **Direct Account Match**: Checks if recipient token account received funds
2. **Owner/Mint Calculation**: Calculates ATA and verifies ownership
3. **Balance Change Analysis**: Compares pre/post token balances
4. **Transaction Log Parsing**: Extracts transfer events from logs
5. **Inner Instruction Inspection**: Checks CPI calls
6. **Parsed Instruction Analysis**: For versioned transactions

**Why Multiple Methods?**
- Different transaction formats (legacy vs versioned)
- Different RPC response formats (parsed vs raw)
- Edge cases with account indexing
- Lookup tables and address derivation

### **Error Handling**

- **Retry Logic**: Payment verification retries up to 5 times
- **Fallback Verification**: If exact match fails, checks for any USDC increase
- **Transaction Success Check**: Verifies transaction succeeded even if verification fails
- **Detailed Logging**: Comprehensive logs for debugging

---

## 📊 x402 vs Current Implementation

| Aspect | Traditional x402 | Our Implementation |
|--------|------------------|-------------------|
| **Payment Method** | HTTP `X-Payment` header | Server-side programmatic |
| **Client Involvement** | Client creates & signs | Server handles everything |
| **Payment Proof** | Base64 in header | On-chain transaction |
| **Verification** | Header parsing | On-chain transaction analysis |
| **User Experience** | Two-step (402 → payment) | Single API call |
| **Grid Wallet** | Not required | Required (for signing) |
| **Credit System** | Not included | Integrated |

---

## 🎯 Key Differences from Standard x402

### **1. No HTTP 402 Status**

- Traditional x402: Server returns `402 Payment Required`
- Our implementation: Server generates quote and creates payment automatically

### **2. No Client-Side Payment Creation**

- Traditional x402: Client creates payment transaction
- Our implementation: Server creates payment transaction using Grid SDK

### **3. Programmatic Flow**

- Traditional x402: Client must handle 402 response and create payment
- Our implementation: Single endpoint handles everything

### **4. Grid Wallet Integration**

- Traditional x402: Works with any wallet
- Our implementation: Specifically designed for Grid wallets

### **5. Credit System**

- Traditional x402: One payment = one transaction
- Our implementation: Payment → Credit → Multiple transactions

---

## 🔧 Configuration

### **Environment Variables**

```bash
# Server fee payer (sponsors transactions)
GASLESS_FEE_PAYER_PRIVATE_KEY="base58-private-key"

# Recipient wallet (receives USDC payments)
GASLESS_RECIPIENT_WALLET="recipient-wallet-address"

# Payment price in USDC
GASLESS_PRICE_USDC=0.0003

# Network
SOLANA_NETWORK=devnet  # or mainnet
```

### **Payment Amount**

- **Default**: 0.0003 USDC
- **Smallest Units**: 300 (USDC has 6 decimals)
- **Configurable**: Via `GASLESS_PRICE_USDC` environment variable

---

## 📝 Code Locations

### **Core x402 Components**

1. **Payment Proof Interface**
   - `src/services/gasless.service.ts` (lines 102-109)

2. **Payment Quote Generation**
   - `src/services/gasless.service.ts` (lines 155-182)

3. **Payment Verification (Header-based - Legacy)**
   - `src/services/gasless.service.ts` (lines 187-234)

4. **Payment Verification (On-chain - Current)**
   - `src/services/gasless.service.ts` (lines 417-859)

5. **USDC Transfer Verification**
   - `src/services/gasless.service.ts` (lines 236-310)

6. **Main Endpoint**
   - `src/controllers/user.controller.ts` (lines 6160-6602)

7. **Credit System**
   - `src/services/gasless-credit.service.ts`

---

## 🚀 Usage Example

### **Step 1: Make Payment (x402 Payment)**

```bash
curl -X POST http://localhost:3000/api/transaction/gasless \
  -H "Content-Type: application/json" \
  -d '{"email": "user@example.com"}'
```

**What happens:**
1. Server generates payment quote (x402 concept)
2. Server creates USDC transfer transaction
3. Grid SDK signs and submits transaction
4. Server verifies payment on-chain
5. Credit added to user account

**Response:**
```json
{
  "success": true,
  "message": "Payment transaction executed!",
  "signature": "transaction_signature",
  "paymentDetails": {
    "amountUSDC": 0.0003,
    "recipient": "token_account_address"
  }
}
```

### **Step 2: Use Credit (Sponsor Transaction)**

```bash
curl -X POST http://localhost:3000/api/transaction/gasless/sponsor \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "transaction": "base64_encoded_transaction",
    "type": "TRANSFER"
  }'
```

**What happens:**
1. Server checks credit balance
2. Server sponsors transaction (pays SOL)
3. Credit deducted from user account
4. Transaction submitted to blockchain

---

## 🎓 Summary

**x402 Integration in this codebase:**

1. ✅ **Follows x402 principles**: Payment in tokens instead of native currency
2. ✅ **Programmatic implementation**: No HTTP headers needed
3. ✅ **Grid wallet specific**: Uses Grid SDK for signing
4. ✅ **Credit system**: Payments convert to reusable credit
5. ✅ **Robust verification**: Multiple methods ensure payment validity
6. ✅ **Single endpoint**: Simplified user experience

The x402 standard is **conceptually implemented** but **pragmatically adapted** for a fully server-side, Grid wallet-based system with credit management.

