// ===========================================
// FIXED VERSION - crypto-to-sheets.js
// Fixed: ByBit V5 auth, Binance P2P endpoints, currency rates, Google Sheets targeting
// ===========================================

import { GoogleAuth } from 'google-auth-library';
import { google } from 'googleapis';
import crypto from 'crypto';

// ===========================================
// TRON ADDRESS HELPERS (Hex -> Base58Check)
// ===========================================
const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function encodeBase58(buffer) {
  if (!buffer || buffer.length === 0) return '';
  // Convert buffer to BigInt
  let value = 0n;
  for (const byte of buffer) {
    value = (value << 8n) + BigInt(byte);
  }
  let result = '';
  while (value > 0n) {
    const mod = value % 58n;
    result = BASE58_ALPHABET[Number(mod)] + result;
    value = value / 58n;
  }
  // Preserve leading zeros as '1'
  for (let i = 0; i < buffer.length && buffer[i] === 0; i++) {
    result = '1' + result;
  }
  return result || '1';
}

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest();
}

function base58checkEncode(payload) {
  const checksum = sha256(sha256(payload)).slice(0, 4);
  return encodeBase58(Buffer.concat([payload, checksum]));
}

// Accepts base58 (returns as-is) or hex (starting with '41') and returns base58
function tronHexToBase58(addr) {
  if (!addr || typeof addr !== 'string') return '';
  const trimmed = addr.trim();
  if (trimmed.startsWith('T')) return trimmed; // already base58
  // Expected hex with 0x41 prefix (21 bytes total)
  const hex = trimmed.startsWith('41') ? trimmed : trimmed.startsWith('0x41') ? trimmed.slice(2) : trimmed;
  // Validate length (should be 42 chars => 21 bytes)
  try {
    const payload = Buffer.from(hex, 'hex');
    if (payload.length === 21 && payload[0] === 0x41) {
      return base58checkEncode(payload);
    }
  } catch (_e) {
    // fallthrough
  }
  return trimmed; // fallback to original if unexpected
}

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
    console.log(`📊 Wallet names: ${Object.keys(wallets).join(', ')}`);
    
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
  const debugLogs = ['🚀 Function started'];
  
  try {
    // Set CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    debugLogs.push('✅ CORS headers set');

    if (req.method === 'OPTIONS') {
      res.status(200).end();
      return;
    }
    debugLogs.push('✅ Method check passed');

    // Handle test_tron_wallet action
    if (req.body?.action === "test_tron_wallet") {
      debugLogs.push('🧪 Processing test_tron_wallet request...');
      return await handleTronWalletTest(req, res, debugLogs);
    }

    // Handle detailed test_tron_wallet_detailed action
    if (req.body?.action === "test_tron_wallet_detailed") {
      debugLogs.push('🧪 Processing test_tron_wallet_detailed request...');
      return await handleTronWalletDetailedTest(req, res, debugLogs);
    }

    // Handle test_connection action
    if (req.body?.action === "test_connection") {
      return res.json({
        success: true,
        message: "✅ Vercel endpoint is working perfectly!",
        timestamp: new Date().toISOString(),
        server: "Vercel Functions",
        status: "Active"
      });
    }

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
    name: "ByBit (CV)",
    apiKey: apiCredentials.BYBIT_API?.apiKey || '',
    apiSecret: apiCredentials.BYBIT_API?.apiSecret || ''
  };

    if (!bybitConfig.apiKey || !bybitConfig.apiSecret) {
      debugLogs.push('⚠️ ByBit (CV): Missing API credentials');
      apiStatusResults['ByBit (CV)'] = {
        status: 'Error',
        lastSync: new Date().toISOString(),
        autoUpdate: 'Every Hour',
        notes: '❌ Missing credentials',
        transactionCount: 0
      };
    } else {
      debugLogs.push('🔧 Processing ByBit (CV) with credentials...');
      const bybitResult = await testByBitAccountFixed(bybitConfig, filterDate, debugLogs);
      apiStatusResults['ByBit (CV)'] = bybitResult.status;
      
      if (bybitResult.success) {
        allTransactions.push(...bybitResult.transactions);
        totalTransactionsFound += bybitResult.transactions.length;
        debugLogs.push(`✅ ByBit (CV): ${bybitResult.transactions.length} transactions`);
      } else {
        debugLogs.push(`❌ ByBit (CV): ${bybitResult.status.notes}`);
      }
    }

    // ===========================================
    // STEP 3: BITGET API WITH CREDENTIALS FROM APPS SCRIPT
    // ===========================================
    debugLogs.push('🔧 Processing Bitget APIs with credentials from Apps Script...');
    
    // Process Bitget Account 1
    const bitgetConfig1 = {
      name: "Bitget (ZA)",
      apiKey: apiCredentials.BITGET_API?.apiKey || '',
      apiSecret: apiCredentials.BITGET_API?.apiSecret || '',
      passphrase: apiCredentials.BITGET_API?.passphrase || ''
    };

    if (!bitgetConfig1.apiKey || !bitgetConfig1.apiSecret) {
      debugLogs.push(`⚠️ Bitget (ZA): Missing API credentials`);
      apiStatusResults['Bitget (ZA)'] = {
        status: 'Error',
        lastSync: new Date().toISOString(),
        autoUpdate: 'Every Hour',
        notes: '❌ Missing credentials',
        transactionCount: 0
      };
    } else {
      debugLogs.push('🔧 Processing Bitget (ZA) with credentials...');
      debugLogs.push(`🔍 Bitget (ZA) Config: Key=${bitgetConfig1.apiKey.substring(0, 10)}..., Secret=${bitgetConfig1.apiSecret.substring(0, 10)}..., Passphrase=${bitgetConfig1.passphrase || 'NOT PROVIDED'}`);
      const bitgetResult1 = await testBitgetAccountFixed(bitgetConfig1, filterDate, debugLogs);
      apiStatusResults['Bitget (ZA)'] = bitgetResult1.status;
      
              if (bitgetResult1.success) {
          allTransactions.push(...bitgetResult1.transactions);
          totalTransactionsFound += bitgetResult1.transactions.length;
          debugLogs.push(`✅ Bitget (ZA): ${bitgetResult1.transactions.length} transactions`);
        } else {
          debugLogs.push(`❌ Bitget (ZA): ${bitgetResult1.status.notes}`);
        }
    }
    
    // Process Bitget Account 2
    const bitgetConfig2 = {
      name: "Bitget (SF)",
      apiKey: apiCredentials.BITGET_API_2?.apiKey || '',
      apiSecret: apiCredentials.BITGET_API_2?.apiSecret || '',
      passphrase: apiCredentials.BITGET_API_2?.passphrase || ''
    };

    if (!bitgetConfig2.apiKey || !bitgetConfig2.apiSecret || !bitgetConfig2.passphrase) {
      debugLogs.push(`⚠️ Bitget (SF): Missing API credentials`);
      apiStatusResults['Bitget (SF)'] = {
        status: 'Error',
        lastSync: new Date().toISOString(),
        autoUpdate: 'Every Hour',
        notes: '❌ Missing credentials',
        transactionCount: 0
      };
    } else {
      debugLogs.push('🔧 Processing Bitget (SF) with credentials...');
      debugLogs.push(`🔍 Bitget (SF) Config: Key=${bitgetConfig2.apiKey.substring(0, 10)}..., Secret=${bitgetConfig2.apiSecret.substring(0, 10)}..., Passphrase=${bitgetConfig2.passphrase || 'NOT PROVIDED'}`);
      const bitgetResult2 = await testBitgetAccountFixed(bitgetConfig2, filterDate, debugLogs);
      apiStatusResults['Bitget (SF)'] = bitgetResult2.status;
      
              if (bitgetResult2.success) {
          allTransactions.push(...bitgetResult2.transactions);
          totalTransactionsFound += bitgetResult2.transactions.length;
          debugLogs.push(`✅ Bitget (SF): ${bitgetResult2.transactions.length} transactions`);
        } else {
          debugLogs.push(`❌ Bitget (SF): ${bitgetResult2.status.notes}`);
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
            // Check if this is actually a BEP20 wallet (BSC) or Ethereum wallet
            if (walletName.toLowerCase().includes('bep20') || walletName.toLowerCase().includes('bsc')) {
              debugLogs.push(`🔧 Detected BEP20 wallet: ${walletName} - using BSC API`);
              transactions = await fetchBEP20Enhanced(walletConfig.address, filterDate, walletConfig.apiKey);
            } else {
              debugLogs.push(`🔧 Detected Ethereum wallet: ${walletName} - using Etherscan API`);
              transactions = await fetchEthereumEnhanced(walletConfig.address, filterDate, walletConfig.apiKey);
            }
            break;
          case 'tron':
            transactions = await fetchTronEnhanced(walletConfig.address, filterDate);
            break;
          case 'solana':
            // Get Helius API key from credentials if available
            const heliusApiKey = apiCredentials.HELIUS?.apiKey || null;
            transactions = await fetchSolanaEnhanced(walletConfig.address, filterDate, heliusApiKey);
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
        
        // Debug: Log transactions for this specific wallet
        console.log(`🔍 Wallet "${walletName}" (${walletConfig.address}): ${mappedTransactions.length} transactions`);
        mappedTransactions.forEach((tx, i) => {
          console.log(`🔍 ${walletName} TX ${i + 1}: type=${tx.type}, asset=${tx.asset}, amount=${tx.amount}, tx_id=${tx.tx_id}`);
        });
        
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
    debugLogs.push(`❌ FATAL ERROR: ${error.message}`);
    debugLogs.push(`❌ Error stack: ${error.stack}`);
    
    try {
      res.status(500).json({
        success: false,
        error: error.message,
        errorStack: error.stack,
        timestamp: new Date().toISOString(),
        debugLogs: debugLogs
      });
    } catch (responseError) {
      // If we can't even send a JSON response, send plain text
      res.status(500).send(`Error: ${error.message} | Response Error: ${responseError.message}`);
    }
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

      // FIXED ALL withdrawals (internal + external combined)
      const allWithdrawals = await fetchByBitWithdrawalsFixed(config, filterDate);
      transactions.push(...allWithdrawals);
      transactionBreakdown.allWithdrawals = allWithdrawals.length;
      console.log(`  📤 ${config.name} ALL withdrawals: ${allWithdrawals.length}`);

      // FIXED internal transfers
      const internalTransfers = await fetchByBitInternalTransfersFixed(config, filterDate);
      transactions.push(...internalTransfers);
      transactionBreakdown.internalTransfers = internalTransfers.length;
      console.log(`  🔄 ${config.name} internal transfers: ${internalTransfers.length}`);
      
      // Enhanced debugging for internal transfers
      if (internalTransfers.length === 0) {
        console.log(`  ⚠️ No internal transfers found for ${config.name} - this might indicate an API issue or no transfers in the date range`);
      } else {
        console.log(`  📊 Internal transfers breakdown:`);
        const transferTypes = internalTransfers.reduce((acc, tx) => {
          acc[tx.type] = (acc[tx.type] || 0) + 1;
          return acc;
        }, {});
        Object.entries(transferTypes).forEach(([type, count]) => {
          console.log(`    - ${type}: ${count}`);
        });
      }

    } catch (txError) {
      console.log(`ByBit transaction fetch failed: ${txError.message}`);
    }

          const statusNotes = `🔧 FIXED V5: ${transactionBreakdown.deposits}D + ${transactionBreakdown.internalDeposits}ID + ${transactionBreakdown.allWithdrawals}W + ${transactionBreakdown.internalTransfers}IT = ${transactions.length} total`;

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
    console.log(`    📤 Fetching ByBit ALL withdrawals (internal + external) for ${config.name} with FIXED TWO-CALL approach...`);
    
    const allWithdrawals = [];
    const timestamp = Date.now().toString();
    const recvWindow = "5000";
    const endpoint = "https://api.bybit.com/v5/asset/withdraw/query-record";
    
    // ===========================================
    // CALL 1: Get EXTERNAL withdrawals (withdrawType=0)
    // ===========================================
    console.log(`    📤 Step 1: Fetching EXTERNAL withdrawals...`);
    const queryParams1 = `timestamp=${timestamp}&limit=50&startTime=${filterDate.getTime()}&withdrawType=0`;
    const signString1 = timestamp + config.apiKey + recvWindow + queryParams1;
    const signature1 = crypto.createHmac('sha256', config.apiSecret).update(signString1).digest('hex');
    const url1 = `${endpoint}?${queryParams1}`;

    const response1 = await fetch(url1, {
      method: "GET",
      headers: {
        "X-BAPI-API-KEY": config.apiKey,
        "X-BAPI-SIGN": signature1,
        "X-BAPI-TIMESTAMP": timestamp,
        "X-BAPI-RECV-WINDOW": recvWindow,
        "Content-Type": "application/json"
      }
    });

    if (response1.ok) {
      const data1 = await response1.json();
      if (data1.retCode === 0 && data1.result && data1.result.rows) {
        console.log(`    📊 External withdrawals found: ${data1.result.rows.length}`);
        allWithdrawals.push(...data1.result.rows);
      }
    } else {
      console.log(`    ⚠️ External withdrawals API error: ${response1.status}`);
    }
    
    // ===========================================
    // CALL 2: Get INTERNAL withdrawals (withdrawType=1)
    // ===========================================
    console.log(`    📤 Step 2: Fetching INTERNAL withdrawals...`);
    const queryParams2 = `timestamp=${timestamp}&limit=50&startTime=${filterDate.getTime()}&withdrawType=1`;
    const signString2 = timestamp + config.apiKey + recvWindow + queryParams2;
    const signature2 = crypto.createHmac('sha256', config.apiSecret).update(signString2).digest('hex');
    const url2 = `${endpoint}?${queryParams2}`;

    const response2 = await fetch(url2, {
      method: "GET",
      headers: {
        "X-BAPI-API-KEY": config.apiKey,
        "X-BAPI-SIGN": signature2,
        "X-BAPI-TIMESTAMP": timestamp,
        "X-BAPI-RECV-WINDOW": recvWindow,
        "Content-Type": "application/json"
      }
    });

    if (response2.ok) {
      const data2 = await response2.json();
      if (data2.retCode === 0 && data2.result && data2.result.rows) {
        console.log(`    📊 Internal withdrawals found: ${data2.result.rows.length}`);
        allWithdrawals.push(...data2.result.rows);
      }
    } else {
      console.log(`    ⚠️ Internal withdrawals API error: ${response2.status}`);
    }

    // ===========================================
    // PROCESS COMBINED RESULTS
    // ===========================================
    if (allWithdrawals.length === 0) {
      console.log(`    ℹ️ No withdrawals found for ${config.name}`);
      return [];
    }

    console.log(`    📊 Total raw withdrawals found: ${allWithdrawals.length}`);

    const withdrawals = allWithdrawals.filter(withdrawal => {
      const withdrawalDate = new Date(parseInt(withdrawal.createTime));
      const isAfterFilter = withdrawalDate >= filterDate;
      const isCompleted = withdrawal.status === "success";
      
      console.log(`    🔍 Withdrawal Filter: Date=${withdrawalDate.toISOString()}, After Filter=${isAfterFilter}, Status=${withdrawal.status}, Completed=${isCompleted}, Type=${withdrawal.withdrawType === 1 ? 'Internal' : 'External'}`);
      return isAfterFilter && isCompleted;
    }).map(withdrawal => ({
      platform: config.name,
      type: "withdrawal", 
      asset: withdrawal.coin,
      amount: withdrawal.amount.toString(),
      timestamp: new Date(parseInt(withdrawal.createTime)).toISOString(),
      from_address: config.name,
      to_address: withdrawal.toAddress || (withdrawal.withdrawType === 1 ? "Internal" : "External"),
      tx_id: withdrawal.txID || withdrawal.withdrawId || withdrawal.id,
      status: "Completed",
      network: withdrawal.withdrawType === 1 ? "Internal" : (withdrawal.chain || "External"),
      api_source: `ByBit_${withdrawal.withdrawType === 1 ? 'Internal' : 'External'}_Withdrawal_V5_Fixed`
    }));

    console.log(`    ✅ ByBit ALL withdrawals processed: ${withdrawals.length} transactions`);
    
    // Log detailed breakdown by type
    const internal = withdrawals.filter(w => w.api_source.includes('Internal')).length;
    const external = withdrawals.filter(w => w.api_source.includes('External')).length;
    console.log(`    📊 Final Breakdown: ${internal} Internal + ${external} External = ${withdrawals.length} Total`);
    
    if (internal > 0) {
      console.log(`    🎉 SUCCESS: Found ${internal} internal withdrawal(s) that were previously missing!`);
    }
    
    return withdrawals;

  } catch (error) {
    console.error(`Error fetching ByBit ALL withdrawals for ${config.name}:`, error);
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

async function fetchByBitInternalWithdrawalsFixed(config, filterDate) {
  try {
    console.log(`    🔄 Fetching ByBit internal withdrawals for ${config.name}...`);
    
    const timestamp = Date.now().toString();
    const recvWindow = "5000";
    const endpoint = "https://api.bybit.com/v5/asset/withdraw/query-internal-record";
    
    const queryParams = `timestamp=${timestamp}&limit=50&startTime=${filterDate.getTime()}&endTime=${Date.now()}`;
    const signString = timestamp + config.apiKey + recvWindow + queryParams;
    const signature = crypto.createHmac('sha256', config.apiSecret).update(signString).digest('hex');
    
    const url = `${endpoint}?${queryParams}`;

    console.log(`    🔍 Internal Withdrawals Debug:`);
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

    console.log(`    📊 Internal Withdrawals Response Status: ${response.status}`);

    if (!response.ok) {
      const errorText = await response.text();
      console.log(`    ❌ Internal Withdrawals Error Response: ${errorText}`);
      throw new Error(`ByBit internal withdrawals API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    
    console.log(`    📊 Internal Withdrawals API Response:`, JSON.stringify(data, null, 2));
    
    if (data.retCode !== 0) {
      throw new Error(`ByBit internal withdrawals error: ${data.retMsg}`);
    }

    if (!data.result || !data.result.rows) {
      console.log(`    ℹ️ No internal withdrawal data returned for ${config.name}`);
      console.log(`    📊 Full response data:`, JSON.stringify(data, null, 2));
      return [];
    }

    console.log(`    📊 Raw internal withdrawals found: ${data.result.rows.length}`);
    if (data.result.rows.length > 0) {
      console.log(`    📊 Sample internal withdrawal:`, JSON.stringify(data.result.rows[0], null, 2));
    }

    const internalWithdrawals = data.result.rows.filter(withdrawal => {
      const created = parseInt(withdrawal.createdTime);
      const createdMs = created < 1e12 ? created * 1000 : created; // handle seconds vs ms
      const withdrawalDate = new Date(createdMs);
      const isAfterFilter = withdrawalDate >= filterDate;
      const isCompleted = Number(withdrawal.status) === 2; // 2 = Success per docs
      
      console.log(`    🔍 Internal Withdrawal Filter: Date=${withdrawalDate.toISOString()}, After Filter=${isAfterFilter}, Status=${withdrawal.status}, Completed=${isCompleted}`);
      
      return isAfterFilter && isCompleted;
    }).map(withdrawal => {
      const created = parseInt(withdrawal.createdTime);
      const createdMs = created < 1e12 ? created * 1000 : created;
      return {
        platform: config.name,
        type: "withdrawal",
        asset: withdrawal.coin,
        amount: withdrawal.amount.toString(),
        timestamp: new Date(createdMs).toISOString(),
        from_address: config.name,
        to_address: withdrawal.address || "Internal",
        tx_id: withdrawal.txID || withdrawal.id,
        status: "Completed",
        network: "Internal",
        api_source: "ByBit_Internal_Withdrawal_V5_Fixed"
      };
    });

    console.log(`    ✅ ByBit internal withdrawals: ${internalWithdrawals.length} transactions`);
    return internalWithdrawals;

  } catch (error) {
    console.error(`Error fetching ByBit internal withdrawals for ${config.name}:`, error);
    return [];
  }
}

async function fetchByBitInternalTransfersFixed(config, filterDate) {
  try {
    console.log(`    🔄 Fetching ByBit internal transfers for ${config.name}...`);
    
    const timestamp = Date.now().toString();
    const recvWindow = "5000";
    const endpoint = "https://api.bybit.com/v5/asset/inter-transfer-list";
    
    // FIXED: Use proper parameter names for Bybit V5 API
    // Try without coin parameter first to see all transfers
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
      
      // Log all internal transfers for debugging
      console.log(`    📊 All internal transfers structure:`);
      data.result.list.forEach((transfer, index) => {
        console.log(`    ${index + 1}. fromAccountType: "${transfer.fromAccountType}", toAccountType: "${transfer.toAccountType}", status: "${transfer.status}", amount: "${transfer.amount}", coin: "${transfer.coin}"`);
      });
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
      
      // FIXED: Better logic for determining transaction type
      let type = 'deposit'; // default
      if (transfer.fromAccountType === 'UNIFIED' && transfer.toAccountType !== 'UNIFIED') {
        type = 'withdrawal'; // Money going OUT of UNIFIED account
      } else if (transfer.toAccountType === 'UNIFIED' && transfer.fromAccountType !== 'UNIFIED') {
        type = 'deposit'; // Money coming IN to UNIFIED account
      } else {
        // For internal transfers between same account types, determine based on direction
        // This is a fallback - you may need to adjust based on your specific needs
        type = 'deposit'; // Default to deposit for internal transfers
      }
      
      console.log(`    🔍 Internal Transfer Type Logic: from=${transfer.fromAccountType}, to=${transfer.toAccountType}, determined_type=${type}`);
      
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

async function fetchBEP20Enhanced(address, filterDate, apiKey = null) {
  try {
    console.log(`  🔍 BEP20/BSC wallet search: ${address.substring(0, 20)}...`);
    console.log(`  🔑 API Key provided: ${apiKey ? 'YES' : 'NO'}`);
    console.log(`  🔑 API Key preview: ${apiKey ? apiKey.substring(0, 10) + '...' : 'NONE'}`);
    
    // Use provided API key from Settings page
    if (!apiKey) {
      console.log("⚠️ No BSCScan API key provided for BEP20 wallet - skipping");
      return [];
    }
    
    const bscscanApiKey = apiKey;
    const transactions = [];
    
    // 1. Fetch BNB transactions (native BSC token)
    console.log(`    🔍 Fetching BNB transactions...`);
    const bnbEndpoint = `https://api.bscscan.com/api?module=account&action=txlist&address=${address}&startblock=0&endblock=99999999&sort=desc&page=1&offset=100&apikey=${bscscanApiKey}`;
    
    console.log(`    🔍 Fetching BNB transactions from: ${bnbEndpoint.split('?')[0]}`);
    const bnbResponse = await fetch(bnbEndpoint);
    
    console.log(`    📊 BNB API Response Status: ${bnbResponse.status}`);
    
    if (!bnbResponse.ok) {
      const errorText = await bnbResponse.text();
      console.log(`    ❌ BSC API error: ${bnbResponse.status} - ${errorText}`);
      throw new Error(`BSC API error: ${bnbResponse.status} - ${errorText}`);
    }
    
    const bnbData = await bnbResponse.json();
    console.log(`    📊 BNB API Response: ${JSON.stringify(bnbData, null, 2)}`);
    
    if (bnbData.status !== "1") {
      console.log(`    ⚠️ BSCScan BNB API message: ${bnbData.message}`);
    } else {
      bnbData.result.forEach(tx => {
        const txDate = new Date(parseInt(tx.timeStamp) * 1000);
        if (txDate < filterDate) return;
        
        const isDeposit = tx.to.toLowerCase() === address.toLowerCase();
        const amount = (parseInt(tx.value) / Math.pow(10, 18)).toString();
        
        if (parseFloat(amount) > 0) {
          transactions.push({
            platform: "BEP20 Wallet",
            type: isDeposit ? "deposit" : "withdrawal",
            asset: "BNB",
            amount: amount,
            timestamp: txDate.toISOString(),
            from_address: tx.from,
            to_address: tx.to,
            tx_id: tx.hash,
            status: tx.txreceipt_status === "1" ? "Completed" : "Failed",
            network: "BSC",
            api_source: "BSCScan_BNB"
          });
        }
      });
      console.log(`    ✅ Found ${bnbData.result.length} BNB transactions, ${transactions.length} after filtering`);
    }
    
    // 2. Fetch BEP-20 token transactions (USDT, USDC, etc.)
    console.log(`    🔍 Fetching BEP-20 token transactions...`);
    const tokenEndpoint = `https://api.bscscan.com/api?module=account&action=tokentx&address=${address}&startblock=0&endblock=99999999&sort=desc&page=1&offset=100&apikey=${bscscanApiKey}`;
    
    const tokenResponse = await fetch(tokenEndpoint);
    
    if (!tokenResponse.ok) {
      console.log(`    ⚠️ Token API error: ${tokenResponse.status}`);
    } else {
      const tokenData = await tokenResponse.json();
      
      if (tokenData.status !== "1") {
        console.log(`    ⚠️ BSCScan Token API message: ${tokenData.message}`);
      } else {
        tokenData.result.forEach(tx => {
          const txDate = new Date(parseInt(tx.timeStamp) * 1000);
          if (txDate < filterDate) return;
          
          const isDeposit = tx.to.toLowerCase() === address.toLowerCase();
          const decimals = parseInt(tx.tokenDecimal) || 18;
          const amount = (parseInt(tx.value) / Math.pow(10, decimals)).toString();
          
          if (parseFloat(amount) > 0) {
            transactions.push({
              platform: "BEP20 Wallet",
              type: isDeposit ? "deposit" : "withdrawal",
              asset: tx.tokenSymbol || "UNKNOWN",
              amount: amount,
              timestamp: txDate.toISOString(),
              from_address: tx.from,
              to_address: tx.to,
              tx_id: tx.hash,
              status: tx.txreceipt_status === "1" ? "Completed" : "Failed",
              network: "BSC",
              api_source: "BSCScan_BEP20"
            });
          }
        });
        console.log(`    ✅ Found ${tokenData.result.length} BEP-20 token transactions, ${tokenData.result.filter(tx => new Date(parseInt(tx.timeStamp) * 1000) >= filterDate).length} after filtering`);
      }
    }
    
    console.log(`  📊 BEP20/BSC total found: ${transactions.length} transactions`);
    return transactions;
    
  } catch (error) {
    console.error("BEP20/BSC API error:", error);
    throw error;
  }
}

async function fetchEthereumEnhanced(address, filterDate, apiKey = null) {
  try {
    console.log(`  🔍 Ethereum wallet search: ${address.substring(0, 20)}...`);
    
    // Use provided API key from Settings page
    if (!apiKey) {
      console.log("⚠️ No Etherscan API key provided for Ethereum wallet - skipping");
      return [];
    }
    
    console.log(`    🔑 Using Etherscan API key: ${apiKey.substring(0, 8)}...`);
    const etherscanApiKey = apiKey;
    const transactions = [];
    
    // 1. Fetch ETH transactions
    console.log(`    🔍 Fetching ETH transactions...`);
    const ethEndpoint = `https://api.etherscan.io/api?module=account&action=txlist&address=${address}&startblock=0&endblock=99999999&sort=desc&page=1&offset=1000&apikey=${etherscanApiKey}`;
    
    const ethResponse = await fetch(ethEndpoint);
    
    if (!ethResponse.ok) {
      throw new Error(`Ethereum API error: ${ethResponse.status}`);
    }
    
    const ethData = await ethResponse.json();
    
    if (ethData.status !== "1") {
      console.log(`    ⚠️ Etherscan ETH API message: ${ethData.message}`);
      if (ethData.message.includes("rate limit") || ethData.message.includes("Max rate limit reached")) {
        console.log(`    ⚠️ Rate limit reached for ETH transactions - will retry with smaller batch`);
        // Could implement retry logic here if needed
      }
    } else {
      ethData.result.forEach(tx => {
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
            api_source: "Etherscan_ETH"
          });
        }
      });
      console.log(`    ✅ Found ${ethData.result.length} ETH transactions, ${transactions.length} after filtering`);
    }
    
    // 2. Fetch ERC-20 token transactions (BEP20 compatible)
    console.log(`    🔍 Fetching ERC-20/BEP20 token transactions...`);
    const tokenEndpoint = `https://api.etherscan.io/api?module=account&action=tokentx&address=${address}&startblock=0&endblock=99999999&sort=desc&page=1&offset=1000&apikey=${etherscanApiKey}`;
    
    const tokenResponse = await fetch(tokenEndpoint);
    
    if (!tokenResponse.ok) {
      console.log(`    ⚠️ Token API error: ${tokenResponse.status}`);
    } else {
      const tokenData = await tokenResponse.json();
      
      if (tokenData.status !== "1") {
        console.log(`    ⚠️ Etherscan Token API message: ${tokenData.message}`);
        if (tokenData.message.includes("rate limit") || tokenData.message.includes("Max rate limit reached")) {
          console.log(`    ⚠️ Rate limit reached for token transactions - will retry with smaller batch`);
          // Could implement retry logic here if needed
        }
      } else {
        tokenData.result.forEach(tx => {
          const txDate = new Date(parseInt(tx.timeStamp) * 1000);
          if (txDate < filterDate) return;
          
          const isDeposit = tx.to.toLowerCase() === address.toLowerCase();
          const decimals = parseInt(tx.tokenDecimal) || 18;
          const amount = (parseInt(tx.value) / Math.pow(10, decimals)).toString();
          
          if (parseFloat(amount) > 0) {
            transactions.push({
              platform: "Ethereum Wallet",
              type: isDeposit ? "deposit" : "withdrawal",
              asset: tx.tokenSymbol || "UNKNOWN",
              amount: amount,
              timestamp: txDate.toISOString(),
              from_address: tx.from,
              to_address: tx.to,
              tx_id: tx.hash,
              status: tx.txreceipt_status === "1" ? "Completed" : "Failed",
              network: "ETH",
              api_source: "Etherscan_ERC20"
            });
          }
        });
        console.log(`    ✅ Found ${tokenData.result.length} token transactions, ${tokenData.result.filter(tx => new Date(parseInt(tx.timeStamp) * 1000) >= filterDate).length} after filtering`);
      }
    }
    
    console.log(`  📊 Ethereum total found: ${transactions.length} transactions`);
    return transactions;
    
  } catch (error) {
    console.error("Ethereum API error:", error);
    throw error;
  }
}

