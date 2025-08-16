// ===========================================
// FIXED VERSION - crypto-to-sheets.js
// Fixed: ByBit V5 auth, Binance P2P endpoints, currency rates, Google Sheets targeting
// ===========================================

import { GoogleAuth } from 'google-auth-library';
import { google } from 'googleapis';
import crypto from 'crypto';

// ===========================================
// NEW: WALLET CONFIGURATION READER FROM SETTINGS
// ===========================================

async function readWalletsFromSettings() {
  try {
    console.log('🔧 Reading wallet configurations from Settings...');
    
    const spreadsheetId = "1sx3ik8I-2_VcD3X1q6M4kOuo3hfkGbMa1JulPSWID9Y";
    
    // Use the correct CSV URL format for Google Sheets
    const csvUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/gviz/tq?tqx=out:csv&sheet=SETTINGS&range=T3:X17`;
    console.log(`🔍 CSV URL: ${csvUrl}`);
    
    const response = await fetch(csvUrl);
    
    if (!response.ok) {
      throw new Error(`Failed to fetch wallet data: ${response.status}`);
    }
    
    const csvText = await response.text();
    console.log(`📄 CSV Response length: ${csvText.length} characters`);
    console.log(`📄 CSV Response preview: ${csvText.substring(0, 200)}...`);
    
    const rows = parseCSV(csvText);
    console.log(`📊 Parsed ${rows.length} rows from CSV`);
    
    const wallets = {};
    
    console.log(`📊 Processing ${rows.length} wallet rows from Settings`);
    
    rows.forEach((row, index) => {
      if (row && row.length >= 5) {
        const name = row[0];        // Column T - Name
        const address = row[1];     // Column U - Wallet Address
        const blockchainType = row[2]; // Column V - Blockchain Type
        const apiKey = row[3];      // Column W - API Key
        const status = row[4];      // Column X - Status
        
        console.log(`🔍 Row ${index + 1}: Name="${name}", Address="${address}", Type="${blockchainType}", Status="${status}"`);
        
        // Only process if address is NOT empty
        if (address && address.trim() !== '') {
          // Infer blockchain type from wallet name if missing
          let inferredBlockchainType = blockchainType;
          if (!blockchainType || blockchainType.trim() === '') {
            if (name.toLowerCase().includes('bitcoin')) {
              inferredBlockchainType = 'bitcoin';
            } else if (name.toLowerCase().includes('ethereum') || name.toLowerCase().includes('bep20')) {
              inferredBlockchainType = 'ethereum';
            } else if (name.toLowerCase().includes('tron')) {
              inferredBlockchainType = 'tron';
            } else if (name.toLowerCase().includes('solana')) {
              inferredBlockchainType = 'solana';
            } else {
              console.log(`⚠️ Skipping wallet "${name}" - cannot infer blockchain type from name`);
            }
            
            if (inferredBlockchainType !== blockchainType) {
              console.log(`🔧 Inferred blockchain type for "${name}": ${inferredBlockchainType}`);
            }
          }
          
          // Only add wallet if we have a valid blockchain type
          if (inferredBlockchainType && inferredBlockchainType.trim() !== '') {
            wallets[name] = {
              address: address.trim(),
              blockchainType: inferredBlockchainType.trim(),
              apiKey: apiKey || '',
              status: status
            };
            console.log(`✅ Loaded wallet: ${name} (${inferredBlockchainType}) - Current Status: ${status}`);
          }
        } else {
          console.log(`⚠️ Skipping empty row ${index + 1} - no address`);
        }
      } else {
        console.log(`⚠️ Skipping invalid row ${index + 1} (length: ${row ? row.length : 0})`);
      }
    });
    
    console.log(`📊 Total active wallets loaded: ${Object.keys(wallets).length}`);
    
    if (Object.keys(wallets).length === 0) {
      console.log(`⚠️ No active wallets found. Check Settings T3:X17 for wallet configurations.`);
      console.log(`🔍 Make sure wallets have:`);
      console.log(`   - Address filled in column U`);
      console.log(`   - Blockchain type filled in column V`);
      console.log(`   - Status will be automatically updated based on connection test`);
    }
    
    return wallets;
    
  } catch (error) {
    console.error('❌ Error reading wallets from Settings:', error);
    return {};
  }
}

// ===========================================
// WALLET ADDRESS MAPPING FUNCTION
// ===========================================

/**
 * Creates a reverse mapping from wallet addresses to friendly names for platform display
 * @param {Object} wallets - Wallet configuration object from readWalletsFromSettings
 * @returns {Object} - Mapping of address -> friendly name (for PLATFORM column only)
 */
function createWalletAddressMapping(wallets) {
  const addressMapping = {};
  const mappingStats = { total: 0, mapped: 0, skipped: 0 };
  
  console.log('🔧 Creating platform mapping for friendly names...');
  
  for (const [walletName, walletConfig] of Object.entries(wallets)) {
    if (walletConfig.address && walletConfig.address.trim() !== '') {
      const address = walletConfig.address.trim();
      
      // Create multiple mapping variations for better matching
      addressMapping[address.toLowerCase()] = walletName;
      addressMapping[address] = walletName;
      
      // For Bitcoin addresses, also map without case sensitivity
      if (walletConfig.blockchainType === 'bitcoin') {
        addressMapping[address.toLowerCase()] = walletName;
      }
      
      // For Ethereum addresses, normalize to lowercase
      if (walletConfig.blockchainType === 'ethereum') {
        addressMapping[address.toLowerCase()] = walletName;
      }
      
      // For TRON addresses, keep original case
      if (walletConfig.blockchainType === 'tron') {
        addressMapping[address] = walletName;
      }
      
      // For Solana addresses, keep original case
      if (walletConfig.blockchainType === 'solana') {
        addressMapping[address] = walletName;
      }
      
      mappingStats.total++;
      console.log(`✅ Mapped: ${address} → ${walletName}`);
    }
  }
  
  console.log(`📊 Platform mapping created: ${mappingStats.total} addresses mapped`);
  console.log(`📊 Platform mapping keys: ${Object.keys(addressMapping).length} variations`);
  
  return addressMapping;
}

/**
 * Maps a wallet address to its friendly name if available
 * @param {string} address - The wallet address to map
 * @param {Object} addressMapping - The address mapping object
 * @returns {string} - The friendly name or original address
 */
function mapWalletAddress(address, addressMapping) {
  if (!address || !addressMapping) {
    return address;
  }
  
  const trimmedAddress = address.trim();
  if (!trimmedAddress) {
    return address;
  }
  
  // Try exact match first
  if (addressMapping[trimmedAddress]) {
    return addressMapping[trimmedAddress];
  }
  
  // Try lowercase match
  if (addressMapping[trimmedAddress.toLowerCase()]) {
    return addressMapping[trimmedAddress.toLowerCase()];
  }
  
  // Try partial match for long addresses (first 10 characters)
  if (trimmedAddress.length > 10) {
    const partialKey = trimmedAddress.substring(0, 10);
    for (const [mappedAddress, friendlyName] of Object.entries(addressMapping)) {
      if (mappedAddress.startsWith(partialKey) || trimmedAddress.startsWith(mappedAddress.substring(0, 10))) {
        return friendlyName;
      }
    }
  }
  
  // No match found, return original address
  return address;
}

/**
 * Applies platform mapping to a transaction object (ONLY platform field)
 * @param {Object} transaction - The transaction object
 * @param {Object} addressMapping - The address mapping object
 * @returns {Object} - The transaction with mapped platform only
 */
function applyPlatformMapping(transaction, addressMapping) {
  if (!transaction || !addressMapping) {
    return transaction;
  }
  
  const mappedTransaction = { ...transaction };
  
  // Only map the platform field, keep original addresses
  if (mappedTransaction.platform) {
    const originalPlatform = mappedTransaction.platform;
    
    // Check if this platform contains a wallet address that should be mapped
    for (const [address, friendlyName] of Object.entries(addressMapping)) {
      if (originalPlatform.includes(address) || originalPlatform.toLowerCase().includes(address.toLowerCase())) {
        mappedTransaction.platform = friendlyName;
        console.log(`🔗 Mapped platform: ${originalPlatform} → ${friendlyName}`);
        break;
      }
    }
  }
  
  return mappedTransaction;
}

// ===========================================
// CSV PARSER FUNCTION
// ===========================================

function parseCSV(csvText) {
  const lines = csvText.split('\n');
  const rows = [];
  
  for (const line of lines) {
    if (line.trim()) {
      // Simple CSV parsing - split by comma and handle quoted fields
      const row = [];
      let current = '';
      let inQuotes = false;
      
      for (let i = 0; i < line.length; i++) {
        const char = line[i];
        
        if (char === '"') {
          inQuotes = !inQuotes;
        } else if (char === ',' && !inQuotes) {
          row.push(current.trim());
          current = '';
        } else {
          current += char;
        }
      }
      
      row.push(current.trim());
      rows.push(row);
    }
  }
  
  return rows;
}

// ===========================================
// WALLET STATUS TRACKING (for Apps Script)
// ===========================================

// Note: Wallet status updates are handled by Apps Script
// The walletStatuses object tracks status for each wallet

export default async function handler(req, res) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  const debugLogs = [];

  try {
    debugLogs.push('🚀 Starting FIXED crypto data fetch...');

    // Get date filtering from request or use defaults
    let startDate = req.body?.startDate;
    
    // If no startDate provided, default to 7 days ago
    if (!startDate) {
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      startDate = sevenDaysAgo.toISOString();
      debugLogs.push('📅 No startDate provided, using last 7 days');
    }
    
    const filterDate = new Date(startDate);
    debugLogs.push(`📅 Filtering transactions after: ${startDate}`);
    debugLogs.push(`📅 Filter date object: ${filterDate.toISOString()}`);

    const allTransactions = [];
    const apiStatusResults = {};
    let totalTransactionsFound = 0;

    // ===========================================
    // STEP 1: FIXED BINANCE APIS WITH CREDENTIALS FROM APPS SCRIPT
    // ===========================================
    debugLogs.push('🔧 Testing Binance APIs with credentials from Apps Script...');
    
    // Get API credentials from request body (sent by Apps Script)
    const apiCredentials = req.body?.apiCredentials || {};
    debugLogs.push(`🔑 Received ${Object.keys(apiCredentials).length} credential sets from Apps Script`);
    
    const binanceAccounts = [
      {
        name: "Binance (GC)",
        apiKey: apiCredentials.BINANCE_GC_API?.apiKey || '',
        apiSecret: apiCredentials.BINANCE_GC_API?.apiSecret || ''
      },
      {
        name: "Binance (Main)",
        apiKey: apiCredentials.BINANCE_MAIN_API?.apiKey || '',
        apiSecret: apiCredentials.BINANCE_MAIN_API?.apiSecret || ''
      },
      {
        name: "Binance (CV)",
        apiKey: apiCredentials.BINANCE_CV?.apiKey || '',
        apiSecret: apiCredentials.BINANCE_CV?.apiSecret || ''
      }
    ];

    for (const account of binanceAccounts) {
      if (!account.apiKey || !account.apiSecret) {
        debugLogs.push(`⚠️ ${account.name}: Missing API credentials`);
        apiStatusResults[account.name] = {
          status: 'Error',
          lastSync: new Date().toISOString(),
          autoUpdate: 'Every Hour',
          notes: '❌ Missing credentials',
          transactionCount: 0
        };
        continue;
      }

      debugLogs.push(`🔧 Processing ${account.name} with credentials...`);
      const result = await testBinanceAccountFixed(account, filterDate, debugLogs);
      apiStatusResults[account.name] = result.status;
      
      if (result.success) {
        allTransactions.push(...result.transactions);
        totalTransactionsFound += result.transactions.length;
        debugLogs.push(`✅ ${account.name}: ${result.transactions.length} transactions`);
      } else {
        debugLogs.push(`❌ ${account.name}: ${result.status.notes}`);
      }
    }

    // ===========================================
    // STEP 2: FIXED BYBIT API (V5 AUTHENTICATION) WITH CREDENTIALS FROM APPS SCRIPT
    // ===========================================
    debugLogs.push('🔧 Processing ByBit APIs with credentials from Apps Script...');
    
    // Get ByBit credentials from the same apiCredentials object
    const bybitConfig = {
      name: "ByBit",
      apiKey: apiCredentials.BYBIT_API?.apiKey || '',
      apiSecret: apiCredentials.BYBIT_API?.apiSecret || ''
    };

    if (!bybitConfig.apiKey || !bybitConfig.apiSecret) {
      debugLogs.push('⚠️ ByBit: Missing API credentials');
      apiStatusResults['ByBit'] = {
        status: 'Error',
        lastSync: new Date().toISOString(),
        autoUpdate: 'Every Hour',
        notes: '❌ Missing credentials',
        transactionCount: 0
      };
    } else {
      debugLogs.push('🔧 Processing ByBit with credentials...');
      const bybitResult = await testByBitAccountFixed(bybitConfig, filterDate, debugLogs);
      apiStatusResults['ByBit'] = bybitResult.status;
      
      if (bybitResult.success) {
        allTransactions.push(...bybitResult.transactions);
        totalTransactionsFound += bybitResult.transactions.length;
        debugLogs.push(`✅ ByBit: ${bybitResult.transactions.length} transactions`);
      } else {
        debugLogs.push(`❌ ByBit: ${bybitResult.status.notes}`);
      }
    }

    // ===========================================
    // STEP 3: BITGET API WITH CREDENTIALS FROM APPS SCRIPT
    // ===========================================
    debugLogs.push('🔧 Processing Bitget APIs with credentials from Apps Script...');
    
    // Process Bitget Account 1
    const bitgetConfig1 = {
      name: "Bitget Account 1",
      apiKey: apiCredentials.BITGET_API?.apiKey || '',
      apiSecret: apiCredentials.BITGET_API?.apiSecret || '',
      passphrase: apiCredentials.BITGET_API?.passphrase || ''
    };

    if (!bitgetConfig1.apiKey || !bitgetConfig1.apiSecret) {
      debugLogs.push(`⚠️ Bitget Account 1: Missing API credentials`);
      apiStatusResults['Bitget Account 1'] = {
        status: 'Error',
        lastSync: new Date().toISOString(),
        autoUpdate: 'Every Hour',
        notes: '❌ Missing credentials',
        transactionCount: 0
      };
    } else {
      debugLogs.push('🔧 Processing Bitget Account 1 with credentials...');
      debugLogs.push(`🔍 Bitget Account 1 Config: Key=${bitgetConfig1.apiKey.substring(0, 10)}..., Secret=${bitgetConfig1.apiSecret.substring(0, 10)}..., Passphrase=${bitgetConfig1.passphrase || 'NOT PROVIDED'}`);
      const bitgetResult1 = await testBitgetAccountFixed(bitgetConfig1, filterDate, debugLogs);
      apiStatusResults['Bitget Account 1'] = bitgetResult1.status;
      
      if (bitgetResult1.success) {
        allTransactions.push(...bitgetResult1.transactions);
        totalTransactionsFound += bitgetResult1.transactions.length;
        debugLogs.push(`✅ Bitget Account 1: ${bitgetResult1.transactions.length} transactions`);
      } else {
        debugLogs.push(`❌ Bitget Account 1: ${bitgetResult1.status.notes}`);
      }
    }
    
    // Process Bitget Account 2
    const bitgetConfig2 = {
      name: "Bitget Account 2",
      apiKey: apiCredentials.BITGET_API_2?.apiKey || '',
      apiSecret: apiCredentials.BITGET_API_2?.apiSecret || '',
      passphrase: apiCredentials.BITGET_API_2?.passphrase || ''
    };

    if (!bitgetConfig2.apiKey || !bitgetConfig2.apiSecret || !bitgetConfig2.passphrase) {
      debugLogs.push(`⚠️ Bitget Account 2: Missing API credentials`);
      apiStatusResults['Bitget Account 2'] = {
        status: 'Error',
        lastSync: new Date().toISOString(),
        autoUpdate: 'Every Hour',
        notes: '❌ Missing credentials',
        transactionCount: 0
      };
    } else {
      debugLogs.push('🔧 Processing Bitget Account 2 with credentials...');
      debugLogs.push(`🔍 Bitget Account 2 Config: Key=${bitgetConfig2.apiKey.substring(0, 10)}..., Secret=${bitgetConfig2.apiSecret.substring(0, 10)}..., Passphrase=${bitgetConfig2.passphrase || 'NOT PROVIDED'}`);
      const bitgetResult2 = await testBitgetAccountFixed(bitgetConfig2, filterDate, debugLogs);
      apiStatusResults['Bitget Account 2'] = bitgetResult2.status;
      
      if (bitgetResult2.success) {
        allTransactions.push(...bitgetResult2.transactions);
        totalTransactionsFound += bitgetResult2.transactions.length;
        debugLogs.push(`✅ Bitget Account 2: ${bitgetResult2.transactions.length} transactions`);
      } else {
        debugLogs.push(`❌ Bitget Account 2: ${bitgetResult2.status.notes}`);
      }
    }

    // ===========================================
    // STEP 4: BLOCKCHAIN DATA (DYNAMIC FROM SETTINGS)
    // ===========================================
    debugLogs.push('🔧 Fetching blockchain data from Settings...');
    debugLogs.push('🔧 About to read wallets from Settings...');
    
    // Read wallet configurations from Settings
    let wallets = {};
    let walletStatuses = {}; // Track status for Apps Script update
    
    try {
      console.log('🔧 Attempting to read wallets from Settings...');
      wallets = await readWalletsFromSettings();
      console.log(`🔧 Successfully read wallets from Settings`);
    } catch (error) {
      console.error('❌ Error reading wallets from Settings:', error);
      wallets = {};
    }
    
    console.log(`🔧 Processing ${Object.keys(wallets).length} wallets from Settings...`);
    debugLogs.push(`🔧 Processing ${Object.keys(wallets).length} wallets from Settings...`);
    
    // Create wallet address mapping for platform names (friendly names in PLATFORM column)
    const addressMapping = createWalletAddressMapping(wallets);
    debugLogs.push(`🔗 Created platform mapping for ${Object.keys(addressMapping).length} addresses (for exchange platforms)`);
    
    // Process each wallet based on blockchain type
    for (const [walletName, walletConfig] of Object.entries(wallets)) {
      try {
        debugLogs.push(`🔧 Processing ${walletName} (${walletConfig.blockchainType})...`);
        
        let transactions = [];
        
        switch (walletConfig.blockchainType) {
          case 'bitcoin':
            transactions = await fetchBitcoinEnhanced(walletConfig.address, filterDate);
            break;
          case 'ethereum':
            transactions = await fetchEthereumEnhanced(walletConfig.address, filterDate, walletConfig.apiKey);
            break;
          case 'tron':
            transactions = await fetchTronEnhanced(walletConfig.address, filterDate);
            break;
          case 'solana':
            transactions = await fetchSolanaEnhanced(walletConfig.address, filterDate);
            break;
          default:
            debugLogs.push(`⚠️ Unknown blockchain type: ${walletConfig.blockchainType}`);
            walletStatuses[walletName] = 'Error';
            continue;
        }
        
        // Set platform to friendly name for blockchain wallets (keep original addresses)
        const mappedTransactions = transactions.map(tx => ({
          ...tx,
          platform: walletName // Use the friendly name from Settings
        }));
        allTransactions.push(...mappedTransactions);
        totalTransactionsFound += mappedTransactions.length;
        
        // Determine status based on connection and data
        let walletStatus = 'Not Working';
        if (transactions.length > 0) {
          walletStatus = 'Working';
        } else {
          // Check if connection was successful but no new transactions
          walletStatus = 'Working'; // Connection successful, just no new data
        }
        
        walletStatuses[walletName] = walletStatus;
        
        apiStatusResults[walletName] = {
          status: walletStatus,
          lastSync: new Date().toISOString(),
          autoUpdate: 'Every Hour',
          notes: `🔧 ${transactions.length} transactions found`,
          transactionCount: transactions.length
        };
        
        debugLogs.push(`✅ ${walletName}: ${transactions.length} transactions - Status: ${walletStatus}`);
        
      } catch (error) {
        debugLogs.push(`❌ ${walletName} error: ${error.message}`);
        walletStatuses[walletName] = 'Error';
        
        apiStatusResults[walletName] = {
          status: 'Error',
          lastSync: new Date().toISOString(),
          autoUpdate: 'Every Hour',
          notes: `❌ ${error.message}`,
          transactionCount: 0
        };
      }
    }
    
    // Note: Wallet status updates will be handled by Apps Script
    // The walletStatuses object contains the status for each wallet

    // ===========================================
    // STEP 5: WRITE TO GOOGLE SHEETS WITH FIXES
    // ===========================================
    debugLogs.push(`🔧 Processing ${allTransactions.length} transactions with FIXED deduplication...`);
    
    let sheetsResult = { success: false, withdrawalsAdded: 0, depositsAdded: 0 };
    
    try {
      sheetsResult = await writeToGoogleSheetsFixed(allTransactions, apiStatusResults, debugLogs, filterDate);
      debugLogs.push('✅ Google Sheets write successful:', sheetsResult);
    } catch (sheetsError) {
      debugLogs.push('❌ Google Sheets write failed:', sheetsError);
      sheetsResult = { 
        success: false, 
        error: sheetsError.message,
        withdrawalsAdded: 0, 
        depositsAdded: 0 
      };
    }

    // ===========================================
    // STEP 6: RETURN FIXED RESULTS
    // ===========================================
    res.status(200).json({
      success: true,
      message: 'FIXED data processing completed',
      transactions: allTransactions.length,
      totalFound: totalTransactionsFound,
      dateFilter: startDate,
      sheetsResult: sheetsResult,
      apiStatus: apiStatusResults,
      deduplicationStats: {
        rawTransactions: allTransactions.length,
        afterDeduplication: sheetsResult.totalAfterDedup || 0,
        afterValueFilter: sheetsResult.totalAfterFilter || 0,
        duplicatesRemoved: sheetsResult.duplicatesRemoved || 0,
        valueFiltered: sheetsResult.filteredOut || 0,
        recycleBinSaved: sheetsResult.recycleBinSaved || 0,
        unknownCurrencies: sheetsResult.unknownCurrencies || [],
        finalAdded: (sheetsResult.withdrawalsAdded || 0) + (sheetsResult.depositsAdded || 0)
      },
      summary: {
        binanceAccounts: Object.keys(apiStatusResults).filter(k => k.includes('Binance')).length,
        blockchainWallets: Object.keys(apiStatusResults).filter(k => k.includes('Wallet')).length,
        activeAPIs: Object.values(apiStatusResults).filter(s => s.status === 'Active').length,
        errorAPIs: Object.values(apiStatusResults).filter(s => s.status === 'Error').length,
        fixedFeatures: 'ByBit V5 + Binance P2P + Extended Currencies + Google Sheets Fix'
      },
      timestamp: new Date().toISOString(),
      debugLogs: debugLogs
    });

  } catch (error) {
    debugLogs.push('❌ Fixed Vercel Error:', error);
    
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString(),
      debugLogs: debugLogs
    });
  }
}

// ===========================================
// FIXED BINANCE API FUNCTIONS
// ===========================================

async function testBinanceAccountFixed(account, filterDate, debugLogs) {
  try {
    const timestamp = Date.now();
    
    // Test with account info first
    const endpoint = "https://api.binance.com/api/v3/account";
    const params = {
      timestamp: timestamp,
      recvWindow: 5000
    };

    const signature = createBinanceSignature(params, account.apiSecret);
    const queryString = createQueryString(params);
    const url = `${endpoint}?${queryString}&signature=${signature}`;

    const response = await fetch(url, {
      method: "GET",
      headers: {
        "X-MBX-APIKEY": account.apiKey,
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
      }
    });

    if (response.status === 451) {
      return {
        success: false,
        transactions: [],
        status: {
          status: 'Error',
          lastSync: new Date().toISOString(),
          autoUpdate: 'Every Hour',
          notes: '❌ Geo-blocked (451)',
          transactionCount: 0
        }
      };
    }

    if (!response.ok) {
      const errorText = await response.text();
      return {
        success: false,
        transactions: [],
        status: {
          status: 'Error',
          lastSync: new Date().toISOString(),
          autoUpdate: 'Every Hour',
          notes: `❌ HTTP ${response.status}: ${errorText.substring(0, 50)}`,
          transactionCount: 0
        }
      };
    }

    const data = await response.json();
    
    if (data.code && data.code !== 200) {
      return {
        success: false,
        transactions: [],
        status: {
          status: 'Error',
          lastSync: new Date().toISOString(),
          autoUpdate: 'Every Hour',
          notes: `❌ API error: ${data.msg}`,
          transactionCount: 0
        }
      };
    }

    // Get transactions with FIXED endpoints
    let transactions = [];
    let transactionBreakdown = {
      deposits: 0,
      withdrawals: 0,
      p2p: 0,
      pay: 0
    };
    
    try {
      // 1. Fetch regular deposits
      const deposits = await fetchBinanceDepositsFixed(account, filterDate);
      transactions.push(...deposits);
      transactionBreakdown.deposits = deposits.length;
      debugLogs.push(`  💰 ${account.name} deposits: ${deposits.length}`);

      // 2. Fetch regular withdrawals
      const withdrawals = await fetchBinanceWithdrawalsFixed(account, filterDate);
      transactions.push(...withdrawals);
      transactionBreakdown.withdrawals = withdrawals.length;
      debugLogs.push(`  📤 ${account.name} withdrawals: ${withdrawals.length}`);

      // 3. FIXED P2P transactions
      const p2pTransactions = await fetchBinanceP2PFixed(account, filterDate);
      transactions.push(...p2pTransactions);
      transactionBreakdown.p2p = p2pTransactions.length;
      debugLogs.push(`  🤝 ${account.name} P2P: ${p2pTransactions.length}`);

      // 4. FIXED Pay transactions
      const payTransactions = await fetchBinancePayFixed(account, filterDate, debugLogs);
      transactions.push(...payTransactions);
      transactionBreakdown.pay = payTransactions.length;
      debugLogs.push(`  💳 ${account.name} Pay: ${payTransactions.length}`);

    } catch (txError) {
      debugLogs.push(`Transaction fetch failed for ${account.name}: ${txError.message}`);
    }

    const statusNotes = `🔧 FIXED: ${transactionBreakdown.deposits}D + ${transactionBreakdown.withdrawals}W + ${transactionBreakdown.p2p}P2P + ${transactionBreakdown.pay}Pay = ${transactions.length} total`;

    return {
      success: true,
      transactions: transactions,
      status: {
        status: 'Active',
        lastSync: new Date().toISOString(),
        autoUpdate: 'Every Hour',
        notes: statusNotes,
        transactionCount: transactions.length
      }
    };

  } catch (error) {
    return {
      success: false,
      transactions: [],
      status: {
        status: 'Error',
        lastSync: new Date().toISOString(),
        autoUpdate: 'Every Hour',
        notes: `❌ ${error.message}`,
        transactionCount: 0
      }
    };
  }
}

async function fetchBinanceDepositsFixed(account, filterDate) {
  try {
    const timestamp = Date.now();
    const endpoint = "https://api.binance.com/sapi/v1/capital/deposit/hisrec";
    const params = {
      timestamp: timestamp,
      recvWindow: 5000,
      limit: 100,
      startTime: filterDate.getTime()
    };

    const signature = createBinanceSignature(params, account.apiSecret);
    const queryString = createQueryString(params);
    const url = `${endpoint}?${queryString}&signature=${signature}`;

    const response = await fetch(url, {
      method: "GET",
      headers: {
        "X-MBX-APIKEY": account.apiKey,
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
      }
    });

    if (!response.ok) {
      throw new Error(`Deposits API error: ${response.status}`);
    }

    const data = await response.json();

    if (data.code && data.code !== 200) {
      throw new Error(`Binance deposits error: ${data.msg}`);
    }

    const deposits = (data || []).filter(deposit => {
      const depositDate = new Date(deposit.insertTime);
      return depositDate >= filterDate;
    });

    return deposits.map(deposit => ({
      platform: account.name,
      type: "deposit",
      asset: deposit.coin,
      amount: deposit.amount.toString(),
      timestamp: new Date(deposit.insertTime).toISOString(),
      from_address: deposit.address || "External",
      to_address: account.name,
      tx_id: deposit.txId || deposit.id,
      status: deposit.status === 1 ? "Completed" : "Pending",
      network: deposit.network,
      api_source: "Binance_Deposit_Fixed"
    }));

  } catch (error) {
    console.error(`Error fetching deposits for ${account.name}:`, error);
    return [];
  }
}

async function fetchBinanceWithdrawalsFixed(account, filterDate) {
  try {
    const timestamp = Date.now();
    const endpoint = "https://api.binance.com/sapi/v1/capital/withdraw/history";
    const params = {
      timestamp: timestamp,
      recvWindow: 5000,
      limit: 100,
      startTime: filterDate.getTime()
    };

    const signature = createBinanceSignature(params, account.apiSecret);
    const queryString = createQueryString(params);
    const url = `${endpoint}?${queryString}&signature=${signature}`;

    const response = await fetch(url, {
      method: "GET",
      headers: {
        "X-MBX-APIKEY": account.apiKey,
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
      }
    });

    if (!response.ok) {
      throw new Error(`Withdrawals API error: ${response.status}`);
    }

    const data = await response.json();

    if (data.code && data.code !== 200) {
      throw new Error(`Binance withdrawals error: ${data.msg}`);
    }

    const withdrawals = (data || []).filter(withdrawal => {
      const withdrawalDate = new Date(withdrawal.applyTime);
      return withdrawalDate >= filterDate;
    });

    return withdrawals.map(withdrawal => ({
      platform: account.name,
      type: "withdrawal",
      asset: withdrawal.coin,
      amount: withdrawal.amount.toString(),
      timestamp: new Date(withdrawal.applyTime).toISOString(),
      from_address: account.name,
      to_address: withdrawal.address || "External",
      tx_id: withdrawal.txId || withdrawal.id,
      status: withdrawal.status === 6 ? "Completed" : "Pending",
      network: withdrawal.network,
      api_source: "Binance_Withdrawal_Fixed"
    }));

  } catch (error) {
    console.error(`Error fetching withdrawals for ${account.name}:`, error);
    return [];
  }
}

// ===========================================
// FIXED BINANCE P2P FUNCTION - OFFICIAL ENDPOINT
// ===========================================

async function fetchBinanceP2PFixed(account, filterDate) {
  const transactions = [];
  try {
    console.log(`    🤝 Fetching P2P transactions for ${account.name} using official endpoint...`);
    const timestamp = Date.now();
    const endpoint = "https://api.binance.com/sapi/v1/c2c/orderMatch/listUserOrderHistory";
    const params = {
      timestamp: timestamp,
      recvWindow: 5000,
      page: 1,
      rows: 100, // Fetch up to 100 records
      startTime: filterDate.getTime()
    };

    const signature = createBinanceSignature(params, account.apiSecret);
    const queryString = createQueryString(params);
    const url = `${endpoint}?${queryString}&signature=${signature}`;

    console.log(`        🔍 P2P Request URL: ${url.split('?')[0]}`);
    const response = await fetch(url, {
      method: "GET",
      headers: { "X-MBX-APIKEY": account.apiKey, "User-Agent": "Mozilla/5.0" }
    });
    
    const responseText = await response.text();
    if (!response.ok) {
      console.error(`        ❌ P2P API Error: ${response.status} - ${responseText}`);
      return [];
    }
    
    const data = JSON.parse(responseText);
    if (data.code !== "000000" || !data.success) {
      console.error(`        ❌ P2P API Logic Error: ${data.message}`);
      return [];
    }

    if (!data.data || data.data.length === 0) {
      console.log(`        ℹ️ P2P: No new transactions found.`);
      return [];
    }

    const orders = data.data.filter(order => order.orderStatus === "COMPLETED");
    console.log(`        📊 P2P Completed Orders: ${orders.length}`);

    return orders.map(order => {
      const isBuy = order.tradeType === 'BUY';
      return {
        platform: account.name,
        type: isBuy ? "deposit" : "withdrawal",
        asset: order.asset,
        amount: order.amount.toString(),
        timestamp: new Date(order.createTime).toISOString(),
        from_address: isBuy ? (order.counterPartNickName || "P2P User") : account.name,
        to_address: isBuy ? account.name : (order.counterPartNickName || "P2P User"),
        tx_id: `P2P_${order.orderNumber}`,
        status: "Completed",
        network: "P2P",
        api_source: "Binance_P2P_Official"
      };
    });

  } catch (error) {
    console.error(`    ❌ P2P fetch failed for ${account.name}:`, error);
  }
  return transactions;
}

// ===========================================
// FIXED BINANCE PAY FUNCTION - OFFICIAL ENDPOINT
// ===========================================

async function fetchBinancePayFixed(account, filterDate, debugLogs) {
  try {
    const log = (msg) => debugLogs.push(msg);
    log(`    💳 Fetching Binance Pay transactions for ${account.name} using official endpoint...`);
    
    const timestamp = Date.now();
    const endpoint = "https://api.binance.com/sapi/v1/pay/transactions";
    const params = {
      timestamp: timestamp,
      recvWindow: 5000,
      limit: 100,
      startTime: filterDate.getTime()
    };

    const signature = createBinanceSignature(params, account.apiSecret);
    const queryString = createQueryString(params);
    const url = `${endpoint}?${queryString}&signature=${signature}`;
    
    log(`        [PAY DEBUG] Request URL: ${url.split('?')[0]}`);
    log(`        [PAY DEBUG] Request Params: ${JSON.stringify(params)}`);

    const response = await fetch(url, {
      method: "GET",
      headers: { "X-MBX-APIKEY": account.apiKey, "User-Agent": "Mozilla/5.0" }
    });

    const responseText = await response.text();
    log(`        [PAY DEBUG] Response Status: ${response.status}`);
    log(`        [PAY DEBUG] Raw Response Body: ${responseText}`);

    if (!response.ok) {
      log(`        ❌ Pay API Error: ${response.status} - ${responseText}`);
      return [];
    }

    const data = JSON.parse(responseText);
    log(`        [PAY DEBUG] Parsed Data: ${JSON.stringify(data, null, 2)}`);

    if (data.code !== "000000" || !data.success) {
      log(`        ❌ Pay API Logic Error: ${data.message}`);
      return [];
    }
    
    if (!data.data || data.data.length === 0) {
        log(`        ℹ️ Pay: No new transactions found.`);
        return [];
    }

    const payTransactions = data.data;
    log(`        [PAY DEBUG] Found ${payTransactions.length} successful transactions.`);

    return payTransactions.map(tx => {
      log(`        [PAY DEBUG] Processing transaction: ${JSON.stringify(tx, null, 2)}`);
      
      // FIXED: Correct logic - check if account is payer (withdrawal) or receiver (deposit)
      const accountUid = tx.uid;
      const payerBinanceId = tx.payerInfo?.binanceId;
      const receiverBinanceId = tx.receiverInfo?.binanceId;
      
      log(`        [PAY DEBUG] Account UID: ${accountUid} (type: ${typeof accountUid})`);
      log(`        [PAY DEBUG] Payer BinanceId: ${payerBinanceId} (type: ${typeof payerBinanceId})`);
      log(`        [PAY DEBUG] Receiver BinanceId: ${receiverBinanceId} (type: ${typeof receiverBinanceId})`);
      
      // Convert to strings for comparison to avoid type mismatches
      const accountUidStr = String(accountUid);
      const payerBinanceIdStr = String(payerBinanceId || '');
      const receiverBinanceIdStr = String(receiverBinanceId || '');
      
      const isPayer = payerBinanceIdStr === accountUidStr;
      const isReceiver = receiverBinanceIdStr === accountUidStr;
      
      log(`        [PAY DEBUG] Is Payer: ${isPayer} ("${payerBinanceIdStr}" === "${accountUidStr}")`);
      log(`        [PAY DEBUG] Is Receiver: ${isReceiver} ("${receiverBinanceIdStr}" === "${accountUidStr}")`);
      
      // Determine transaction type based on account role
      let transactionType;
      if (isPayer && !isReceiver) {
        transactionType = "withdrawal"; // Account is paying out
        log(`        [PAY DEBUG] Classified as WITHDRAWAL (account is payer)`);
      } else if (isReceiver && !isPayer) {
        transactionType = "deposit"; // Account is receiving
        log(`        [PAY DEBUG] Classified as DEPOSIT (account is receiver)`);
      } else {
        // Fallback to amount sign if role is unclear
        transactionType = parseFloat(tx.amount) > 0 ? "deposit" : "withdrawal";
        log(`        [PAY DEBUG] Using fallback logic - amount sign: ${tx.amount} -> ${transactionType}`);
      }
      
      log(`        [PAY DEBUG] Final Type: ${transactionType}`);
      
      // Get counterparty name
      let counterpartyName = "Binance Pay User";
      if (transactionType === "withdrawal") {
        counterpartyName = tx.receiverInfo?.name || "Binance Pay User";
      } else {
        counterpartyName = tx.payerInfo?.name || "Binance Pay User";
      }
      
      return {
        platform: account.name,
        type: transactionType,
        asset: tx.currency,
        amount: Math.abs(parseFloat(tx.amount)).toString(),
        timestamp: new Date(tx.transactionTime).toISOString(),
        from_address: transactionType === "withdrawal" ? account.name : counterpartyName,
        to_address: transactionType === "withdrawal" ? counterpartyName : account.name,
        tx_id: `PAY_${tx.transactionId}`,
        status: "Completed",
        network: "Binance Pay",
        api_source: "Binance_Pay_Official"
      };
    });

  } catch (error) {
    debugLogs.push(`    ❌ CRITICAL Error fetching Binance Pay for ${account.name}: ${error.message}`);
    return [];
  }
}

// ===========================================
// FIXED BYBIT WITH CORRECTED V5 AUTHENTICATION
// ===========================================

async function testByBitAccountFixed(config, filterDate, debugLogs) {
  try {
    console.log(`🔧 Processing ByBit ${config.name} with FIXED V5 authentication...`);
    
    // FIXED: Test connection with correct V5 authentication
    const timestamp = Date.now().toString();
    const recvWindow = "5000";
    const testEndpoint = "https://api.bybit.com/v5/account/wallet-balance";
    
    // FIXED: Correct V5 signature creation
    const queryParams = `accountType=UNIFIED&timestamp=${timestamp}`;
    const signString = timestamp + config.apiKey + recvWindow + queryParams;
    const signature = crypto.createHmac('sha256', config.apiSecret).update(signString).digest('hex');
    
    const testUrl = `${testEndpoint}?${queryParams}`;

    const testResponse = await fetch(testUrl, {
      method: "GET",
      headers: {
        "X-BAPI-API-KEY": config.apiKey,
        "X-BAPI-SIGN": signature,
        "X-BAPI-TIMESTAMP": timestamp,
        "X-BAPI-RECV-WINDOW": recvWindow,
        "Content-Type": "application/json"
      }
    });

    const testData = await testResponse.json();
    
    console.log(`    📊 ByBit Response: ${testResponse.status}, RetCode: ${testData.retCode}`);
    
    if (!testResponse.ok || testData.retCode !== 0) {
      return {
        success: false,
        transactions: [],
        status: {
          status: 'Error',
          lastSync: new Date().toISOString(),
          autoUpdate: 'Every Hour',
          notes: `❌ ByBit V5 auth failed: ${testData.retMsg || testResponse.status}`,
          transactionCount: 0
        }
      };
    }

    console.log(`    ✅ ByBit connection successful, fetching transactions...`);

    // Fetch transactions with FIXED functions
    let transactions = [];
    let transactionBreakdown = {
      deposits: 0,
      withdrawals: 0
    };

    try {
      // FIXED external deposits
      const deposits = await fetchByBitDepositsFixed(config, filterDate);
      transactions.push(...deposits);
      transactionBreakdown.deposits = deposits.length;
      console.log(`  💰 ${config.name} external deposits: ${deposits.length}`);

      // FIXED internal deposits
      const internalDeposits = await fetchByBitInternalDepositsFixed(config, filterDate);
      transactions.push(...internalDeposits);
      transactionBreakdown.internalDeposits = internalDeposits.length;
      console.log(`  🔄 ${config.name} internal deposits: ${internalDeposits.length}`);

      // FIXED withdrawals
      const withdrawals = await fetchByBitWithdrawalsFixed(config, filterDate);
      transactions.push(...withdrawals);
      transactionBreakdown.withdrawals = withdrawals.length;
      console.log(`  📤 ${config.name} withdrawals: ${withdrawals.length}`);

      // FIXED internal transfers
      const internalTransfers = await fetchByBitInternalTransfersFixed(config, filterDate);
      transactions.push(...internalTransfers);
      transactionBreakdown.internalTransfers = internalTransfers.length;
      console.log(`  🔄 ${config.name} internal transfers: ${internalTransfers.length}`);

    } catch (txError) {
      console.log(`ByBit transaction fetch failed: ${txError.message}`);
    }

    const statusNotes = `🔧 FIXED V5: ${transactionBreakdown.deposits}D + ${transactionBreakdown.internalDeposits}ID + ${transactionBreakdown.withdrawals}W + ${transactionBreakdown.internalTransfers}IT = ${transactions.length} total`;

    return {
      success: true,
      transactions: transactions,
      status: {
        status: 'Active',
        lastSync: new Date().toISOString(),
        autoUpdate: 'Every Hour',
        notes: statusNotes,
        transactionCount: transactions.length
      }
    };

  } catch (error) {
    return {
      success: false,
      transactions: [],
      status: {
        status: 'Error',
        lastSync: new Date().toISOString(),
        autoUpdate: 'Every Hour',
        notes: `❌ ByBit FIXED failed: ${error.message}`,
        transactionCount: 0
      }
    };
  }
}

async function fetchByBitDepositsFixed(config, filterDate) {
  try {
    console.log(`    💰 Fetching ByBit deposits for ${config.name} with FIXED signature...`);
    
    const timestamp = Date.now().toString();
    const recvWindow = "5000";
    const endpoint = "https://api.bybit.com/v5/asset/deposit/query-record";
    
    // FIXED: Proper query string construction with all required parameters
    const queryParams = `timestamp=${timestamp}&limit=50&startTime=${filterDate.getTime()}&endTime=${Date.now()}`;
    const signString = timestamp + config.apiKey + recvWindow + queryParams;
    const signature = crypto.createHmac('sha256', config.apiSecret).update(signString).digest('hex');
    
    const url = `${endpoint}?${queryParams}`;

    const response = await fetch(url, {
      method: "GET",
      headers: {
        "X-BAPI-API-KEY": config.apiKey,
        "X-BAPI-SIGN": signature,
        "X-BAPI-TIMESTAMP": timestamp,
        "X-BAPI-RECV-WINDOW": recvWindow,
        "Content-Type": "application/json"
      }
    });

    if (!response.ok) {
      throw new Error(`ByBit deposits API error: ${response.status}`);
    }

    const data = await response.json();
    
    if (data.retCode !== 0) {
      throw new Error(`ByBit deposits error: ${data.retMsg}`);
    }

    if (!data.result || !data.result.rows) {
      console.log(`    ℹ️ No deposit data returned for ${config.name}`);
      return [];
    }

    const deposits = data.result.rows.filter(deposit => {
      const depositDate = new Date(parseInt(deposit.successAt));
      // Status 3 means completed according to ByBit docs
      return depositDate >= filterDate && deposit.status === 3;
    }).map(deposit => ({
      platform: config.name,
      type: "deposit",
      asset: deposit.coin,
      amount: deposit.amount.toString(),
      timestamp: new Date(parseInt(deposit.successAt)).toISOString(),
      from_address: deposit.fromAddress || "External",
      to_address: deposit.toAddress || config.name,
      tx_id: deposit.txID,
      status: "Completed",
      network: deposit.chain,
      api_source: "ByBit_Deposit_V5_Fixed"
    }));

    console.log(`    ✅ ByBit deposits: ${deposits.length} transactions`);
    return deposits;

  } catch (error) {
    console.error(`Error fetching ByBit deposits for ${config.name}:`, error);
    return [];
  }
}

async function fetchByBitWithdrawalsFixed(config, filterDate) {
  try {
    console.log(`    📤 Fetching ByBit withdrawals for ${config.name} with FIXED signature...`);
    
    const timestamp = Date.now().toString();
    const recvWindow = "5000";
    const endpoint = "https://api.bybit.com/v5/asset/withdraw/query-record";
    
    // FIXED: Proper query string construction
    const queryParams = `timestamp=${timestamp}&limit=50&startTime=${filterDate.getTime()}`;
    const signString = timestamp + config.apiKey + recvWindow + queryParams;
    const signature = crypto.createHmac('sha256', config.apiSecret).update(signString).digest('hex');
    
    const url = `${endpoint}?${queryParams}`;

    const response = await fetch(url, {
      method: "GET",
      headers: {
        "X-BAPI-API-KEY": config.apiKey,
        "X-BAPI-SIGN": signature,
        "X-BAPI-TIMESTAMP": timestamp,
        "X-BAPI-RECV-WINDOW": recvWindow,
        "Content-Type": "application/json"
      }
    });

    if (!response.ok) {
      throw new Error(`ByBit withdrawals API error: ${response.status}`);
    }

    const data = await response.json();
    
    if (data.retCode !== 0) {
      throw new Error(`ByBit withdrawals error: ${data.retMsg}`);
    }

    if (!data.result || !data.result.rows) {
      console.log(`    ℹ️ No withdrawal data returned for ${config.name}`);
      return [];
    }

    const withdrawals = data.result.rows.filter(withdrawal => {
      const withdrawalDate = new Date(parseInt(withdrawal.createTime));
      return withdrawalDate >= filterDate && withdrawal.status === "success";
    }).map(withdrawal => ({
      platform: config.name,
      type: "withdrawal", 
      asset: withdrawal.coin,
      amount: withdrawal.amount.toString(),
      timestamp: new Date(parseInt(withdrawal.createTime)).toISOString(),
      from_address: config.name,
      to_address: withdrawal.toAddress || "External",
      tx_id: withdrawal.txID || withdrawal.id,
      status: "Completed",
      network: withdrawal.chain,
      api_source: "ByBit_Withdrawal_V5_Fixed"
    }));

    console.log(`    ✅ ByBit withdrawals: ${withdrawals.length} transactions`);
    return withdrawals;

  } catch (error) {
    console.error(`Error fetching ByBit withdrawals for ${config.name}:`, error);
    return [];
  }
}

async function fetchByBitInternalDepositsFixed(config, filterDate) {
  try {
    console.log(`    🔄 Fetching ByBit internal deposits for ${config.name}...`);
    
    const timestamp = Date.now().toString();
    const recvWindow = "5000";
    const endpoint = "https://api.bybit.com/v5/asset/deposit/query-internal-record";
    
    const queryParams = `timestamp=${timestamp}&limit=50&startTime=${filterDate.getTime()}&endTime=${Date.now()}`;
    const signString = timestamp + config.apiKey + recvWindow + queryParams;
    const signature = crypto.createHmac('sha256', config.apiSecret).update(signString).digest('hex');
    
    const url = `${endpoint}?${queryParams}`;

    console.log(`    🔍 Internal Deposits Debug:`);
    console.log(`    - URL: ${url}`);
    console.log(`    - Start Time: ${new Date(filterDate.getTime()).toISOString()}`);
    console.log(`    - End Time: ${new Date().toISOString()}`);
    console.log(`    - Filter Date: ${filterDate.toISOString()}`);

    const response = await fetch(url, {
      method: "GET",
      headers: {
        "X-BAPI-API-KEY": config.apiKey,
        "X-BAPI-SIGN": signature,
        "X-BAPI-TIMESTAMP": timestamp,
        "X-BAPI-RECV-WINDOW": recvWindow,
        "Content-Type": "application/json"
      }
    });

    console.log(`    📊 Internal Deposits Response Status: ${response.status}`);

    if (!response.ok) {
      const errorText = await response.text();
      console.log(`    ❌ Internal Deposits Error Response: ${errorText}`);
      throw new Error(`ByBit internal deposits API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    
    console.log(`    📊 Internal Deposits API Response:`, JSON.stringify(data, null, 2));
    
    if (data.retCode !== 0) {
      throw new Error(`ByBit internal deposits error: ${data.retMsg}`);
    }

    if (!data.result || !data.result.rows) {
      console.log(`    ℹ️ No internal deposit data returned for ${config.name}`);
      console.log(`    📊 Full response data:`, JSON.stringify(data, null, 2));
      return [];
    }

    console.log(`    📊 Raw internal deposits found: ${data.result.rows.length}`);
    if (data.result.rows.length > 0) {
      console.log(`    📊 Sample internal deposit:`, JSON.stringify(data.result.rows[0], null, 2));
    }

    const internalDeposits = data.result.rows.filter(deposit => {
      const created = parseInt(deposit.createdTime);
      const createdMs = created < 1e12 ? created * 1000 : created; // handle seconds vs ms
      const depositDate = new Date(createdMs);
      const isAfterFilter = depositDate >= filterDate;
      const isCompleted = Number(deposit.status) === 2; // 2 = Success per docs
      
      console.log(`    🔍 Internal Deposit Filter: Date=${depositDate.toISOString()}, After Filter=${isAfterFilter}, Status=${deposit.status}, Completed=${isCompleted}`);
      
      return isAfterFilter && isCompleted;
    }).map(deposit => {
      const created = parseInt(deposit.createdTime);
      const createdMs = created < 1e12 ? created * 1000 : created;
      return {
        platform: config.name,
        type: "deposit",
        asset: deposit.coin,
        amount: deposit.amount.toString(),
        timestamp: new Date(createdMs).toISOString(),
        from_address: deposit.address || "Internal",
        to_address: config.name,
        tx_id: deposit.txID || deposit.id,
        status: "Completed",
        network: "Internal",
        api_source: "ByBit_Internal_Deposit_V5_Fixed"
      };
    });

    console.log(`    ✅ ByBit internal deposits: ${internalDeposits.length} transactions`);
    return internalDeposits;

  } catch (error) {
    console.error(`Error fetching ByBit internal deposits for ${config.name}:`, error);
    return [];
  }
}

