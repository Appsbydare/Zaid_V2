// ===========================================
// FIXED VERSION - crypto-to-sheets.js
// Fixed: ByBit V5 auth, Binance P2P endpoints, currency rates, Google Sheets targeting
// ===========================================

import { GoogleAuth } from 'google-auth-library';
import { google } from 'googleapis';
import crypto from 'crypto';

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
    // STEP 1: FIXED BINANCE APIS
    // ===========================================
    debugLogs.push('🔧 Testing Binance APIs with FIXED endpoints...');
    
    // Read API credentials from Settings sheet
    const apiCredentials = await readApiCredentialsFromSheet(sheets, spreadsheetId);
    
    // Set global variables for other functions to access
    global.etherscanApiKey = apiCredentials.ETHERSCAN_API_KEY?.apiKey || "SP8YA4W8RDB85G9129BTDHY72ADBZ6USHA";
    
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

      debugLogs.push(`🔧 Processing ${account.name} with FIXES...`);
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
    // STEP 2: FIXED BYBIT API (V5 AUTHENTICATION)
    // ===========================================
    if (apiCredentials.BYBIT_API_SECRET?.apiKey && apiCredentials.BYBIT_API_SECRET?.apiSecret) {
      debugLogs.push('🔧 Testing ByBit with FIXED V5 authentication...');
              const bybitResult = await testByBitAccountFixed({
          name: "ByBit (CV)",
          apiKey: apiCredentials.BYBIT_API_SECRET.apiKey,
          apiSecret: apiCredentials.BYBIT_API_SECRET.apiSecret
        }, filterDate, debugLogs);
      
      apiStatusResults["ByBit (CV)"] = bybitResult.status;
      if (bybitResult.success) {
        allTransactions.push(...bybitResult.transactions);
        totalTransactionsFound += bybitResult.transactions.length;
        debugLogs.push(`✅ ByBit: ${bybitResult.transactions.length} transactions`);
      } else {
        debugLogs.push(`❌ ByBit: ${bybitResult.status.notes}`);
      }
    }

    // ===========================================
    // STEP 3: BLOCKCHAIN DATA (UNCHANGED)
    // ===========================================
    debugLogs.push('🔧 Fetching blockchain data...');
    
    const wallets = {
      BTC: "bc1qkuefzcmc6c8enw9f7a2e9w2hy964q3jgwcv35g",
      ETH: "0x856851a1d5111330729744f95238e5D810ba773c",
      TRON: "TAUDuQAZSTUH88xno1imPoKN25eJN6aJkN",
      SOL: "BURkHx6BNTqryY3sCqXcYNVkhN6Mz3ttDUdGQ6hXuX4n"
    };

    // Bitcoin API
    try {
      debugLogs.push('🔧 Testing Bitcoin API...');
      const btcTxs = await fetchBitcoinEnhanced(wallets.BTC, filterDate);
      allTransactions.push(...btcTxs);
      totalTransactionsFound += btcTxs.length;
      apiStatusResults['Bitcoin Wallet'] = {
        status: btcTxs.length > 0 ? 'Active' : 'Warning',
        lastSync: new Date().toISOString(),
        autoUpdate: 'Every Hour',
        notes: `🔧 ${btcTxs.length} transactions found`,
        transactionCount: btcTxs.length
      };
      debugLogs.push(`✅ Bitcoin: ${btcTxs.length} transactions`);
    } catch (error) {
      apiStatusResults['Bitcoin Wallet'] = {
        status: 'Error',
        lastSync: new Date().toISOString(),
        autoUpdate: 'Every Hour',
        notes: `❌ ${error.message}`,
        transactionCount: 0
      };
      debugLogs.push(`❌ Bitcoin error: ${error.message}`);
    }

    // Ethereum API
    try {
      debugLogs.push('🔧 Testing Ethereum API...');
      const ethTxs = await fetchEthereumEnhanced(wallets.ETH, filterDate);
      allTransactions.push(...ethTxs);
      totalTransactionsFound += ethTxs.length;
      apiStatusResults['Ethereum Wallet'] = {
        status: 'Active',
        lastSync: new Date().toISOString(),
        autoUpdate: 'Every Hour',
        notes: `🔧 ${ethTxs.length} transactions found`,
        transactionCount: ethTxs.length
      };
      debugLogs.push(`✅ Ethereum: ${ethTxs.length} transactions`);
    } catch (error) {
      apiStatusResults['Ethereum Wallet'] = {
        status: 'Error',
        lastSync: new Date().toISOString(),
        autoUpdate: 'Every Hour',
        notes: `❌ ${error.message}`,
        transactionCount: 0
      };
      debugLogs.push(`❌ Ethereum error: ${error.message}`);
    }

    // TRON API
    try {
      debugLogs.push('🔧 Testing TRON API...');
      const tronTxs = await fetchTronEnhanced(wallets.TRON, filterDate);
      allTransactions.push(...tronTxs);
      totalTransactionsFound += tronTxs.length;
      apiStatusResults['TRON Wallet'] = {
        status: 'Active',
        lastSync: new Date().toISOString(),
        autoUpdate: 'Every Hour',
        notes: `🔧 ${tronTxs.length} transactions found`,
        transactionCount: tronTxs.length
      };
      debugLogs.push(`✅ TRON: ${tronTxs.length} transactions`);
    } catch (error) {
      apiStatusResults['TRON Wallet'] = {
        status: 'Error',
        lastSync: new Date().toISOString(),
        autoUpdate: 'Every Hour',
        notes: `❌ ${error.message}`,
        transactionCount: 0
      };
      debugLogs.push(`❌ TRON error: ${error.message}`);
    }

    // Solana API
    try {
      debugLogs.push('🔧 Testing Solana API...');
      const solTxs = await fetchSolanaEnhanced(wallets.SOL, filterDate);
      allTransactions.push(...solTxs);
      totalTransactionsFound += solTxs.length;
      apiStatusResults['Solana Wallet'] = {
        status: 'Active',
        lastSync: new Date().toISOString(),
        autoUpdate: 'Every Hour',
        notes: `🔧 ${solTxs.length} transactions found`,
        transactionCount: solTxs.length
      };
      debugLogs.push(`✅ Solana: ${solTxs.length} transactions`);
    } catch (error) {
      apiStatusResults['Solana Wallet'] = {
        status: 'Error',
        lastSync: new Date().toISOString(),
        autoUpdate: 'Every Hour',
        notes: `❌ ${error.message}`,
        transactionCount: 0
      };
      debugLogs.push(`❌ Solana error: ${error.message}`);
    }

    // ===========================================
    // STEP 4: WRITE TO GOOGLE SHEETS WITH FIXES
    // ===========================================
    debugLogs.push(`🔧 Processing ${allTransactions.length} transactions with FIXED deduplication...`);
    
    let sheetsResult = { success: false, withdrawalsAdded: 0, depositsAdded: 0 };
    
    if (allTransactions.length > 0) {
      try {
        sheetsResult = await writeToGoogleSheetsFixed(allTransactions, apiStatusResults, debugLogs);
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
    } else {
      // Still update status even with 0 transactions
      try {
        await updateSettingsStatusOnly(apiStatusResults);
        sheetsResult.statusUpdated = true;
      } catch (error) {
        debugLogs.push('❌ Status update failed:', error);
      }
    }

    // ===========================================
    // STEP 5: RETURN FIXED RESULTS
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
      // FIXED deposits
      const deposits = await fetchByBitDepositsFixed(config, filterDate);
      transactions.push(...deposits);
      transactionBreakdown.deposits = deposits.length;
      console.log(`  💰 ${config.name} deposits: ${deposits.length}`);

      // FIXED withdrawals
      const withdrawals = await fetchByBitWithdrawalsFixed(config, filterDate);
      transactions.push(...withdrawals);
      transactionBreakdown.withdrawals = withdrawals.length;
      console.log(`  📤 ${config.name} withdrawals: ${withdrawals.length}`);

    } catch (txError) {
      console.log(`ByBit transaction fetch failed: ${txError.message}`);
    }

    const statusNotes = `🔧 FIXED V5: ${transactionBreakdown.deposits}D + ${transactionBreakdown.withdrawals}W = ${transactions.length} total`;

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

