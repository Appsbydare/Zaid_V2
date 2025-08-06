// Test script to debug wallet reading from Settings
// Run this to test if wallets are being read correctly

async function testWalletReading() {
  try {
    console.log('🧪 Testing wallet reading from Settings...');
    
    const spreadsheetId = "1sx3ik8I-2_VcD3X1q6M4kOuo3hfkGbMa1JulPSWID9Y";
    
    // Test different CSV URL formats
    const testUrls = [
      `https://docs.google.com/spreadsheets/d/${spreadsheetId}/gviz/tq?tqx=out:csv&sheet=SETTINGS&range=T3:X17`,
      `https://docs.google.com/spreadsheets/d/${spreadsheetId}/gviz/tq?tqx=out:csv&sheet=SETTINGS`,
      `https://docs.google.com/spreadsheets/d/${spreadsheetId}/gviz/tq?tqx=out:csv&sheet=SETTINGS&range=T:X`
    ];
    
    for (let i = 0; i < testUrls.length; i++) {
      const url = testUrls[i];
      console.log(`\n🔍 Testing URL ${i + 1}: ${url}`);
      
      try {
        const response = await fetch(url);
        
        if (!response.ok) {
          console.log(`❌ Failed: HTTP ${response.status}`);
          continue;
        }
        
        const csvText = await response.text();
        console.log(`✅ Success: ${csvText.length} characters`);
        console.log(`📄 Preview: ${csvText.substring(0, 300)}...`);
        
        // Parse CSV
        const rows = parseCSV(csvText);
        console.log(`📊 Parsed ${rows.length} rows`);
        
        // Look for wallet data
        let walletRows = 0;
        rows.forEach((row, index) => {
          if (row && row.length >= 5) {
            const name = row[0];
            const address = row[1];
            const blockchainType = row[2];
            const status = row[4];
            
            if (address && address.trim() !== '') {
              walletRows++;
              console.log(`🔍 Row ${index + 1}: "${name}" | "${address}" | "${blockchainType}" | "${status}"`);
            }
          }
        });
        
        console.log(`📊 Found ${walletRows} wallet rows`);
        
      } catch (error) {
        console.log(`❌ Error: ${error.message}`);
      }
    }
    
  } catch (error) {
    console.error('❌ Test failed:', error);
  }
}

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

// Export for testing
export { testWalletReading }; 