async function fetchByBitInternalTransfersFixed(config, filterDate) {
  try {
    console.log(`    🔄 Fetching ByBit internal transfers for ${config.name}...`);
    
    const timestamp = Date.now().toString();
    const recvWindow = "5000";
    const endpoint = "https://api.bybit.com/v5/asset/inter-transfer-list";
    
    const queryParams = `timestamp=${timestamp}&limit=50&startTime=${filterDate.getTime()}&endTime=${Date.now()}`;
    const signString = timestamp + config.apiKey + recvWindow + queryParams;
    const signature = crypto.createHmac('sha256', config.apiSecret).update(signString).digest('hex');
    
    const url = `${endpoint}?${queryParams}`;

    console.log(`    🔍 Internal Transfers Debug:`);
    console.log(`    - URL: ${url}`);
    console.log(`    - Start Time: ${new Date(filterDate.getTime()).toISOString()}`);
    console.log(`    - End Time: ${new Date().toISOString()}`);
    console.log(`    - Filter Date: ${filterDate.toISOString()}`);

    const response = await fetch(url, {
      method: "GET",
      headers: {
        "X-BAPI-API-KEY": config.apiKey,
        "X-BAPI-SIGN": signature,
        "X-BAPI-TIMESTAMP": timestamp,
        "X-BAPI-RECV-WINDOW": recvWindow,
        "Content-Type": "application/json"
      }
    });

    console.log(`    📊 Internal Transfers Response Status: ${response.status}`);

    if (!response.ok) {
      const errorText = await response.text();
      console.log(`    ❌ Internal Transfers Error Response: ${errorText}`);
      throw new Error(`ByBit internal transfers API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    
    console.log(`    📊 Internal Transfers API Response:`, JSON.stringify(data, null, 2));
    
    if (data.retCode !== 0) {
      throw new Error(`ByBit internal transfers error: ${data.retMsg}`);
    }

    if (!data.result || !Array.isArray(data.result.list)) {
      console.log(`    ℹ️ No internal transfer data returned for ${config.name}`);
      console.log(`    📊 Full response data:`, JSON.stringify(data, null, 2));
      return [];
    }

    console.log(`    📊 Raw internal transfers found: ${data.result.list.length}`);
    if (data.result.list.length > 0) {
      console.log(`    📊 Sample internal transfer:`, JSON.stringify(data.result.list[0], null, 2));
    }

    const internalTransfers = data.result.list.filter(transfer => {
      const created = parseInt(transfer.timestamp);
      const createdMs = created < 1e12 ? created * 1000 : created;
      const transferDate = new Date(createdMs);
      const isAfterFilter = transferDate >= filterDate;
      const isSuccess = transfer.status === "SUCCESS";
      
      console.log(`    🔍 Internal Transfer Filter: Date=${transferDate.toISOString()}, After Filter=${isAfterFilter}, Status=${transfer.status}, Success=${isSuccess}`);
      
      return isAfterFilter && isSuccess;
    }).map(transfer => {
      const created = parseInt(transfer.timestamp);
      const createdMs = created < 1e12 ? created * 1000 : created;
      const type = transfer.toAccountType === 'UNIFIED' ? 'deposit' : (transfer.fromAccountType === 'UNIFIED' ? 'withdrawal' : 'deposit');
      return {
        platform: config.name,
        type: type,
        asset: transfer.coin || 'USDT',
        amount: transfer.amount.toString(),
        timestamp: new Date(createdMs).toISOString(),
        from_address: transfer.fromAccountType || 'Internal',
        to_address: transfer.toAccountType || 'Internal',
        tx_id: transfer.transferId || transfer.id || '',
        status: 'Completed',
        network: 'Internal',
        api_source: 'ByBit_Internal_Transfer_V5_Fixed'
      };
    });

    console.log(`    ✅ ByBit internal transfers: ${internalTransfers.length} transactions`);
    return internalTransfers;

  } catch (error) {
    console.error(`Error fetching ByBit internal transfers for ${config.name}:`, error);
    return [];
  }
}

// ===========================================
// BLOCKCHAIN API FUNCTIONS (UNCHANGED)
// ===========================================

async function fetchBitcoinEnhanced(address, filterDate) {
  const transactions = [];
  
  const relaxedDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const actualFilterDate = filterDate < relaxedDate ? relaxedDate : filterDate;
  
  console.log(`  🔍 Bitcoin wallet search: ${address.substring(0, 20)}...`);
  
  const apis = [
    {
      name: "Blockchain.info",
      fetch: () => fetchBitcoinBlockchainInfo(address, actualFilterDate)
    },
    {
      name: "Blockstream",
      fetch: () => fetchBitcoinBlockstream(address, actualFilterDate)
    }
  ];

  for (const api of apis) {
    try {
      console.log(`    🔍 Trying Bitcoin API: ${api.name}`);
      const apiTxs = await api.fetch();
      transactions.push(...apiTxs);
      console.log(`    ✅ ${api.name}: ${apiTxs.length} transactions`);
      
      if (apiTxs.length > 0) break;
      
    } catch (error) {
      console.log(`    ❌ ${api.name} failed: ${error.message}`);
      continue;
    }
  }

  console.log(`  📊 Bitcoin total found: ${transactions.length}`);
  return transactions;
}

async function fetchBitcoinBlockstream(address, filterDate) {
  const endpoint = `https://blockstream.info/api/address/${address}/txs`;
  const response = await fetch(endpoint);
  
  if (!response.ok) {
    throw new Error(`Blockstream HTTP ${response.status}`);
  }
  
  const data = await response.json();
  const transactions = [];
  
  data.slice(0, 20).forEach(tx => {
    const txDate = new Date(tx.status.block_time * 1000);
    if (txDate < filterDate) return;
    
    const isDeposit = tx.vout.some(output => output.scriptpubkey_address === address);
    
    if (isDeposit) {
      const output = tx.vout.find(o => o.scriptpubkey_address === address);
      transactions.push({
        platform: "Bitcoin Wallet",
        type: "deposit",
        asset: "BTC",
        amount: (output.value / 100000000).toString(),
        timestamp: txDate.toISOString(),
        from_address: "External",
        to_address: address,
        tx_id: tx.txid,
        status: "Completed",
        network: "BTC",
        api_source: "Blockstream"
      });
    }
  });
  
  return transactions;
}

async function fetchBitcoinBlockchainInfo(address, filterDate) {
  const endpoint = `https://blockchain.info/rawaddr/${address}?limit=20`;
  const response = await fetch(endpoint);
  
  if (response.status === 429) {
    throw new Error("Rate limited");
  }
  
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  
  const data = await response.json();
  const transactions = [];
  
  data.txs.slice(0, 20).forEach(tx => {
    const txDate = new Date(tx.time * 1000);
    if (txDate < filterDate) return;
    
    const isDeposit = tx.out.some(output => output.addr === address);
    
    if (isDeposit) {
      const output = tx.out.find(o => o.addr === address);
      transactions.push({
        platform: "Bitcoin Wallet",
        type: "deposit",
        asset: "BTC",
        amount: (output.value / 100000000).toString(),
        timestamp: txDate.toISOString(),
        from_address: "External",
        to_address: address,
        tx_id: tx.hash,
        status: "Completed",
        network: "BTC",
        api_source: "Blockchain_Info"
      });
    }
  });
  
  return transactions;
}

async function fetchEthereumEnhanced(address, filterDate, apiKey = null) {
  try {
    // Use provided API key from Settings page
    if (!apiKey) {
      console.log("⚠️ No Etherscan API key provided for Ethereum wallet");
      return [];
    }
    const etherscanApiKey = apiKey;
    const endpoint = `https://api.etherscan.io/api?module=account&action=txlist&address=${address}&startblock=0&endblock=99999999&sort=desc&page=1&offset=100&apikey=${etherscanApiKey}`;
    
    const response = await fetch(endpoint);
    
    if (!response.ok) {
      throw new Error(`Ethereum API error: ${response.status}`);
    }
    
    const data = await response.json();
    
    if (data.status !== "1") {
      console.log("Etherscan API message:", data.message);
      return [];
    }
    
    const transactions = [];
    
    data.result.forEach(tx => {
      const txDate = new Date(parseInt(tx.timeStamp) * 1000);
      if (txDate < filterDate) return;
      
      const isDeposit = tx.to.toLowerCase() === address.toLowerCase();
      const amount = (parseInt(tx.value) / Math.pow(10, 18)).toString();
      
      if (parseFloat(amount) > 0) {
        transactions.push({
          platform: "Ethereum Wallet",
          type: isDeposit ? "deposit" : "withdrawal",
          asset: "ETH",
          amount: amount,
          timestamp: txDate.toISOString(),
          from_address: tx.from,
          to_address: tx.to,
          tx_id: tx.hash,
          status: tx.txreceipt_status === "1" ? "Completed" : "Failed",
          network: "ETH",
          api_source: "Etherscan"
        });
      }
    });
    
    return transactions;
    
  } catch (error) {
    console.error("Ethereum API error:", error);
    throw error;
  }
}

async function fetchTronEnhanced(address, filterDate) {
  try {
    // Fetch native TRX transfers (as before)
    const trxEndpoint = `https://api.trongrid.io/v1/accounts/${address}/transactions?limit=200&order_by=block_timestamp,desc`;
    const trxResponse = await fetch(trxEndpoint);
    if (!trxResponse.ok) {
      throw new Error(`TRON API error: ${trxResponse.status}`);
    }
    const trxData = await trxResponse.json();
    const transactions = [];

    // TRC-20 token contract addresses (add more as needed)
    const trc20Tokens = {
      USDT: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
      USDC: 'TEkxiTehnzSmSe2XqrBj4w32RUN966rdz8',
      // Add more tokens as needed
    };

    // Process TRX transfers
    if (trxData.data) {
      trxData.data.forEach(tx => {
        const txDate = new Date(tx.block_timestamp);
        if (txDate < filterDate) return;
        if (tx.raw_data && tx.raw_data.contract) {
          tx.raw_data.contract.forEach(contract => {
            if (contract.type === "TransferContract") {
              const value = contract.parameter.value;
              const isDeposit = value.to_address && value.to_address.toLowerCase() === address.toLowerCase();
              const amount = (value.amount / 1000000).toString();
              transactions.push({
                platform: "TRON Wallet",
                type: isDeposit ? "deposit" : "withdrawal",
                asset: "TRX",
                amount: amount,
                timestamp: txDate.toISOString(),
                from_address: value.owner_address,
                to_address: value.to_address,
                tx_id: tx.txID,
                status: "Completed",
                network: "TRON",
                api_source: "TronGrid"
              });
            }
          });
        }
      });
    }

    // Fetch TRC-20 token transfers (USDT, etc.)
    const trc20Endpoint = `https://api.trongrid.io/v1/accounts/${address}/transactions/trc20?limit=200&order_by=block_timestamp,desc`;
    const trc20Response = await fetch(trc20Endpoint);
    if (!trc20Response.ok) {
      throw new Error(`TRON TRC-20 API error: ${trc20Response.status}`);
    }
    const trc20Data = await trc20Response.json();
    if (trc20Data.data) {
      trc20Data.data.forEach(tx => {
        const txDate = new Date(tx.block_timestamp);
        if (txDate < filterDate) return;
        // Use token symbol from API response instead of hardcoded mapping
        const tokenName = tx.token_info.symbol || 'UNKNOWN';
        let type = null;
        if (tx.to && tx.to.toLowerCase() === address.toLowerCase()) {
          type = 'deposit';
        } else if (tx.from && tx.from.toLowerCase() === address.toLowerCase()) {
          type = 'withdrawal';
        } else {
          // Not relevant to this wallet, skip
          return;
        }
        // USDT and most TRC-20 tokens have 6 decimals
        const decimals = tx.token_info.decimals || 6;
        const amount = (parseFloat(tx.value) / Math.pow(10, decimals)).toString();
        // Log the raw and calculated values for diagnostics
        console.log(`[TRC20 LOG] TX: ${tx.transaction_id}, Symbol: ${tx.token_info.symbol}, Decimals: ${decimals}, Raw Value: ${tx.value}, Amount: ${amount}, Type: ${type}`);
        transactions.push({
          platform: "TRON Wallet",
          type: type,
          asset: tokenName,
          amount: amount,
          timestamp: txDate.toISOString(),
          from_address: tx.from,
          to_address: tx.to,
          tx_id: tx.transaction_id,
          status: "Completed",
          network: "TRON",
          api_source: "TronGrid-TRC20"
        });
      });
    }

    // Log all transactions before returning
    console.log(`[TRON LOG] Total transactions to return: ${transactions.length}`);
    
    // Log currency breakdown
    const currencyBreakdown = {};
    transactions.forEach(t => {
      currencyBreakdown[t.asset] = (currencyBreakdown[t.asset] || 0) + 1;
    });
    console.log(`[TRON LOG] Currency breakdown:`, currencyBreakdown);
    
    transactions.forEach((t, i) => {
      console.log(`[TRON TX ${i + 1}] ${JSON.stringify(t)}`);
    });

    return transactions;
  } catch (error) {
    console.error("TRON API error:", error);
    throw error;
  }
}

async function fetchSolanaEnhanced(address, filterDate) {
  try {
    const endpoint = "https://api.mainnet-beta.solana.com";
    
    const payload = {
      jsonrpc: "2.0",
      id: 1,
      method: "getSignaturesForAddress",
      params: [address, { limit: 20 }]
    };
    
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    
    if (!response.ok) {
      throw new Error(`Solana API error: ${response.status}`);
    }
    
    const data = await response.json();
    
    if (data.error) {
      throw new Error(`Solana RPC error: ${data.error.message}`);
    }
    
    const transactions = data.result.filter(sig => {
      const txDate = new Date(sig.blockTime * 1000);
      return txDate >= filterDate;
    }).map(sig => ({
      platform: "Solana Wallet",
      type: "deposit",
      asset: "SOL",
      amount: "0.001",
      timestamp: new Date(sig.blockTime * 1000).toISOString(),
      from_address: "External",
      to_address: address,
      tx_id: sig.signature,
      status: sig.err ? "Failed" : "Completed",
      network: "SOL",
      api_source: "Solana_RPC"
    }));
    
    return transactions;
    
  } catch (error) {
    console.error("Solana API error:", error);
    throw error;
  }
}

// ===========================================
// FIXED FILTERING WITH EXTENDED CURRENCIES
// ===========================================

async function getExistingTransactionIds(sheets, spreadsheetId) {
  const existingTxIds = new Set();
  
  try {
    console.log('🔍 Reading existing transaction IDs for deduplication...');
    
    try {
      const withdrawalsRange = 'Withdrawals!F7:L1000'; // FIXED: F:L range
      const withdrawalsResponse = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: withdrawalsRange,
      });
      
      const withdrawalsData = withdrawalsResponse.data.values || [];
      withdrawalsData.forEach(row => {
        if (row[6]) { // FIXED: Column L is index 6 in F:L range (F=0, G=1, H=2, I=3, J=4, K=5, L=6)
          existingTxIds.add(row[6].toString().trim());
        }
      });
      console.log(`📤 Found ${withdrawalsData.length} existing withdrawals`);
    } catch (error) {
      console.log('⚠️ Could not read withdrawals sheet (might be empty)');
    }
    
    try {
      const depositsRange = 'Deposits!F7:L1000'; // FIXED: F:L range
      const depositsResponse = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: depositsRange,
      });
      
      const depositsData = depositsResponse.data.values || [];
      depositsData.forEach(row => {
        if (row[6]) { // FIXED: Column L is index 6 in F:L range
          existingTxIds.add(row[6].toString().trim());
        }
      });
      console.log(`📥 Found ${depositsData.length} existing deposits`);
    } catch (error) {
      console.log('⚠️ Could not read deposits sheet (might be empty)');
    }
    
    console.log(`🎯 Total unique TX IDs found: ${existingTxIds.size}`);
    return existingTxIds;
    
  } catch (error) {
    console.error('❌ Error reading existing transactions:', error);
    return new Set();
  }
}

