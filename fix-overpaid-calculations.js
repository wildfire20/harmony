#!/usr/bin/env node
/**
 * Fix Overpaid Payment Display Issue
 * Corrects calculation and display of overpaid amounts for students
 */

const { Pool } = require('pg');

// Use Railway DATABASE_URL or local fallback
const databaseUrl = process.env.DATABASE_URL || 'postgresql://localhost:5432/harmony';

const db = new Pool({
  connectionString: databaseUrl,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function fixOverpaidCalculations() {
  console.log('🔧 FIXING OVERPAID PAYMENT CALCULATIONS');
  console.log('======================================\n');
  
  try {
    // Test database connection
    await db.query('SELECT NOW()');
    console.log('✅ Database connected successfully\n');

    // 1. First, let's recalculate all invoice amounts based on actual payment transactions
    console.log('📊 RECALCULATING INVOICE AMOUNTS...');
    
    const recalculationQuery = `
      UPDATE invoices SET
        amount_paid = COALESCE((
          SELECT SUM(pt.amount) 
          FROM payment_transactions pt 
          WHERE pt.invoice_id = invoices.id AND pt.status != 'Failed'
        ), 0),
        outstanding_balance = CASE 
          WHEN COALESCE((
            SELECT SUM(pt.amount) 
            FROM payment_transactions pt 
            WHERE pt.invoice_id = invoices.id AND pt.status != 'Failed'
          ), 0) >= amount_due 
          THEN 0 
          ELSE amount_due - COALESCE((
            SELECT SUM(pt.amount) 
            FROM payment_transactions pt 
            WHERE pt.invoice_id = invoices.id AND pt.status != 'Failed'
          ), 0)
        END,
        overpaid_amount = CASE 
          WHEN COALESCE((
            SELECT SUM(pt.amount) 
            FROM payment_transactions pt 
            WHERE pt.invoice_id = invoices.id AND pt.status != 'Failed'
          ), 0) > amount_due 
          THEN COALESCE((
            SELECT SUM(pt.amount) 
            FROM payment_transactions pt 
            WHERE pt.invoice_id = invoices.id AND pt.status != 'Failed'
          ), 0) - amount_due
          ELSE 0
        END,
        status = CASE 
          WHEN COALESCE((
            SELECT SUM(pt.amount) 
            FROM payment_transactions pt 
            WHERE pt.invoice_id = invoices.id AND pt.status != 'Failed'
          ), 0) > amount_due THEN 'Overpaid'
          WHEN COALESCE((
            SELECT SUM(pt.amount) 
            FROM payment_transactions pt 
            WHERE pt.invoice_id = invoices.id AND pt.status != 'Failed'
          ), 0) = amount_due THEN 'Paid'
          WHEN COALESCE((
            SELECT SUM(pt.amount) 
            FROM payment_transactions pt 
            WHERE pt.invoice_id = invoices.id AND pt.status != 'Failed'
          ), 0) > 0 THEN 'Partial'
          ELSE 'Unpaid'
        END,
        updated_at = NOW()
      WHERE EXISTS (
        SELECT 1 FROM payment_transactions pt 
        WHERE pt.invoice_id = invoices.id
      )
    `;
    
    const updateResult = await db.query(recalculationQuery);
    console.log(`✅ Updated ${updateResult.rowCount} invoices with corrected calculations\n`);

    // 2. Now let's check specific problematic cases
    console.log('🔍 CHECKING UPDATED CALCULATIONS:');
    
    const problemCases = await db.query(`
      SELECT 
        i.reference_number,
        i.status,
        i.amount_due,
        i.amount_paid,
        i.outstanding_balance,
        i.overpaid_amount,
        u.first_name,
        u.last_name,
        u.student_number,
        (SELECT COUNT(*) FROM payment_transactions pt WHERE pt.invoice_id = i.id) as transaction_count,
        (SELECT SUM(pt.amount) FROM payment_transactions pt WHERE pt.invoice_id = i.id) as total_transactions
      FROM invoices i
      LEFT JOIN users u ON i.student_id = u.id
      WHERE i.reference_number IN ('HAR068', 'HAR099', 'HAR080')
         OR i.status = 'Overpaid' 
         OR i.overpaid_amount > 0
      ORDER BY i.reference_number
    `);
    
    console.log(`Found ${problemCases.rows.length} cases to review:\n`);
    
    problemCases.rows.forEach((invoice, i) => {
      console.log(`${i+1}. ${invoice.reference_number} - ${invoice.first_name} ${invoice.last_name} (${invoice.student_number})`);
      console.log(`   Status: ${invoice.status}`);
      console.log(`   Amount Due: R${invoice.amount_due}`);
      console.log(`   Amount Paid: R${invoice.amount_paid || 0}`);
      console.log(`   Outstanding: R${invoice.outstanding_balance || 0}`);
      console.log(`   Overpaid: R${invoice.overpaid_amount || 0}`);
      console.log(`   Transactions: ${invoice.transaction_count} (Total: R${invoice.total_transactions || 0})`);
      
      // Verify calculation
      const expectedOverpaid = Math.max(0, (invoice.total_transactions || 0) - invoice.amount_due);
      const actualOverpaid = invoice.overpaid_amount || 0;
      
      if (Math.abs(expectedOverpaid - actualOverpaid) > 0.01) {
        console.log(`   ❌ Calculation mismatch! Expected: R${expectedOverpaid}, Got: R${actualOverpaid}`);
      } else {
        console.log(`   ✅ Calculation correct`);
      }
      console.log('');
    });

    // 3. Fix any remaining inconsistencies in payment transaction linking
    console.log('🔧 FIXING UNLINKED PAYMENT TRANSACTIONS:');
    
    const unlinkTransactions = await db.query(`
      SELECT pt.*, i.id as correct_invoice_id, i.reference_number
      FROM payment_transactions pt
      LEFT JOIN invoices i ON i.reference_number = pt.reference_number
      WHERE pt.invoice_id IS NULL AND i.id IS NOT NULL
    `);
    
    if (unlinkTransactions.rows.length > 0) {
      console.log(`Found ${unlinkTransactions.rows.length} unlinked transactions to fix:`);
      
      for (const tx of unlinkTransactions.rows) {
        await db.query(`
          UPDATE payment_transactions 
          SET invoice_id = $1, status = 'Matched'
          WHERE id = $2
        `, [tx.correct_invoice_id, tx.id]);
        
        console.log(`  ✅ Linked transaction ${tx.id} (R${tx.amount}) to invoice ${tx.reference_number}`);
      }
      
      // Re-run the recalculation for affected invoices
      console.log('\n🔄 Re-running calculations for affected invoices...');
      await db.query(recalculationQuery);
      console.log('✅ Recalculation complete');
    } else {
      console.log('✅ No unlinked transactions found');
    }

    // 4. Final verification
    console.log('\n🎯 FINAL VERIFICATION:');
    
    const finalCheck = await db.query(`
      SELECT 
        i.reference_number,
        i.status,
        i.amount_due,
        i.amount_paid,
        i.overpaid_amount,
        (SELECT SUM(pt.amount) FROM payment_transactions pt WHERE pt.invoice_id = i.id) as calculated_paid
      FROM invoices i
      WHERE i.reference_number IN ('HAR068', 'HAR099', 'HAR080')
      ORDER BY i.reference_number
    `);
    
    finalCheck.rows.forEach(invoice => {
      const calculatedOverpaid = Math.max(0, (invoice.calculated_paid || 0) - invoice.amount_due);
      const statusMatch = 
        (invoice.calculated_paid > invoice.amount_due && invoice.status === 'Overpaid') ||
        (invoice.calculated_paid === invoice.amount_due && invoice.status === 'Paid') ||
        (invoice.calculated_paid < invoice.amount_due && invoice.calculated_paid > 0 && invoice.status === 'Partial') ||
        (invoice.calculated_paid === 0 && invoice.status === 'Unpaid');
      
      console.log(`${invoice.reference_number}:`);
      console.log(`  Status: ${invoice.status} ${statusMatch ? '✅' : '❌'}`);
      console.log(`  Amount Due: R${invoice.amount_due}`);
      console.log(`  Amount Paid: R${invoice.amount_paid || 0}`);
      console.log(`  Calculated Paid: R${invoice.calculated_paid || 0}`);
      console.log(`  Overpaid Amount: R${invoice.overpaid_amount || 0}`);
      console.log(`  Expected Overpaid: R${calculatedOverpaid}`);
      console.log(`  Match: ${Math.abs(calculatedOverpaid - (invoice.overpaid_amount || 0)) <= 0.01 ? '✅' : '❌'}`);
      console.log('');
    });

  } catch (error) {
    console.error('❌ Fix failed:', error);
    throw error;
  } finally {
    await db.end();
  }
}

// Run fix
fixOverpaidCalculations()
  .then(() => {
    console.log('🎉 OVERPAID PAYMENT CALCULATIONS FIXED');
    console.log('The payment display should now show correct amounts matching bank statements.');
    process.exit(0);
  })
  .catch((error) => {
    console.error('💥 Fix failed:', error.message);
    process.exit(1);
  });
