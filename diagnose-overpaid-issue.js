#!/usr/bin/env node
/**
 * Diagnose Overpaid Payment Issue
 * Identifies specific discrepancies between bank statements and displayed amounts
 */

const { Pool } = require('pg');

// Use Railway DATABASE_URL or local fallback
const databaseUrl = process.env.DATABASE_URL || 'postgresql://localhost:5432/harmony';

const db = new Pool({
  connectionString: databaseUrl,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function diagnoseOverpaidIssue() {
  console.log('🔍 DIAGNOSING OVERPAID PAYMENT ISSUE');
  console.log('===================================\n');
  
  try {
    // Test database connection
    await db.query('SELECT NOW()');
    console.log('✅ Database connected successfully\n');

    // 1. Check specific students mentioned in the issue
    console.log('📊 CHECKING SPECIFIC STUDENTS:');
    
    const studentReferences = ['HAR068', 'HAR099', 'HAR080'];
    
    for (const ref of studentReferences) {
      console.log(`\n--- Student: ${ref} ---`);
      
      // Get invoice information
      const invoiceResult = await db.query(`
        SELECT i.*, u.first_name, u.last_name, u.student_number
        FROM invoices i
        LEFT JOIN users u ON i.student_id = u.id
        WHERE i.reference_number = $1
      `, [ref]);
      
      if (invoiceResult.rows.length === 0) {
        console.log(`❌ No invoice found for reference ${ref}`);
        continue;
      }
      
      const invoice = invoiceResult.rows[0];
      console.log(`Student: ${invoice.first_name} ${invoice.last_name} (${invoice.student_number})`);
      console.log(`Invoice Status: ${invoice.status}`);
      console.log(`Amount Due: R${invoice.amount_due}`);
      console.log(`Amount Paid: R${invoice.amount_paid || 0}`);
      console.log(`Outstanding Balance: R${invoice.outstanding_balance || 0}`);
      console.log(`Overpaid Amount (DB): R${invoice.overpaid_amount || 0}`);
      
      // Get all payment transactions for this invoice
      const transactionsResult = await db.query(`
        SELECT pt.*, u.first_name, u.last_name
        FROM payment_transactions pt
        LEFT JOIN users u ON pt.student_id = u.id
        WHERE pt.reference_number = $1 OR pt.invoice_id = $2
        ORDER BY pt.payment_date, pt.created_at
      `, [ref, invoice.id]);
      
      console.log(`\n📋 Payment Transactions (${transactionsResult.rows.length}):`);
      let totalTransactions = 0;
      
      transactionsResult.rows.forEach((tx, i) => {
        console.log(`  ${i+1}. Amount: R${tx.amount} | Date: ${tx.payment_date} | Status: ${tx.status}`);
        console.log(`     Description: "${tx.description || 'N/A'}"`);
        console.log(`     Transaction ID: ${tx.id} | Invoice ID: ${tx.invoice_id || 'N/A'}`);
        totalTransactions += parseFloat(tx.amount || 0);
      });
      
      console.log(`\n💰 CALCULATION VERIFICATION:`);
      console.log(`Total Transaction Amounts: R${totalTransactions}`);
      console.log(`Database Amount Paid: R${invoice.amount_paid || 0}`);
      console.log(`Expected Overpaid: R${Math.max(0, totalTransactions - parseFloat(invoice.amount_due))}`);
      console.log(`Database Overpaid: R${invoice.overpaid_amount || 0}`);
      
      // Check for discrepancies
      const expectedOverpaid = Math.max(0, totalTransactions - parseFloat(invoice.amount_due));
      const dbOverpaid = parseFloat(invoice.overpaid_amount || 0);
      
      if (Math.abs(expectedOverpaid - dbOverpaid) > 0.01) {
        console.log(`❌ DISCREPANCY FOUND!`);
        console.log(`   Expected overpaid: R${expectedOverpaid}`);
        console.log(`   Database overpaid: R${dbOverpaid}`);
        console.log(`   Difference: R${Math.abs(expectedOverpaid - dbOverpaid)}`);
      } else {
        console.log(`✅ Calculations match`);
      }
    }

    // 2. Check for duplicate payments or processing issues
    console.log('\n\n🔍 CHECKING FOR PROCESSING ISSUES:');
    
    const duplicatePayments = await db.query(`
      SELECT reference_number, COUNT(*) as payment_count, SUM(amount) as total_amount
      FROM payment_transactions 
      WHERE reference_number IN ('HAR068', 'HAR099', 'HAR080')
      GROUP BY reference_number
      HAVING COUNT(*) > 1
    `);
    
    if (duplicatePayments.rows.length > 0) {
      console.log('⚠️ Found multiple payments for same reference:');
      duplicatePayments.rows.forEach(dup => {
        console.log(`  ${dup.reference_number}: ${dup.payment_count} payments, Total: R${dup.total_amount}`);
      });
    } else {
      console.log('✅ No duplicate payment issues found');
    }

    // 3. Check invoice status consistency
    console.log('\n🔍 CHECKING STATUS CONSISTENCY:');
    
    const statusCheck = await db.query(`
      SELECT reference_number, status, amount_due, amount_paid, outstanding_balance, overpaid_amount,
             CASE 
               WHEN amount_paid > amount_due THEN 'Overpaid'
               WHEN amount_paid = amount_due THEN 'Paid'
               WHEN amount_paid > 0 THEN 'Partial'
               ELSE 'Unpaid'
             END as calculated_status
      FROM invoices
      WHERE reference_number IN ('HAR068', 'HAR099', 'HAR080')
    `);
    
    statusCheck.rows.forEach(invoice => {
      const statusMatch = invoice.status === invoice.calculated_status;
      console.log(`\n${invoice.reference_number}:`);
      console.log(`  Current Status: ${invoice.status}`);
      console.log(`  Calculated Status: ${invoice.calculated_status}`);
      console.log(`  Status Match: ${statusMatch ? '✅' : '❌'}`);
      
      if (!statusMatch) {
        console.log(`  ⚠️ STATUS MISMATCH - Should be updated`);
      }
    });

  } catch (error) {
    console.error('❌ Diagnosis failed:', error);
    throw error;
  } finally {
    await db.end();
  }
}

// Run diagnosis
diagnoseOverpaidIssue()
  .then(() => {
    console.log('\n🎯 DIAGNOSIS COMPLETE');
    console.log('Check the output above to identify specific payment discrepancies.');
    process.exit(0);
  })
  .catch((error) => {
    console.error('💥 Diagnosis failed:', error.message);
    process.exit(1);
  });