async function fetchTronEnhanced(address, filterDate) {
  try {
    // Fetch native TRX transfers (as before)
    const trxEndpoint = `https://api.trongrid.io/v1/accounts/${address}/transactions?limit=200&only_confirmed=true&order_by=block_timestamp,desc`;
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
              // Fix: Properly categorize based on whether this wallet is sender or receiver
              // Convert hex addresses (41...) to base58 for reliable comparison
              const normalizedAddress = address.trim();
              const normalizedToAddress = value.to_address ? tronHexToBase58(value.to_address.trim()) : '';
              const normalizedFromAddress = value.owner_address ? tronHexToBase58(value.owner_address.trim()) : '';
              
              // Enhanced logging for debugging
              console.log(`[TRX ENHANCED DEBUG] Processing transaction: ${tx.txID}`);
              console.log(`[TRX ENHANCED DEBUG] Wallet address: "${normalizedAddress}"`);
              console.log(`[TRX ENHANCED DEBUG] To address: "${normalizedToAddress}"`);
              console.log(`[TRX ENHANCED DEBUG] From address: "${normalizedFromAddress}"`);
              console.log(`[TRX ENHANCED DEBUG] To match: ${normalizedToAddress === normalizedAddress}`);
              console.log(`[TRX ENHANCED DEBUG] From match: ${normalizedFromAddress === normalizedAddress}`);
              
              const isDeposit = normalizedToAddress && normalizedToAddress === normalizedAddress;
              const isWithdrawal = normalizedFromAddress && normalizedFromAddress === normalizedAddress;
              const amount = (value.amount / 1000000).toString();
              
              // Debug logging for TRX transfers
              console.log(`[TRX DEBUG] TX: ${tx.txID}`);
              console.log(`[TRX DEBUG] Wallet address: ${address} (normalized: ${normalizedAddress})`);
              console.log(`[TRX DEBUG] To address (raw): ${value.to_address}`);
              console.log(`[TRX DEBUG] From address (raw): ${value.owner_address}`);
              console.log(`[TRX DEBUG] To address (base58): ${normalizedToAddress}`);
              console.log(`[TRX DEBUG] From address (base58): ${normalizedFromAddress}`);
              console.log(`[TRX DEBUG] To address match: ${normalizedToAddress === normalizedAddress}`);
              console.log(`[TRX DEBUG] From address match: ${normalizedFromAddress === normalizedAddress}`);
              console.log(`[TRX DEBUG] Is deposit: ${isDeposit}`);
              console.log(`[TRX DEBUG] Is withdrawal: ${isWithdrawal}`);
              
              // Only add transaction if this wallet is involved (sender or receiver)
              if (isDeposit || isWithdrawal) {
                const type = isDeposit ? "deposit" : "withdrawal";
                console.log(`[TRX DEBUG] Type: ${type}`);
                transactions.push({
                  platform: "TRON Wallet",
                  type: type,
                  asset: "TRX",
                  amount: amount,
                  timestamp: txDate.toISOString(),
                  from_address: normalizedFromAddress,
                  to_address: normalizedToAddress,
                  tx_id: tx.txID,
                  status: "Completed",
                  network: "TRON",
                  api_source: "TronGrid"
                });
              } else {
                console.log(`[TRX DEBUG] Skipping transaction - wallet not involved`);
              }
            }
          });
        }
      });
    }

    // Fetch TRC-20 token transfers (USDT, etc.)
    const trc20Endpoint = `https://api.trongrid.io/v1/accounts/${address}/transactions/trc20?limit=200&only_confirmed=true&order_by=block_timestamp,desc`;
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
        
        // TRON addresses are case-sensitive, so don't convert to lowercase
        const normalizedAddress = address.trim();
        const normalizedToAddress = tx.to ? tx.to.trim() : '';
        const normalizedFromAddress = tx.from ? tx.from.trim() : '';
        
        // Enhanced logging for TRC-20 debugging
        console.log(`[TRC20 ENHANCED DEBUG] Processing transaction: ${tx.transaction_id}`);
        console.log(`[TRC20 ENHANCED DEBUG] Wallet address: "${normalizedAddress}"`);
        console.log(`[TRC20 ENHANCED DEBUG] To address: "${normalizedToAddress}"`);
        console.log(`[TRC20 ENHANCED DEBUG] From address: "${normalizedFromAddress}"`);
        console.log(`[TRC20 ENHANCED DEBUG] To match: ${normalizedToAddress === normalizedAddress}`);
        console.log(`[TRC20 ENHANCED DEBUG] From match: ${normalizedFromAddress === normalizedAddress}`);
        
        if (normalizedToAddress && normalizedToAddress === normalizedAddress) {
          type = 'deposit';
          console.log(`[TRC20 ENHANCED DEBUG] ✅ DEPOSIT DETECTED`);
        } else if (normalizedFromAddress && normalizedFromAddress === normalizedAddress) {
          type = 'withdrawal';
          console.log(`[TRC20 ENHANCED DEBUG] 📤 WITHDRAWAL DETECTED`);
        } else {
          // Not relevant to this wallet, skip
          console.log(`[TRC20 ENHANCED DEBUG] ❌ SKIPPED - wallet not involved`);
          return;
        }
        
        // Debug logging for TRC-20 transfers
        console.log(`[TRC20 DEBUG] TX: ${tx.transaction_id}`);
        console.log(`[TRC20 DEBUG] Wallet address: ${address} (normalized: ${normalizedAddress})`);
        console.log(`[TRC20 DEBUG] To address: ${tx.to} (normalized: ${normalizedToAddress})`);
        console.log(`[TRC20 DEBUG] From address: ${tx.from} (normalized: ${normalizedFromAddress})`);
        console.log(`[TRC20 DEBUG] Type: ${type}`);
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
    
    // Log transaction type breakdown
    const typeBreakdown = {};
    const assetBreakdown = {};
    transactions.forEach(t => {
      typeBreakdown[t.type] = (typeBreakdown[t.type] || 0) + 1;
      assetBreakdown[t.asset] = (assetBreakdown[t.asset] || 0) + 1;
    });
    console.log(`[TRON LOG] Type breakdown:`, typeBreakdown);
    console.log(`[TRON LOG] Asset breakdown:`, assetBreakdown);
    
    // Log detailed breakdown for debugging
    const deposits = transactions.filter(t => t.type === 'deposit');
    const withdrawals = transactions.filter(t => t.type === 'withdrawal');
    console.log(`[TRON LOG] Deposits: ${deposits.length}, Withdrawals: ${withdrawals.length}`);
    
    if (deposits.length > 0) {
      console.log(`[TRON LOG] Sample deposit:`, deposits[0]);
    }
    if (withdrawals.length > 0) {
      console.log(`[TRON LOG] Sample withdrawal:`, withdrawals[0]);
    }
    
    transactions.forEach((t, i) => {
      console.log(`[TRON TX ${i + 1}] ${JSON.stringify(t)}`);
    });

    return transactions;
  } catch (error) {
    console.error("TRON API error:", error);
    throw error;
  }
}

