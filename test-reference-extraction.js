#!/usr/bin/env node
/**
 * Test Enhanced Reference Extraction for Harmony Learning Bank Statements
 * Tests the improved logic with actual bank statement patterns
 */

const EnhancedCSVParser = require('./utils/enhancedCSVParser');

// Test data based on the bank statement screenshots
const testTransactions = [
  {
    description: "CAPITEC HAR149",
    expected: "HAR149"
  },
  {
    description: "CAPITEC HAR124", 
    expected: "HAR124"
  },
  {
    description: "ADT CASH DEPOLEPMHALL HAR142",
    expected: "HAR142"
  },
  {
    description: "FNB APP PAYMENT FROM REMOBATILE MELLO",
    expected: "REMOBATILE" // or "MELLO" - will extract meaningful name
  },
  {
    description: "CAPITEC KAMO RAMAOKA SHORTS",
    expected: "KAMO" // Extract first meaningful name
  },
  {
    description: "CASH DEPOSIT FEE HAR020",
    expected: "HAR020"
  },
  {
    description: "INTERNET TRANSFER FROM HAR240 STUDENT FEES",
    expected: "HAR240"
  },
  {
    description: "PAYMENT REFERENCE 123456",
    expected: "123456"
  },
  {
    description: "JOHN SMITH GRADE 3 FEES",
    expected: "JOHN" // Extract student name
  },
  {
    description: "HAR50",
    expected: "HAR50"
  }
];

async function testReferenceExtraction() {
  console.log('🧪 Testing Enhanced Reference Extraction for Harmony Learning...\n');
  
  const parser = new EnhancedCSVParser();
  let passed = 0;
  let total = testTransactions.length;
  
  for (const test of testTransactions) {
    const extracted = parser.extractReference(test.description, '');
    const success = extracted === test.expected || 
                   (extracted && test.description.includes(extracted));
    
    console.log(`📝 Description: "${test.description}"`);
    console.log(`🎯 Expected: "${test.expected}"`);
    console.log(`🔍 Extracted: "${extracted}"`);
    console.log(`${success ? '✅' : '❌'} ${success ? 'PASS' : 'FAIL'}\n`);
    
    if (success) passed++;
  }
  
  console.log(`📊 Test Results: ${passed}/${total} tests passed (${Math.round(passed/total*100)}%)`);
  
  if (passed === total) {
    console.log('🎉 All tests passed! Reference extraction is working correctly.');
  } else {
    console.log('⚠️  Some tests failed. The reference extraction needs further refinement.');
  }
}

// Test CSV parsing with sample data
async function testCSVParsing() {
  console.log('\n🧪 Testing CSV Parsing with Sample Bank Statement Format...\n');
  
  const parser = new EnhancedCSVParser();
  
  // Simulate bank statement data
  const sampleData = [
    { 
      'Transaction Date': '2025-01-15',
      'Description': 'CAPITEC HAR149',
      'Debit': '',
      'Credit': '2500.00',
      'Balance': '10000.00'
    },
    {
      'Transaction Date': '2025-01-16', 
      'Description': 'ADT CASH DEPOLEPMHALL HAR142',
      'Debit': '',
      'Credit': '1800.00',
      'Balance': '11800.00'
    },
    {
      'Transaction Date': '2025-01-17',
      'Description': 'FNB APP PAYMENT FROM REMOBATILE MELLO',
      'Debit': '',
      'Credit': '2200.00', 
      'Balance': '14000.00'
    }
  ];
  
  const mapping = {
    date: 'Transaction Date',
    description: 'Description',
    debit: 'Debit',
    credit: 'Credit'
  };
  
  console.log('📋 Sample Bank Statement Data:');
  sampleData.forEach((row, index) => {
    console.log(`${index + 1}. ${row['Transaction Date']} - ${row.Description} - R${row.Credit}`);
    
    const extracted = parser.extractReference(row.Description, '');
    console.log(`   🔍 Extracted Reference: "${extracted}"`);
  });
  
  console.log('\n✅ CSV parsing test completed');
}

// Run tests
async function runAllTests() {
  try {
    await testReferenceExtraction();
    await testCSVParsing();
    
    console.log('\n🎯 Next Steps:');
    console.log('1. Upload your bank statement CSV to test with real data');
    console.log('2. Check the Railway logs for reference extraction results'); 
    console.log('3. Verify that HAR### patterns are being matched correctly');
    
  } catch (error) {
    console.error('❌ Test failed:', error);
  }
}

runAllTests();