function removeDuplicateTransactions(transactions, existingWithdrawalIds, existingDepositIds) {
  let duplicateCount = 0;
  let totalCount = transactions.length;
  
  const newTransactions = transactions.filter(tx => {
    const txId = tx.tx_id?.toString().trim();
    
    if (!txId) {
      return true;
    }
    
    const isDuplicate = existingWithdrawalIds.has(txId) || existingDepositIds.has(txId);
    if (isDuplicate) {
      duplicateCount++;
    }
    
    return !isDuplicate;
  });
  
  console.log(`🔄 Duplicate Filter: ${totalCount} → ${newTransactions.length} transactions (removed ${duplicateCount} duplicates)`);
  
  return newTransactions;
}

// FIXED: Extended currency list with 20+ currencies
function filterTransactionsByValueFixed(transactions) {
  const pricesAED = {
    'BTC': 220200,
    'ETH': 11010,
    'USDT': 3.67,
    'USDC': 3.67,
    'SOL': 181.50,
    'TRX': 0.37,
    'BNB': 2200,
    'SEI': 1.47,
    'BUSD': 3.67,
    'ADA': 1.47,  // FIXED: Added
    'DOT': 18.50, // FIXED: Added
    'MATIC': 1.84, // FIXED: Added
    'LINK': 44.10, // FIXED: Added
    'UNI': 25.75, // FIXED: Added
    'LTC': 257.25, // FIXED: Added
    'XRP': 2.20, // FIXED: Added
    'AVAX': 117.00, // FIXED: Added
    'ATOM': 29.50, // FIXED: Added
    'NEAR': 22.00, // FIXED: Added
    'FTM': 2.94, // FIXED: Added
    'ALGO': 1.10, // FIXED: Added
    'VET': 0.11, // FIXED: Added
    'ICP': 36.75, // FIXED: Added
    'SAND': 1.84, // FIXED: Added
    'MANA': 1.47, // FIXED: Added
    'CRO': 0.44, // FIXED: Added
    'SHIB': 0.00009, // FIXED: Added
    'DOGE': 0.26, // FIXED: Added
    'BCH': 1468.00, // FIXED: Added
    'ETC': 92.40 // FIXED: Added
  };

  const minValueAED = 1.0;
  let filteredCount = 0;
  let totalCount = transactions.length;
  const filteredTransactions = [];
  const unknownCurrencies = new Set();

  const keepTransactions = transactions.filter(tx => {
    const amount = parseFloat(tx.amount) || 0;
    let priceAED = pricesAED[tx.asset];
    
    // FIXED: Use 1 AED default for unknown currencies
    if (!priceAED) {
      priceAED = 1.0;
      unknownCurrencies.add(tx.asset);
      console.log(`⚠️ Unknown currency ${tx.asset} - using 1 AED default`);
    }
    
    const aedValue = amount * priceAED;
    const keepTransaction = aedValue >= minValueAED;
    
    if (!keepTransaction) {
      filteredCount++;
      filteredTransactions.push({
        ...tx,
        calculated_aed_value: aedValue,
        used_default_rate: !pricesAED[tx.asset],
        filter_reason: `Value ${aedValue.toFixed(2)} AED < ${minValueAED} AED minimum`
      });
      // Log filtered out transaction details
      console.log(`[FILTERED OUT] TX: ${tx.tx_id}, Asset: ${tx.asset}, Amount: ${amount}, AED: ${aedValue}, Reason: Value < ${minValueAED} AED`);
    }
    
    return keepTransaction;
  });

  console.log(`💰 Value Filter: ${totalCount} → ${keepTransactions.length} transactions (removed ${filteredCount} < ${minValueAED} AED)`);
  if (unknownCurrencies.size > 0) {
    console.log(`⚠️ Unknown currencies using 1 AED default: ${Array.from(unknownCurrencies).join(', ')}`);
  }
  
  return {
    transactions: keepTransactions,
    filteredOut: filteredTransactions,
    unknownCurrencies: Array.from(unknownCurrencies)
  };
}

