// ============================================
// BITGET V1 TO V2 API MIGRATION TEST
// ============================================
// Purpose: Test V2 endpoints with both Bitget accounts before production migration
// This will verify that V2 endpoints work with your existing API keys

import crypto from 'crypto';

// ============================================
// CONFIGURATION - UPDATE WITH YOUR CREDENTIALS
// ============================================
// Get these from your Google Sheet > SETTINGS sheet:
// Account 1 (ZA): Row 8, columns L (key), M (secret), N (passphrase)
// Account 2 (SF): Row 9, columns L (key), M (secret), N (passphrase)

const BITGET_ACCOUNT_1 = {
  name: "Bitget (ZA)",
  apiKey: process.env.BITGET_API_KEY || "bg_905fae870a806d82dc57439df3c50c6a",
  apiSecret: process.env.BITGET_API_SECRET || "3ae2ad9dbd2364ffa893419573aaefeed40cfe4ee94aabad9339f6ebffa454c",
  passphrase: process.env.BITGET_API_PASSPHRASE || "Darshana1"
};

const BITGET_ACCOUNT_2 = {
  name: "Bitget (SF)",
  apiKey: process.env.BITGET_API_2_KEY || "bg_fe80b5a1851c65bb83a99aba55d4b40b",
  apiSecret: process.env.BITGET_API_2_SECRET || "1c8e1bac46576724aa920e2a2a60f7db78121a00d350cf6225041a007d4333de",
  passphrase: process.env.BITGET_API_2_PASSPHRASE || "Darshana1"
};

// ============================================
// TEST FUNCTIONS
// ============================================

async function testBitgetV2Endpoint(config, endpointName, endpoint, requestPath, queryParams = '') {
  console.log(`\n🧪 Testing ${endpointName} for ${config.name}`);
  console.log('-'.repeat(80));
  
  try {
    const timestamp = Date.now().toString();
    const method = 'GET';
    const fullRequestPath = queryParams ? `${requestPath}?${queryParams}` : requestPath;
    const body = '';
    
    // Create signature: timestamp + method + requestPath + body
    const signString = timestamp + method + fullRequestPath + body;
    const signature = crypto.createHmac('sha256', config.apiSecret).update(signString).digest('base64');
    
    console.log(`📡 Endpoint: ${endpoint}`);
    console.log(`🔑 Request Path: ${fullRequestPath}`);
    console.log(`🔐 Sign String: ${signString.substring(0, 60)}...`);
    console.log(`✍️  Signature: ${signature.substring(0, 30)}...`);
    
    const url = queryParams ? `${endpoint}?${queryParams}` : endpoint;
    const response = await fetch(url, {
      method: "GET",
      headers: {
        "ACCESS-KEY": config.apiKey,
        "ACCESS-SIGN": signature,
        "ACCESS-TIMESTAMP": timestamp,
        "Content-Type": "application/json",
        "ACCESS-PASSPHRASE": config.passphrase || ""
      }
    });
    
    const data = await response.json();
    
    console.log(`📊 Response Status: ${response.status}`);
    console.log(`📊 Response Code: ${data.code}`);
    console.log(`📊 Response Message: ${data.msg || 'N/A'}`);
    
    if (response.ok && data.code === '00000') {
      console.log(`✅ SUCCESS - ${endpointName} authenticated successfully!`);
      
      // Check data structure
      if (data.data) {
        if (Array.isArray(data.data)) {
          console.log(`📊 Data Type: Array with ${data.data.length} items`);
          if (data.data.length > 0) {
            console.log(`📋 Sample Item (first):`, JSON.stringify(data.data[0], null, 2));
            
            // Log field names to verify compatibility
            console.log(`📋 Available Fields:`, Object.keys(data.data[0]));
          } else {
            console.log(`ℹ️  No data items in response (this is OK if no transactions exist)`);
          }
        } else if (typeof data.data === 'object') {
          console.log(`📊 Data Type: Object`);
          console.log(`📊 Object Keys:`, Object.keys(data.data));
          console.log(`📋 Sample Data:`, JSON.stringify(data.data, null, 2).substring(0, 500));
        }
      } else {
        console.log(`ℹ️  No 'data' field in response`);
      }
      
      return { success: true, data: data };
    } else {
      console.log(`❌ FAILED - ${endpointName}`);
      console.log(`❌ Error Code: ${data.code}`);
      console.log(`❌ Error Message: ${data.msg}`);
      console.log(`❌ Full Response:`, JSON.stringify(data, null, 2));
      return { success: false, error: data.msg || 'Unknown error', code: data.code, data: data };
    }
    
  } catch (error) {
    console.log(`❌ ERROR - ${endpointName}: ${error.message}`);
    console.error(error);
    return { success: false, error: error.message };
  }
}

