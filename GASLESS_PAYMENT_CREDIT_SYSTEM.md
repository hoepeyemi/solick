# Gasless Payment Credit System - Implementation Design

## 🎯 Goal

Allow users to pay USDC upfront (via x402 payment), and use that payment to sponsor their future transactions. The server pays SOL gas fees, but the cost is covered by the user's USDC credit.

---

## 💡 Implementation Approaches

### **Approach 1: Credit/Allowance System (Recommended)**

**Concept:** Users pay USDC to build up credit, then use credit to execute transactions.

**Flow:**
1. User pays 0.0003 USDC → Gets credit balance
2. User wants to execute transaction → Server checks credit
3. Server sponsors transaction (pays SOL) → Deducts credit
4. Transaction executes → User pays 0 SOL

**Pros:**
- ✅ Flexible - users can build up credit
- ✅ Clear accounting - track credit per user
- ✅ Can support multiple transactions per payment
- ✅ Easy to implement

**Cons:**
- ⚠️ Need to track credit balance
- ⚠️ Need to handle credit expiration (optional)

**Database Schema:**
```prisma
model GaslessPayment {
  id          String   @id @default(cuid())
  userId      String
  user        User     @relation(fields: [userId], references: [id])
  
  // Payment Details
  amountUSDC  Float    // Amount paid in USDC
  amount      BigInt   // Amount in smallest units
  signature   String   @unique // Transaction signature
  status      PaymentStatus @default(PENDING)
  
  // Credit Details
  creditRemaining Float // Remaining credit from this payment
  creditUsed      Float // Credit used from this payment
  
  // Transaction Link
  sponsoredTransactions SponsoredTransaction[]
  
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  
  @@map("gasless_payments")
}

model SponsoredTransaction {
  id          String   @id @default(cuid())
  userId      String
  user        User     @relation(fields: [userId], references: [id])
  paymentId   String
  payment     GaslessPayment @relation(fields: [paymentId], references: [id])
  
  // Transaction Details
  type        SponsoredTransactionType
  signature   String   @unique
  solFeePaid  Float    // SOL fee paid by server
  usdcCreditUsed Float // USDC credit used
  
  // Transaction Data
  serializedTransaction String?
  transactionSignature  String?
  
  status      TransactionStatus @default(PENDING)
  errorMessage String?
  
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  
  @@map("sponsored_transactions")
}

enum PaymentStatus {
  PENDING
  VERIFIED
  FAILED
  EXPIRED
}

enum SponsoredTransactionType {
  USER_TRANSACTION
  TRANSFER
  YIELD_OPERATION
  CUSTOM
}

enum TransactionStatus {
  PENDING
  SUBMITTED
  CONFIRMED
  FAILED
}
```

---

### **Approach 2: Direct Transaction Sponsorship**

**Concept:** User pays USDC and immediately provides a transaction to sponsor.

**Flow:**
1. User pays 0.0003 USDC → Payment verified
2. User provides transaction to execute → Server sponsors it
3. Server pays SOL gas → Transaction executes
4. Done

**Pros:**
- ✅ Simple - one payment, one transaction
- ✅ No credit tracking needed
- ✅ Immediate use

**Cons:**
- ⚠️ Less flexible - payment tied to one transaction
- ⚠️ User must have transaction ready

**API Design:**
```typescript
POST /api/transaction/gasless/sponsor
{
  "email": "user@example.com",
  "transaction": "base64-encoded-transaction"
}
```

---

### **Approach 3: Prepaid Transaction Queue**

**Concept:** User pays USDC, then queues transactions to execute later.

**Flow:**
1. User pays USDC → Gets prepaid balance
2. User queues transactions → Stored in queue
3. Server processes queue → Sponsors transactions using prepaid balance
4. Balance deducted per transaction

**Pros:**
- ✅ Batch processing
- ✅ Can queue multiple transactions
- ✅ Efficient for high-volume users

**Cons:**
- ⚠️ More complex
- ⚠️ Need queue management
- ⚠️ Transactions might fail

---

### **Approach 4: Hybrid System (Best of Both Worlds)**

**Concept:** Combine credit system with direct sponsorship option.

**Flow:**
1. User pays USDC → Gets credit balance
2. User can either:
   - **Option A:** Use credit to sponsor a transaction immediately
   - **Option B:** Build up credit for future use
3. Server tracks credit and sponsors transactions

**Pros:**
- ✅ Maximum flexibility
- ✅ Supports both use cases
- ✅ Best user experience

**Cons:**
- ⚠️ Most complex to implement
- ⚠️ Need to handle both flows

---

## 🏗️ Recommended Implementation: Approach 1 (Credit System)