async function fetchSolanaEnhanced(address, filterDate, heliusApiKey = null) {
  try {
    console.log(`  🔍 Solana wallet search: ${address.substring(0, 20)}...`);
    console.log(`  📅 Filter date: ${filterDate.toISOString()}`);
    
    // Use Helius API if key is provided, otherwise fall back to free endpoint
    let endpoint;
    if (heliusApiKey) {
      endpoint = `https://rpc.helius.xyz/?api-key=${heliusApiKey}`;
      console.log(`  🔑 Using Helius API with key: ${heliusApiKey.substring(0, 8)}...`);
    } else {
      endpoint = "https://api.mainnet-beta.solana.com";
      console.log(`  ⚠️ No Helius API key provided, using free endpoint`);
    }
    
    const transactions = [];
    
    // 1. Get recent signatures for the address
    const signaturesPayload = {
      jsonrpc: "2.0",
      id: 1,
      method: "getSignaturesForAddress",
      params: [address, { limit: 500 }] // Increased limit to capture more history
    };
    
    const signaturesResponse = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(signaturesPayload)
    });
    
    if (!signaturesResponse.ok) {
      throw new Error(`Solana API error: ${signaturesResponse.status}`);
    }
    
    const signaturesData = await signaturesResponse.json();
    
    if (signaturesData.error) {
      throw new Error(`Solana RPC error: ${signaturesData.error.message}`);
    }
    
    console.log(`    🔍 Found ${signaturesData.result.length} signatures, fetching transaction details...`);
    
    // 2. Get transaction details for each signature
    let processedCount = 0;
    let skippedByDate = 0;
    let errorCount = 0;
    
    for (const sig of signaturesData.result) {
      const txDate = new Date(sig.blockTime * 1000);
      console.log(`    📅 Transaction ${sig.signature.substring(0, 10)}... date: ${txDate.toISOString()} vs filter: ${filterDate.toISOString()}`);
      
      if (txDate < filterDate) {
        skippedByDate++;
        console.log(`    ⏭️ Skipping transaction (before filter date): ${txDate.toISOString()}`);
        continue;
      }
      
      processedCount++;
      
      try {
        const txPayload = {
          jsonrpc: "2.0",
          id: 1,
          method: "getTransaction",
          params: [sig.signature, { encoding: "json", maxSupportedTransactionVersion: 0 }]
        };
        
        const txResponse = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(txPayload)
        });
        
        if (txResponse.ok) {
          const txData = await txResponse.json();
          
          if (txData.result && txData.result.meta && !sig.err) {
            console.log(`    🔍 Processing transaction: ${sig.signature.substring(0, 10)}...`);
            
            // Method 1: Use pre/post balance changes (more reliable)
            const preBalances = txData.result.meta.preBalances || [];
            const postBalances = txData.result.meta.postBalances || [];
            const accountKeys = txData.result.transaction?.message?.accountKeys || [];
            
            // Find our wallet's index in the account keys
            const walletIndex = accountKeys.findIndex(key => key === address);
            console.log(`    🔍 Wallet index in transaction: ${walletIndex}`);
            
            if (walletIndex !== -1 && preBalances[walletIndex] !== undefined && postBalances[walletIndex] !== undefined) {
              const preBalance = preBalances[walletIndex];
              const postBalance = postBalances[walletIndex];
              const balanceChange = postBalance - preBalance;
              
              console.log(`    💰 Balance change: ${preBalance} -> ${postBalance} (${balanceChange} lamports)`);
              
              if (Math.abs(balanceChange) > 0) {
                const solAmount = Math.abs(balanceChange / 1e9);
                const isDeposit = balanceChange > 0;
                
                console.log(`    ✅ Found SOL transaction: ${solAmount} SOL (${isDeposit ? 'deposit' : 'withdrawal'})`);
                
                transactions.push({
                  platform: "Solana Wallet",
                  type: isDeposit ? "deposit" : "withdrawal", 
                  asset: "SOL",
                  amount: solAmount.toString(),
                  timestamp: txDate.toISOString(),
                  from_address: isDeposit ? "External" : address,
                  to_address: isDeposit ? address : "External",
                  tx_id: sig.signature,
                  status: "Completed",
                  network: "SOL",
                  api_source: "Solana_RPC_Balance_Change"
                });
              } else {
                console.log(`    ⚠️ No balance change detected for wallet`);
              }
            } else {
              console.log(`    ⚠️ Wallet not found in transaction account keys or missing balance data`);
            }
            
            // Method 2: Also check for SPL token balance changes
            const preTokenBalances = txData.result.meta.preTokenBalances || [];
            const postTokenBalances = txData.result.meta.postTokenBalances || [];
            
            for (const postTokenBalance of postTokenBalances) {
              if (postTokenBalance.owner === address) {
                const preTokenBalance = preTokenBalances.find(ptb => 
                  ptb.accountIndex === postTokenBalance.accountIndex && ptb.mint === postTokenBalance.mint
                );
                
                if (preTokenBalance) {
                  const preAmount = parseFloat(preTokenBalance.uiTokenAmount.uiAmount) || 0;
                  const postAmount = parseFloat(postTokenBalance.uiTokenAmount.uiAmount) || 0;
                  const tokenChange = postAmount - preAmount;
                  
                  if (Math.abs(tokenChange) > 0) {
                    const isDeposit = tokenChange > 0;
                    console.log(`    ✅ Found SPL token transaction: ${Math.abs(tokenChange)} ${postTokenBalance.mint.substring(0, 8)}... (${isDeposit ? 'deposit' : 'withdrawal'})`);
                    
                    transactions.push({
                      platform: "Solana Wallet",
                      type: isDeposit ? "deposit" : "withdrawal",
                      asset: postTokenBalance.mint.substring(0, 8) + "...",
                      amount: Math.abs(tokenChange).toString(),
                      timestamp: txDate.toISOString(),
                      from_address: isDeposit ? "External" : address,
                      to_address: isDeposit ? address : "External", 
                      tx_id: sig.signature,
                      status: "Completed",
                      network: "SOL",
                      api_source: "Solana_SPL_Balance_Change"
                    });
                  }
                }
              }
            }
          } else {
            console.log(`    ⚠️ Transaction has no result, meta, or has error: ${sig.err || 'unknown'}`);
          }
        } else {
          console.log(`    ❌ Failed to fetch transaction details: ${txResponse.status}`);
        }
      } catch (txError) {
        errorCount++;
        console.log(`    ❌ Error fetching transaction ${sig.signature}: ${txError.message}`);
        // Skip failed transactions instead of adding fallback
      }
    }
    
    console.log(`    📊 Solana processing summary:`);
    console.log(`    📊 - Total signatures: ${signaturesData.result.length}`);
    console.log(`    📊 - Processed: ${processedCount}`);
    console.log(`    📊 - Skipped by date: ${skippedByDate}`);
    console.log(`    📊 - Errors: ${errorCount}`);
    console.log(`    📊 - Transactions found: ${transactions.length}`);
    
    // SPL token transactions are now handled in the main transaction loop above
    

    
    console.log(`  📊 Solana total found: ${transactions.length} transactions`);
    
    // Log currency breakdown
    const currencyBreakdown = {};
    transactions.forEach(t => {
      currencyBreakdown[t.asset] = (currencyBreakdown[t.asset] || 0) + 1;
    });
    console.log(`  📊 Currency breakdown:`, currencyBreakdown);
    
    return transactions;
    
  } catch (error) {
    console.error("Solana API error:", error);
    throw error;
  }
}