async function fetchEthereumEnhanced(address, filterDate) {
  try {
    // Get API credentials from the main function context
    const apiKey = global.etherscanApiKey || "SP8YA4W8RDB85G9129BTDHY72ADBZ6USHA";
    const endpoint = `https://api.etherscan.io/api?module=account&action=txlist&address=${address}&startblock=0&endblock=99999999&sort=desc&page=1&offset=100&apikey=${apiKey}`;
    
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
      // USDC: 'TOKEN_CONTRACT_ADDRESS',
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
        // Only include tokens we care about
        const tokenName = Object.keys(trc20Tokens).find(
          k => trc20Tokens[k].toLowerCase() === tx.token_info.address.toLowerCase()
        );
        if (!tokenName) return;
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

function removeDuplicateTransactions(transactions, existingTxIds) {
  let duplicateCount = 0;
  let totalCount = transactions.length;
  
  const newTransactions = transactions.filter(tx => {
    const txId = tx.tx_id?.toString().trim();
    
    if (!txId) {
      return true;
    }
    
    const isDuplicate = existingTxIds.has(txId);
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

async function writeToGoogleSheetsFixed(transactions, apiStatus, debugLogs) {
  try {
    console.log('🔑 Setting up Google Sheets authentication...');
    
    // Read Google service account credentials from Settings sheet
    const googleCredentials = await readGoogleCredentialsFromSheet(sheets, spreadsheetId);
    
    const credentials = {
      type: "service_account",
      project_id: googleCredentials.GOOGLE_PROJECT_ID,
      private_key_id: googleCredentials.GOOGLE_PRIVATE_KEY_ID,
      private_key: googleCredentials.GOOGLE_PRIVATE_KEY ? googleCredentials.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n') : '',
      client_email: googleCredentials.GOOGLE_CLIENT_EMAIL,
      client_id: googleCredentials.GOOGLE_CLIENT_ID,
      auth_uri: "https://accounts.google.com/o/oauth2/auth",
      token_uri: "https://oauth2.googleapis.com/token",
      auth_provider_x509_cert_url: "https://www.googleapis.com/oauth2/v1/certs",
      client_x509_cert_url: `https://www.googleapis.com/robot/v1/metadata/x509/${googleCredentials.GOOGLE_CLIENT_EMAIL}`
    };

    const auth = new GoogleAuth({
      credentials: credentials,
      scopes: ['https://www.googleapis.com/auth/spreadsheets']
    });

    const sheets = google.sheets({ version: 'v4', auth });
    const spreadsheetId = '1sx3ik8I-2_VcD3X1q6M4kOuo3hfkGbMa1JulPSWID9Y';

    console.log(`📊 Starting with ${transactions.length} raw transactions`);

    const existingTxIds = await getExistingTransactionIds(sheets, spreadsheetId);
    const uniqueTransactions = removeDuplicateTransactions(transactions, existingTxIds);
    
    // FIXED: Use new filtering function
    const filterResult = filterTransactionsByValueFixed(uniqueTransactions);
    const filteredTransactions = filterResult.transactions;
    const rejectedTransactions = filterResult.filteredOut;
    const unknownCurrencies = filterResult.unknownCurrencies;
    
    const sortedTransactions = sortTransactionsByTimestamp(filteredTransactions);

    console.log(`🎯 Final result: ${transactions.length} → ${sortedTransactions.length} NEW transactions to append`);
    console.log(`🛡️ SAFETY: Existing data will NOT be touched - only appending new transactions`);

    // Save rejected transactions to RecycleBin
    let recycleBinSaved = 0;
    if (rejectedTransactions.length > 0) {
      recycleBinSaved = await saveToRecycleBin(sheets, spreadsheetId, rejectedTransactions);
    }

    if (sortedTransactions.length === 0) {
      console.log('ℹ️ No new transactions to append after deduplication and filtering');
      await updateSettingsStatus(sheets, spreadsheetId, apiStatus);
      
      return {
        success: true,
        withdrawalsAdded: 0,
        depositsAdded: 0,
        statusUpdated: true,
        totalRaw: transactions.length,
        totalAfterDedup: uniqueTransactions.length,
        totalAfterFilter: filteredTransactions.length,
        duplicatesRemoved: transactions.length - uniqueTransactions.length,
        filteredOut: uniqueTransactions.length - filteredTransactions.length,
        recycleBinSaved: recycleBinSaved,
        unknownCurrencies: unknownCurrencies
      };
    }

    const sortedWithdrawals = sortedTransactions.filter(tx => tx.type === 'withdrawal');
    const sortedDeposits = sortedTransactions.filter(tx => tx.type === 'deposit');

    let withdrawalsAdded = 0;
    let depositsAdded = 0;

    // FIXED: Write to columns F:L using exact range targeting
    if (sortedWithdrawals.length > 0) {
      console.log(`📤 WRITING ${sortedWithdrawals.length} new withdrawals to columns F:L...`);
      
      const withdrawalRows = sortedWithdrawals.map(tx => [
        tx.platform, // F
        tx.asset, // G
        parseFloat(tx.amount).toFixed(8), // H
        formatDateTimeSimple(tx.timestamp), // I
        tx.from_address, // J
        tx.to_address, // K
        tx.tx_id // L
      ]);

      // Find next empty row in column F (never before row 7)
      const lastRowResponse = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: 'Withdrawals!F:F'
      });
      const nextRow = Math.max(7, (lastRowResponse.data.values?.length || 6) + 1); // Ensure minimum row 7
      const endRow = nextRow + withdrawalRows.length - 1;

      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `Withdrawals!F${nextRow}:L${endRow}`, // FIXED: Exact F:L range
        valueInputOption: 'RAW',
        requestBody: { values: withdrawalRows }
      });
      
      withdrawalsAdded = sortedWithdrawals.length;
      console.log(`✅ WROTE ${withdrawalsAdded} withdrawals to F${nextRow}:L${endRow}`);
    }

    if (sortedDeposits.length > 0) {
      console.log(`📥 WRITING ${sortedDeposits.length} new deposits to columns F:L...`);
      
      const depositRows = sortedDeposits.map(tx => [
        tx.platform, // F
        tx.asset, // G
        parseFloat(tx.amount).toFixed(8), // H
        formatDateTimeSimple(tx.timestamp), // I
        tx.from_address, // J
        tx.to_address, // K
        tx.tx_id // L
      ]);

      // Find next empty row in column F (never before row 7)
      const lastRowResponse = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: 'Deposits!F:F'
      });
      const nextRow = Math.max(7, (lastRowResponse.data.values?.length || 6) + 1); // Ensure minimum row 7
      const endRow = nextRow + depositRows.length - 1;

      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `Deposits!F${nextRow}:L${endRow}`, // FIXED: Exact F:L range
        valueInputOption: 'RAW',
        requestBody: { values: depositRows }
      });
      
      depositsAdded = sortedDeposits.length;
      console.log(`✅ WROTE ${depositsAdded} deposits to F${nextRow}:L${endRow}`);
    }

    await updateSettingsStatus(sheets, spreadsheetId, apiStatus);

    const result = {
      success: true,
      withdrawalsAdded: withdrawalsAdded,
      depositsAdded: depositsAdded,
      statusUpdated: true,
      totalRaw: transactions.length,
      totalAfterDedup: uniqueTransactions.length,
      totalAfterFilter: filteredTransactions.length,
      duplicatesRemoved: transactions.length - uniqueTransactions.length,
      filteredOut: uniqueTransactions.length - filteredTransactions.length,
      recycleBinSaved: recycleBinSaved,
      unknownCurrencies: unknownCurrencies,
              safetyNote: "Only wrote new transactions to F:L columns - existing accountant data (A:E) untouched"
    };

    console.log('🎉 FIXED deduplication completed:', result);
    console.log('🛡️ GUARANTEE: Columns A:E (accountant data) never touched - only F:L updated');
    if (unknownCurrencies.length > 0) {
      console.log('⚠️ UNKNOWN CURRENCIES using 1 AED default:', unknownCurrencies.join(', '));
    }
    return result;

  } catch (error) {
    console.error('❌ Error in FIXED writeToGoogleSheets:', error);
    throw error;
  }
}

