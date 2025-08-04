// ===========================================
// BITGET API TESTING SCRIPT
// Testing different endpoints and authentication methods
// ===========================================

import crypto from 'crypto';

// Hardcoded Bitget API credentials for testing
const BITGET_CONFIG = {
  apiKey: "bg_fe80b5a1851c65bb83a99aba55d4b40b",
  apiSecret: "1c8e1bac46576724aa920e2a2a60f7db78121a00d350cf6225041a007d4333de",
  passphrase: "Darshana1"
};

// Test endpoints to try
const TEST_ENDPOINTS = [
  // V1 Endpoints
  {
    name: "V1 Account Assets",
    url: "https://api.bitget.com/api/spot/v1/account/assets",
    path: "/api/spot/v1/account/assets"
  },
  {
    name: "V1 Deposit List",
    url: "https://api.bitget.com/api/spot/v1/account/deposit-list",
    path: "/api/spot/v1/account/deposit-list"
  },
  {
    name: "V1 Withdraw List",
    url: "https://api.bitget.com/api/spot/v1/account/withdraw-list",
    path: "/api/spot/v1/account/withdraw-list"
  },
  {
    name: "V1 P2P Order List",
    url: "https://api.bitget.com/api/spot/v1/p2p/order-list",
    path: "/api/spot/v1/p2p/order-list"
  },
  
  // V2 Endpoints
  {
    name: "V2 Account Assets",
    url: "https://api.bitget.com/api/spot/v2/account/assets",
    path: "/api/spot/v2/account/assets"
  },
  {
    name: "V2 Deposit List",
    url: "https://api.bitget.com/api/spot/v2/account/deposit-list",
    path: "/api/spot/v2/account/deposit-list"
  },
  {
    name: "V2 Withdraw List",
    url: "https://api.bitget.com/api/spot/v2/account/withdraw-list",
    path: "/api/spot/v2/account/withdraw-list"
  },
  {
    name: "V2 P2P Order List",
    url: "https://api.bitget.com/api/spot/v2/p2p/order-list",
    path: "/api/spot/v2/p2p/order-list"
  },
  
  // V2 Tax Endpoints
  {
    name: "V2 Tax Spot Record",
    url: "https://api.bitget.com/api/v2/tax/spot-record",
    path: "/api/v2/tax/spot-record"
  },
  {
    name: "V2 Tax P2P Record",
    url: "https://api.bitget.com/api/v2/tax/p2p-record",
    path: "/api/v2/tax/p2p-record"
  }
];

// Create Bitget signature
function createBitgetSignature(timestamp, method, requestPath, body, secret) {
  const signString = timestamp + method + requestPath + body;
  return crypto.createHmac('sha256', secret).update(signString).digest('base64');
}

// Test a single endpoint
async function testEndpoint(endpoint, config) {
  console.log(`\n🔍 Testing: ${endpoint.name}`);
  console.log(`📡 URL: ${endpoint.url}`);
  
  const timestamp = Date.now().toString();
  const method = 'GET';
  const body = '';
  
  // Create signature
  const signature = createBitgetSignature(timestamp, method, endpoint.path, body, config.apiSecret);
  
  console.log(`🔑 Auth Details:`);
  console.log(`   - Timestamp: ${timestamp}`);
  console.log(`   - Sign String: "${timestamp}${method}${endpoint.path}${body}"`);
  console.log(`   - Signature: ${signature.substring(0, 20)}...`);
  
  try {
    const response = await fetch(endpoint.url, {
      method: method,
      headers: {
        "ACCESS-KEY": config.apiKey,
        "ACCESS-SIGN": signature,
        "ACCESS-TIMESTAMP": timestamp,
        "ACCESS-PASSPHRASE": config.passphrase,
        "Content-Type": "application/json"
      }
    });
    
    const data = await response.json();
    
    console.log(`📊 Response Status: ${response.status}`);
    console.log(`📊 Response Code: ${data.code || 'N/A'}`);
    console.log(`📊 Response Message: ${data.msg || data.message || 'N/A'}`);
    
    if (response.ok && data.code === '00000') {
      console.log(`✅ SUCCESS: ${endpoint.name}`);
      if (data.data) {
        console.log(`📊 Data found: ${Array.isArray(data.data) ? data.data.length : 'Object'}`);
        if (Array.isArray(data.data) && data.data.length > 0) {
          console.log(`📋 Sample data:`, JSON.stringify(data.data[0], null, 2));
        }
      }
      return { success: true, data: data };
    } else {
      console.log(`❌ FAILED: ${endpoint.name}`);
      console.log(`📋 Full response:`, JSON.stringify(data, null, 2));
      return { success: false, error: data.msg || data.message || 'Unknown error' };
    }
    
  } catch (error) {
    console.log(`❌ ERROR: ${error.message}`);
    return { success: false, error: error.message };
  }
}

