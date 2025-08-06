import crypto from 'crypto';

// ===========================================
// WALLET CONFIGURATION READER FROM SETTINGS
// ===========================================

async function readWalletsFromSettings() {
  try {
    console.log('🔧 Reading wallet configurations from Settings...');
    
    const spreadsheetId = '1sx3ik8I-2_VcD3X1q6M4kOuo3hfkGbMa1JulPSWID9Y';
    
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
        
        // Only process if address is NOT empty AND status is "Working"
        if (address && address.trim() !== '' && 
            blockchainType && blockchainType.trim() !== '' && 
            status === 'Working') {
          wallets[name] = {
            address: address.trim(),
            blockchainType: blockchainType.trim(),
            apiKey: apiKey || '',
            status: status
          };
          console.log(`✅ Loaded wallet: ${name} (${blockchainType})`);
        } else if (address && address.trim() !== '') {
          console.log(`⚠️ Skipping wallet "${name}" - status not "Working" or missing blockchain type`);
        } else {
          console.log(`⚠️ Skipping empty row ${index + 1}`);
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
      console.log(`   - Status set to "Working" in column X`);
    }
    
    return wallets;
    
  } catch (error) {
    console.error('❌ Error reading wallets from Settings:', error);
    return {};
  }
}

export default async function handler(req, res) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  try {
    // STEP 1: Get transactions from Google Sheets (existing logic)
    console.log('📊 Fetching transactions from Google Sheets...');
    const spreadsheetId = '1sx3ik8I-2_VcD3X1q6M4kOuo3hfkGbMa1JulPSWID9Y';
    const sheetName = 'FORMATTED_TRANSACTIONS';
    
    const csvUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/gviz/tq?tqx=out:csv&sheet=${sheetName}`;
    
    const response = await fetch(csvUrl);
    
    if (!response.ok) {
      throw new Error(`Failed to fetch sheet data: ${response.status}`);
    }
    
    const csvText = await response.text();
    const rows = parseCSV(csvText);
    
    const transactions = rows.length > 0 ? rows.slice(1)
      .filter(row => row && row.length > 0 && row[0])
      .map((row, index) => ({
        id: index + 1,
        timestamp: row[0] || '',
        platform: row[1] || '',
        type: row[2]?.toLowerCase() || '',
        asset: row[3] || '',
        amount: row[4] || '0',
        amount_aed: row[5]?.replace(/[^\d.-]/g, '') || '0',
        rate: row[6] || '0',
        client: row[7] || '',
        remarks: row[8] || '',
        from_address: row[9] || '',
        to_address: row[10] || '',
        tx_id: row[11] || '',
        status: 'Completed',
        network: getNetworkFromAsset(row[3])
      })) : [];

    // STEP 2: Fetch live wallet balances
    console.log('🔄 Fetching live wallet balances...');
    const walletBalances = await fetchLiveWalletBalances();

    // STEP 3: Fetch live crypto prices
    console.log('💰 Fetching live crypto prices...');
    const cryptoPrices = await fetchLiveCryptoPrices();

    // STEP 4: Get API status
    console.log('📡 Checking API status...');
    const apiStatus = await getAPIStatus();

    res.status(200).json({
      transactions,
      walletBalances,
      cryptoPrices,
      apiStatus,
      lastUpdated: new Date().toISOString(),
      totalRows: transactions.length,
      source: 'Live Data + Google Sheets'
    });

  } catch (error) {
    console.error('API Error:', error);
    
    res.status(500).json({
      error: 'Failed to fetch live data',
      details: error.message,
      timestamp: new Date().toISOString()
    });
  }
}

// LIVE WALLET BALANCE FETCHER
async function fetchLiveWalletBalances() {
  const balances = {};

  // Binance Accounts
  const binanceAccounts = [
    { name: "Binance (GC)", apiKey: process.env.BINANCE_GC_API_KEY, apiSecret: process.env.BINANCE_GC_API_SECRET },
    { name: "Binance (Main)", apiKey: process.env.BINANCE_MAIN_API_KEY, apiSecret: process.env.BINANCE_MAIN_API_SECRET },
    { name: "Binance (CV)", apiKey: process.env.BINANCE_CV_API_KEY, apiSecret: process.env.BINANCE_CV_API_SECRET }
  ];

  for (const account of binanceAccounts) {
    if (account.apiKey && account.apiSecret) {
      try {
        const accountBalances = await fetchBinanceBalances(account);
        balances[account.name] = accountBalances;
      } catch (error) {
        console.error(`Error fetching ${account.name}:`, error.message);
        balances[account.name] = { error: error.message };
      }
    }
  }

  // ByBit Account
  if (process.env.BYBIT_API_KEY && process.env.BYBIT_API_SECRET) {
    try {
      const bybitBalances = await fetchByBitBalances({
        apiKey: process.env.BYBIT_API_KEY,
        apiSecret: process.env.BYBIT_API_SECRET
      });
      balances["ByBit (CV)"] = bybitBalances;
    } catch (error) {
      console.error('Error fetching ByBit:', error.message);
      balances["ByBit (CV)"] = { error: error.message };
    }
  }

  // Blockchain Wallets - Read from Settings
  const wallets = await readWalletsFromSettings();
  
  for (const [name, walletConfig] of Object.entries(wallets)) {
    try {
      const walletBalance = await fetchBlockchainBalance(name, walletConfig.address);
      balances[name] = walletBalance;
    } catch (error) {
      console.error(`Error fetching ${name}:`, error.message);
      balances[name] = { error: error.message };
    }
  }

  return balances;
}

// BINANCE BALANCE FETCHER
async function fetchBinanceBalances(account) {
  const timestamp = Date.now();
  const endpoint = "https://api.binance.com/api/v3/account";
  const params = { timestamp, recvWindow: 5000 };

  const signature = createBinanceSignature(params, account.apiSecret);
  const queryString = createQueryString(params);
  const url = `${endpoint}?${queryString}&signature=${signature}`;

  const response = await fetch(url, {
    headers: {
      "X-MBX-APIKEY": account.apiKey,
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
    }
  });

  if (!response.ok) {
    throw new Error(`Binance API error: ${response.status}`);
  }

  const data = await response.json();
  
  if (data.code && data.code !== 200) {
    throw new Error(`Binance error: ${data.msg}`);
  }

  const balances = {};
  data.balances.forEach(balance => {
    const free = parseFloat(balance.free);
    const locked = parseFloat(balance.locked);
    const total = free + locked;
    
    if (total > 0) {
      balances[balance.asset] = total;
    }
  });

  return balances;
}

// BYBIT BALANCE FETCHER
async function fetchByBitBalances(config) {
  const timestamp = Date.now();
  const endpoint = "https://api.bybit.com/v5/account/wallet-balance";
  const params = { accountType: "UNIFIED", timestamp: timestamp.toString() };

  const signature = createByBitSignature(params, config.apiSecret);
  const queryString = createQueryString(params);
  const url = `${endpoint}?${queryString}`;

  const response = await fetch(url, {
    headers: {
      "X-BAPI-API-KEY": config.apiKey,
      "X-BAPI-SIGN": signature,
      "X-BAPI-TIMESTAMP": timestamp.toString()
    }
  });

  if (!response.ok) {
    throw new Error(`ByBit API error: ${response.status}`);
  }

  const data = await response.json();
  
  if (data.retCode !== 0) {
    throw new Error(`ByBit error: ${data.retMsg}`);
  }

  const balances = {};
  if (data.result && data.result.list) {
    data.result.list.forEach(account => {
      if (account.coin) {
        account.coin.forEach(coin => {
          const total = parseFloat(coin.walletBalance);
          if (total > 0) {
            balances[coin.coin] = total;
          }
        });
      }
    });
  }

  return balances;
}

// BLOCKCHAIN BALANCE FETCHER
async function fetchBlockchainBalance(walletName, address) {
  if (walletName === "Bitcoin Wallet") {
    return await fetchBitcoinBalance(address);
  } else if (walletName === "Ethereum Wallet" || walletName === "BEP20 Wallet") {
    return await fetchEthereumBalance(address);
  } else if (walletName === "TRON Wallet") {
    return await fetchTronBalance(address);
  } else if (walletName === "Solana Wallet") {
    return await fetchSolanaBalance(address);
  }
  
  return {};
}

async function fetchBitcoinBalance(address) {
  const response = await fetch(`https://blockchain.info/rawaddr/${address}`);
  if (!response.ok) throw new Error(`Bitcoin API error: ${response.status}`);
  
  const data = await response.json();
  return { BTC: data.final_balance / 100000000 };
}

