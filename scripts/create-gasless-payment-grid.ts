/**
 * Step 2: Create and Send Gasless Transaction Payment with Grid Wallet
 * 
 * This script uses Grid SDK to sign the payment transaction.
 * Use this after getting the prepared transaction from the prepare endpoint.
 * 
 * Usage:
 *   1. First, prepare transaction: POST /api/transaction/gasless/grid/prepare
 *   2. Sign transaction with Grid SDK using the returned data
 *   3. Execute: POST /api/transaction/gasless/grid/execute
 * 
 * Or use this script which does steps 2-3 automatically
 */

import fetch from 'node-fetch';
import * as dotenv from 'dotenv';
// Note: Grid SDK signing should be done client-side
// This script demonstrates the flow but requires client-side Grid SDK

// Load environment variables
dotenv.config();

// ============================================
// CONFIGURATION
// ============================================

const SERVER_URL = process.env.SERVER_URL || 'http://localhost:3000';
const USER_EMAIL = process.env.USER_EMAIL || '';

if (!USER_EMAIL) {
  console.error('❌ ERROR: USER_EMAIL must be set in .env');
  console.error('Example: USER_EMAIL=user@example.com');
  process.exit(1);
}

// ============================================
// MAIN FUNCTION
// ============================================

async function createAndSendGaslessPaymentWithGrid() {
  try {
    console.log('🚀 Creating Gasless Payment with Grid Wallet');
    console.log('============================================\n');
    console.log(`Server URL: ${SERVER_URL}`);
    console.log(`User Email: ${USER_EMAIL}\n`);

    // Step 1: Prepare payment transaction
    console.log('📋 Step 1: Preparing payment transaction...');
    const prepareResponse = await fetch(`${SERVER_URL}/api/transaction/gasless/grid/prepare`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email: USER_EMAIL }),
    });

    if (!prepareResponse.ok) {
      const error = await prepareResponse.json();
      console.error('❌ Failed to prepare transaction:');
      console.error(JSON.stringify(error, null, 2));
      throw new Error(`Prepare failed with status ${prepareResponse.status}`);
    }

    const prepareResult = await prepareResponse.json();
    console.log('✓ Transaction prepared successfully');
    console.log(`  Payment Amount: ${prepareResult.paymentQuote.amountUSDC} USDC`);
    console.log(`  Recipient: ${prepareResult.paymentQuote.tokenAccount}\n`);

    const { transactionPayload, instructions } = prepareResult;

    // Step 2: Sign transaction with Grid SDK
    console.log('📋 Step 2: Signing transaction with Grid SDK...');
    
    // Note: In a real application, the user would sign this on the client side
    // using their Grid SDK session. For this script, we're using the server's
    // Grid SDK, but in production, this should be done client-side.
    
    // For demonstration, we'll show what needs to be done:
    console.log('  ⚠ Note: In production, signing should be done client-side');
    console.log('  ⚠ This script requires Grid SDK session data from the user');
    console.log('  ⚠ For now, you need to sign the transaction manually or use Grid SDK client-side\n');

    // The transaction payload is ready for Grid SDK signing
    // User would call: gridClient.signAndSend({ ...instructions.gridData, transactionPayload })
    
    // For this script, we'll need the signed transaction
    // In a real implementation, the user would:
    // 1. Use Grid SDK on client to sign: gridClient.signAndSend({ sessionSecrets, session, transactionPayload, address })
    // 2. Extract the signed transaction from the response
    // 3. Send it to the execute endpoint

    console.log('📋 Step 3: To complete, you need to:');
    console.log('  1. Sign the transaction using Grid SDK on client side');
    console.log('  2. Send the signed transaction to /api/transaction/gasless/grid/execute');
    console.log('\n📊 Transaction Payload:');
    console.log(JSON.stringify(transactionPayload, null, 2));
    console.log('\n📊 Grid Data for Signing:');
    console.log(JSON.stringify(instructions.gridData, null, 2));
    console.log('\n💡 Example Grid SDK call:');
    console.log(`
const signedTx = await gridClient.signAndSend({
  sessionSecrets: ${JSON.stringify(instructions.gridData.sessionSecrets)},
  session: ${JSON.stringify(instructions.gridData.session)},
  transactionPayload: ${JSON.stringify(transactionPayload)},
  address: "${instructions.gridData.address}"
});

// Then send signedTx.data.transaction (or signedTx.transaction) to execute endpoint
    `);

    // If you have the signed transaction, uncomment below to execute:
    /*
    const SIGNED_TRANSACTION = 'your_signed_transaction_base64_here';
    
    console.log('\n📋 Step 4: Executing signed transaction...');
    const executeResponse = await fetch(`${SERVER_URL}/api/transaction/gasless/grid/execute`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: USER_EMAIL,
        signedTransaction: SIGNED_TRANSACTION,
      }),
    });

    const executeResult = await executeResponse.json();

    if (!executeResponse.ok) {
      console.error('❌ Transaction execution failed:');
      console.error(JSON.stringify(executeResult, null, 2));
      throw new Error(`Execution failed with status ${executeResponse.status}`);
    }

    console.log('✅ Transaction executed successfully!');
    console.log('\n📊 Result:');
    console.log(JSON.stringify(executeResult, null, 2));

    if (executeResult.explorerUrl) {
      console.log(`\n🔗 View transaction on Solana Explorer:`);
      console.log(executeResult.explorerUrl);
    }
    */

    console.log('\n✅ Preparation completed! Sign the transaction and send to execute endpoint.');
  } catch (error) {
    console.error('\n❌ Error:');
    console.error(error);
    process.exit(1);
  }
}

// Run the script
createAndSendGaslessPaymentWithGrid();