// ===========================================
// FIXED FILTERING WITH EXTENDED CURRENCIES
// ===========================================

async function getExistingTransactionIds(sheets, spreadsheetId, sheetType /* 'Withdrawals' | 'Deposits' */) {
  const existingTxIds = new Set();
  try {
    const range = `${sheetType}!F7:L`;
    console.log(`🔍 Reading existing TX IDs for ${sheetType} from ${range}...`);
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range
    });
    const data = response.data.values || [];
    data.forEach(row => {
      if (row[6]) existingTxIds.add(row[6].toString().trim().toLowerCase());
    });
    console.log(`✅ Found ${existingTxIds.size} existing ${sheetType.toLowerCase()} TX IDs`);
    return existingTxIds;
  } catch (error) {
    console.log(`⚠️ Could not read ${sheetType} sheet (might be empty)`);
    return new Set();
  }
}

function removeDuplicateTransactions(transactions, existingWithdrawalIds, existingDepositIds) {
  let duplicateCount = 0;
  let totalCount = transactions.length;
  
  const newTransactions = transactions.filter(tx => {
    const txId = tx.tx_id?.toString().trim().toLowerCase();
    
    if (!txId) {
      return true;
    }
    
    // Check if this transaction ID already exists in the SAME sheet type only
    const isDuplicate = (tx.type === 'withdrawal' && existingWithdrawalIds.has(txId)) ||
                        (tx.type === 'deposit' && existingDepositIds.has(txId));
    
    if (isDuplicate) {
      duplicateCount++;
      console.log(`🔄 Removing duplicate ${tx.type}: ${txId} (already exists in ${tx.type} sheet)`);
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
    'ADA': 1.47,
    'DOT': 18.50,
    'MATIC': 1.84,
    'LINK': 44.10,
    'UNI': 25.75,
    'LTC': 257.25,
    'XRP': 2.20,
    'AVAX': 117.00,
    'ATOM': 29.50,
    'NEAR': 22.00,
    'FTM': 2.94,
    'ALGO': 1.10,
    'VET': 0.11,
    'ICP': 36.75,
    'SAND': 1.84,
    'MANA': 1.47,
    'CRO': 0.44,
    'SHIB': 0.00009,
    'DOGE': 0.26,
    'BCH': 1468.00,
    'ETC': 92.40,
    // Additional common ERC-20 tokens
    'DAI': 3.67,
    'WBTC': 220200,
    'WETH': 11010,
    'AAVE': 2200,
    'COMP': 1100,
    'MKR': 11000,
    'SNX': 110,
    'CRV': 2.20,
    'YFI': 22000,
    'SUSHI': 2.20,
    '1INCH': 2.20,
    'BAL': 110,
    'REN': 0.37,
    'KNC': 2.20,
    'ZRX': 2.20,
    'BAT': 2.20,
    'REP': 110,
    'OMG': 2.20,
    'ENJ': 2.20,
    'CHZ': 0.37,
    'HOT': 0.00009,
    'ANKR': 0.37,
    'CKB': 0.11,
    'NEO': 220,
    'GAS': 22,
    'ONT': 2.20,
    'QTUM': 22,
    'ZEC': 220,
    'XMR': 2200,
    'DASH': 220,
    'EOS': 2.20,
    'IOTA': 2.20,
    'XLM': 0.37,
    'NANO': 2.20,
    'VET': 0.11,
    'THETA': 2.20,
    'FIL': 22,
    'HNT': 22,
    'CHIA': 22,
    'XCH': 22,
    // Additional SPL tokens
    'RAY': 22,
    'SRM': 2.20,
    'ORCA': 2.20,
    'STEP': 2.20,
    'ALEPH': 2.20,
    'COPE': 2.20,
    'SNY': 2.20,
    'SLRS': 2.20,
    'MSOL': 181.50,
    'STSOL': 181.50,
    'JSOL': 181.50,
    'SCNSOL': 181.50
  };

  const minValueAED = 1.0;
  let filteredCount = 0;
  let totalCount = transactions.length;
  const filteredTransactions = [];
  const unknownCurrencies = new Set();

  const keepTransactions = transactions.filter(tx => {
    const amount = parseFloat(tx.amount) || 0;
    let priceAED = pricesAED[tx.asset];
    
    // For unknown currencies, use a conservative default of 1 AED to enable dust filtering
    if (!priceAED) {
      priceAED = 1.0;
      unknownCurrencies.add(tx.asset);
      console.log(`⚠️ Unknown currency ${tx.asset} - using default 1 AED for dust filter`);
    }
    
    const aedValue = amount * priceAED;
    
    // Keep only transactions >= 1 AED across all assets
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
    
    // Get existing transaction IDs to avoid duplicates (per-sheet)
    const existingWithdrawalIds = await getExistingTransactionIds(sheets, spreadsheetId, 'Withdrawals');
    const existingDepositIds = await getExistingTransactionIds(sheets, spreadsheetId, 'Deposits');
    
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
    
    // Debug: Log all TRON transactions to see their types
    const tronTransactions = sortedTransactions.filter(tx => tx.platform === "TRON Wallet");
    console.log(`🔍 TRON transactions found: ${tronTransactions.length}`);
    tronTransactions.forEach((tx, i) => {
      console.log(`🔍 TRON TX ${i + 1}: type=${tx.type}, asset=${tx.asset}, amount=${tx.amount}, tx_id=${tx.tx_id}, platform=${tx.platform}`);
    });
    
    // Debug: Log all TRX transactions specifically
    const trxTransactions = sortedTransactions.filter(tx => tx.asset === "TRX");
    console.log(`🔍 TRX transactions found: ${trxTransactions.length}`);
    trxTransactions.forEach((tx, i) => {
      console.log(`🔍 TRX TX ${i + 1}: type=${tx.type}, asset=${tx.asset}, amount=${tx.amount}, tx_id=${tx.tx_id}, platform=${tx.platform}, from=${tx.from_address}, to=${tx.to_address}`);
    });
    
    // Debug: Log all transactions by platform to see if R TRC20 is being processed
    const platformGroups = {};
    sortedTransactions.forEach(tx => {
      if (!platformGroups[tx.platform]) {
        platformGroups[tx.platform] = [];
      }
      platformGroups[tx.platform].push(tx);
    });
    
    console.log(`🔍 Transactions by platform:`);
    Object.keys(platformGroups).forEach(platform => {
      const deposits = platformGroups[platform].filter(tx => tx.type === 'deposit').length;
      const withdrawals = platformGroups[platform].filter(tx => tx.type === 'withdrawal').length;
      console.log(`🔍 ${platform}: ${deposits} deposits, ${withdrawals} withdrawals`);
    });
    
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
      
      // Debug: Log all TRX withdrawals specifically
      const trxWithdrawals = withdrawals.filter(tx => tx.asset === "TRX");
      console.log(`📤 TRX withdrawals found: ${trxWithdrawals.length}`);
      trxWithdrawals.forEach((tx, i) => {
        console.log(`📤 TRX Withdrawal ${i + 1}: type=${tx.type}, asset=${tx.asset}, amount=${tx.amount}, tx_id=${tx.tx_id}, platform=${tx.platform}, from=${tx.from_address}, to=${tx.to_address}`);
      });
      
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
      
      // Debug: Log all TRX deposits specifically
      const trxDeposits = deposits.filter(tx => tx.asset === "TRX");
      console.log(`📝 TRX deposits found: ${trxDeposits.length}`);
      trxDeposits.forEach((tx, i) => {
        console.log(`📝 TRX Deposit ${i + 1}: type=${tx.type}, asset=${tx.asset}, amount=${tx.amount}, tx_id=${tx.tx_id}, platform=${tx.platform}, from=${tx.from_address}, to=${tx.to_address}`);
      });
      
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
// BITGET API FUNCTIONS (V2 API - Updated Dec 2024)
// ===========================================

async function testBitgetAccountFixed(config, filterDate, debugLogs) {
  try {
    console.log(`🔧 Processing Bitget ${config.name} with authentication...`);
    debugLogs.push(`🔧 [Bitget ${config.name}] Testing V2 API authentication...`);
    
    // Test connection with Bitget authentication
    const timestamp = Date.now().toString();
    const testEndpoint = "https://api.bitget.com/api/v2/spot/account/assets";
    
    // Bitget signature creation - FIXED according to official documentation
    const method = 'GET';
    const requestPath = '/api/v2/spot/account/assets';
    const body = ''; // Empty body for GET request
    
    // Create signature string: timestamp + method + requestPath + body
    const signString = timestamp + method + requestPath + body;
    const signature = crypto.createHmac('sha256', config.apiSecret).update(signString).digest('base64');
    
    debugLogs.push(`🔍 [Bitget ${config.name}] Request: ${testEndpoint}`);
    debugLogs.push(`🔍 [Bitget ${config.name}] Sign String: ${signString.substring(0, 60)}...`);
    
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
    console.log(`    - URL: ${testEndpoint} (V2 API)`);
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
    debugLogs.push(`📊 [Bitget ${config.name}] API Response: Status=${testResponse.status}, Code=${testData.code}, Msg=${testData.msg || 'N/A'}`);
    
    // If first attempt fails, try with different API key format
    if (!testResponse.ok || testData.code !== '00000') {
      console.log(`    🔄 Trying alternative API key format...`);
      debugLogs.push(`🔄 [Bitget ${config.name}] First attempt failed, trying without prefix...`);
      
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
      debugLogs.push(`📊 [Bitget ${config.name}] Second attempt: Status=${testResponse.status}, Code=${testData.code}, Msg=${testData.msg || 'N/A'}`);
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
      
      debugLogs.push(`❌ [Bitget ${config.name}] Auth FAILED: ${testData.msg || testResponse.status} (Code: ${testData.code})`);
      
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
    debugLogs.push(`✅ [Bitget ${config.name}] Authentication SUCCESS - fetching transactions...`);

    // Fetch transactions
    let transactions = [];
    let transactionBreakdown = {
      deposits: 0,
      withdrawals: 0,
      p2p: 0
    };

    try {
      // Fetch deposits
      debugLogs.push(`💰 [Bitget ${config.name}] Fetching deposits...`);
      const deposits = await fetchBitgetDepositsFixed(config, filterDate);
      transactions.push(...deposits);
      transactionBreakdown.deposits = deposits.length;
      console.log(`  💰 ${config.name} deposits: ${deposits.length}`);
      debugLogs.push(`💰 [Bitget ${config.name}] Found ${deposits.length} deposits`);

      // Fetch withdrawals
      debugLogs.push(`📤 [Bitget ${config.name}] Fetching withdrawals...`);
      const withdrawals = await fetchBitgetWithdrawalsFixed(config, filterDate);
      transactions.push(...withdrawals);
      transactionBreakdown.withdrawals = withdrawals.length;
      console.log(`  📤 ${config.name} withdrawals: ${withdrawals.length}`);
      debugLogs.push(`📤 [Bitget ${config.name}] Found ${withdrawals.length} withdrawals`);

      // Fetch P2P transactions
      debugLogs.push(`🤝 [Bitget ${config.name}] Fetching P2P/Futures...`);
      const p2pTransactions = await fetchBitgetP2PFixed(config, filterDate);
      transactions.push(...p2pTransactions);
      transactionBreakdown.p2p = p2pTransactions.length;
      console.log(`  🤝 ${config.name} P2P: ${p2pTransactions.length}`);
      debugLogs.push(`🤝 [Bitget ${config.name}] Found ${p2pTransactions.length} P2P/Futures`);

    } catch (txError) {
      console.log(`Bitget transaction fetch failed: ${txError.message}`);
      debugLogs.push(`❌ [Bitget ${config.name}] Transaction fetch error: ${txError.message}`);
    }

    const statusNotes = `🔧 Bitget: ${transactionBreakdown.deposits}D + ${transactionBreakdown.withdrawals}W + ${transactionBreakdown.p2p}P2P = ${transactions.length} total`;
    debugLogs.push(`📊 [Bitget ${config.name}] Total: ${transactions.length} transactions (${statusNotes})`);

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
    console.log(`❌ Bitget ${config.name} fatal error: ${error.message}`);
    debugLogs.push(`❌ [Bitget ${config.name}] FATAL ERROR: ${error.message}`);
    debugLogs.push(`❌ [Bitget ${config.name}] Stack: ${error.stack}`);
    
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
    // V2 API: Use new deposit records endpoint
    const endpoint = "https://api.bitget.com/api/v2/spot/wallet/deposit-records";
    
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
    
    const requestPath = '/api/v2/spot/wallet/deposit-records?' + queryString;
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
            platform: config.name,
            type: 'deposit',
            asset: deposit.coin,
            amount: (deposit.size || deposit.amount || '0').toString(), // V2 uses 'size', V1 used 'amount'
            timestamp: new Date(parseInt(deposit.cTime)).toISOString(),
            from_address: deposit.fromAddress || 'External',
            to_address: config.name,
            tx_id: deposit.tradeId || deposit.txId || deposit.orderId || deposit.id, // V2 uses 'tradeId'
            status: deposit.status === 'success' ? 'Completed' : 'Pending',
            network: deposit.chain,
            api_source: 'Bitget_Deposit_V2'
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
    // V2 API: Use new withdrawal records endpoint
    const endpoint = "https://api.bitget.com/api/v2/spot/wallet/withdrawal-records";
    
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
    
    const requestPath = '/api/v2/spot/wallet/withdrawal-records?' + queryString;
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
            platform: config.name,
            type: 'withdrawal',
            asset: withdrawal.coin,
            amount: (withdrawal.size || withdrawal.amount || '0').toString(), // V2 uses 'size', V1 used 'amount'
            timestamp: new Date(parseInt(withdrawal.cTime)).toISOString(),
            from_address: config.name,
            to_address: withdrawal.toAddress || 'External',
            tx_id: withdrawal.tradeId || withdrawal.txId || withdrawal.orderId || withdrawal.id, // V2 uses 'tradeId'
            status: withdrawal.status === 'success' ? 'Completed' : 'Pending',
            network: withdrawal.chain,
            api_source: 'Bitget_Withdrawal_V2'
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
    // V2 API: Account bill endpoint (Note: May not be available in V2, will fail gracefully)
    const endpoint = "https://api.bitget.com/api/v2/mix/account/account-bill";
    
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
    
    const requestPath = '/api/v2/mix/account/account-bill?' + queryString;
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
      console.log(`    ⚠️ Bitget P2P/Futures endpoint not available (this is OK - deposits/withdrawals are the main sources): ${data.msg || response.status}`);
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
            platform: config.name,
            type: type,
            asset: transaction.marginCoin || 'USDT',
            amount: transaction.amount.toString(),
            timestamp: new Date(parseInt(transaction.ctime)).toISOString(),
            from_address: type === 'deposit' ? 'External' : config.name,
            to_address: type === 'deposit' ? config.name : 'External',
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

/**
 * TEST FUNCTION: Debug TRX deposit issues specifically
 */
async function debugTronDeposits() {
  try {
    console.log("🔍 Starting TRX deposit debugging...");
    
    // Test with a specific TRON wallet address
    const testAddress = "TThTR3mtzippXkFkG3GHzbwcMRsiiWivDN"; // R TRC20 wallet
    const filterDate = new Date();
    filterDate.setDate(filterDate.getDate() - 30); // Last 30 days
    
    console.log(`🔍 Testing TRON wallet: ${testAddress}`);
    console.log(`🔍 Filter date: ${filterDate.toISOString()}`);
    
    // Fetch native TRX transfers
    const trxEndpoint = `https://api.trongrid.io/v1/accounts/${testAddress}/transactions?limit=50&only_confirmed=true&order_by=block_timestamp,desc`;
    console.log(`🔍 Fetching from: ${trxEndpoint}`);
    
    const trxResponse = await fetch(trxEndpoint);
    if (!trxResponse.ok) {
      throw new Error(`TRON API error: ${trxResponse.status}`);
    }
    
    const trxData = await trxResponse.json();
    console.log(`🔍 Raw TRX data received: ${trxData.data ? trxData.data.length : 0} transactions`);
    
    let depositCount = 0;
    let withdrawalCount = 0;
    let skippedCount = 0;
    
    if (trxData.data) {
      trxData.data.forEach((tx, index) => {
        const txDate = new Date(tx.block_timestamp);
        console.log(`\n🔍 Transaction ${index + 1}: ${tx.txID}`);
        console.log(`🔍 Date: ${txDate.toISOString()}`);
        console.log(`🔍 Block timestamp: ${tx.block_timestamp}`);
        
        if (txDate < filterDate) {
          console.log(`🔍 ⏰ Skipping - before filter date`);
          return;
        }
        
        if (tx.raw_data && tx.raw_data.contract) {
          tx.raw_data.contract.forEach((contract, contractIndex) => {
            console.log(`🔍 Contract ${contractIndex + 1}: ${contract.type}`);
            
            if (contract.type === "TransferContract") {
              const value = contract.parameter.value;
              const normalizedAddress = testAddress.trim();
              const normalizedToAddress = value.to_address ? tronHexToBase58(value.to_address.trim()) : '';
              const normalizedFromAddress = value.owner_address ? tronHexToBase58(value.owner_address.trim()) : '';
              
              const isDeposit = normalizedToAddress && normalizedToAddress === normalizedAddress;
              const isWithdrawal = normalizedFromAddress && normalizedFromAddress === normalizedAddress;
              const amount = (value.amount / 1000000).toString();
              
              console.log(`🔍 Transfer details:`);
              console.log(`   - From (raw): ${value.owner_address}  -> base58: ${normalizedFromAddress}`);
              console.log(`   - To   (raw): ${value.to_address}  -> base58: ${normalizedToAddress}`);
              console.log(`   - Amount: ${amount} TRX`);
              console.log(`   - Is deposit: ${isDeposit}`);
              console.log(`   - Is withdrawal: ${isWithdrawal}`);
              console.log(`   - Address match: ${normalizedToAddress === normalizedAddress || normalizedFromAddress === normalizedAddress}`);
              
              if (isDeposit) {
                depositCount++;
                console.log(`✅ DEPOSIT DETECTED`);
              } else if (isWithdrawal) {
                withdrawalCount++;
                console.log(`📤 WITHDRAWAL DETECTED`);
              } else {
                skippedCount++;
                console.log(`❌ SKIPPED - wallet not involved`);
              }
            }
          });
        } else {
          console.log(`🔍 No raw_data or contracts found`);
        }
      });
    }
    
    console.log(`\n📊 TRX Transaction Analysis:`);
    console.log(`   - Total transactions: ${trxData.data ? trxData.data.length : 0}`);
    console.log(`   - Deposits found: ${depositCount}`);
    console.log(`   - Withdrawals found: ${withdrawalCount}`);
    console.log(`   - Skipped: ${skippedCount}`);
    
    return {
      success: true,
      totalTransactions: trxData.data ? trxData.data.length : 0,
      deposits: depositCount,
      withdrawals: withdrawalCount,
      skipped: skippedCount,
      address: testAddress
    };
    
  } catch (error) {
    console.error("❌ Error in TRX deposit debugging:", error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Handle test_tron_wallet action - Fetches ALL TRX transactions for a specific wallet
 */
async function handleTronWalletTest(req, res, debugLogs) {
  try {
    const { walletAddress, walletName, startDate, skipFiltering } = req.body;
    debugLogs.push(`🧪 Testing TRON wallet: ${walletName} (${walletAddress})`);
    
    if (!walletAddress) {
      return res.status(400).json({
        success: false,
        error: "walletAddress is required",
        debugLogs
      });
    }
    
    // Use extended date range for testing or provided startDate
    const filterDate = startDate ? new Date(startDate) : new Date('2024-01-01');
    debugLogs.push(`🧪 Using filter date: ${filterDate.toISOString()}`);
    
    // Fetch TRON transactions using existing function
    const transactions = await fetchTronEnhanced(walletAddress, filterDate);
    debugLogs.push(`🧪 Raw transactions fetched: ${transactions.length}`);
    
    // Add detailed debug information for each transaction
    const enhancedTransactions = transactions.map(tx => {
      const isDeposit = tx.to_address === walletAddress;
      const isWithdrawal = tx.from_address === walletAddress;
      
      return {
        ...tx,
        debug_info: {
          wallet_address: walletAddress,
          to_address_match: tx.to_address === walletAddress,
          from_address_match: tx.from_address === walletAddress,
          determined_type: isDeposit ? 'DEPOSIT' : isWithdrawal ? 'WITHDRAWAL' : 'UNKNOWN',
          actual_type: tx.type
        }
      };
    });
    
    // Group by type for analysis
    const deposits = enhancedTransactions.filter(tx => tx.type === 'deposit');
    const withdrawals = enhancedTransactions.filter(tx => tx.type === 'withdrawal');
    const native_trx = enhancedTransactions.filter(tx => tx.asset === 'TRX');
    const trc20_tokens = enhancedTransactions.filter(tx => tx.asset !== 'TRX');
    
    debugLogs.push(`🧪 Analysis: ${deposits.length} deposits, ${withdrawals.length} withdrawals`);
    debugLogs.push(`🧪 Assets: ${native_trx.length} native TRX, ${trc20_tokens.length} TRC-20 tokens`);
    
    // Log each transaction for debugging
    enhancedTransactions.forEach((tx, i) => {
      debugLogs.push(`🧪 TX ${i + 1}: ${tx.asset} ${tx.type} ${tx.amount} | ${tx.tx_id} | From: ${tx.from_address?.substring(0, 10)}... | To: ${tx.to_address?.substring(0, 10)}...`);
    });
    
    return res.json({
      success: true,
      walletAddress,
      walletName,
      filterDate: filterDate.toISOString(),
      skipFiltering,
      transactions: enhancedTransactions,
      summary: {
        total: enhancedTransactions.length,
        deposits: deposits.length,
        withdrawals: withdrawals.length,
        native_trx: native_trx.length,
        trc20_tokens: trc20_tokens.length,
        assets: [...new Set(enhancedTransactions.map(tx => tx.asset))]
      },
      debugLogs
    });
    
  } catch (error) {
    debugLogs.push(`❌ Error in TRON wallet test: ${error.message}`);
    return res.status(500).json({
      success: false,
      error: error.message,
      debugLogs
    });
  }
}

/**
 * Handle test_tron_wallet_detailed action - Tests both native TRX and TRC-20 endpoints separately
 */
async function handleTronWalletDetailedTest(req, res, debugLogs) {
  try {
    const { walletAddress, walletName, startDate, testBothEndpoints } = req.body;
    debugLogs.push(`🧪 Detailed TRON test for: ${walletName} (${walletAddress})`);
    
    if (!walletAddress) {
      return res.status(400).json({
        success: false,
        error: "walletAddress is required",
        debugLogs
      });
    }
    
    const filterDate = startDate ? new Date(startDate) : new Date('2024-01-01');
    debugLogs.push(`🧪 Using filter date: ${filterDate.toISOString()}`);
    
    let nativeResults = { transactions: [], error: null };
    let trc20Results = { transactions: [], error: null };
    
    // ===========================================
    // TEST 1: NATIVE TRX TRANSACTIONS
    // ===========================================
    debugLogs.push(`🧪 Testing NATIVE TRX endpoint...`);
    try {
      const trxEndpoint = `https://api.trongrid.io/v1/accounts/${walletAddress}/transactions?limit=200&only_confirmed=true&order_by=block_timestamp,desc`;
      debugLogs.push(`🔗 Native TRX URL: ${trxEndpoint}`);
      
      const trxResponse = await fetch(trxEndpoint);
      const trxStatusCode = trxResponse.status;
      debugLogs.push(`📡 Native TRX API Status: ${trxStatusCode}`);
      
      if (trxResponse.ok) {
        const trxData = await trxResponse.json();
        debugLogs.push(`📊 Native TRX API Response: ${trxData.data ? trxData.data.length : 0} raw transactions`);
        
        if (trxData.data) {
          // Process native TRX transactions
          trxData.data.forEach(tx => {
            const txDate = new Date(tx.block_timestamp);
            if (txDate < filterDate) return;
            
            if (tx.raw_data && tx.raw_data.contract) {
              tx.raw_data.contract.forEach(contract => {
                if (contract.type === "TransferContract") {
                  const value = contract.parameter.value;
                  const normalizedAddress = walletAddress.trim();
                  const normalizedToAddress = value.to_address ? tronHexToBase58(value.to_address.trim()) : '';
                  const normalizedFromAddress = value.owner_address ? tronHexToBase58(value.owner_address.trim()) : '';
                  
                  const isDeposit = normalizedToAddress === normalizedAddress;
                  const isWithdrawal = normalizedFromAddress === normalizedAddress;
                  
                  if (isDeposit || isWithdrawal) {
                    const amount = (value.amount / 1000000).toString();
                    const type = isDeposit ? "deposit" : "withdrawal";
                    
                    nativeResults.transactions.push({
                      timestamp: txDate.toISOString(),
                      platform: "TRON Wallet",
                      type: type,
                      asset: "TRX",
                      amount: amount,
                      from_address: normalizedFromAddress,
                      to_address: normalizedToAddress,
                      tx_id: tx.txID,
                      status: "Completed",
                      network: "TRON",
                      api_source: "TronGrid-Native",
                      debug_info: {
                        endpoint_type: "NATIVE_TRX",
                        wallet_address: walletAddress,
                        to_address_match: isDeposit,
                        from_address_match: isWithdrawal,
                        determined_type: type,
                        contract_type: contract.type
                      }
                    });
                    
                    debugLogs.push(`✅ Native TRX ${type.toUpperCase()}: ${amount} TRX | TX: ${tx.txID}`);
                  }
                }
              });
            }
          });
        }
      } else {
        nativeResults.error = `API Error ${trxStatusCode}`;
        debugLogs.push(`❌ Native TRX API Error: ${trxStatusCode}`);
      }
    } catch (nativeError) {
      nativeResults.error = nativeError.message;
      debugLogs.push(`❌ Native TRX Exception: ${nativeError.message}`);
    }
    
    // ===========================================
    // TEST 2: TRC-20 TOKEN TRANSACTIONS  
    // ===========================================
    debugLogs.push(`🧪 Testing TRC-20 endpoint...`);
    try {
      const trc20Endpoint = `https://api.trongrid.io/v1/accounts/${walletAddress}/transactions/trc20?limit=200&only_confirmed=true&order_by=block_timestamp,desc`;
      debugLogs.push(`🔗 TRC-20 URL: ${trc20Endpoint}`);
      
      const trc20Response = await fetch(trc20Endpoint);
      const trc20StatusCode = trc20Response.status;
      debugLogs.push(`📡 TRC-20 API Status: ${trc20StatusCode}`);
      
      if (trc20Response.ok) {
        const trc20Data = await trc20Response.json();
        debugLogs.push(`📊 TRC-20 API Response: ${trc20Data.data ? trc20Data.data.length : 0} raw transactions`);
        
        if (trc20Data.data) {
          // Process TRC-20 transactions
          trc20Data.data.forEach(tx => {
            const txDate = new Date(tx.block_timestamp);
            if (txDate < filterDate) return;
            
            const normalizedAddress = walletAddress.trim();
            const normalizedToAddress = tx.to ? tx.to.trim() : '';
            const normalizedFromAddress = tx.from ? tx.from.trim() : '';
            
            const isDeposit = normalizedToAddress === normalizedAddress;
            const isWithdrawal = normalizedFromAddress === normalizedAddress;
            
            if (isDeposit || isWithdrawal) {
              const tokenSymbol = tx.token_info?.symbol || 'UNKNOWN';
              const decimals = tx.token_info?.decimals || 6;
              const amount = (parseFloat(tx.value) / Math.pow(10, decimals)).toString();
              const type = isDeposit ? "deposit" : "withdrawal";
              
              trc20Results.transactions.push({
                timestamp: txDate.toISOString(),
                platform: "TRON Wallet", 
                type: type,
                asset: tokenSymbol,
                amount: amount,
                from_address: tx.from,
                to_address: tx.to,
                tx_id: tx.transaction_id,
                status: "Completed",
                network: "TRON",
                api_source: "TronGrid-TRC20",
                debug_info: {
                  endpoint_type: "TRC20_TOKENS",
                  wallet_address: walletAddress,
                  to_address_match: isDeposit,
                  from_address_match: isWithdrawal,
                  determined_type: type,
                  token_symbol: tokenSymbol,
                  decimals: decimals,
                  raw_value: tx.value
                }
              });
              
              debugLogs.push(`✅ TRC-20 ${type.toUpperCase()}: ${amount} ${tokenSymbol} | TX: ${tx.transaction_id}`);
            }
          });
        }
      } else {
        trc20Results.error = `API Error ${trc20StatusCode}`;
        debugLogs.push(`❌ TRC-20 API Error: ${trc20StatusCode}`);
      }
    } catch (trc20Error) {
      trc20Results.error = trc20Error.message;
      debugLogs.push(`❌ TRC-20 Exception: ${trc20Error.message}`);
    }
    
    // ===========================================
    // COMBINE AND ANALYZE RESULTS
    // ===========================================
    const allTransactions = [...nativeResults.transactions, ...trc20Results.transactions];
    
    const nativeDeposits = nativeResults.transactions.filter(tx => tx.type === 'deposit').length;
    const nativeWithdrawals = nativeResults.transactions.filter(tx => tx.type === 'withdrawal').length;
    const trc20Deposits = trc20Results.transactions.filter(tx => tx.type === 'deposit').length;
    const trc20Withdrawals = trc20Results.transactions.filter(tx => tx.type === 'withdrawal').length;
    
    debugLogs.push(`📊 NATIVE TRX: ${nativeDeposits} deposits, ${nativeWithdrawals} withdrawals (Total: ${nativeResults.transactions.length})`);
    debugLogs.push(`📊 TRC-20: ${trc20Deposits} deposits, ${trc20Withdrawals} withdrawals (Total: ${trc20Results.transactions.length})`);
    debugLogs.push(`📊 COMBINED: ${allTransactions.length} total transactions`);
    
    return res.json({
      success: true,
      walletAddress,
      walletName,
      filterDate: filterDate.toISOString(),
      endpoints_tested: {
        native_trx: {
          url: `https://api.trongrid.io/v1/accounts/${walletAddress}/transactions?limit=200&order_by=block_timestamp,desc`,
          status: nativeResults.error ? 'ERROR' : 'SUCCESS',
          error: nativeResults.error,
          transactions: nativeResults.transactions.length,
          deposits: nativeDeposits,
          withdrawals: nativeWithdrawals
        },
        trc20_tokens: {
          url: `https://api.trongrid.io/v1/accounts/${walletAddress}/transactions/trc20?limit=200&order_by=block_timestamp,desc`,
          status: trc20Results.error ? 'ERROR' : 'SUCCESS', 
          error: trc20Results.error,
          transactions: trc20Results.transactions.length,
          deposits: trc20Deposits,
          withdrawals: trc20Withdrawals
        }
      },
      transactions: allTransactions,
      summary: {
        total: allTransactions.length,
        native_trx_total: nativeResults.transactions.length,
        trc20_total: trc20Results.transactions.length,
        deposits: nativeDeposits + trc20Deposits,
        withdrawals: nativeWithdrawals + trc20Withdrawals,
        assets: [...new Set(allTransactions.map(tx => tx.asset))]
      },
      debugLogs
    });
    
  } catch (error) {
    debugLogs.push(`❌ Error in detailed TRON wallet test: ${error.message}`);
    return res.status(500).json({
      success: false,
      error: error.message,
      debugLogs
    });
  }
}