async function fetchEthereumBalance(address) {
  const apiKey = process.env.ETHERSCAN_API_KEY || "SP8YA4W8RDB85G9129BTDHY72ADBZ6USHA";
  const response = await fetch(`https://api.etherscan.io/api?module=account&action=balance&address=${address}&tag=latest&apikey=${apiKey}`);
  
  if (!response.ok) throw new Error(`Ethereum API error: ${response.status}`);
  
  const data = await response.json();
  const ethBalance = parseInt(data.result) / Math.pow(10, 18);
  
  return { ETH: ethBalance };
}

async function fetchTronBalance(address) {
  const response = await fetch(`https://api.trongrid.io/v1/accounts/${address}`);
  if (!response.ok) throw new Error(`TRON API error: ${response.status}`);
  
  const data = await response.json();
  const balances = {};
  
  if (data.data && data.data[0]) {
    const account = data.data[0];
    if (account.balance) {
      balances.TRX = account.balance / 1000000;
    }
  }
  
  return balances;
}

async function fetchSolanaBalance(address) {
  const endpoint = "https://api.mainnet-beta.solana.com";
  const payload = {
    jsonrpc: "2.0",
    id: 1,
    method: "getBalance",
    params: [address]
  };
  
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  
  if (!response.ok) throw new Error(`Solana API error: ${response.status}`);
  
  const data = await response.json();
  const solBalance = data.result.value / Math.pow(10, 9);
  
  return { SOL: solBalance };
}

