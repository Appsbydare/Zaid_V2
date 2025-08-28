// ============================================
// STANDALONE BYBIT WITHDRAWAL API TEST
// ============================================

import crypto from 'crypto';

// ByBit API credentials - UPDATE THESE WITH YOUR REAL VALUES
const BYBIT_CONFIG = {
  apiKey: "vqL52uDhkej3tyGUaP",        // Replace with your actual API key
  apiSecret: "B043tPnaVGON5P5W3eCo4cDFDqEXcx7fB2sl"  // Replace with your actual secret
};

async function testByBitWithdrawalEndpoints() {
  console.log('🧪 TESTING: ByBit withdrawal endpoints...');
  console.log('==========================================');
  
  // Set date filter to last 30 days to catch more data
  const filterDate = new Date();
  filterDate.setDate(filterDate.getDate() - 30);
  
  try {
    const timestamp = Date.now().toString();
    const recvWindow = "5000";
    
    // ===========================================
    // TEST 1: Standard endpoint with NO filters
    // ===========================================
    console.log('\n🧪 TEST 1: Standard /query-record endpoint (ALL withdrawals)');
    console.log('-'.repeat(60));
    
    const endpoint1 = "https://api.bybit.com/v5/asset/withdraw/query-record";
    const queryParams1 = `timestamp=${timestamp}&limit=20&startTime=${filterDate.getTime()}`;
    const signString1 = timestamp + BYBIT_CONFIG.apiKey + recvWindow + queryParams1;
    const signature1 = crypto.createHmac('sha256', BYBIT_CONFIG.apiSecret).update(signString1).digest('hex');
    const url1 = `${endpoint1}?${queryParams1}`;
    
    console.log(`📡 URL: ${url1}`);
    console.log(`🔑 Signature: ${signature1.substring(0, 20)}...`);
    
    const response1 = await fetch(url1, {
      method: "GET",
      headers: {
        "X-BAPI-API-KEY": BYBIT_CONFIG.apiKey,
        "X-BAPI-SIGN": signature1,
        "X-BAPI-TIMESTAMP": timestamp,
        "X-BAPI-RECV-WINDOW": recvWindow,
        "Content-Type": "application/json"
      }
    });
    
    const data1 = await response1.json();
    console.log(`📊 Response Status: ${response1.status}`);
    console.log(`📋 Response Data:`, JSON.stringify(data1, null, 2));
    
    if (data1.result && data1.result.rows && data1.result.rows.length > 0) {
      console.log(`\n📊 Found ${data1.result.rows.length} withdrawal records:`);
      console.log('='.repeat(60));
      
      data1.result.rows.forEach((row, index) => {
        console.log(`\n🔍 Record ${index + 1}:`);
        console.log(`   withdrawType: ${row.withdrawType} (${row.withdrawType === 1 ? 'INTERNAL' : 'EXTERNAL'})`);
        console.log(`   status: ${row.status}`);
        console.log(`   coin: ${row.coin}`);
        console.log(`   amount: ${row.amount}`);
        console.log(`   toAddress: ${row.toAddress || 'N/A'}`);
        console.log(`   createTime: ${row.createTime} (${new Date(parseInt(row.createTime)).toISOString()})`);
        console.log(`   txID: ${row.txID || row.id || 'N/A'}`);
        console.log(`   chain: ${row.chain || 'N/A'}`);
      });
    } else {
      console.log('❌ No withdrawal records found in standard endpoint');
    }
    
    // ===========================================
    // TEST 2: Filter for withdrawType=1 (Internal)
    // ===========================================
    console.log('\n\n🧪 TEST 2: Same endpoint with withdrawType=1 filter (INTERNAL only)');
    console.log('-'.repeat(60));
    
    const queryParams2 = `timestamp=${timestamp}&limit=20&startTime=${filterDate.getTime()}&withdrawType=1`;
    const signString2 = timestamp + BYBIT_CONFIG.apiKey + recvWindow + queryParams2;
    const signature2 = crypto.createHmac('sha256', BYBIT_CONFIG.apiSecret).update(signString2).digest('hex');
    const url2 = `${endpoint1}?${queryParams2}`;
    
    console.log(`📡 URL: ${url2}`);
    
    const response2 = await fetch(url2, {
      method: "GET",
      headers: {
        "X-BAPI-API-KEY": BYBIT_CONFIG.apiKey,
        "X-BAPI-SIGN": signature2,
        "X-BAPI-TIMESTAMP": timestamp,
        "X-BAPI-RECV-WINDOW": recvWindow,
        "Content-Type": "application/json"
      }
    });
    
    const data2 = await response2.json();
    console.log(`📊 Response Status: ${response2.status}`);
    console.log(`📋 Internal Withdrawals Response:`, JSON.stringify(data2, null, 2));
    
    // ===========================================
    // TEST 3: Filter for withdrawType=0 (External)
    // ===========================================
    console.log('\n\n🧪 TEST 3: Same endpoint with withdrawType=0 filter (EXTERNAL only)');
    console.log('-'.repeat(60));
    
    const queryParams3 = `timestamp=${timestamp}&limit=20&startTime=${filterDate.getTime()}&withdrawType=0`;
    const signString3 = timestamp + BYBIT_CONFIG.apiKey + recvWindow + queryParams3;
    const signature3 = crypto.createHmac('sha256', BYBIT_CONFIG.apiSecret).update(signString3).digest('hex');
    const url3 = `${endpoint1}?${queryParams3}`;
    
    console.log(`📡 URL: ${url3}`);
    
    const response3 = await fetch(url3, {
      method: "GET",
      headers: {
        "X-BAPI-API-KEY": BYBIT_CONFIG.apiKey,
        "X-BAPI-SIGN": signature3,
        "X-BAPI-TIMESTAMP": timestamp,
        "X-BAPI-RECV-WINDOW": recvWindow,
        "Content-Type": "application/json"
      }
    });
    
    const data3 = await response3.json();
    console.log(`📊 Response Status: ${response3.status}`);
    console.log(`📋 External Withdrawals Response:`, JSON.stringify(data3, null, 2));
    
    // ===========================================
    // TEST 4: Internal-specific endpoint
    // ===========================================
    console.log('\n\n🧪 TEST 4: Internal-specific endpoint /query-internal-record');
    console.log('-'.repeat(60));
    
    const endpoint4 = "https://api.bybit.com/v5/asset/withdraw/query-internal-record";
    const queryParams4 = `timestamp=${timestamp}&limit=20&startTime=${filterDate.getTime()}`;
    const signString4 = timestamp + BYBIT_CONFIG.apiKey + recvWindow + queryParams4;
    const signature4 = crypto.createHmac('sha256', BYBIT_CONFIG.apiSecret).update(signString4).digest('hex');
    const url4 = `${endpoint4}?${queryParams4}`;
    
    console.log(`📡 URL: ${url4}`);
    
    const response4 = await fetch(url4, {
      method: "GET",
      headers: {
        "X-BAPI-API-KEY": BYBIT_CONFIG.apiKey,
        "X-BAPI-SIGN": signature4,
        "X-BAPI-TIMESTAMP": timestamp,
        "X-BAPI-RECV-WINDOW": recvWindow,
        "Content-Type": "application/json"
      }
    });
    
    const data4 = await response4.json();
    console.log(`📊 Response Status: ${response4.status}`);
    console.log(`📋 Internal-specific Endpoint Response:`, JSON.stringify(data4, null, 2));
    
    // ===========================================
    // SUMMARY
    // ===========================================
    console.log('\n\n📋 TESTING SUMMARY:');
    console.log('='.repeat(60));
    console.log('✅ Test completed! Check the responses above to understand:');
    console.log('   1. How internal withdrawals appear in the data');
    console.log('   2. What fields distinguish internal vs external');
    console.log('   3. Which endpoint gives the best results');
    console.log('   4. The exact JSON structure for each type');
    
  } catch (error) {
    console.error('❌ TEST ERROR:', error.message);
    console.error('Stack:', error.stack);
  }
}

// Run the test
testByBitWithdrawalEndpoints();