async function testBitgetAccount(config) {
  console.log('\n' + '='.repeat(80));
  console.log(`🔍 TESTING ACCOUNT: ${config.name}`);
  console.log('='.repeat(80));
  
  // Verify credentials are configured
  if (config.apiKey.startsWith('YOUR_BITGET')) {
    console.log('⚠️  SKIPPED - API credentials not configured');
    console.log('Please update the credentials in this file before running tests.');
    return {
      accountName: config.name,
      skipped: true,
      tests: {}
    };
  }
  
  const filterDate = new Date();
  filterDate.setDate(filterDate.getDate() - 90); // Last 90 days
  
  const results = {
    accountName: config.name,
    skipped: false,
    tests: {}
  };
  
  // Test 1: Account Assets (V2) - This is the main authentication test
  console.log('\n📝 Test 1/4: Account Assets (Primary authentication check)');
  results.tests.accountAssets = await testBitgetV2Endpoint(
    config,
    'Account Assets V2',
    'https://api.bitget.com/api/v2/spot/account/assets',
    '/api/v2/spot/account/assets'
  );
  
  if (!results.tests.accountAssets.success) {
    console.log('\n⚠️  Account Assets test failed - skipping remaining tests for this account');
    console.log('Fix authentication before proceeding.');
    return results;
  }
  
  await new Promise(resolve => setTimeout(resolve, 1000)); // Rate limit pause
  
  // Test 2: Deposit Records (V2)
  console.log('\n📝 Test 2/4: Deposit Records');
  const depositParams = `startTime=${filterDate.getTime()}&endTime=${Date.now()}`;
  results.tests.deposits = await testBitgetV2Endpoint(
    config,
    'Deposit Records V2',
    'https://api.bitget.com/api/v2/spot/wallet/deposit-records',
    '/api/v2/spot/wallet/deposit-records',
    depositParams
  );
  
  await new Promise(resolve => setTimeout(resolve, 1000)); // Rate limit pause
  
  // Test 3: Withdrawal Records (V2)
  console.log('\n📝 Test 3/4: Withdrawal Records');
  const withdrawalParams = `startTime=${filterDate.getTime()}&endTime=${Date.now()}`;
  results.tests.withdrawals = await testBitgetV2Endpoint(
    config,
    'Withdrawal Records V2',
    'https://api.bitget.com/api/v2/spot/wallet/withdrawal-records',
    '/api/v2/spot/wallet/withdrawal-records',
    withdrawalParams
  );
  
  await new Promise(resolve => setTimeout(resolve, 1000)); // Rate limit pause
  
  // Test 4: Account Bill / P2P (V2)
  console.log('\n📝 Test 4/4: Account Bill (P2P & Futures)');
  const billParams = `productType=UMCBL&startTime=${filterDate.getTime()}&endTime=${Date.now()}&pageSize=20`;
  results.tests.accountBill = await testBitgetV2Endpoint(
    config,
    'Account Bill V2',
    'https://api.bitget.com/api/v2/mix/account/account-bill',
    '/api/v2/mix/account/account-bill',
    billParams
  );
  
  return results;
}

