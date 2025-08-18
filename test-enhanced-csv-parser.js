const EnhancedCSVParser = require('./utils/enhancedCSVParser');
const path = require('path');

async function testEnhancedCSVParser() {
  console.log('🧪 Testing Enhanced CSV Parser...\n');

  const parser = new EnhancedCSVParser();
  const testFiles = [
    'standard-format.csv',
    'standard-bank-format.csv',
    'fnb-bank-format.csv',
    'absa-bank-format.csv',
    'capitec-bank-format.csv',
    'nedbank-format.csv'
  ];

  for (const fileName of testFiles) {
    const filePath = path.join(__dirname, 'test-csv-samples', fileName);
    
    try {
      console.log(`📄 Testing: ${fileName}`);
      console.log('━'.repeat(50));
      
      const result = await parser.parseCSV(filePath);
      
      console.log(`📊 Headers: ${result.headers.join(', ')}`);
      console.log(`🤖 Auto-mapping:`, result.mapping);
      console.log(`🎯 Confidence: ${parser.getMappingConfidence(result.mapping, result.headers)}%`);
      console.log(`✅ Transactions extracted: ${result.transactions.length}`);
      console.log(`❌ Errors: ${result.errors.length}`);
      
      if (result.transactions.length > 0) {
        console.log('📝 Sample transaction:');
        console.log(JSON.stringify(result.transactions[0], null, 2));
      }
      
      console.log(''); // Empty line for separation
      
    } catch (error) {
      console.error(`❌ Error testing ${fileName}:`, error.message);
    }
  }
  
  console.log('🎉 Enhanced CSV Parser test completed!');
}

// Run test if called directly
if (require.main === module) {
  testEnhancedCSVParser();
}

module.exports = testEnhancedCSVParser;