function sortTransactionsByTimestamp(transactions) {
  console.log(`⏰ Sorting ${transactions.length} NEW transactions by timestamp (ascending)...`);
  
  const sorted = [...transactions].sort((a, b) => {
    const dateA = new Date(a.timestamp);
    const dateB = new Date(b.timestamp);
    return dateA - dateB;
  });
  
  if (sorted.length > 0) {
    const oldestDate = new Date(sorted[0].timestamp).toISOString().slice(0, 16);
    const newestDate = new Date(sorted[sorted.length - 1].timestamp).toISOString().slice(0, 16);
    console.log(`📅 Date range: ${oldestDate} → ${newestDate} (${sorted.length} transactions)`);
  }
  
  return sorted;
}

async function saveToRecycleBin(sheets, spreadsheetId, filteredTransactions) {
  if (filteredTransactions.length === 0) {
    console.log('📁 No transactions to save to RecycleBin');
    return 0;
  }

  try {
    console.log(`📁 Saving ${filteredTransactions.length} filtered transactions to RecycleBin...`);
    
    // Check if RecycleBin sheet exists
    try {
      const sheetMetadata = await sheets.spreadsheets.get({
        spreadsheetId: spreadsheetId
      });
      
      const recycleBinExists = sheetMetadata.data.sheets.some(
        sheet => sheet.properties.title === 'RecycleBin'
      );
      
      if (!recycleBinExists) {
        console.log('📁 Creating RecycleBin sheet...');
        await sheets.spreadsheets.batchUpdate({
          spreadsheetId: spreadsheetId,
          requestBody: {
            requests: [{
              addSheet: {
                properties: {
                  title: 'RecycleBin'
                }
              }
            }]
          }
        });
        
        // Add headers
        await sheets.spreadsheets.values.update({
          spreadsheetId,
          range: 'RecycleBin!A1:M1',
          valueInputOption: 'RAW',
          requestBody: {
            values: [[
              'Date & Time', 'Platform', 'Type', 'Asset', 'Amount', 
              'Calculated AED', 'Used Default Rate', 'Filter Reason',
              'From Address', 'To Address', 'TX ID', 'Status', 'Network'
            ]]
          }
        });
      }
    } catch (error) {
      console.error('❌ Error checking/creating RecycleBin sheet:', error);
      return 0;
    }

    // Get existing RecycleBin data to avoid duplicates
    let existingTxIds = new Set();
    try {
      const existingData = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: 'RecycleBin!A2:M1000'
      });
      
      if (existingData.data.values) {
        existingData.data.values.forEach(row => {
          if (row[10]) {
            existingTxIds.add(row[10].toString().trim());
          }
        });
      }
    } catch (error) {
      console.log('⚠️ Could not read existing RecycleBin data (might be empty)');
    }

    // Filter out duplicates
    const newFilteredTransactions = filteredTransactions.filter(tx => {
      const txId = tx.tx_id?.toString().trim();
      return txId && !existingTxIds.has(txId);
    });

    if (newFilteredTransactions.length === 0) {
      console.log('📁 All filtered transactions already exist in RecycleBin');
      return 0;
    }

    // Prepare rows for RecycleBin
    const recycleBinRows = newFilteredTransactions.map(tx => [
      formatDateTimeSimple(tx.timestamp),
      tx.platform,
      tx.type,
      tx.asset,
      parseFloat(tx.amount).toFixed(8),
      tx.calculated_aed_value?.toFixed(2) || '0.00',
      tx.used_default_rate ? 'YES' : 'NO',
      tx.filter_reason || 'Unknown',
      tx.from_address || '',
      tx.to_address || '',
      tx.tx_id || '',
      tx.status || 'Unknown',
      tx.network || ''
    ]);

    // Append to RecycleBin
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: 'RecycleBin!A:M',
      valueInputOption: 'RAW',
      requestBody: { values: recycleBinRows }
    });

    console.log(`✅ Saved ${newFilteredTransactions.length} new transactions to RecycleBin`);
    return newFilteredTransactions.length;

  } catch (error) {
    console.error('❌ Error saving to RecycleBin:', error);
    return 0;
  }
}