### **Phase 1: Database Schema**

Add to `prisma/schema.prisma`:

```prisma
model User {
  // ... existing fields ...
  gaslessPayments    GaslessPayment[]
  sponsoredTransactions SponsoredTransaction[]
}

model GaslessPayment {
  id          String   @id @default(cuid())
  userId      String
  user        User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  
  // Payment Details
  amountUSDC  Float    // Amount paid in USDC (e.g., 0.0003)
  amount      String   // Amount in smallest units (e.g., "300")
  signature   String   @unique // Payment transaction signature
  status      PaymentStatus @default(PENDING)
  
  // Credit Details
  creditRemaining Float @default(0) // Remaining credit in USDC
  creditUsed      Float @default(0) // Credit used in USDC
  
  // Metadata
  recipientTokenAccount String // Where payment was sent
  network        String // devnet or mainnet
  
  // Relations
  sponsoredTransactions SponsoredTransaction[]
  
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  
  @@map("gasless_payments")
}

model SponsoredTransaction {
  id          String   @id @default(cuid())
  userId      String
  user        User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  paymentId   String?
  payment     GaslessPayment? @relation(fields: [paymentId], references: [id])
  
  // Transaction Details
  type        SponsoredTransactionType
  signature   String?  @unique // Sponsored transaction signature
  solFeePaid  Float?   // SOL fee paid by server (in SOL)
  usdcCreditUsed Float? // USDC credit used
  
  // Transaction Data
  serializedTransaction String?
  transactionSignature  String?
  
  status      TransactionStatus @default(PENDING)
  errorMessage String?
  
  // Metadata
  network     String
  explorerUrl String?
  
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  
  @@map("sponsored_transactions")
}

enum PaymentStatus {
  PENDING
  VERIFIED
  FAILED
  EXPIRED
}

enum SponsoredTransactionType {
  USER_TRANSACTION
  TRANSFER
  YIELD_OPERATION
  CUSTOM
}

enum TransactionStatus {
  PENDING
  SUBMITTED
  CONFIRMED
  FAILED
}
```

---

### **Phase 2: Service Layer**

Create `src/services/gasless-credit.service.ts`:

```typescript
export class GaslessCreditService {
  /**
   * Record payment and add credit to user
   */
  async recordPayment(userId: string, paymentData: {
    signature: string;
    amountUSDC: number;
    amount: string;
    recipientTokenAccount: string;
    network: string;
  }): Promise<GaslessPayment> {
    // Create payment record
    // Set creditRemaining = amountUSDC
    // Status = VERIFIED
  }

  /**
   * Get user's total available credit
   */
  async getUserCredit(userId: string): Promise<number> {
    // Sum all creditRemaining from verified payments
  }

  /**
   * Use credit to sponsor a transaction
   */
  async useCredit(userId: string, amountUSDC: number, transactionType: string): Promise<{
    success: boolean;
    paymentId?: string;
    remainingCredit?: number;
    error?: string;
  }> {
    // 1. Get user's total credit
    // 2. Check if sufficient
    // 3. Deduct from oldest payment first (FIFO)
    // 4. Return success with payment ID
  }

  /**
   * Record sponsored transaction
   */
  async recordSponsoredTransaction(userId: string, data: {
    paymentId?: string;
    type: string;
    signature: string;
    solFeePaid: number;
    usdcCreditUsed: number;
    transactionData?: any;
  }): Promise<SponsoredTransaction> {
    // Create sponsored transaction record
  }
}
```

---

### **Phase 3: API Endpoints**

#### **Endpoint 1: Make Payment (Current - Enhanced)**

```typescript
POST /api/transaction/gasless/payment
{
  "email": "user@example.com"
}

Response:
{
  "success": true,
  "payment": {
    "signature": "...",
    "amountUSDC": 0.0003,
    "creditAdded": 0.0003,
    "totalCredit": 0.0006, // If user had previous credit
  }
}
```

#### **Endpoint 2: Check Credit Balance**

```typescript
GET /api/transaction/gasless/credit/:email

Response:
{
  "email": "user@example.com",
  "totalCredit": 0.0006,
  "creditUSDC": 0.0006,
  "payments": [
    {
      "id": "...",
      "amountUSDC": 0.0003,
      "creditRemaining": 0.0003,
      "signature": "...",
      "createdAt": "..."
    }
  ]
}
```

#### **Endpoint 3: Sponsor Transaction**

