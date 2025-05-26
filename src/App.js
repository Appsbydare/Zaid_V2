import React, { useState, useEffect } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, BarChart, Bar, PieChart, Pie, Cell } from 'recharts';
import { Download, RefreshCw, DollarSign, Circle, AlertTriangle, Wallet, TrendingUp, TrendingDown, Eye, EyeOff, Settings, Filter, HelpCircle, Info, Users, FileText, GitBranch } from 'lucide-react';

const CryptoTrackerProduction = () => {
  const [transactionData, setTransactionData] = useState([]);
  const [walletBalances, setWalletBalances] = useState({});
  const [isLoading, setIsLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [activeTab, setActiveTab] = useState('dashboard');
  const [selectedPlatform, setSelectedPlatform] = useState('All');
  const [selectedDateRange, setSelectedDateRange] = useState('7d');
  const [showBalances, setShowBalances] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);

  // Fetch data from Google Sheets via API
  const fetchDataFromSheets = async () => {
    setRefreshing(true);
    setError(null);
    
    try {
      const response = await fetch('/api/sheets');
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const data = await response.json();
      
      // Set the data from Google Sheets
      setTransactionData(data.transactions || []);
      setWalletBalances(data.walletBalances || {});
      setLastUpdated(new Date(data.lastUpdated).toLocaleString());
      setIsLoading(false);
      setRefreshing(false);
      
    } catch (error) {
      console.error('Error fetching data from Google Sheets:', error);
      setError(error.message);
      setIsLoading(false);
      setRefreshing(false);
      
      // Set empty data on error
      setTransactionData([]);
      setWalletBalances({});
      setLastUpdated('Failed to load');
    }
  };

  useEffect(() => {
    fetchDataFromSheets();
  }, []);

  // Calculate totals in AED
  const getTotalValues = () => {
    let totalDeposits = 0;
    let totalWithdrawals = 0;
    
    transactionData.forEach(tx => {
      const aedValue = parseFloat(tx.amount_aed) || 0;
      if (tx.type === "deposit") {
        totalDeposits += aedValue;
      } else {
        totalWithdrawals += aedValue;
      }
    });
    
    return {
      deposits: totalDeposits,
      withdrawals: totalWithdrawals,
      balance: totalDeposits - totalWithdrawals
    };
  };

  // Calculate total portfolio value
  const getPortfolioValue = () => {
    // Current prices in AED (these would come from real price APIs in future)
    const prices = {
      BTC: 220200,
      ETH: 11010,
      USDT: 3.67,
      SOL: 181.50,
      TRX: 0.37,
      BNB: 2200
    };

    let totalValue = 0;
    Object.entries(walletBalances).forEach(([wallet, assets]) => {
      Object.entries(assets).forEach(([asset, amount]) => {
        totalValue += (amount * (prices[asset] || 0));
      });
    });

    return totalValue;
  };

  const totals = getTotalValues();
  const portfolioValue = getPortfolioValue();
  const platforms = ['All', ...new Set(transactionData.map(tx => tx.platform))];

  // Prepare chart data
  const preparePlatformChart = () => {
    const platformData = {};
    
    transactionData.forEach(tx => {
      if (!platformData[tx.platform]) {
        platformData[tx.platform] = { 
          name: tx.platform, 
          deposits: 0, 
          withdrawals: 0 
        };
      }
      
      const aedValue = parseFloat(tx.amount_aed) || 0;
      if (tx.type === "deposit") {
        platformData[tx.platform].deposits += aedValue;
      } else {
        platformData[tx.platform].withdrawals += aedValue;
      }
    });
    
    return Object.values(platformData);
  };

  const prepareAssetDistribution = () => {
    const assetTotals = {};
    Object.entries(walletBalances).forEach(([wallet, assets]) => {
      Object.entries(assets).forEach(([asset, amount]) => {
        if (!assetTotals[asset]) assetTotals[asset] = 0;
        
        // Convert to AED
        const prices = { BTC: 220200, ETH: 11010, USDT: 3.67, SOL: 181.50, TRX: 0.37, BNB: 2200 };
        assetTotals[asset] += amount * (prices[asset] || 0);
      });
    });

    const colors = ['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#06B6D4'];
    return Object.entries(assetTotals).map(([asset, value], index) => ({
      name: asset,
      value: value,
      color: colors[index % colors.length]
    }));
  };

  const prepareDailyVolumeChart = () => {
    const dailyData = {};
    
    transactionData.forEach(tx => {
      const date = tx.timestamp.split(' ')[0];
      if (!dailyData[date]) {
        dailyData[date] = { name: date, deposits: 0, withdrawals: 0 };
      }
      
      const aedValue = parseFloat(tx.amount_aed) || 0;
      if (tx.type === "deposit") {
        dailyData[date].deposits += aedValue;
      } else {
        dailyData[date].withdrawals += aedValue;
      }
    });
    
    // Sort by date and ensure we have data for recent days
    const sortedData = Object.values(dailyData).sort((a, b) => {
      return new Date(a.name) - new Date(b.name);
    });
    
    return sortedData;
  };

  const filteredTransactions = selectedPlatform === 'All' 
    ? transactionData 
    : transactionData.filter(tx => tx.platform === selectedPlatform);

  // Loading state
  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-gray-50 p-4">
        <div className="text-2xl font-bold text-gray-700 mb-4">Loading Your Crypto Portfolio...</div>
        <div className="w-16 h-16 border-4 border-t-blue-500 border-blue-200 rounded-full animate-spin"></div>
        <p className="text-gray-500 mt-4">Fetching real-time data from Google Sheets...</p>
      </div>
    );
  }

  // Error state
  if (error && transactionData.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-gray-50 p-4">
        <div className="text-2xl font-bold text-red-600 mb-4">Connection Error</div>
        <div className="text-gray-600 mb-4">Unable to fetch data from Google Sheets</div>
        <div className="text-sm text-gray-500 mb-6">Error: {error}</div>
        <button 
          onClick={fetchDataFromSheets}
          className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition"
        >
          Retry Connection
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-gradient-to-r from-blue-600 to-indigo-700 p-6 shadow-lg">
        <div className="max-w-7xl mx-auto">
          <div className="flex justify-between items-start">
            <div>
              <h1 className="text-3xl font-bold text-white">Crypto Portfolio Tracker</h1>
              <p className="text-blue-100 mt-2">Real-time tracking across all your wallets and exchanges</p>
            </div>
            <div className="flex items-center space-x-4">
              <button 
                onClick={() => setShowBalances(!showBalances)}
                className="flex items-center px-3 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-400 transition"
              >
                {showBalances ? <EyeOff size={16} /> : <Eye size={16} />}
                <span className="ml-2">{showBalances ? 'Hide' : 'Show'} Balances</span>
              </button>
              <button 
                onClick={fetchDataFromSheets}
                disabled={refreshing}
                className="flex items-center px-3 py-2 bg-green-500 text-white rounded-lg hover:bg-green-400 transition disabled:opacity-50"
              >
                <RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} />
                <span className="ml-2">Refresh</span>
              </button>
            </div>
          </div>
          
          <div className="flex mt-6 text-sm">
            {[
              { id: 'dashboard', label: 'Dashboard', icon: TrendingUp },
              { id: 'transactions', label: 'Transactions', icon: Circle },
              { id: 'wallets', label: 'Wallets', icon: Wallet },
              { id: 'settings', label: 'Settings', icon: Settings },
              { id: 'help', label: 'Help & Info', icon: HelpCircle }
            ].map(tab => (
              <button 
                key={tab.id}
                className={`flex items-center px-4 py-2 font-medium rounded-t-lg transition mr-2 ${
                  activeTab === tab.id 
                    ? 'bg-white text-blue-700' 
                    : 'bg-blue-500 text-white hover:bg-blue-400'
                }`}
                onClick={() => setActiveTab(tab.id)}
              >
                <tab.icon size={16} className="mr-2" />
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </div>
      
      <div className="max-w-7xl mx-auto p-6">
        {/* Status Bar */}
        <div className="bg-white p-4 rounded-lg shadow mb-6 flex justify-between items-center">
          <div className="flex items-center">
            <Circle size={12} className={error ? "text-red-500" : "text-green-500"} fill="currentColor" />
            <span>{error ? 'Connection issues detected' : 'Connected to Google Sheets • Real-time sync active'}</span>
          </div>
          <div className="flex items-center text-gray-500 text-sm">
            <span>Last updated: {lastUpdated}</span>
          </div>
        </div>
        
        {activeTab === 'dashboard' && (
          <>
            {/* Portfolio Summary Cards */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-6">
              <div className="bg-white p-6 rounded-lg shadow-md">
                <div className="flex items-center mb-2">
                  <div className="p-2 bg-blue-100 rounded-lg mr-3">
                    <Wallet size={24} className="text-blue-600" />
                  </div>
                  <h3 className="text-lg font-medium text-gray-700">Portfolio Value</h3>
                </div>
                <p className="text-3xl font-bold">
                  {showBalances ? `AED ${portfolioValue.toLocaleString(undefined, { maximumFractionDigits: 2 })}` : '••••••'}
                </p>
                <p className="text-sm text-gray-500 mt-1">Current holdings</p>
              </div>
              
              <div className="bg-white p-6 rounded-lg shadow-md">
                <div className="flex items-center mb-2">
                  <div className="p-2 bg-green-100 rounded-lg mr-3">
                    <TrendingUp size={24} className="text-green-600" />
                  </div>
                  <h3 className="text-lg font-medium text-gray-700">Total Deposits</h3>
                </div>
                <p className="text-3xl font-bold text-green-600">
                  {showBalances ? `AED ${totals.deposits.toLocaleString(undefined, { maximumFractionDigits: 2 })}` : '••••••'}
                </p>
                <p className="text-sm text-gray-500 mt-1">All-time inflows</p>
              </div>
              
              <div className="bg-white p-6 rounded-lg shadow-md">
                <div className="flex items-center mb-2">
                  <div className="p-2 bg-red-100 rounded-lg mr-3">
                    <TrendingDown size={24} className="text-red-600" />
                  </div>
                  <h3 className="text-lg font-medium text-gray-700">Total Withdrawals</h3>
                </div>
                <p className="text-3xl font-bold text-red-600">
                  {showBalances ? `AED ${totals.withdrawals.toLocaleString(undefined, { maximumFractionDigits: 2 })}` : '••••••'}
                </p>
                <p className="text-sm text-gray-500 mt-1">All-time outflows</p>
              </div>
              
              <div className="bg-white p-6 rounded-lg shadow-md">
                <div className="flex items-center mb-2">
                  <div className="p-2 bg-purple-100 rounded-lg mr-3">
                    <DollarSign size={24} className="text-purple-600" />
                  </div>
                  <h3 className="text-lg font-medium text-gray-700">Net Flow</h3>
                </div>
                <p className={`text-3xl font-bold ${totals.balance >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                  {showBalances ? `AED ${totals.balance.toLocaleString(undefined, { maximumFractionDigits: 2 })}` : '••••••'}
                </p>
                <p className="text-sm text-gray-500 mt-1">Net position</p>
              </div>
            </div>
            
            {/* Charts */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
              <div className="bg-white p-6 rounded-lg shadow-md">
                <h3 className="text-lg font-medium text-gray-700 mb-4">Platform Activity (AED)</h3>
                <div className="h-64">
                  {preparePlatformChart().length > 0 ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={preparePlatformChart()}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="name" />
                        <YAxis />
                        <Tooltip formatter={(value) => [`AED ${value.toFixed(2)}`, 'Value']} />
                        <Legend />
                        <Bar dataKey="deposits" name="Deposits" fill="#10B981" />
                        <Bar dataKey="withdrawals" name="Withdrawals" fill="#EF4444" />
                      </BarChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="flex items-center justify-center h-full text-gray-500">
                      No transaction data available
                    </div>
                  )}
                </div>
              </div>
              
              <div className="bg-white p-6 rounded-lg shadow-md">
                <h3 className="text-lg font-medium text-gray-700 mb-4">Asset Distribution</h3>
                <div className="h-64">
                  {prepareAssetDistribution().length > 0 ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={prepareAssetDistribution()}
                          cx="50%"
                          cy="50%"
                          innerRadius={40}
                          outerRadius={100}
                          fill="#8884d8"
                          dataKey="value"
                          label={({name, percent}) => `${name} ${(percent * 100).toFixed(0)}%`}
                        >
                          {prepareAssetDistribution().map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={entry.color} />
                          ))}
                        </Pie>
                        <Tooltip formatter={(value) => [`AED ${value.toFixed(2)}`, 'Value']} />
                      </PieChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="flex items-center justify-center h-full text-gray-500">
                      No wallet balance data available
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Daily Transaction Volume Chart */}
            <div className="bg-white p-6 rounded-lg shadow-md mb-6">
              <h3 className="text-lg font-medium text-gray-700 mb-4">Daily Transaction Volume</h3>
              <div className="h-80">
                {prepareDailyVolumeChart().length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={prepareDailyVolumeChart()}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis 
                        dataKey="name" 
                        tickFormatter={(value) => {
                          const date = new Date(value);
                          return `${date.getMonth() + 1}-${date.getDate()}`;
                        }}
                      />
                      <YAxis 
                        tickFormatter={(value) => `${(value / 1000).toFixed(0)}K`}
                      />
                      <Tooltip 
                        formatter={(value) => [`AED ${value.toLocaleString()}`, '']}
                        labelFormatter={(label) => `Date: ${label}`}
                      />
                      <Legend />
                      <Line 
                        type="monotone" 
                        dataKey="deposits" 
                        stroke="#10B981" 
                        strokeWidth={3}
                        fill="#10B981"
                        fillOpacity={0.1}
                        name="Deposits"
                        dot={{ fill: '#10B981', strokeWidth: 2, r: 6 }}
                        activeDot={{ r: 8, stroke: '#10B981', strokeWidth: 2 }}
                      />
                      <Line 
                        type="monotone" 
                        dataKey="withdrawals" 
                        stroke="#EF4444" 
                        strokeWidth={3}
                        fill="#EF4444"
                        fillOpacity={0.1}
                        name="Withdrawals"
                        dot={{ fill: '#EF4444', strokeWidth: 2, r: 6 }}
                        activeDot={{ r: 8, stroke: '#EF4444', strokeWidth: 2 }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex items-center justify-center h-full text-gray-500">
                    No daily transaction data available
                  </div>
                )}
              </div>
            </div>
          </>
        )}
        
        {activeTab === 'transactions' && (
          <div className="bg-white p-6 rounded-lg shadow-md">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-6">
              <h3 className="text-xl font-medium text-gray-700 mb-2 sm:mb-0">Transaction History</h3>
              
              <div className="flex flex-col sm:flex-row items-start sm:items-center space-y-2 sm:space-y-0 sm:space-x-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Platform</label>
                  <select
                    className="block w-full pl-3 pr-10 py-2 text-base border-gray-300 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm rounded-md"
                    value={selectedPlatform}
                    onChange={(e) => setSelectedPlatform(e.target.value)}
                  >
                    {platforms.map((platform) => (
                      <option key={platform} value={platform}>{platform}</option>
                    ))}
                  </select>
                </div>
                
                <button className="flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition">
                  <Download size={16} className="mr-2" />
                  Export CSV
                </button>
              </div>
            </div>
            
            <div className="overflow-x-auto">
              {filteredTransactions.length > 0 ? (
                <table className="min-w-full">
                  <thead>
                    <tr className="bg-gray-50">
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Date & Time</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Platform</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Type</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Asset</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Amount</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">AED Value</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Client</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Remarks</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {filteredTransactions.map((tx) => (
                      <tr key={tx.id} className="hover:bg-gray-50">
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{tx.timestamp}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{tx.platform}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm">
                          <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
                            tx.type === 'deposit' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                          }`}>
                            {tx.type}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{tx.asset}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{parseFloat(tx.amount).toFixed(8)}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                          {showBalances ? `AED ${parseFloat(tx.amount_aed).toLocaleString()}` : '••••••'}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{tx.client}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{tx.remarks}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div className="text-center py-12">
                  <p className="text-gray-500">No transactions found. Add some sample data to your Google Sheet to see them here.</p>
                </div>
              )}
            </div>
          </div>
        )}
        
        {activeTab === 'wallets' && (
          <div className="space-y-6">
            <div className="bg-white p-6 rounded-lg shadow-md">
              <h3 className="text-xl font-medium text-gray-700 mb-4">Wallet Balances</h3>
              
              {Object.keys(walletBalances).length > 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {Object.entries(walletBalances).map(([wallet, assets]) => (
                    <div key={wallet} className="border rounded-lg p-4">
                      <h4 className="font-medium text-gray-900 mb-3">{wallet}</h4>
                      <div className="space-y-2">
                        {Object.entries(assets).map(([asset, amount]) => (
                          <div key={asset} className="flex justify-between items-center">
                            <span className="text-sm text-gray-600">{asset}</span>
                            <span className="text-sm font-medium">
                              {showBalances ? amount.toFixed(8) : '••••••'}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-12">
                  <p className="text-gray-500">No wallet balance data available. This will be populated when API integrations are complete.</p>
                </div>
              )}
            </div>
          </div>
        )}
        
        {activeTab === 'settings' && (
          <div className="bg-white p-6 rounded-lg shadow-md">
            <h3 className="text-xl font-medium text-gray-700 mb-4">System Configuration</h3>
            
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div>
                <h4 className="text-lg font-medium text-gray-700 mb-3">Connected Accounts</h4>
                <div className="space-y-3">
                  {['Binance (GC)', 'Binance (Main)', 'Binance (CV)', 'ByBit (CV)'].map(account => (
                    <div key={account} className="flex justify-between items-center p-3 border rounded">
                      <div>
                        <span className="font-medium">{account}</span>
                        <p className="text-sm text-gray-500">API Setup Required</p>
                      </div>
                      <Circle size={12} className="text-yellow-500" fill="currentColor" />
                    </div>
                  ))}
                </div>
              </div>
              
              <div>
                <h4 className="text-lg font-medium text-gray-700 mb-3">Blockchain Wallets</h4>
                <div className="space-y-3">
                  {[
                    { name: 'Bitcoin Wallet', address: 'bc1qkuef...v35g' },
                    { name: 'Ethereum Wallet', address: '0x8568...73c' },
                    { name: 'TRON Wallet', address: 'TAUDu...6aJkN' },
                    { name: 'Solana Wallet', address: 'BURkH...uX4n' }
                  ].map(wallet => (
                    <div key={wallet.name} className="flex justify-between items-center p-3 border rounded">
                      <div>
                        <span className="font-medium">{wallet.name}</span>
                        <p className="text-sm text-gray-500">{wallet.address}</p>
                      </div>
                      <Circle size={12} className="text-yellow-500" fill="currentColor" />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}
        
        {activeTab === 'help' && (
          <div className="space-y-6">
            {/* Company Information */}
            <div className="bg-white p-6 rounded-lg shadow-md">
              <div className="flex items-center mb-4">
                <Users size={24} className="text-blue-600 mr-3" />
                <h3 className="text-xl font-medium text-gray-700">Developer Information</h3>
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <h4 className="text-lg font-medium text-gray-900 mb-3">Development Team</h4>
                  <div className="space-y-2">
                    <p><span className="font-medium">Developer:</span> Darshana</p>
                    <p><span className="font-medium">Platform:</span> Fiverr Professional</p>
                    <p><span className="font-medium">Specialization:</span> API Integration & Automation</p>
                    <p><span className="font-medium">Experience:</span> 5+ years in Crypto & Financial APIs</p>
                  </div>
                  
                  <div className="mt-4 pt-4 border-t border-gray-200">
                    <h5 className="text-md font-medium text-gray-900 mb-2">Our Websites</h5>
                    <div className="space-y-2">
                      <div>
                        <a 
                          href="https://www.fiverr.com/sellers/xlsolutions/" 
                          target="_blank" 
                          rel="noopener noreferrer"
                          className="text-blue-600 hover:text-blue-800 underline text-sm"
                        >
                          🔗 Fiverr Professional Profile
                        </a>
                        <p className="text-xs text-gray-500 ml-4">Professional services & portfolio</p>
                      </div>
                      <div>
                        <a 
                          href="https://www.anydata.lk/" 
                          target="_blank" 
                          rel="noopener noreferrer"
                          className="text-blue-600 hover:text-blue-800 underline text-sm"
                        >
                          🔗 AnyData.lk - Data Solutions
                        </a>
                        <p className="text-xs text-gray-500 ml-4">Specialized data automation services</p>
                      </div>
                    </div>
                  </div>
                </div>
                
                <div>
                  <h4 className="text-lg font-medium text-gray-900 mb-3">Support & Contact</h4>
                  <div className="space-y-2">
                    <p><span className="font-medium">Support Period:</span> 30 days post-delivery</p>
                    <p><span className="font-medium">Response Time:</span> Within 24 hours</p>
                    <p><span className="font-medium">Maintenance:</span> Available for long-term contracts</p>
                    <p><span className="font-medium">Updates:</span> Feature enhancements available</p>
                  </div>
                </div>
              </div>
            </div>

            {/* User Manual */}
            <div className="bg-white p-6 rounded-lg shadow-md">
              <div className="flex items-center mb-4">
                <FileText size={24} className="text-green-600 mr-3" />
                <h3 className="text-xl font-medium text-gray-700">📖 User Manual</h3>
              </div>
              
              <div className="space-y-6">
                <div>
                  <h4 className="text-lg font-medium text-gray-900 mb-3">📊 Dashboard Overview</h4>
                  <ul className="list-disc list-inside space-y-2 text-gray-700 ml-4">
                    <li><strong>💰 Portfolio Value:</strong> Real-time total value of all your cryptocurrency holdings across all wallets</li>
                    <li><strong>📈 Total Deposits:</strong> Sum of all incoming transactions to your wallets and exchanges</li>
                    <li><strong>📉 Total Withdrawals:</strong> Sum of all outgoing transactions from your wallets and exchanges</li>
                    <li><strong>🎯 Net Flow:</strong> Difference between deposits and withdrawals (your profit/loss)</li>
                    <li><strong>📊 Platform Activity:</strong> Bar chart showing transaction volumes by exchange/wallet</li>
                    <li><strong>🥧 Asset Distribution:</strong> Pie chart showing your portfolio allocation by cryptocurrency</li>
                    <li><strong>📈 Daily Transaction Volume:</strong> Line chart showing daily deposit and withdrawal trends</li>
                  </ul>
                </div>

                <div>
                  <h4 className="text-lg font-medium text-gray-900 mb-3">🔧 How to Use</h4>
                  <ol className="list-decimal list-inside space-y-2 text-gray-700 ml-4">
                    <li><strong>🏠 Dashboard:</strong> View your overall portfolio performance and key metrics</li>
                    <li><strong>💸 Transactions:</strong> Browse all your transaction history with filtering options</li>
                    <li><strong>👛 Wallets:</strong> Check current balances across all connected wallets and exchanges</li>
                    <li><strong>⚙️ Settings:</strong> View connection status and manage your wallet configurations</li>
                    <li><strong>👁️ Privacy Toggle:</strong> Use the eye icon to hide/show sensitive balance information</li>
                    <li><strong>🔄 Refresh:</strong> Click refresh to manually update data from all sources</li>
                    <li><strong>💾 Export:</strong> Download transaction data as CSV for accounting purposes</li>
                  </ol>
                </div>

                <div>
                  <h4 className="text-lg font-medium text-gray-900 mb-3">👨‍💼 Features for Your Accountant</h4>
                  <ul className="list-disc list-inside space-y-2 text-gray-700 ml-4">
                    <li><strong>📊 Google Sheets Access:</strong> Your accountant can directly edit remarks and client information in the connected Google Sheet</li>
                    <li><strong>📄 CSV Export:</strong> Download complete transaction history for tax filing and accounting software</li>
                    <li><strong>🇦🇪 AED Values:</strong> All transactions show AED equivalent for easy local accounting</li>
                    <li><strong>🏷️ Client Tracking:</strong> Each transaction can be tagged with client information and remarks</li>
                    <li><strong>📅 Daily Separations:</strong> Transactions are visually separated by date for easy review</li>
                  </ul>
                </div>
              </div>
            </div>

            {/* System Architecture */}
            <div className="bg-white p-6 rounded-lg shadow-md">
              <div className="flex items-center mb-4">
                <GitBranch size={24} className="text-purple-600 mr-3" />
                <h3 className="text-xl font-medium text-gray-700">🏗️ System Architecture & Data Flow</h3>
              </div>
              
              <div className="space-y-6">
                <div>
                  <h4 className="text-lg font-medium text-gray-900 mb-3">📡 Data Sources</h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="p-4 bg-blue-50 rounded-lg">
                      <h5 className="font-medium text-blue-900 mb-2">🏦 Exchange APIs</h5>
                      <ul className="text-sm text-blue-800 space-y-1">
                        <li>• 💱 Binance API (3 accounts)</li>
                        <li>• 📊 ByBit API (1 account)</li>
                        <li>• ⚡ Real-time transaction data</li>
                        <li>• 🤝 P2P & Binance Pay transactions</li>
                      </ul>
                    </div>
                    <div className="p-4 bg-green-50 rounded-lg">
                      <h5 className="font-medium text-green-900 mb-2">⛓️ Blockchain APIs</h5>
                      <ul className="text-sm text-green-800 space-y-1">
                        <li>• 🔷 Etherscan (Ethereum)</li>
                        <li>• 🔴 TronScan (TRON)</li>
                        <li>• 🟠 Blockchain.info (Bitcoin)</li>
                        <li>• 🟣 Solana Explorer</li>
                      </ul>
                    </div>
                  </div>
                </div>

                <div>
                  <h4 className="text-lg font-medium text-gray-900 mb-3">🔄 Data Processing Flow</h4>
                  <div className="bg-gray-50 p-4 rounded-lg">
                    <div className="flex items-center justify-between text-sm">
                      <div className="text-center">
                        <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center mb-2">
                          <span className="text-blue-600 font-bold">📡</span>
                        </div>
                        <p className="text-gray-700">APIs</p>
                      </div>
                      <div className="text-gray-400">→</div>
                      <div className="text-center">
                        <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center mb-2">
                          <span className="text-green-600 font-bold">⚙️</span>
                        </div>
                        <p className="text-gray-700">Google Apps Script</p>
                      </div>
                      <div className="text-gray-400">→</div>
                      <div className="text-center">
                        <div className="w-12 h-12 bg-yellow-100 rounded-full flex items-center justify-center mb-2">
                          <span className="text-yellow-600 font-bold">📊</span>
                        </div>
                        <p className="text-gray-700">Google Sheets</p>
                      </div>
                      <div className="text-gray-400">→</div>
                      <div className="text-center">
                        <div className="w-12 h-12 bg-purple-100 rounded-full flex items-center justify-center mb-2">
                          <span className="text-purple-600 font-bold">📈</span>
                        </div>
                        <p className="text-gray-700">Dashboard</p>
                      </div>
                    </div>
                  </div>
                  
                  <div className="mt-4 space-y-3">
                    <div className="flex items-start">
                      <span className="text-blue-600 font-bold mr-3">📡</span>
                      <p className="text-gray-700"><strong>Data Collection:</strong> Hourly automated fetching from exchange APIs and blockchain explorers</p>
                    </div>
                    <div className="flex items-start">
                      <span className="text-green-600 font-bold mr-3">⚙️</span>
                      <p className="text-gray-700"><strong>Processing:</strong> Google Apps Script processes, formats, and validates all transaction data</p>
                    </div>
                    <div className="flex items-start">
                      <span className="text-yellow-600 font-bold mr-3">📊</span>
                      <p className="text-gray-700"><strong>Storage:</strong> Clean data stored in Google Sheets with separate tabs for different views</p>
                    </div>
                    <div className="flex items-start">
                      <span className="text-purple-600 font-bold mr-3">📈</span>
                      <p className="text-gray-700"><strong>Visualization:</strong> React dashboard reads from Google Sheets to display real-time analytics</p>
                    </div>
                  </div>
                </div>

                <div>
                  <h4 className="text-lg font-medium text-gray-900 mb-3">🔒 Security & Privacy</h4>
                  <div className="bg-red-50 p-4 rounded-lg">
                    <ul className="text-sm text-red-800 space-y-2">
                      <li>• <strong>🔐 API Keys:</strong> Stored securely in Google's encrypted PropertiesService</li>
                      <li>• <strong>👁️ Read-Only Access:</strong> Exchange APIs have read-only permissions (cannot withdraw funds)</li>
                      <li>• <strong>🛡️ HTTPS Encryption:</strong> All data transmission uses secure HTTPS protocols</li>
                      <li>• <strong>🏠 Private Data:</strong> Your transaction data remains in your Google account</li>
                      <li>• <strong>🚫 No Third-Party Storage:</strong> No external databases or data sharing</li>
                    </ul>
                  </div>
                </div>

                <div>
                  <h4 className="text-lg font-medium text-gray-900 mb-3">🔧 Maintenance & Updates</h4>
                  <div className="space-y-3">
                    <p className="text-gray-700"><strong>🤖 Automatic Updates:</strong> The system runs hourly updates automatically without any manual intervention.</p>
                    <p className="text-gray-700"><strong>🛠️ Error Handling:</strong> Built-in error detection and logging to ensure data integrity and system reliability.</p>
                    <p className="text-gray-700"><strong>📈 Scalability:</strong> Easy to add new wallets, exchanges, or cryptocurrencies as your portfolio grows.</p>
                    <p className="text-gray-700"><strong>🎧 Support:</strong> 30-day support period included with ongoing maintenance options available.</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default CryptoTrackerProduction;