// ===========================================
// FIXED GOOGLE SHEETS FUNCTIONS
// ===========================================

async function writeToGoogleSheetsFixed(transactions, apiStatus, debugLogs, filterDate) {
  try {
    console.log('🔑 Setting up Google Sheets authentication...');
    
    // Read Google credentials from the sheet
    const spreadsheetId = "1sx3ik8I-2_VcD3X1q6M4kOuo3hfkGbMa1JulPSWID9Y";
    
    // Use environment variables for Google authentication
    // The private key should be set in Vercel environment variables
    const googleCredentials = {
      type: "service_account",
      project_id: process.env.GOOGLE_PROJECT_ID || "zaidcryptowallets",
      private_key_id: process.env.GOOGLE_PRIVATE_KEY_ID || "28d0fa5468a57eed6c7654bd077d87843ad0ceaf",
      client_email: process.env.GOOGLE_CLIENT_EMAIL || "crypto-tracker-service@zaidcryptowallets.iam.gserviceaccount.com",
      client_id: process.env.GOOGLE_CLIENT_ID || "101295956426147651033",
      private_key: process.env.GOOGLE_PRIVATE_KEY
    };
    
    if (!process.env.GOOGLE_PRIVATE_KEY) {
      console.log('❌ GOOGLE_PRIVATE_KEY environment variable not set');
      return {
        success: false,
        withdrawalsAdded: 0,
        depositsAdded: 0,
        statusUpdated: false,
        totalRaw: transactions.length,
        totalAfterDedup: transactions.length,
        totalAfterFilter: transactions.length,
        duplicatesRemoved: 0,
        filteredOut: 0,
        recycleBinSaved: 0,
        unknownCurrencies: [],
        note: "❌ GOOGLE_PRIVATE_KEY environment variable not set in Vercel"
      };
    }
    
    if (!googleCredentials) {
      console.log('❌ No Google credentials found, skipping Google Sheets write');
      return {
        success: false,
        withdrawalsAdded: 0,
        depositsAdded: 0,
        statusUpdated: false,
        totalRaw: transactions.length,
        totalAfterDedup: transactions.length,
        totalAfterFilter: transactions.length,
        duplicatesRemoved: 0,
        filteredOut: 0,
        recycleBinSaved: 0,
        unknownCurrencies: [],
        note: "❌ No Google credentials found - cannot write to sheets"
      };
    }
    
    // Set up Google Sheets API
    const auth = new GoogleAuth({
      credentials: googleCredentials,
      scopes: ['https://www.googleapis.com/auth/spreadsheets']
    });
    
    console.log('🔑 Google Auth created, getting client...');
    const authClient = await auth.getClient();
    console.log('✅ Google Auth client obtained');
    
    const sheets = google.sheets({ version: 'v4', auth: authClient });
    
    console.log('✅ Google Sheets API initialized');
    
    // Get existing transaction IDs to avoid duplicates
    const existingWithdrawalIds = await getExistingTransactionIds(sheets, spreadsheetId);
    const existingDepositIds = await getExistingTransactionIds(sheets, spreadsheetId);
    
    console.log(`📊 Found ${existingWithdrawalIds.size} existing withdrawal IDs`);
    console.log(`📊 Found ${existingDepositIds.size} existing deposit IDs`);
    
    // Remove duplicates
    const deduplicatedTransactions = removeDuplicateTransactions(transactions, existingWithdrawalIds, existingDepositIds);
    console.log(`🔧 Deduplication: ${transactions.length} → ${deduplicatedTransactions.length} transactions`);
    
    // Filter transactions by value
    const filteredResult = filterTransactionsByValueFixed(deduplicatedTransactions);
    const validTransactions = filteredResult.transactions;
    const filteredOut = filteredResult.filteredOut;
    
    console.log(`💰 Value filtering: ${deduplicatedTransactions.length} → ${validTransactions.length} transactions`);
    
    // Sort transactions by timestamp
    const sortedTransactions = sortTransactionsByTimestamp(validTransactions);
    
    // Separate withdrawals and deposits
    const withdrawals = sortedTransactions.filter(tx => tx.type === 'withdrawal');
    const deposits = sortedTransactions.filter(tx => tx.type === 'deposit');
    
    console.log(`📊 Separated: ${withdrawals.length} withdrawals, ${deposits.length} deposits`);
    console.log(`🔍 Transaction types found:`, [...new Set(sortedTransactions.map(tx => tx.type))]);
    
    // Debug: Show sample transactions of each type
    if (withdrawals.length > 0) {
      console.log(`📤 Sample withdrawal:`, {
        type: withdrawals[0].type,
        platform: withdrawals[0].platform,
        asset: withdrawals[0].asset,
        amount: withdrawals[0].amount,
        timestamp: withdrawals[0].timestamp
      });
    }
    
    if (deposits.length > 0) {
      console.log(`💰 Sample deposit:`, {
        type: deposits[0].type,
        platform: deposits[0].platform,
        asset: deposits[0].asset,
        amount: deposits[0].amount,
        timestamp: deposits[0].timestamp
      });
    }
    
    // Write to Google Sheets
    let withdrawalsAdded = 0;
    let depositsAdded = 0;
    
    if (withdrawals.length > 0) {
      console.log(`📤 Writing ${withdrawals.length} withdrawals to sheet...`);
      console.log(`📤 Sample withdrawal:`, withdrawals[0]);
      
      // Find the last row with data in column F
      const withdrawalsSheet = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: 'Withdrawals!F:F'
      });
      const lastRow = withdrawalsSheet.data.values ? withdrawalsSheet.data.values.length : 6;
      const startRow = lastRow + 1;
      
      console.log(`📤 Last row in Withdrawals column F: ${lastRow}, starting at row: ${startRow}`);
      
      // Only prepare F-L data (columns 5-11 in array)
      const withdrawalRows = withdrawals.map(tx => [
        tx.platform || '', // Column F - PLATFORM
        tx.asset || '', // Column G - ASSET
        tx.amount || '', // Column H - AMOUNT
        formatDateTimeSimple(tx.timestamp) || '', // Column I - TIMESTAMP (formatted)
        tx.from_address || '', // Column J - FROM ADDRESS
        tx.to_address || '', // Column K - TO ADDRESS
        tx.tx_id || '' // Column L - TX ID
      ]);
      
      console.log(`📤 First withdrawal row:`, withdrawalRows[0]);
      console.log(`📤 Total withdrawal rows to write:`, withdrawalRows.length);
      
      try {
        console.log(`📤 Attempting to write to Withdrawals!F${startRow}:L${startRow + withdrawalRows.length - 1}...`);
        const withdrawalResult = await sheets.spreadsheets.values.update({
          spreadsheetId,
          range: `Withdrawals!F${startRow}:L${startRow + withdrawalRows.length - 1}`,
          valueInputOption: 'RAW',
          requestBody: { 
            values: withdrawalRows
          }
        });
        
        console.log(`📤 Withdrawal write result:`, withdrawalResult);
        console.log(`📤 Withdrawal write successful:`, withdrawalResult.data);
        
        withdrawalsAdded = withdrawals.length;
        console.log(`✅ Added ${withdrawalsAdded} withdrawals to sheet`);
      } catch (error) {
        console.error(`❌ Error writing withdrawals:`, error);
        console.error(`❌ Error details:`, error.message);
        withdrawalsAdded = 0;
      }
    } else {
      console.log(`ℹ️ No withdrawals to write (${withdrawals.length} withdrawals found)`);
    }
    
    if (deposits.length > 0) {
      console.log(`📝 Writing ${deposits.length} deposits to sheet...`);
      console.log(`📝 Sample deposit:`, deposits[0]);
      
      // Find the last row with data in column F
      const depositsSheet = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: 'Deposits!F:F'
      });
      const lastRow = depositsSheet.data.values ? depositsSheet.data.values.length : 6;
      const startRow = lastRow + 1;
      
      console.log(`📝 Last row in Deposits column F: ${lastRow}, starting at row: ${startRow}`);
      
      // Only prepare F-L data (columns 5-11 in array)
      const depositRows = deposits.map(tx => [
        tx.platform || '', // Column F - PLATFORM
        tx.asset || '', // Column G - ASSET
        tx.amount || '', // Column H - AMOUNT
        formatDateTimeSimple(tx.timestamp) || '', // Column I - TIMESTAMP (formatted)
        tx.from_address || '', // Column J - FROM ADDRESS
        tx.to_address || '', // Column K - TO ADDRESS
        tx.tx_id || '' // Column L - TX ID
      ]);
      
      console.log(`📝 First deposit row:`, depositRows[0]);
      console.log(`📝 Total deposit rows to write:`, depositRows.length);
      
      try {
        console.log(`📝 Attempting to write to Deposits!F${startRow}:L${startRow + depositRows.length - 1}...`);
        const depositResult = await sheets.spreadsheets.values.update({
          spreadsheetId,
          range: `Deposits!F${startRow}:L${startRow + depositRows.length - 1}`,
          valueInputOption: 'RAW',
          requestBody: { 
            values: depositRows
          }
        });
        
        console.log(`📝 Deposit write result:`, depositResult);
        console.log(`📝 Deposit write successful:`, depositResult.data);
        
        depositsAdded = deposits.length;
        console.log(`✅ Added ${depositsAdded} deposits to sheet`);
      } catch (error) {
        console.error(`❌ Error writing deposits:`, error);
        console.error(`❌ Error details:`, error.message);
        depositsAdded = 0;
      }
    } else {
      console.log(`ℹ️ No deposits to write (${deposits.length} deposits found)`);
    }
    
    // Save filtered transactions to recycle bin
    let recycleBinSaved = 0;
    if (filteredOut.length > 0) {
      recycleBinSaved = await saveToRecycleBin(sheets, spreadsheetId, filteredOut);
    }
    
    // Update API status in Settings sheet
    const statusUpdated = await updateSettingsStatus(sheets, spreadsheetId, apiStatus);
    
    console.log(`✅ Google Sheets write completed: ${withdrawalsAdded} withdrawals, ${depositsAdded} deposits`);
    
    return {
      success: true,
      withdrawalsAdded,
      depositsAdded,
      statusUpdated,
      totalRaw: transactions.length,
      totalAfterDedup: deduplicatedTransactions.length,
      totalAfterFilter: validTransactions.length,
      duplicatesRemoved: transactions.length - deduplicatedTransactions.length,
      filteredOut: filteredOut.length,
      recycleBinSaved,
      unknownCurrencies: filteredResult.unknownCurrencies,
      note: "✅ Transactions successfully written to Google Sheets"
    };

  } catch (error) {
    console.error('❌ Error in writeToGoogleSheets:', error);
    return {
      success: false,
      withdrawalsAdded: 0,
      depositsAdded: 0,
      statusUpdated: false,
      totalRaw: transactions.length,
      totalAfterDedup: transactions.length,
      totalAfterFilter: 0,
      duplicatesRemoved: 0,
      filteredOut: 0,
      recycleBinSaved: 0,
      unknownCurrencies: [],
      note: `❌ Google Sheets write failed: ${error.message}`
    };
  }
}

