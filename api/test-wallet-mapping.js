// ===========================================
// TEST WALLET ADDRESS MAPPING
// ===========================================

// Mock wallet configuration for testing
const mockWallets = {
  "Bitcoin Wallet 1": {
    address: "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa",
    blockchainType: "bitcoin",
    apiKey: "",
    status: "Working"
  },
  "Ethereum Wallet 1": {
    address: "0x742d35Cc6634C0532925a3b8D4C9db96C4b4d8b6",
    blockchainType: "ethereum",
    apiKey: "SP8YA4W8RDB85G9129BTDHY72ADBZ6USHA",
    status: "Working"
  },
  "TRON Wallet 1": {
    address: "TJRabPrwbZy45sbavfcjinPJC18kjpRTv8",
    blockchainType: "tron",
    apiKey: "",
    status: "Working"
  },
  "Solana Wallet 1": {
    address: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM",
    blockchainType: "solana",
    apiKey: "",
    status: "Working"
  }
};

// Mock transactions for testing
const mockTransactions = [
  {
    platform: "Bitcoin Wallet 1",
    type: "deposit",
    asset: "BTC",
    amount: "0.001",
    timestamp: "2025-01-15T10:30:00Z",
    from_address: "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa",
    to_address: "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa",
    tx_id: "test_tx_1"
  },
  {
    platform: "Ethereum Wallet 1",
    type: "withdrawal",
    asset: "ETH",
    amount: "0.1",
    timestamp: "2025-01-15T11:30:00Z",
    from_address: "0x742d35Cc6634C0532925a3b8D4C9db96C4b4d8b6",
    to_address: "0x1234567890123456789012345678901234567890",
    tx_id: "test_tx_2"
  },
  {
    platform: "TRON Wallet 1",
    type: "deposit",
    asset: "TRX",
    amount: "1000",
    timestamp: "2025-01-15T12:30:00Z",
    from_address: "TJRabPrwbZy45sbavfcjinPJC18kjpRTv8",
    to_address: "TJRabPrwbZy45sbavfcjinPJC18kjpRTv8",
    tx_id: "test_tx_3"
  },
  {
    platform: "Unknown Wallet",
    type: "deposit",
    asset: "BTC",
    amount: "0.002",
    timestamp: "2025-01-15T13:30:00Z",
    from_address: "1B2C3D4E5F6G7H8I9J0K1L2M3N4O5P6Q7R8S9T0",
    to_address: "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa",
    tx_id: "test_tx_4"
  }
];

/**
 * Creates a reverse mapping from wallet addresses to friendly names
 * @param {Object} wallets - Wallet configuration object from readWalletsFromSettings
 * @returns {Object} - Mapping of address -> friendly name
 */
function createWalletAddressMapping(wallets) {
  const addressMapping = {};
  const mappingStats = { total: 0, mapped: 0, skipped: 0 };
  
  console.log('🔧 Creating wallet address mapping...');
  
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
  
  console.log(`📊 Address mapping created: ${mappingStats.total} addresses mapped`);
  console.log(`📊 Mapping keys: ${Object.keys(addressMapping).length} variations`);
  
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
 * Applies wallet address mapping to a transaction object
 * @param {Object} transaction - The transaction object
 * @param {Object} addressMapping - The address mapping object
 * @returns {Object} - The transaction with mapped addresses
 */
function applyWalletAddressMapping(transaction, addressMapping) {
  if (!transaction || !addressMapping) {
    return transaction;
  }
  
  const mappedTransaction = { ...transaction };
  
  // Map from_address if it exists
  if (mappedTransaction.from_address) {
    const originalFromAddress = mappedTransaction.from_address;
    mappedTransaction.from_address = mapWalletAddress(originalFromAddress, addressMapping);
    
    // Log if mapping occurred
    if (mappedTransaction.from_address !== originalFromAddress) {
      console.log(`🔗 Mapped from_address: ${originalFromAddress} → ${mappedTransaction.from_address}`);
    }
  }
  
  // Map to_address if it exists
  if (mappedTransaction.to_address) {
    const originalToAddress = mappedTransaction.to_address;
    mappedTransaction.to_address = mapWalletAddress(originalToAddress, addressMapping);
    
    // Log if mapping occurred
    if (mappedTransaction.to_address !== originalToAddress) {
      console.log(`🔗 Mapped to_address: ${originalToAddress} → ${mappedTransaction.to_address}`);
    }
  }
  
  return mappedTransaction;
}

// Test the mapping functionality
function testWalletAddressMapping() {
  console.log('🧪 Testing Wallet Address Mapping...\n');
  
  // Create address mapping
  const addressMapping = createWalletAddressMapping(mockWallets);
  console.log('\n📋 Address Mapping Created:');
  console.log(addressMapping);
  
  // Test individual address mapping
  console.log('\n🔍 Testing Individual Address Mapping:');
  const testAddresses = [
    "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa",
    "0x742d35Cc6634C0532925a3b8D4C9db96C4b4d8b6",
    "TJRabPrwbZy45sbavfcjinPJC18kjpRTv8",
    "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM",
    "1B2C3D4E5F6G7H8I9J0K1L2M3N4O5P6Q7R8S9T0" // Unknown address
  ];
  
  testAddresses.forEach(address => {
    const mapped = mapWalletAddress(address, addressMapping);
    console.log(`${address} → ${mapped}`);
  });
  
  // Test transaction mapping
  console.log('\n📊 Testing Transaction Mapping:');
  const mappedTransactions = mockTransactions.map(tx => applyWalletAddressMapping(tx, addressMapping));
  
  mappedTransactions.forEach((tx, index) => {
    console.log(`\nTransaction ${index + 1}:`);
    console.log(`  Platform: ${tx.platform}`);
    console.log(`  Type: ${tx.type}`);
    console.log(`  Asset: ${tx.asset}`);
    console.log(`  From: ${tx.from_address}`);
    console.log(`  To: ${tx.to_address}`);
  });
  
  console.log('\n✅ Wallet Address Mapping Test Completed!');
}

// Run the test
testWalletAddressMapping(); 