```typescript
POST /api/transaction/gasless/sponsor
{
  "email": "user@example.com",
  "transaction": "base64-encoded-transaction",
  "type": "USER_TRANSACTION" // or TRANSFER, YIELD_OPERATION, CUSTOM
}

Response:
{
  "success": true,
  "signature": "...",
  "creditUsed": 0.0003,
  "remainingCredit": 0.0003,
  "solFeePaid": 0.00001,
  "explorerUrl": "..."
}
```

#### **Endpoint 4: Sponsor Custom Transaction**

```typescript
POST /api/transaction/gasless/sponsor/custom
{
  "email": "user@example.com",
  "toAddress": "recipient-address",
  "amount": "1.5",
  "tokenMint": "USDC-mint-address",
  "memo": "Optional memo"
}

// Server creates transaction, sponsors it, executes it
```

---

### **Phase 4: Integration Points**

#### **A. Modify Current Gasless Payment Endpoint**

Update `POST /api/transaction/gasless` to:
1. Record payment in database
2. Add credit to user
3. Return credit information

#### **B. Create Transaction Sponsorship Endpoint**

New endpoint that:
1. Checks user credit
2. Creates/sponsors transaction
3. Deducts credit
4. Records sponsored transaction

#### **C. Integrate with Existing Transactions**

Modify existing transaction endpoints to support gasless sponsorship:
- `/api/users/send-transaction` - Add option to use credit
- `/api/users/deposit` - Add option to use credit
- Other transaction endpoints

---

## 📊 Credit Calculation

### **Credit to SOL Conversion**

Need to determine: How much USDC credit = 1 SOL gas fee?

**Options:**
1. **Fixed Rate:** 0.0003 USDC = 1 transaction (regardless of gas cost)
2. **Dynamic Rate:** Calculate based on actual SOL gas cost
3. **Hybrid:** Fixed rate with adjustment for high-cost transactions

**Recommended:** Fixed rate with maximum cap
- 0.0003 USDC = 1 standard transaction
- If transaction costs more, user pays difference or transaction fails

---

## 🔄 Implementation Steps

### **Step 1: Database Migration**
1. Add `GaslessPayment` model
2. Add `SponsoredTransaction` model
3. Add relations to `User` model
4. Run migration

### **Step 2: Service Implementation**
1. Create `GaslessCreditService`
2. Implement credit tracking methods
3. Implement credit deduction logic

### **Step 3: Update Payment Endpoint**
1. Modify current `/api/transaction/gasless` to record payment
2. Add credit to user account
3. Return credit information

### **Step 4: Create Sponsorship Endpoint**
1. Create `/api/transaction/gasless/sponsor`
2. Check credit balance
3. Sponsor transaction
4. Deduct credit
5. Record transaction

### **Step 5: Integration**
1. Add credit check to existing transaction endpoints
2. Add option to use credit for transactions
3. Update UI/documentation

---

## 💰 Credit Management

### **Credit Lifecycle:**
1. **Payment** → Credit added
2. **Transaction** → Credit deducted
3. **Expiration** (optional) → Credit expires after X days
4. **Refund** (optional) → Unused credit can be refunded

### **Credit Deduction Strategy:**
- **FIFO:** Use oldest credit first
- **LIFO:** Use newest credit first
- **Proportional:** Deduct from all payments proportionally

**Recommended:** FIFO (First In, First Out)

---

## 🎯 Example User Flow

### **Scenario: User wants to send USDC transfer**

**Current Flow:**
1. User needs SOL for gas
2. User executes transaction
3. User pays SOL

**New Flow:**
1. User pays 0.0003 USDC (gets credit)
2. User wants to send USDC transfer
3. User calls sponsorship endpoint
4. Server sponsors transaction (pays SOL)
5. Credit deducted (0.0003 USDC used)
6. Transaction executes
6. User paid 0 SOL, used 0.0003 USDC credit

---

## 🔐 Security Considerations

1. **Credit Validation:** Verify credit before sponsoring
2. **Double Spending:** Prevent using same credit twice
3. **Transaction Validation:** Verify transaction before sponsoring
4. **Rate Limiting:** Prevent credit abuse
5. **Audit Trail:** Track all credit usage

---

## 📈 Future Enhancements

1. **Credit Expiration:** Credits expire after 30 days
2. **Credit Transfer:** Users can transfer credits
3. **Credit Refund:** Unused credits can be refunded
4. **Credit Marketplace:** Users can buy/sell credits
5. **Bulk Transactions:** Sponsor multiple transactions with one payment

---

## 🚀 Quick Start Implementation

Would you like me to implement:
1. **Option A:** Full credit system (Approach 1)
2. **Option B:** Simple direct sponsorship (Approach 2)
3. **Option C:** Hybrid system (Approach 4)

Let me know which approach you prefer, and I'll implement it!