async function updateSettingsStatusOnly(apiStatus) {
  // Read Google service account credentials from Settings sheet
  const googleCredentials = await readGoogleCredentialsFromSheet(sheets, spreadsheetId);
  
  const credentials = {
    type: "service_account",
    project_id: googleCredentials.GOOGLE_PROJECT_ID,
    private_key_id: googleCredentials.GOOGLE_PRIVATE_KEY_ID,
    private_key: googleCredentials.GOOGLE_PRIVATE_KEY ? googleCredentials.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n') : '',
    client_email: googleCredentials.GOOGLE_CLIENT_EMAIL,
    client_id: googleCredentials.GOOGLE_CLIENT_ID,
    auth_uri: "https://accounts.google.com/o/oauth2/auth",
    token_uri: "https://oauth2.googleapis.com/token",
    auth_provider_x509_cert_url: "https://www.googleapis.com/oauth2/v1/certs",
    client_x509_cert_url: `https://www.googleapis.com/robot/v1/metadata/x509/${googleCredentials.GOOGLE_CLIENT_EMAIL}`
  };

  const auth = new GoogleAuth({
    credentials: credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets']
  });

  const sheets = google.sheets({ version: 'v4', auth });
  const spreadsheetId = '1sx3ik8I-2_VcD3X1q6M4kOuo3hfkGbMa1JulPSWID9Y';

  await updateSettingsStatus(sheets, spreadsheetId, apiStatus);
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