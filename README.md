# Solick Backend

A comprehensive Node.js backend API for Solana that enables gasless transactions (pay in USDC via the x402 standard), Grid multi-sig wallets, and yield investments—built with Express, TypeScript, Prisma, and PostgreSQL.

---

## Repository & Demo

| | Link |
|---|------|
| **Code repository** | [https://github.com/hoepeyemi/solick](https://github.com/hoepeyemi/solick) |
| **Presentation** | [Watch on YouTube](https://youtu.be/9Od6CcvIfKU) |
| **Demo** | [Watch on YouTube](https://youtu.be/k6Z9IfnW47Q) |

---

## Problem Statement & Solution

**Problem:** Users on Solana often lack SOL for transaction fees, face friction with key management for multi-sig workflows, and want simple ways to pay fees in stablecoins (e.g. USDC) or use accumulated credit instead of holding SOL.

**Solution:** Solick provides a backend that (1) **gasless transactions** via the x402 payment standard—users pay in USDC while the server pays SOL for gas; (2) a **credit system** so payments become reusable credit for future transactions; (3) **Grid (Squads) wallet integration** for programmatic multi-sig and balances; and (4) **Lulo yield integration** for yield products. The API is secure, documented (Swagger), and ready for production use.

---

## Tools, Frameworks & Technologies

| Category | Technologies |
|----------|--------------|
| **Runtime & language** | Node.js (v18+), TypeScript |
| **Web framework** | Express.js |
| **Database & ORM** | PostgreSQL, Prisma |
| **API docs** | Swagger / OpenAPI |
| **Security** | Helmet, CORS, rate limiting, JWT, bcrypt, Zod validation |
| **Blockchain** | Solana (devnet/mainnet), x402 payment standard |
| **Integrations** | Squads Grid API (wallets), Lulo API (yield) |
| **Logging & monitoring** | Winston, health checks, optional Redis |
| **Testing** | Jest |

---

## Technical Implementation Overview

- **REST API:** Express app with typed routes, validation (Zod), and structured error handling. Core domains: users, posts, Grid accounts, gasless/credit transactions, and yield.
- **Gasless & credit:** Fee payer signs and submits transactions; users pay in USDC (or use existing credit). Payments are stored as `GaslessPayment`; credit is tracked per user and consumed in FIFO order via `SponsoredTransaction` and `gasless-credit.service`.
- **Grid:** Server-side Grid SDK usage for initiating/completing account creation (OTP), fetching balances by email or wallet, and supporting gasless flows that depend on Grid wallets.
- **Data layer:** Prisma schema with `User`, `Post`, `GaslessPayment`, `SponsoredTransaction`; migrations and seeding via npm scripts.
- **Security:** Input validation, JWT auth, role-based access, rate limits, security headers, and CORS configured per environment.

For deeper technical detail, see the in-repo guides (e.g. [COMPLETE_GASLESS_CREDIT_GUIDE.md](./COMPLETE_GASLESS_CREDIT_GUIDE.md), [API_DOCUMENTATION.md](./API_DOCUMENTATION.md)) and the [Project Structure](#project-structure) section below.

---

## Features

- 🚀 **Express.js** with TypeScript
- 🗄️ **Prisma ORM** with PostgreSQL
- 📚 **Swagger/OpenAPI** documentation
- 🔒 **Comprehensive Security** (Helmet, CORS, Rate Limiting, Input Validation)
- 🛡️ **Authentication & Authorization** (JWT, bcrypt, Role-based access)
- 🚫 **Attack Prevention** (SQL Injection, XSS, CSRF protection)
- 📝 **Structured logging** with Winston
- 🧪 **Testing setup** with Jest
- 🔄 **Database migrations** and seeding
- 📊 **Monitoring & Health Checks**
- 💰 **Gasless Transactions** - Pay transaction fees in USDC instead of SOL (x402 standard)
- 🎁 **Credit System** - Build up credit from payments and use it for future transactions
- 🔐 **Grid Wallet Integration** - Full support for Squads Grid multi-signature wallets
- 📈 **Yield Investment** - Integration with Lulo API for yield farming operations

## Prerequisites

- Node.js (v18 or higher)
- PostgreSQL database
- Redis (optional, for caching/sessions)
- npm or yarn
- Grid API key from [Squads Grid](https://grid.squads.xyz)

## Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/hoepeyemi/solick.git
   cd solick
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Set up environment variables**

   **Option A: Interactive Setup (Recommended)**
   ```bash
   npm run setup:env
   ```

   **Option B: Manual Setup**
   Create a `.env` file in the root directory:
   ```env
   # Application Configuration
   NODE_ENV=development
   PORT=3000

   # Database Configuration
   DATABASE_URL="postgresql://username:password@localhost:5432/solick_backend"

   # Grid Configuration (Squads Grid)
   GRID_ENVIRONMENT=sandbox
   GRID_API_KEY=your_grid_api_key_here
   GRID_BASE_URL=https://grid.squads.xyz

   # Redis Configuration (Optional - for caching/sessions)
   REDIS_URL=redis://localhost:6379
   REDIS_HOST=localhost
   REDIS_PORT=6379
   REDIS_PASSWORD=

   # Security Configuration (Required for Production)
   JWT_SECRET=your-super-secret-jwt-key-change-in-production
   JWT_EXPIRES_IN=24h
   JWT_REFRESH_EXPIRES_IN=7d
   BCRYPT_ROUNDS=12
   SESSION_SECRET=your-session-secret-key
   VALID_API_KEYS=key1,key2,key3
   # CORS Configuration
   ALLOWED_ORIGINS=http://localhost:3000,https://yourdomain.com,https://app.yourdomain.com
   CORS_MAX_AGE=86400
   ENABLE_CORS_LOGGING=true
   
   # Rate Limiting Configuration
   RATE_LIMIT_WINDOW_MS=900000
   RATE_LIMIT_MAX_REQUESTS=100
   AUTH_RATE_LIMIT_WINDOW_MS=900000
   AUTH_RATE_LIMIT_MAX_REQUESTS=5
   
   # Logging Configuration
   LOG_LEVEL=info
   ENABLE_REQUEST_LOGGING=true
   ENABLE_ERROR_LOGGING=true
   LOG_TO_FILE=false
   LOG_DIRECTORY=./logs
   
   # Monitoring Configuration
   ENABLE_METRICS=true
   METRICS_PORT=9090
   ENABLE_HEALTH_CHECKS=true
   
   # Solana Configuration
   SOLANA_NETWORK=devnet  # or mainnet
   SOLANA_MAINNET_RPC=https://api.mainnet-beta.solana.com
   SOLANA_DEVNET_RPC=https://api.devnet.solana.com
   
   # Gasless Transaction Configuration (x402 Payment Standard)
   GASLESS_FEE_PAYER_PRIVATE_KEY=your_base58_private_key_here
   GASLESS_RECIPIENT_WALLET=recipient_wallet_address
   GASLESS_PRICE_USDC=0.0003
   
   # Lulo Yield Investment API
   LULO_API_URL=https://api.lulo.fi/v1
   LULO_API_KEY=your_lulo_api_key_here
   ```

## Environment Variables Setup

### Required Variables

1. **Database Configuration**
   - `DATABASE_URL`: PostgreSQL connection string
   - Format: `postgresql://username:password@host:port/database_name`

2. **Grid Configuration**
   - `GRID_ENVIRONMENT`: Either `sandbox` or `production`
   - `GRID_API_KEY`: Your API key from Squads Grid
   - `GRID_BASE_URL`: Grid API base URL (default: https://grid.squads.xyz)

### Optional Variables

3. **Redis Configuration** (if using Redis for caching/sessions)
   - `REDIS_URL`: Redis connection string
   - `REDIS_HOST`: Redis host (default: localhost)
   - `REDIS_PORT`: Redis port (default: 6379)
   - `REDIS_PASSWORD`: Redis password (if required)

4. **Application Configuration**
   - `NODE_ENV`: Environment (development/production)
   - `PORT`: Server port (default: 3000)

5. **Solana Configuration**
   - `SOLANA_NETWORK`: Network to use (`devnet` or `mainnet`)
   - `SOLANA_MAINNET_RPC`: Mainnet RPC endpoint
   - `SOLANA_DEVNET_RPC`: Devnet RPC endpoint

6. **Gasless Transaction Configuration** (x402 Payment Standard)
   - `GASLESS_FEE_PAYER_PRIVATE_KEY`: Server's fee payer private key (base58 or JSON array)
   - `GASLESS_RECIPIENT_WALLET`: Wallet address that receives USDC payments
   - `GASLESS_PRICE_USDC`: Price per transaction in USDC (default: 0.0003)

7. **Lulo Yield Investment API**
   - `LULO_API_URL`: Lulo API base URL
   - `LULO_API_KEY`: Your Lulo API key

### Getting Your Grid API Key

1. Visit [Squads Grid](https://grid.squads.xyz)
2. Sign up for an account
3. Navigate to your dashboard
4. Generate an API key
5. Copy the key to your `.env` file

### Database Setup

4. **Set up the database**
   ```bash
   # Generate Prisma client
   npm run db:generate
   
   # Push schema to database (for development)
   npm run db:push
   
   # Or run migrations (for production)
   npm run db:migrate
   
   # Seed the database with sample data
   npm run db:seed
   ```

## Development

1. **Start the development server**
   ```bash
   npm run dev
   ```

2. **Access the API**
   - API Base URL: `http://localhost:3000`
   - Swagger Documentation: `http://localhost:3000/api-docs`
   - Health Check: `http://localhost:3000/health`

## Available Scripts

- `npm run dev` - Start development server with nodemon
- `npm run build` - Build the TypeScript project
- `npm run start` - Start the production server
- `npm run test` - Run tests
- `npm run test:watch` - Run tests in watch mode
- `npm run db:generate` - Generate Prisma client
- `npm run db:push` - Push schema changes to database
- `npm run db:migrate` - Run database migrations
- `npm run db:studio` - Open Prisma Studio
- `npm run db:seed` - Seed the database
- `npm run setup:env` - Interactive environment setup

## API Endpoints

### Health Check
- `GET /health` - Server health status

### Users
- `GET /api/users` - Get all users
- `POST /api/users` - Create a new user
- `GET /api/users/:id` - Get user by ID
- `PUT /api/users/:id` - Update user
- `DELETE /api/users/:id` - Delete user

### Posts
- `GET /api/posts` - Get all posts
- `POST /api/posts` - Create a new post
- `GET /api/posts/:id` - Get post by ID
- `PUT /api/posts/:id` - Update post
- `DELETE /api/posts/:id` - Delete post

### Grid Account Management
- `POST /api/users/grid/initiate` - Initiate Grid account creation
- `POST /api/users/grid/complete` - Complete Grid account creation with OTP
- `GET /api/users/email/:email/balances` - Get user balances (Grid account)
- `GET /api/users/wallet/:walletAddress/balances` - Get balances by wallet address

### Gasless Transactions (x402 Payment Standard)
- `POST /api/transaction/gasless` - Execute gasless transaction (pay in USDC, server pays SOL)
- `GET /api/transaction/gasless/credit/:email` - Get user's credit balance
- `GET /api/transaction/gasless/payments/:email` - Get payment history
- `POST /api/transaction/gasless/sponsor` - Sponsor transaction using credit
- `POST /api/transaction/gasless/create-transaction` - Create transaction for sponsorship

### Yield Investment (Lulo Integration)
- `GET /api/yield/products` - Get available yield products
- `POST /api/yield/invest` - Invest in a yield product
- `GET /api/yield/investments/:email` - Get user's investments
- `POST /api/yield/withdraw` - Withdraw from yield investment

## Database Schema

### User Model
- `id` (String, Primary Key)
- `email` (String, Unique)
- `name` (String)
- `gridAddress` (String, Optional) - Grid wallet address
- `gridStatus` (String, Optional) - Grid account status
- `authResult` (Json, Optional) - Grid authentication data
- `sessionSecrets` (Json, Optional) - Grid session secrets
- `createdAt` (DateTime)
- `updatedAt` (DateTime)

### Post Model
- `id` (String, Primary Key)
- `title` (String)
- `content` (String, Optional)
- `published` (Boolean, Default: false)
- `authorId` (String, Foreign Key)
- `createdAt` (DateTime)
- `updatedAt` (DateTime)

### GaslessPayment Model
- `id` (String, Primary Key)
- `userId` (String, Foreign Key to User)
- `amountUSDC` (Float) - Amount paid in USDC
- `amount` (String) - Amount in smallest units
- `signature` (String, Unique) - Transaction signature
- `status` (PaymentStatus) - Payment status (PENDING, VERIFIED, CONFIRMED, FAILED, CANCELLED)
- `creditRemaining` (Float) - Remaining credit from this payment
- `creditUsed` (Float) - Credit used from this payment
- `recipientTokenAccount` (String) - Recipient token account
- `recipientWallet` (String) - Recipient wallet address
- `fromAddress` (String, Optional) - Sender address
- `network` (String) - Network (devnet/mainnet)
- `tokenMint` (String) - Token mint address
- `paymentProof` (Json, Optional) - x402 payment proof
- `explorerUrl` (String, Optional) - Transaction explorer URL
- `createdAt` (DateTime)
- `updatedAt` (DateTime)

### SponsoredTransaction Model
- `id` (String, Primary Key)
- `userId` (String, Foreign Key to User)
- `paymentId` (String, Optional, Foreign Key to GaslessPayment)
- `type` (SponsoredTransactionType) - Transaction type (USER_TRANSACTION, TRANSFER, YIELD_OPERATION, CUSTOM)
- `signature` (String, Unique, Optional) - Transaction signature
- `solFeePaid` (Float, Optional) - SOL fee paid by server
- `usdcCreditUsed` (Float, Optional) - USDC credit used
- `serializedTransaction` (String, Optional) - Base64 encoded transaction
- `status` (TransactionStatus) - Transaction status (PENDING, SUBMITTED, CONFIRMED, FAILED)
- `errorMessage` (String, Optional) - Error message if failed
- `network` (String) - Network (devnet/mainnet)
- `explorerUrl` (String, Optional) - Transaction explorer URL
- `createdAt` (DateTime)
- `updatedAt` (DateTime)

## Project Structure

```
src/
├── config/
│   ├── env.ts          # Environment configuration
│   └── swagger.ts      # Swagger/OpenAPI configuration
├── controllers/
│   ├── user.controller.ts      # User and transaction controllers
│   └── post.controller.ts      # Post controllers
├── services/
│   ├── blockchain.service.ts    # Solana blockchain operations
│   ├── gasless.service.ts      # Gasless transaction service (x402)
│   ├── gasless-credit.service.ts # Credit system service
│   └── grid.service.ts         # Grid SDK integration
├── lib/
│   └── prisma.ts       # Prisma client configuration
├── routes/
│   ├── user.routes.ts           # User routes
│   ├── post.routes.ts           # Post routes
│   └── transaction.routes.ts    # Transaction and gasless routes
├── schemas/
│   ├── transaction.schemas.ts   # Transaction validation schemas
│   └── user.schemas.ts          # User validation schemas
├── middleware/
│   ├── validation.middleware.ts # Request validation
│   └── error.middleware.ts      # Error handling
├── utils/
│   └── logger.ts       # Winston logger configuration
├── app.ts              # Express app setup
└── server.ts           # Server entry point

prisma/
├── schema.prisma       # Database schema
└── seed.ts            # Database seeding script

scripts/
├── create-transaction-for-sponsor.ts  # Helper script for transaction creation
└── test-gasless-transaction.ts        # Testing scripts
```

## Security

This application implements comprehensive security measures to protect against common vulnerabilities:

- **Input Validation**: All inputs are validated using Zod schemas
- **Authentication**: JWT-based authentication with bcrypt password hashing
- **Authorization**: Role-based access control and resource ownership
- **Rate Limiting**: Protection against DDoS and brute force attacks
- **Security Headers**: Helmet.js for comprehensive security headers
- **CORS Protection**: Environment-based cross-origin resource sharing
- **SQL Injection Prevention**: Prisma ORM with input sanitization
- **XSS Protection**: Input sanitization and output encoding
- **Error Handling**: Secure error responses without information leakage

For detailed security information, see [SECURITY.md](./SECURITY.md).

### CORS Configuration

The API uses environment-based CORS configuration for secure cross-origin requests:

- **Development**: Allows localhost origins for local development
- **Production**: Only allows explicitly configured domains
- **Security**: Blocks requests without origin headers in production
- **Flexibility**: Supports multiple subdomains and environments

For detailed CORS setup instructions, see [CORS_CONFIGURATION.md](./CORS_CONFIGURATION.md).

## Gasless Transactions & Credit System

This project implements a **gasless transaction relay system** using the **x402 Payment Standard**, allowing users to pay transaction fees in USDC instead of SOL. The system includes a **credit system** where payments accumulate as credit that can be used for future transactions.

### Key Features

- **x402 Payment Standard**: Pay transaction fees in USDC instead of SOL
- **Credit System**: Payments convert to reusable credit balance
- **Grid Wallet Integration**: Fully programmatic, server-side implementation
- **Payment Tracking**: All payments and sponsored transactions are tracked in the database
- **FIFO Credit Deduction**: Credit is deducted from oldest payment first

### Quick Start

1. **Make a payment** (adds credit):
   ```bash
   curl -X POST http://localhost:3000/api/transaction/gasless \
     -H "Content-Type: application/json" \
     -d '{"email": "user@example.com"}'
   ```

2. **Check credit balance**:
   ```bash
   curl http://localhost:3000/api/transaction/gasless/credit/user@example.com
   ```

3. **Sponsor a transaction** (uses credit):
   ```bash
   curl -X POST http://localhost:3000/api/transaction/gasless/sponsor \
     -H "Content-Type: application/json" \
     -d '{
       "email": "user@example.com",
       "transaction": "base64_encoded_transaction",
       "type": "TRANSFER"
     }'
   ```

### Documentation

For detailed guides and documentation, see:

- **[Complete Gasless & Credit Guide](./COMPLETE_GASLESS_CREDIT_GUIDE.md)** - Comprehensive step-by-step guide
- **[x402 Integration Explained](./X402_INTEGRATION_EXPLAINED.md)** - How x402 payment standard works
- **[Credit System Usage Guide](./CREDIT_SYSTEM_USAGE_GUIDE.md)** - Using the credit system
- **[Gasless Feature Walkthrough](./GASLESS_FEATURE_WALKTHROUGH.md)** - Detailed feature explanation
- **[How to Create Transaction for Sponsor](./HOW_TO_CREATE_TRANSACTION_FOR_SPONSOR.md)** - Creating transactions
- **[Quick Start Sponsor Transaction](./QUICK_START_SPONSOR_TRANSACTION.md)** - Quick reference

### Configuration

Ensure the following environment variables are set:

```env
# Gasless Transaction Configuration
GASLESS_FEE_PAYER_PRIVATE_KEY=your_base58_private_key
GASLESS_RECIPIENT_WALLET=recipient_wallet_address
GASLESS_PRICE_USDC=0.0003
SOLANA_NETWORK=devnet  # or mainnet
```

**Important Notes:**
- The fee payer wallet must have SOL balance to pay for gas fees
- The recipient wallet receives USDC payments from users
- Users pay in USDC, server pays SOL gas fees
- Credit is automatically added when payments are verified

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## License

This project is licensed under the ISC License.