// Test with different API key formats
async function testWithDifferentKeyFormats(endpoint, config) {
  console.log(`\n🔄 Testing ${endpoint.name} with different key formats...`);
  
  const keyFormats = [
    { name: "Original", key: config.apiKey },
    { name: "Without bg_ prefix", key: config.apiKey.replace('bg_', '') },
    { name: "With bg_ prefix", key: config.apiKey.startsWith('bg_') ? config.apiKey : `bg_${config.apiKey}` }
  ];
  
  for (const format of keyFormats) {
    console.log(`\n   Testing with ${format.name} key: ${format.key.substring(0, 10)}...`);
    
    const timestamp = Date.now().toString();
    const method = 'GET';
    const body = '';
    const signature = createBitgetSignature(timestamp, method, endpoint.path, body, config.apiSecret);
    
    try {
      const response = await fetch(endpoint.url, {
        method: method,
        headers: {
          "ACCESS-KEY": format.key,
          "ACCESS-SIGN": signature,
          "ACCESS-TIMESTAMP": timestamp,
          "ACCESS-PASSPHRASE": config.passphrase,
          "Content-Type": "application/json"
        }
      });
      
      const data = await response.json();
      console.log(`     Status: ${response.status}, Code: ${data.code}, Message: ${data.msg || 'N/A'}`);
      
      if (response.ok && data.code === '00000') {
        console.log(`     ✅ SUCCESS with ${format.name} key!`);
        return { success: true, workingKey: format.key, data: data };
      }
      
    } catch (error) {
      console.log(`     ❌ Error: ${error.message}`);
    }
  }
  
  return { success: false, error: "No key format worked" };
}

// Main testing function
async function runBitgetTests() {
  console.log("🚀 Starting Bitget API Testing...");
  console.log("=" * 50);
  
  const results = {
    successful: [],
    failed: []
  };
  
  // Test all endpoints
  for (const endpoint of TEST_ENDPOINTS) {
    const result = await testEndpoint(endpoint, BITGET_CONFIG);
    
    if (result.success) {
      results.successful.push({
        endpoint: endpoint.name,
        url: endpoint.url,
        data: result.data
      });
    } else {
      results.failed.push({
        endpoint: endpoint.name,
        url: endpoint.url,
        error: result.error
      });
    }
  }
  
  // Test key formats for the first working endpoint
  if (results.successful.length > 0) {
    console.log("\n" + "=" * 50);
    console.log("🔑 Testing different API key formats...");
    await testWithDifferentKeyFormats(TEST_ENDPOINTS[0], BITGET_CONFIG);
  }
  
  // Summary
  console.log("\n" + "=" * 50);
  console.log("📊 TESTING SUMMARY");
  console.log("=" * 50);
  console.log(`✅ Successful endpoints: ${results.successful.length}`);
  console.log(`❌ Failed endpoints: ${results.failed.length}`);
  
  if (results.successful.length > 0) {
    console.log("\n✅ WORKING ENDPOINTS:");
    results.successful.forEach(item => {
      console.log(`   - ${item.endpoint}: ${item.url}`);
    });
  }
  
  if (results.failed.length > 0) {
    console.log("\n❌ FAILED ENDPOINTS:");
    results.failed.forEach(item => {
      console.log(`   - ${item.endpoint}: ${item.error}`);
    });
  }
  
  return results;
}

// Export for Vercel
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  try {
    const results = await runBitgetTests();
    res.status(200).json({
      success: true,
      results: results
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
}

// For local testing
if (typeof window === 'undefined') {
  runBitgetTests().catch(console.error);
} 