async function updateSettingsStatusOnly(apiStatus) {
  // This function is no longer needed since we handle everything in writeToGoogleSheetsFixed
  console.log('updateSettingsStatusOnly called - this should not happen');
  return { success: false, error: 'Function deprecated' };
}

async function updateSettingsStatus(sheets, spreadsheetId, apiStatus) {
  try {
    console.log('📊 Updating Settings status table...');
    
    const statusRows = [];
    
    Object.entries(apiStatus).forEach(([platform, status]) => {
      statusRows.push([
        platform,
        status.status,
        formatDateTimeSimple(status.lastSync),
        status.autoUpdate,
        status.notes
      ]);
    });

    if (statusRows.length > 0) {
      await sheets.spreadsheets.values.clear({
        spreadsheetId,
        range: 'SETTINGS!A3:E20'
      });

      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: 'SETTINGS!A2:E2',
        valueInputOption: 'RAW',
        requestBody: {
          values: [['Platform', 'API Status', 'Last Sync', 'Auto-Update', 'Notes']]
        }
      });

      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `SETTINGS!A3:E${2 + statusRows.length}`,
        valueInputOption: 'RAW',
        requestBody: {
          values: statusRows
        }
      });

      console.log(`✅ Updated ${statusRows.length} API statuses in Settings`);
    }

  } catch (error) {
    console.error('❌ Error updating Settings status:', error);
    throw error;
  }
}

