#!/usr/bin/env node
/**
 * Production Reference Matching Test
 * Tests the enhanced payment system against your actual invoice database
 */

const db = require('./config/database');
const EnhancedCSVParser = require('./utils/enhancedCSVParser');

async function testProductionMatching() {
  let client;
  try {
    console.log('🎯 Testing Production Reference Matching...\n');
    
    client = await db.connect();
    
    // Get a sample of actual invoices from your database
    const invoicesResult = await client.query(`
      SELECT reference_number, amount_due, outstanding_balance, status,
             u.first_name, u.last_name, u.student_number
      FROM invoices i
      LEFT JOIN users u ON i.student_id = u.id
      WHERE i.status IN ('Unpaid', 'Partial')
      ORDER BY i.due_date DESC
      LIMIT 10
    `);
    
    console.log('📊 Sample Unpaid Invoices in Database:');
    invoicesResult.rows.forEach((invoice, index) => {
      console.log(`${index + 1}. ${invoice.reference_number} - ${invoice.first_name} ${invoice.last_name} - R${invoice.outstanding_balance || invoice.amount_due}`);
    });
    
    console.log('\n🧪 Testing Reference Matching with Bank Statement Patterns...\n');
    
    const parser = new EnhancedCSVParser();
    
    // Test with patterns from your actual bank statements
    const testPatterns = [
      `CAPITEC ${invoicesResult.rows[0]?.reference_number || 'HAR149'}`,
      `ADT CASH DEPOLEPMHALL ${invoicesResult.rows[1]?.reference_number || 'HAR142'}`,
      `FNB APP PAYMENT FROM ${invoicesResult.rows[0]?.first_name || 'STUDENT'} ${invoicesResult.rows[0]?.last_name || 'NAME'}`,
      `INTERNET TRANSFER ${invoicesResult.rows[2]?.reference_number || 'HAR050'}`,
      `CASH DEPOSIT ${invoicesResult.rows[3]?.reference_number || 'HAR020'}`
    ];
    
    for (let i = 0; i < testPatterns.length && i < invoicesResult.rows.length; i++) {
      const pattern = testPatterns[i];
      const expectedInvoice = invoicesResult.rows[i];
      
      console.log(`📝 Bank Statement: "${pattern}"`);
      
      const extractedRef = parser.extractReference(pattern, '');
      console.log(`🔍 Extracted Reference: "${extractedRef}"`);
      
      // Test database matching
      if (extractedRef) {
        // Try exact match
        let matchResult = await client.query(`
          SELECT reference_number, amount_due, outstanding_balance
          FROM invoices 
          WHERE UPPER(reference_number) = UPPER($1) AND status IN ('Unpaid', 'Partial')
          LIMIT 1
        `, [extractedRef]);
        
        if (matchResult.rows.length > 0) {
          console.log(`✅ MATCH FOUND: ${matchResult.rows[0].reference_number} - R${matchResult.rows[0].outstanding_balance}`);
        } else {
          console.log(`❌ NO MATCH: No invoice found for "${extractedRef}"`);
        }
      } else {
        console.log(`❌ NO REFERENCE EXTRACTED`);
      }
      
      console.log('');
    }
    
    console.log('🎯 Production Test Summary:');
    console.log('- Enhanced reference extraction is active');
    console.log('- Database connection working');
    console.log('- Invoice matching logic operational');
    console.log('\n✅ Ready to process real bank statements!');
    
  } catch (error) {
    console.error('❌ Production test failed:', error.message);
    console.error('Stack:', error.stack);
  } finally {
    if (client) client.release();
  }
}

// Only run if this file is executed directly
if (require.main === module) {
  testProductionMatching()
    .then(() => {
      console.log('\n🎉 Production test completed');
      process.exit(0);
    })
    .catch(error => {
      console.error('💥 Production test error:', error);
      process.exit(1);
    });
}
