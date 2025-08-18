#!/usr/bin/env node
/**
 * Update Existing Overpaid Amounts
 * Corrects overpaid amounts that were calculated incorrectly due to the bug
 */

const { Pool } = require('pg');

// Use Railway DATABASE_URL or local fallback
const databaseUrl = process.env.DATABASE_URL || 'postgresql://localhost:5432/harmony';

const db = new Pool({
  connectionString: databaseUrl,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function updateExistingOverpaidAmounts() {
  console.log('🔧 UPDATING EXISTING OVERPAID AMOUNTS');
  console.log('====================================\n');
  
  try {
    // Test database connection
    await db.query('SELECT NOW()');
    console.log('✅ Database connected successfully\n');

    console.log('📊 Finding invoices with potentially incorrect overpaid amounts...\n');

    // Find all overpaid invoices and recalculate their overpaid amounts
    const overpaidInvoices = await db.query(`
      SELECT 
        i.id,
        i.reference_number,
        i.amount_due,
        i.amount_paid,
        i.overpaid_amount as current_overpaid_amount,
        i.status,
        u.first_name,
        u.last_name,
        u.student_number,
        (SELECT COALESCE(SUM(pt.amount), 0) 
         FROM payment_transactions pt 
         WHERE pt.invoice_id = i.id AND pt.status != 'Failed') as actual_total_paid
      FROM invoices i
      LEFT JOIN users u ON i.student_id = u.id
      WHERE i.status = 'Overpaid' OR i.overpaid_amount > 0
      ORDER BY i.reference_number
    `);

    if (overpaidInvoices.rows.length === 0) {
      console.log('✅ No overpaid invoices found in the database.\n');
      return;
    }

    console.log(`Found ${overpaidInvoices.rows.length} overpaid invoices to review:\n`);

    let correctedCount = 0;
    let alreadyCorrectCount = 0;

    for (let i = 0; i < overpaidInvoices.rows.length; i++) {
      const invoice = overpaidInvoices.rows[i];
      
      // Calculate the correct overpaid amount
      const actualTotalPaid = parseFloat(invoice.actual_total_paid);
      const amountDue = parseFloat(invoice.amount_due);
      const correctOverpaidAmount = Math.max(0, actualTotalPaid - amountDue);
      const currentOverpaidAmount = parseFloat(invoice.current_overpaid_amount || 0);
      
      console.log(`${i + 1}. ${invoice.reference_number} - ${invoice.first_name} ${invoice.last_name} (${invoice.student_number})`);
      console.log(`   Amount Due: R${amountDue}`);
      console.log(`   Actual Total Paid: R${actualTotalPaid}`);
      console.log(`   Current Overpaid Amount: R${currentOverpaidAmount}`);
      console.log(`   Correct Overpaid Amount: R${correctOverpaidAmount}`);

      // Check if correction is needed
      const difference = Math.abs(correctOverpaidAmount - currentOverpaidAmount);
      if (difference > 0.01) { // Allow for small rounding differences
        console.log(`   ❌ NEEDS CORRECTION! Difference: R${difference}`);
        
        // Update the invoice with correct values
        await db.query(`
          UPDATE invoices SET 
            overpaid_amount = $1,
            amount_paid = $2,
            outstanding_balance = CASE 
              WHEN $2 >= amount_due THEN 0 
              ELSE amount_due - $2 
            END,
            status = CASE 
              WHEN $2 > amount_due THEN 'Overpaid'
              WHEN $2 = amount_due THEN 'Paid'
              WHEN $2 > 0 THEN 'Partial'
              ELSE 'Unpaid'
            END,
            updated_at = NOW()
          WHERE id = $3
        `, [correctOverpaidAmount, actualTotalPaid, invoice.id]);
        
        console.log(`   ✅ CORRECTED: Updated overpaid amount to R${correctOverpaidAmount}`);
        correctedCount++;
      } else {
        console.log(`   ✅ Already correct`);
        alreadyCorrectCount++;
      }
      console.log('');
    }

    console.log('\n🎯 SUMMARY:');
    console.log(`Total invoices reviewed: ${overpaidInvoices.rows.length}`);
    console.log(`Invoices corrected: ${correctedCount}`);
    console.log(`Invoices already correct: ${alreadyCorrectCount}`);

    if (correctedCount > 0) {
      console.log('\n🎉 OVERPAID AMOUNTS HAVE BEEN CORRECTED!');
      console.log('The payment system should now display correct overpaid amounts that match your bank statements.');
    } else {
      console.log('\n✅ All overpaid amounts were already correct.');
    }

  } catch (error) {
    console.error('❌ Update failed:', error);
    throw error;
  } finally {
    await db.end();
  }
}

// Run update
updateExistingOverpaidAmounts()
  .then(() => {
    console.log('\n✅ Update process completed successfully!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('💥 Update failed:', error.message);
    process.exit(1);
  });
