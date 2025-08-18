#!/usr/bin/env node
/**
 * Payment System Diagnostic Tool
 * Checks database structure and payment matching capability
 */

const db = require('./config/database');
const EnhancedCSVParser = require('./utils/enhancedCSVParser');

async function runPaymentDiagnostics() {
  let client;
  try {
    console.log('🔍 Running Payment System Diagnostics...\n');
    
    client = await db.connect();
    
    // 1. Check invoices table structure and data
    console.log('📊 INVOICE DATABASE ANALYSIS:');
    const invoiceStats = await client.query(`
      SELECT 
        COUNT(*) as total_invoices,
        COUNT(CASE WHEN status = 'Unpaid' THEN 1 END) as unpaid_invoices,
        COUNT(CASE WHEN status = 'Partial' THEN 1 END) as partial_invoices,
        COUNT(CASE WHEN status = 'Paid' THEN 1 END) as paid_invoices
      FROM invoices
    `);
    
    console.log(`Total Invoices: ${invoiceStats.rows[0].total_invoices}`);
    console.log(`Unpaid: ${invoiceStats.rows[0].unpaid_invoices}`);
    console.log(`Partial: ${invoiceStats.rows[0].partial_invoices}`);
    console.log(`Paid: ${invoiceStats.rows[0].paid_invoices}\n`);
    
    // 2. Show sample invoice references
    console.log('📋 SAMPLE INVOICE REFERENCES:');
    const sampleInvoices = await client.query(`
      SELECT reference_number, status, amount_due, outstanding_balance
      FROM invoices 
      WHERE status IN ('Unpaid', 'Partial')
      ORDER BY created_at DESC
      LIMIT 10
    `);
    
    if (sampleInvoices.rows.length === 0) {
      console.log('❌ No unpaid invoices found! This explains why you get 0 matches.');
      console.log('   You need to generate invoices first before processing payments.\n');
    } else {
      sampleInvoices.rows.forEach((inv, i) => {
        console.log(`${i+1}. ${inv.reference_number} - ${inv.status} - R${inv.outstanding_balance || inv.amount_due}`);
      });
      console.log('');
    }
    
    // 3. Test reference extraction with your patterns
    console.log('🔍 REFERENCE EXTRACTION TEST:');
    const parser = new EnhancedCSVParser();
    
    const testPatterns = [
      'CAPITEC HAR149',
      'ADT CASH DEPOLEPMHALL HAR142',
      'FNB APP PAYMENT FROM STUDENT NAME',
      'CASH DEPOSIT HAR020',
      'INTERNET TRANSFER HAR240'
    ];
    
    testPatterns.forEach(pattern => {
      const extracted = parser.extractReference(pattern, '');
      console.log(`📝 "${pattern}" → "${extracted}"`);
    });
    console.log('');
    
    // 4. Test matching logic with actual data
    if (sampleInvoices.rows.length > 0) {
      console.log('🎯 MATCHING TEST WITH ACTUAL DATA:');
      
      const testRef = sampleInvoices.rows[0].reference_number;
      console.log(`Testing with actual reference: "${testRef}"`);
      
      // Test exact match
      const exactMatch = await client.query(`
        SELECT reference_number, status, outstanding_balance
        FROM invoices 
        WHERE UPPER(reference_number) = UPPER($1) AND status IN ('Unpaid', 'Partial')
        LIMIT 1
      `, [testRef]);
      
      if (exactMatch.rows.length > 0) {
        console.log(`✅ Exact match found: ${exactMatch.rows[0].reference_number}`);
      } else {
        console.log(`❌ No exact match found for: ${testRef}`);
      }
      
      // Test with HAR pattern
      const harPattern = `CAPITEC ${testRef}`;
      const extractedFromPattern = parser.extractReference(harPattern, '');
      console.log(`📝 Pattern: "${harPattern}" → Extracted: "${extractedFromPattern}"`);
      
      if (extractedFromPattern) {
        const patternMatch = await client.query(`
          SELECT reference_number, status, outstanding_balance
          FROM invoices 
          WHERE UPPER(reference_number) = UPPER($1) AND status IN ('Unpaid', 'Partial')
          LIMIT 1
        `, [extractedFromPattern]);
        
        if (patternMatch.rows.length > 0) {
          console.log(`✅ Pattern match found: ${patternMatch.rows[0].reference_number}`);
        } else {
          console.log(`❌ No pattern match found for: ${extractedFromPattern}`);
        }
      }
      console.log('');
    }
    
    // 5. Check payment_transactions table
    console.log('💰 PAYMENT TRANSACTIONS ANALYSIS:');
    const transactionStats = await client.query(`
      SELECT COUNT(*) as total_transactions
      FROM payment_transactions
    `);
    console.log(`Total payment transactions: ${transactionStats.rows[0].total_transactions}`);
    
    // 6. Recommendations
    console.log('🎯 RECOMMENDATIONS:');
    
    if (sampleInvoices.rows.length === 0) {
      console.log('1. ❗ Generate invoices first using the "Generate Invoices" button');
      console.log('2. 🎯 Ensure invoices have proper reference numbers (HAR###)');
      console.log('3. 📝 Then upload your bank statement CSV');
    } else {
      console.log('1. ✅ Invoices exist and ready for matching');
      console.log('2. 🎯 Enhanced reference extraction is configured');
      console.log('3. 📝 Upload your bank statement CSV to test matching');
    }
    
    console.log('\n🎉 Diagnostics completed!');
    
  } catch (error) {
    console.error('❌ Diagnostics failed:', error.message);
    console.error('Stack:', error.stack);
  } finally {
    if (client) client.release();
  }
}

// Run diagnostics
runPaymentDiagnostics()
  .then(() => {
    console.log('✅ Payment system diagnostic completed');
    process.exit(0);
  })
  .catch(error => {
    console.error('💥 Diagnostic error:', error);
    process.exit(1);
  });