// LIVE CRYPTO PRICES FETCHER
async function fetchLiveCryptoPrices() {
  try {
    const response = await fetch(
      'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,tether,solana,tron,binancecoin&vs_currencies=aed,usd'
    );
    
    if (!response.ok) {
      throw new Error(`CoinGecko API error: ${response.status}`);
    }
    
    const data = await response.json();
    
    return {
      BTC: { AED: data.bitcoin?.aed || 220200, USD: data.bitcoin?.usd || 60000 },
      ETH: { AED: data.ethereum?.aed || 11010, USD: data.ethereum?.usd || 3000 },
      USDT: { AED: data.tether?.aed || 3.67, USD: data.tether?.usd || 1 },
      SOL: { AED: data.solana?.aed || 550, USD: data.solana?.usd || 150 },
      TRX: { AED: data.tron?.aed || 0.37, USD: data.tron?.usd || 0.1 },
      BNB: { AED: data.binancecoin?.aed || 2200, USD: data.binancecoin?.usd || 600 }
    };
  } catch (error) {
    console.error('Error fetching live prices:', error);
    // Return fallback prices
    return {
      BTC: { AED: 220200, USD: 60000 },
      ETH: { AED: 11010, USD: 3000 },
      USDT: { AED: 3.67, USD: 1 },
      SOL: { AED: 550, USD: 150 },
      TRX: { AED: 0.37, USD: 0.1 },
      BNB: { AED: 2200, USD: 600 }
    };
  }
}