async function runAllTests() {
  console.log('\n' + '█'.repeat(80));
  console.log('🚀 BITGET V1 TO V2 API MIGRATION TEST SUITE');
  console.log('█'.repeat(80));
  console.log('Purpose: Verify V2 endpoints work with existing API keys before migration');
  console.log('Testing: 4 endpoints × 2 accounts = 8 total tests');
  console.log('█'.repeat(80));
  
  const allResults = [];
  
  // Test Account 1
  console.log('\n📌 Starting tests for Account 1...');
  const results1 = await testBitgetAccount(BITGET_ACCOUNT_1);
  allResults.push(results1);
  
  if (!results1.skipped) {
    await new Promise(resolve => setTimeout(resolve, 2000)); // Pause between accounts
  }
  
  // Test Account 2
  console.log('\n📌 Starting tests for Account 2...');
  const results2 = await testBitgetAccount(BITGET_ACCOUNT_2);
  allResults.push(results2);
  
  // ============================================
  // SUMMARY REPORT
  // ============================================
  console.log('\n\n' + '█'.repeat(80));
  console.log('📊 TEST SUMMARY REPORT');
  console.log('█'.repeat(80));
  
  let totalTests = 0;
  let passedTests = 0;
  let failedTests = 0;
  let skippedAccounts = 0;
  
  allResults.forEach(accountResult => {
    console.log(`\n${accountResult.accountName}:`);
    
    if (accountResult.skipped) {
      console.log(`  ⏭️  SKIPPED - Credentials not configured`);
      skippedAccounts++;
    } else {
      Object.keys(accountResult.tests).forEach(testName => {
        const test = accountResult.tests[testName];
        const icon = test.success ? '✅' : '❌';
        console.log(`  ${icon} ${testName}: ${test.success ? 'PASSED' : 'FAILED'}`);
        
        totalTests++;
        if (test.success) {
          passedTests++;
        } else {
          failedTests++;
          if (test.error) {
            console.log(`     Error: ${test.error}`);
          }
          if (test.code) {
            console.log(`     Code: ${test.code}`);
          }
        }
      });
    }
  });
  
  console.log('\n' + '-'.repeat(80));
  console.log(`📊 Overall Results: ${passedTests}/${totalTests} tests passed`);
  
  if (skippedAccounts > 0) {
    console.log(`⏭️  ${skippedAccounts} account(s) skipped (credentials not configured)`);
  }
  
  console.log('\n' + '='.repeat(80));
  
  if (totalTests === 0) {
    console.log('⚠️  NO TESTS RUN - Please configure API credentials first!');
    console.log('\nInstructions:');
    console.log('1. Open your Google Sheet > SETTINGS sheet');
    console.log('2. Copy credentials from:');
    console.log('   - Account 1 (ZA): Row 8, columns L, M, N');
    console.log('   - Account 2 (SF): Row 9, columns L, M, N');
    console.log('3. Update the credentials in this test file (lines 16-27)');
    console.log('4. Run the test again: node test-bitget-v2-migration.js');
  } else if (passedTests === totalTests) {
    console.log('✅ ALL TESTS PASSED!');
    console.log('\n🎉 V2 API migration is ready!');
    console.log('\nNext Steps:');
    console.log('1. Update production code in api/crypto-to-sheets.js');
    console.log('2. Deploy to Vercel');
    console.log('3. Test with Google Sheets');
    console.log('4. Commit changes to git');
  } else if (failedTests > 0 && passedTests > 0) {
    console.log('⚠️  PARTIAL SUCCESS - Some tests failed');
    console.log('\nRecommendation:');
    console.log('- Review failed tests above');
    console.log('- Check API key permissions in Bitget dashboard');
    console.log('- Verify passphrase is correct');
    console.log('- If Account Assets passed, other failures may be due to no data');
  } else {
    console.log('❌ ALL TESTS FAILED');
    console.log('\nTroubleshooting:');
    console.log('1. Verify API credentials are correct');
    console.log('2. Check if API keys have proper permissions:');
    console.log('   - Spot Trading: Read');
    console.log('   - Wallet: Read');
    console.log('   - Futures: Read (for Account Bill)');
    console.log('3. Verify passphrase matches exactly');
    console.log('4. Check if IP whitelist is configured (if enabled)');
  }
  
  console.log('█'.repeat(80) + '\n');
}

// ============================================
// RUN TEST SUITE
// ============================================
console.log('Starting Bitget V2 API migration tests...\n');
runAllTests().catch(error => {
  console.error('\n❌ Fatal error running tests:', error);
  process.exit(1);
});