// ===========================================
// UTILITY FUNCTIONS
// ===========================================

function createBinanceSignature(params, secret) {
  const queryString = createQueryString(params);
  return crypto.createHmac('sha256', secret).update(queryString).digest('hex');
}

function createQueryString(params) {
  return Object.keys(params)
    .sort()
    .map(key => `${encodeURIComponent(key)}=${encodeURIComponent(params[key])}`)
    .join('&');
}

function formatDateTimeSimple(isoString) {
  const date = new Date(isoString);
  return date.toISOString().slice(0, 16).replace('T', ' ');
}

// ===========================================
// SETTINGS SHEET READER FUNCTIONS
// ===========================================

async function readApiCredentialsFromSheet(sheets, spreadsheetId) {
  try {
    console.log('🔑 Reading API credentials from Settings sheet...');
    
    // Read API Keys table (K2:M7)
    const apiKeysRange = 'SETTINGS!K2:M7';
    const apiKeysResponse = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: apiKeysRange,
    });
    
    const apiKeysData = apiKeysResponse.data.values || [];
    const credentials = {};
    
    // Skip header row (row 2), process data rows (3-7)
    for (let i = 1; i < apiKeysData.length; i++) {
      const row = apiKeysData[i];
      if (row && row.length >= 3) {
        const platform = row[0]; // Column K
        const apiKey = row[1];   // Column L
        const apiSecret = row[2]; // Column M
        
        if (platform && apiKey && apiSecret) {
          credentials[platform] = {
            apiKey: apiKey,
            apiSecret: apiSecret
          };
          console.log(`✅ Loaded credentials for ${platform}`);
        }
      }
    }
    
    console.log(`📊 Loaded ${Object.keys(credentials).length} API credential sets`);
    return credentials;
    
  } catch (error) {
    console.error('❌ Error reading API credentials from sheet:', error);
    return {};
  }
}

async function readGoogleCredentialsFromSheet(sheets, spreadsheetId) {
  try {
    console.log('🔑 Reading Google credentials from Settings sheet...');
    
    // Read Google Data table (P2:Q9)
    const googleDataRange = 'SETTINGS!P2:Q9';
    const googleDataResponse = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: googleDataRange,
    });
    
    const googleData = googleDataResponse.data.values || [];
    const credentials = {};
    
    // Skip header row (row 2), process data rows (3-9)
    for (let i = 1; i < googleData.length; i++) {
      const row = googleData[i];
      if (row && row.length >= 2) {
        const key = row[0];   // Column P
        const value = row[1]; // Column Q
        
        if (key && value) {
          credentials[key] = value;
          console.log(`✅ Loaded Google credential: ${key}`);
        }
      }
    }
    
    console.log(`📊 Loaded ${Object.keys(credentials).length} Google credential fields`);
    return credentials;
    
  } catch (error) {
    console.error('❌ Error reading Google credentials from sheet:', error);
    return {};
  }
}

// ===========================================
// BITGET API FUNCTIONS
// ===========================================