// API STATUS CHECKER
async function getAPIStatus() {
  const status = {};
  
  // Check Binance accounts
  const binanceAccounts = [
    { name: "Binance (GC)", apiKey: process.env.BINANCE_GC_API_KEY, apiSecret: process.env.BINANCE_GC_API_SECRET },
    { name: "Binance (Main)", apiKey: process.env.BINANCE_MAIN_API_KEY, apiSecret: process.env.BINANCE_MAIN_API_SECRET },
    { name: "Binance (CV)", apiKey: process.env.BINANCE_CV_API_KEY, apiSecret: process.env.BINANCE_CV_API_SECRET }
  ];

  for (const account of binanceAccounts) {
    if (account.apiKey && account.apiSecret) {
      try {
        await testBinanceConnection(account);
        status[account.name] = 'Active';
      } catch (error) {
        status[account.name] = 'Error';
      }
    } else {
      status[account.name] = 'Missing Credentials';
    }
  }

  // Check ByBit
  if (process.env.BYBIT_API_KEY && process.env.BYBIT_API_SECRET) {
    try {
      await testByBitConnection();
      status["ByBit (CV)"] = 'Active';
    } catch (error) {
      status["ByBit (CV)"] = 'Error';
    }
  } else {
    status["ByBit (CV)"] = 'Missing Credentials';
  }

  // Blockchain wallets are always active (public APIs)
  status["Bitcoin Wallet"] = 'Active';
  status["Ethereum Wallet"] = 'Active';
  status["TRON Wallet"] = 'Active';
  status["Solana Wallet"] = 'Active';

  return status;
}

async function testBinanceConnection(account) {
  const timestamp = Date.now();
  const endpoint = "https://api.binance.com/api/v3/account";
  const params = { timestamp, recvWindow: 5000 };

  const signature = createBinanceSignature(params, account.apiSecret);
  const queryString = createQueryString(params);
  const url = `${endpoint}?${queryString}&signature=${signature}`;

  const response = await fetch(url, {
    headers: { "X-MBX-APIKEY": account.apiKey }
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const data = await response.json();
  if (data.code && data.code !== 200) {
    throw new Error(data.msg);
  }
}

async function testByBitConnection() {
  const timestamp = Date.now();
  const endpoint = "https://api.bybit.com/v5/account/wallet-balance";
  const params = { accountType: "UNIFIED", timestamp: timestamp.toString() };

  const signature = createByBitSignature(params, process.env.BYBIT_API_SECRET);
  const queryString = createQueryString(params);
  const url = `${endpoint}?${queryString}`;

  const response = await fetch(url, {
    headers: {
      "X-BAPI-API-KEY": process.env.BYBIT_API_KEY,
      "X-BAPI-SIGN": signature,
      "X-BAPI-TIMESTAMP": timestamp.toString()
    }
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const data = await response.json();
  if (data.retCode !== 0) {
    throw new Error(data.retMsg);
  }
}

// UTILITY FUNCTIONS
function createBinanceSignature(params, secret) {
  const queryString = createQueryString(params);
  return crypto.createHmac('sha256', secret).update(queryString).digest('hex');
}

function createByBitSignature(params, secret) {
  const queryString = createQueryString(params);
  return crypto.createHmac('sha256', secret).update(queryString).digest('hex');
}

function createQueryString(params) {
  return Object.keys(params)
    .sort()
    .map(key => `${encodeURIComponent(key)}=${encodeURIComponent(params[key])}`)
    .join('&');
}

function parseCSV(csvText) {
  const rows = [];
  const lines = csvText.split('\n');
  
  for (let line of lines) {
    if (line.trim() === '') continue;
    
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
    const cleanRow = row.map(field => field.replace(/^"|"$/g, ''));
    rows.push(cleanRow);
  }
  
  return rows;
}

function getNetworkFromAsset(asset) {
  const networkMap = {
    'BTC': 'BTC',
    'ETH': 'ETH',
    'USDT': 'TRC20',
    'TRX': 'TRON',
    'SOL': 'SOL',
    'BNB': 'BEP20'
  };
  
  return networkMap[asset] || 'Unknown';
}
