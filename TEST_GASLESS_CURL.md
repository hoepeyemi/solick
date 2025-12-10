# Testing Gasless Transaction Feature with cURL

Quick guide to test the gasless transaction feature using cURL commands.

## Prerequisites

1. **Server must be running:**
   ```bash
   npm run dev
   # or
   yarn dev
   ```

2. **User must have:**
   - Grid account with complete session data
   - USDC balance in their Grid wallet (at least 0.0003 USDC)
   - Active account status

3. **Environment variables configured:**
   - `GASLESS_FEE_PAYER_PRIVATE_KEY`
   - `GASLESS_RECIPIENT_WALLET`
   - `GASLESS_PRICE_USDC`

## Basic cURL Command

### Simple Request

```bash
curl -X POST http://localhost:3000/api/transaction/gasless \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com"
  }'
```

### Pretty Print Response (with jq)

```bash
curl -X POST http://localhost:3000/api/transaction/gasless \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com"
  }' | jq .
```

### Verbose Output (see request/response details)

```bash
curl -v -X POST http://localhost:3000/api/transaction/gasless \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com"
  }'
```

### Save Response to File

```bash
curl -X POST http://localhost:3000/api/transaction/gasless \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com"
  }' -o response.json
```

## Expected Success Response

```json
{
  "success": true,
  "message": "Payment transaction executed! You paid 0 SOL (signed with Grid wallet)",
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
    "feePayer": "Grid Wallet (user paid USDC, Grid paid SOL)",
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

## Common Error Responses

### 404 - User Not Found

```bash
# Response:
{
  "error": "User not found"
}
```

### 400 - Incomplete Grid Account

```bash
# Response:
{
  "error": "User does not have complete Grid account data",
  "message": "User must have completed Grid account creation"
}
```

### 401 - Account Inactive

```bash
# Response:
{
  "error": "User account is inactive"
}
```

### 402 - Payment Verification Failed

```bash
# Response:
{
  "error": "Payment verification failed",
  "details": "Invalid USDC transfer in transaction"
}
```

### 503 - Service Not Configured

```bash
# Response:
{
  "error": "Gasless transaction service not configured",
  "details": "Server fee payer or recipient wallet not configured"
}
```

## Testing with Different Servers

### Local Development

```bash
curl -X POST http://localhost:3000/api/transaction/gasless \
  -H "Content-Type: application/json" \
  -d '{"email": "user@example.com"}'
```

### Staging Server

```bash
curl -X POST https://staging.example.com/api/transaction/gasless \
  -H "Content-Type: application/json" \
  -d '{"email": "user@example.com"}'
```

### Production Server

```bash
curl -X POST https://api.example.com/api/transaction/gasless \
  -H "Content-Type: application/json" \
  -d '{"email": "user@example.com"}'
```

## Using Environment Variables

### Windows PowerShell

```powershell
$email = "user@example.com"
curl -X POST http://localhost:3000/api/transaction/gasless `
  -H "Content-Type: application/json" `
  -d "{`"email`": `"$email`"}"
```

### Windows CMD

```cmd
set EMAIL=user@example.com
curl -X POST http://localhost:3000/api/transaction/gasless -H "Content-Type: application/json" -d "{\"email\": \"%EMAIL%\"}"
```

### Linux/Mac Bash

```bash
EMAIL="user@example.com"
curl -X POST http://localhost:3000/api/transaction/gasless \
  -H "Content-Type: application/json" \
  -d "{\"email\": \"$EMAIL\"}"
```

## Testing Script

Create a file `test-gasless.sh`:

```bash
#!/bin/bash

# Configuration
SERVER_URL="${SERVER_URL:-http://localhost:3000}"
USER_EMAIL="${USER_EMAIL:-user@example.com}"

echo "Testing Gasless Transaction Feature"
echo "===================================="
echo "Server: $SERVER_URL"
echo "User Email: $USER_EMAIL"
echo ""

# Make the request
response=$(curl -s -X POST "$SERVER_URL/api/transaction/gasless" \
  -H "Content-Type: application/json" \
  -d "{\"email\": \"$USER_EMAIL\"}")

# Check if request was successful
if echo "$response" | grep -q '"success":true'; then
  echo "✅ Success!"
  echo ""
  echo "$response" | jq .
  
  # Extract signature
  signature=$(echo "$response" | jq -r '.signature')
  echo ""
  echo "Transaction Signature: $signature"
  
  # Extract explorer URL
  explorer_url=$(echo "$response" | jq -r '.explorerUrl')
  echo "Explorer URL: $explorer_url"
else
  echo "❌ Error occurred"
  echo ""
  echo "$response" | jq .
fi
```

Make it executable and run:

```bash
chmod +x test-gasless.sh
./test-gasless.sh
```

Or with custom values:

```bash
SERVER_URL=http://localhost:3000 USER_EMAIL=test@example.com ./test-gasless.sh
```

## Quick Test Checklist

- [ ] Server is running (`npm run dev`)
- [ ] User exists in database
- [ ] User has Grid account with session data
- [ ] User's Grid wallet has USDC balance
- [ ] Environment variables are configured
- [ ] Network is accessible (devnet/mainnet)

## Troubleshooting

### Connection Refused

**Error:** `curl: (7) Failed to connect to localhost port 3000`

**Solution:** Make sure the server is running on port 3000

### Invalid JSON

**Error:** `{"error":"Invalid request body"}`

**Solution:** Check JSON syntax, ensure proper escaping of quotes

### Timeout

**Error:** `curl: (28) Operation timed out`

**Solution:** 
- Check network connectivity
- Verify server is accessible
- Check firewall settings

### SSL Certificate Error (for HTTPS)

**Error:** `curl: (60) SSL certificate problem`

**Solution:** Use `-k` flag to skip certificate verification (development only):
```bash
curl -k -X POST https://api.example.com/api/transaction/gasless ...
```

## Tips

1. **Use `jq` for pretty printing:** Install `jq` for better JSON formatting
2. **Save responses:** Use `-o response.json` to save responses for analysis
3. **Verbose mode:** Use `-v` to see full request/response headers
4. **Test with different users:** Try multiple email addresses to test different scenarios
5. **Check server logs:** Monitor server console for detailed error messages