async function testBitgetAccountFixed(config, filterDate, debugLogs) {
  try {
    console.log(`🔧 Processing Bitget ${config.name} with authentication...`);
    
    // Test connection with Bitget authentication
    const timestamp = Date.now().toString();
    const testEndpoint = "https://api.bitget.com/api/spot/v1/account/assets";
    
    // Bitget signature creation - FIXED according to official documentation
    const method = 'GET';
    const requestPath = '/api/spot/v1/account/assets';
    const body = ''; // Empty body for GET request
    
    // Create signature string: timestamp + method + requestPath + body
    const signString = timestamp + method + requestPath + body;
    const signature = crypto.createHmac('sha256', config.apiSecret).update(signString).digest('base64');
    
    // Debug signature creation
    console.log(`    🔍 Signature Debug:`);
    console.log(`    - Sign String: "${signString}"`);
    console.log(`    - Secret Length: ${config.apiSecret.length}`);
    console.log(`    - Signature Length: ${signature.length}`);
    console.log(`    - Signature (first 20 chars): ${signature.substring(0, 20)}`);
    
    console.log(`    🔍 Bitget Auth Debug:`);
    console.log(`    - API Key: ${config.apiKey.substring(0, 10)}...`);
    console.log(`    - Secret: ${config.apiSecret.substring(0, 10)}...`);
    console.log(`    - Timestamp: ${timestamp}`);
    console.log(`    - Sign String: ${signString}`);
    console.log(`    - Signature: ${signature.substring(0, 20)}...`);
    console.log(`    - Full API Key: ${config.apiKey}`);
    console.log(`    - Full Secret: ${config.apiSecret}`);
    console.log(`    - Passphrase: ${config.passphrase || 'NOT PROVIDED'}`);
    console.log(`    - API Key Length: ${config.apiKey.length}`);
    console.log(`    - API Key Format Check: ${config.apiKey.startsWith('bg_') ? 'Has bg_ prefix' : 'No bg_ prefix'}`);
    
    // Try different API key formats
    const apiKeyOriginal = config.apiKey;
    const apiKeyWithoutPrefix = config.apiKey.startsWith('bg_') ? config.apiKey.substring(3) : config.apiKey;
    const apiKeyWithPrefix = config.apiKey.startsWith('bg_') ? config.apiKey : `bg_${config.apiKey}`;
    
    console.log(`    - Original API Key: ${apiKeyOriginal}`);
    console.log(`    - API Key without prefix: ${apiKeyWithoutPrefix}`);
    console.log(`    - API Key with prefix: ${apiKeyWithPrefix}`);
    
    console.log(`    🔍 Request Debug:`);
    console.log(`    - URL: ${testEndpoint} (V1 API)`);
    console.log(`    - Method: GET`);
    console.log(`    - Headers:`);
    console.log(`      ACCESS-KEY: ${apiKeyOriginal}`);
    console.log(`      ACCESS-SIGN: ${signature.substring(0, 20)}...`);
    console.log(`      ACCESS-TIMESTAMP: ${timestamp}`);
    console.log(`      ACCESS-PASSPHRASE: ${config.passphrase || 'NOT PROVIDED'}`);
    
    // Try with original API key first
    let testResponse = await fetch(testEndpoint, {
      method: "GET",
      headers: {
        "ACCESS-KEY": apiKeyOriginal,
        "ACCESS-SIGN": signature,
        "ACCESS-TIMESTAMP": timestamp,
        "Content-Type": "application/json",
        "ACCESS-PASSPHRASE": config.passphrase || ""  // Use passphrase from credentials
      }
    });
    
    let testData = await testResponse.json();
    console.log(`    📊 First attempt - Response: ${testResponse.status}, Code: ${testData.code}, Message: ${testData.msg || 'N/A'}`);
    
    // If first attempt fails, try with different API key format
    if (!testResponse.ok || testData.code !== '00000') {
      console.log(`    🔄 Trying alternative API key format...`);
      
      testResponse = await fetch(testEndpoint, {
        method: "GET",
        headers: {
          "ACCESS-KEY": apiKeyWithoutPrefix,
          "ACCESS-SIGN": signature,
          "ACCESS-TIMESTAMP": timestamp,
          "Content-Type": "application/json",
          "ACCESS-PASSPHRASE": config.passphrase || ""
        }
      });
      
      testData = await testResponse.json();
      console.log(`    📊 Second attempt - Response: ${testResponse.status}, Code: ${testData.code}, Message: ${testData.msg || 'N/A'}`);
    }
    
    console.log(`    📊 Bitget Response: ${testResponse.status}, Code: ${testData.code}, Message: ${testData.msg || 'N/A'}`);
    console.log(`    📊 Full Response:`, JSON.stringify(testData, null, 2));
    
    if (!testResponse.ok || testData.code !== '00000') {
      console.log(`    ❌ Bitget Authentication Failed:`);
      console.log(`    - Status: ${testResponse.status}`);
      console.log(`    - Code: ${testData.code}`);
      console.log(`    - Message: ${testData.msg || 'N/A'}`);
      console.log(`    - API Key Used: ${apiKeyOriginal}`);
      console.log(`    - Passphrase Used: ${config.passphrase || 'NOT PROVIDED'}`);
      
      return {
        success: false,
        transactions: [],
        status: {
          status: 'Error',
          lastSync: new Date().toISOString(),
          autoUpdate: 'Every Hour',
          notes: `❌ Bitget auth failed: ${testData.msg || testResponse.status}`,
          transactionCount: 0
        }
      };
    }

    console.log(`    ✅ Bitget connection successful, fetching transactions...`);

    // Fetch transactions
    let transactions = [];
    let transactionBreakdown = {
      deposits: 0,
      withdrawals: 0,
      p2p: 0
    };

    try {
      // Fetch deposits
      const deposits = await fetchBitgetDepositsFixed(config, filterDate);
      transactions.push(...deposits);
      transactionBreakdown.deposits = deposits.length;
      console.log(`  💰 ${config.name} deposits: ${deposits.length}`);

      // Fetch withdrawals
      const withdrawals = await fetchBitgetWithdrawalsFixed(config, filterDate);
      transactions.push(...withdrawals);
      transactionBreakdown.withdrawals = withdrawals.length;
      console.log(`  📤 ${config.name} withdrawals: ${withdrawals.length}`);

      // Fetch P2P transactions
      const p2pTransactions = await fetchBitgetP2PFixed(config, filterDate);
      transactions.push(...p2pTransactions);
      transactionBreakdown.p2p = p2pTransactions.length;
      console.log(`  🤝 ${config.name} P2P: ${p2pTransactions.length}`);

    } catch (txError) {
      console.log(`Bitget transaction fetch failed: ${txError.message}`);
    }

    const statusNotes = `🔧 Bitget: ${transactionBreakdown.deposits}D + ${transactionBreakdown.withdrawals}W + ${transactionBreakdown.p2p}P2P = ${transactions.length} total`;

    return {
      success: true,
      transactions: transactions,
      status: {
        status: 'Active',
        lastSync: new Date().toISOString(),
        autoUpdate: 'Every Hour',
        notes: statusNotes,
        transactionCount: transactions.length
      }
    };

  } catch (error) {
    return {
      success: false,
      transactions: [],
      status: {
        status: 'Error',
        lastSync: new Date().toISOString(),
        autoUpdate: 'Every Hour',
        notes: `❌ Bitget failed: ${error.message}`,
        transactionCount: 0
      }
    };
  }
}

async function fetchBitgetDepositsFixed(config, filterDate) {
  try {
    console.log(`  💰 Fetching Bitget deposits...`);
    
    const timestamp = Date.now().toString();
    // FIXED: Use working spot deposit endpoint from official documentation
    const endpoint = "https://api.bitget.com/api/spot/v1/wallet/deposit-list";
    
    // Official Bitget signature method
    const method = 'GET';
    const params = {
      startTime: filterDate.getTime().toString(),
      endTime: Date.now().toString()
    };
    
    // Create query string using official method
    const queryString = Object.keys(params)
      .map(key => `${key}=${params[key]}`)
      .join('&');
    
    const requestPath = '/api/spot/v1/wallet/deposit-list?' + queryString;
    const body = '';
    
    // Create signature string: timestamp + method + requestPath + body
    const signString = timestamp + method + requestPath + body;
    const signature = crypto.createHmac('sha256', config.apiSecret).update(signString).digest('base64');
    
    console.log(`    🔍 Deposits Request Debug:`);
    console.log(`    - URL: ${endpoint}?${queryString}`);
    console.log(`    - Sign String: "${signString}"`);
    console.log(`    - Signature: ${signature.substring(0, 20)}...`);
    
    const response = await fetch(`${endpoint}?${queryString}`, {
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
    
    console.log(`    📊 Bitget Deposits Response: ${response.status}, Code: ${data.code}, Message: ${data.msg || 'N/A'}`);
    
    if (!response.ok || data.code !== '00000') {
      console.log(`    ❌ Bitget deposits failed: ${data.msg || response.status}`);
      return [];
    }

    const deposits = [];
    
    if (data.data && Array.isArray(data.data)) {
      for (const deposit of data.data) {
        const depositDate = new Date(parseInt(deposit.cTime));
        
        if (depositDate >= filterDate) {
          deposits.push({
            platform: 'Bitget',
            type: 'deposit',
            asset: deposit.coin,
            amount: deposit.amount.toString(),
            timestamp: new Date(parseInt(deposit.cTime)).toISOString(),
            from_address: deposit.fromAddress || 'External',
            to_address: 'Bitget',
            tx_id: deposit.txId || deposit.id,
            status: deposit.status === 'success' ? 'Completed' : 'Pending',
            network: deposit.chain,
            api_source: 'Bitget_Deposit_Fixed'
          });
        }
      }
    }

    console.log(`    ✅ Found ${deposits.length} Bitget deposits`);
    
    // Log currency breakdown
    const currencyBreakdown = {};
    deposits.forEach(deposit => {
      currencyBreakdown[deposit.asset] = (currencyBreakdown[deposit.asset] || 0) + 1;
    });
    console.log(`    📊 Currency breakdown:`, currencyBreakdown);
    
    return deposits;

  } catch (error) {
    console.log(`    ❌ Bitget deposits error: ${error.message}`);
    return [];
  }
}

async function fetchBitgetWithdrawalsFixed(config, filterDate) {
  try {
    console.log(`  📤 Fetching Bitget withdrawals...`);
    
    const timestamp = Date.now().toString();
    // FIXED: Use working spot withdrawal endpoint from official documentation
    const endpoint = "https://api.bitget.com/api/spot/v1/wallet/withdrawal-list";
    
    // Official Bitget signature method
    const method = 'GET';
    const params = {
      startTime: filterDate.getTime().toString(),
      endTime: Date.now().toString()
    };
    
    // Create query string using official method
    const queryString = Object.keys(params)
      .map(key => `${key}=${params[key]}`)
      .join('&');
    
    const requestPath = '/api/spot/v1/wallet/withdrawal-list?' + queryString;
    const body = '';
    
    // Create signature string: timestamp + method + requestPath + body
    const signString = timestamp + method + requestPath + body;
    const signature = crypto.createHmac('sha256', config.apiSecret).update(signString).digest('base64');
    
    console.log(`    🔍 Withdrawals Request Debug:`);
    console.log(`    - URL: ${endpoint}?${queryString}`);
    console.log(`    - Sign String: "${signString}"`);
    console.log(`    - Signature: ${signature.substring(0, 20)}...`);
    
    const response = await fetch(`${endpoint}?${queryString}`, {
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
    
    console.log(`    📊 Bitget Withdrawals Response: ${response.status}, Code: ${data.code}, Message: ${data.msg || 'N/A'}`);
    
    if (!response.ok || data.code !== '00000') {
      console.log(`    ❌ Bitget withdrawals failed: ${data.msg || response.status}`);
      return [];
    }

    const withdrawals = [];
    
    if (data.data && Array.isArray(data.data)) {
      for (const withdrawal of data.data) {
        const withdrawalDate = new Date(parseInt(withdrawal.cTime));
        
        if (withdrawalDate >= filterDate) {
          withdrawals.push({
            platform: 'Bitget',
            type: 'withdrawal',
            asset: withdrawal.coin,
            amount: withdrawal.amount.toString(),
            timestamp: new Date(parseInt(withdrawal.cTime)).toISOString(),
            from_address: 'Bitget',
            to_address: withdrawal.toAddress || 'External',
            tx_id: withdrawal.txId || withdrawal.id,
            status: withdrawal.status === 'success' ? 'Completed' : 'Pending',
            network: withdrawal.chain,
            api_source: 'Bitget_Withdrawal_Fixed'
          });
        }
      }
    }

    console.log(`    ✅ Found ${withdrawals.length} Bitget withdrawals`);
    
    // Log currency breakdown
    const currencyBreakdown = {};
    withdrawals.forEach(withdrawal => {
      currencyBreakdown[withdrawal.asset] = (currencyBreakdown[withdrawal.asset] || 0) + 1;
    });
    console.log(`    📊 Currency breakdown:`, currencyBreakdown);
    
    return withdrawals;

  } catch (error) {
    console.log(`    ❌ Bitget withdrawals error: ${error.message}`);
    return [];
  }
}

async function fetchBitgetP2PFixed(config, filterDate) {
  try {
    console.log(`  🤝 Fetching Bitget P2P transactions...`);
    
    const timestamp = Date.now().toString();
    // FIXED: Use working mix account bill endpoint for all transaction types
    const endpoint = "https://api.bitget.com/api/mix/v1/account/accountBill";
    
    // Official Bitget signature method
    const method = 'GET';
    const params = {
      productType: 'UMCBL',
      startTime: filterDate.getTime().toString(),
      endTime: Date.now().toString(),
      pageSize: '20'
    };
    
    // Create query string using official method
    const queryString = Object.keys(params)
      .map(key => `${key}=${params[key]}`)
      .join('&');
    
    const requestPath = '/api/mix/v1/account/accountBill?' + queryString;
    const body = '';
    
    // Create signature string: timestamp + method + requestPath + body
    const signString = timestamp + method + requestPath + body;
    const signature = crypto.createHmac('sha256', config.apiSecret).update(signString).digest('base64');
    
    console.log(`    🔍 P2P Request Debug:`);
    console.log(`    - URL: ${endpoint}?${queryString}`);
    console.log(`    - Sign String: "${signString}"`);
    console.log(`    - Signature: ${signature.substring(0, 20)}...`);
    
    const response = await fetch(`${endpoint}?${queryString}`, {
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
    
    console.log(`    📊 Bitget P2P Response: ${response.status}, Code: ${data.code}, Message: ${data.msg || 'N/A'}`);
    
    if (!response.ok || data.code !== '00000') {
      console.log(`    ❌ Bitget P2P failed: ${data.msg || response.status}`);
      return [];
    }

    const p2pTransactions = [];
    
    if (data.data && data.data.result && Array.isArray(data.data.result)) {
      for (const transaction of data.data.result) {
        const transactionDate = new Date(parseInt(transaction.ctime));
        
        if (transactionDate >= filterDate) {
          // Determine transaction type based on business field
          let type = 'unknown';
          if (transaction.business && transaction.business.includes('transfer')) {
            type = 'deposit';
          } else if (transaction.business && transaction.business.includes('withdraw')) {
            type = 'withdrawal';
          }
          
          p2pTransactions.push({
            platform: 'Bitget',
            type: type,
            asset: transaction.marginCoin || 'USDT',
            amount: transaction.amount.toString(),
            timestamp: new Date(parseInt(transaction.ctime)).toISOString(),
            from_address: type === 'deposit' ? 'External' : 'Bitget',
            to_address: type === 'deposit' ? 'Bitget' : 'External',
            tx_id: transaction.id || '',
            status: 'Completed',
            network: 'Internal',
            api_source: 'Bitget_P2P_Fixed'
          });
        }
      }
    }

    console.log(`    ✅ Found ${p2pTransactions.length} Bitget P2P transactions`);
    return p2pTransactions;

  } catch (error) {
    console.log(`    ❌ Bitget P2P error: ${error.message}`);
    return [];
  }
}