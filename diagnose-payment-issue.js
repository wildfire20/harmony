const { Client } = require('pg');

async function diagnosePaymentIssue() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
  });

  try {
    await client.connect();
    console.log('🔗 Connected to Railway database for diagnosis');

    // 1. Check payment_transactions table structure
    console.log('\n📊 PAYMENT_TRANSACTIONS TABLE ANALYSIS:');
    const ptColumns = await client.query(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns 
      WHERE table_name = 'payment_transactions' 
      ORDER BY ordinal_position
    `);
    
    console.log('Columns:', ptColumns.rows);

    // 2. Check actual payment_transactions data
    const ptData = await client.query(`
      SELECT id, reference_number, amount, payment_date, invoice_id, student_id, status, created_at
      FROM payment_transactions 
      ORDER BY created_at DESC 
      LIMIT 10
    `);
    
    console.log('\nRecent payment transactions:', ptData.rows);

    // 3. Check invoices table structure
    console.log('\n📊 INVOICES TABLE ANALYSIS:');
    const invColumns = await client.query(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns 
      WHERE table_name = 'invoices' 
      ORDER BY ordinal_position
    `);
    
    console.log('Columns:', invColumns.rows);

    // 4. Check actual invoices data
    const invData = await client.query(`
      SELECT id, student_id, reference_number, amount_due, amount_paid, outstanding_balance, status
      FROM invoices 
      ORDER BY id
      LIMIT 10
    `);
    
    console.log('\nCurrent invoices:', invData.rows);

    // 5. Check for payment-invoice relationships
    console.log('\n🔗 PAYMENT-INVOICE RELATIONSHIPS:');
    const relationships = await client.query(`
      SELECT 
        pt.reference_number as payment_ref,
        pt.amount as payment_amount,
        pt.invoice_id,
        pt.status as payment_status,
        i.reference_number as invoice_ref,
        i.amount_due,
        i.amount_paid,
        i.outstanding_balance,
        i.status as invoice_status
      FROM payment_transactions pt
      LEFT JOIN invoices i ON pt.invoice_id = i.id
      ORDER BY pt.created_at DESC
      LIMIT 10
    `);
    
    console.log('Payment-Invoice relationships:', relationships.rows);

    // 6. Check payment_upload_logs
    console.log('\n📋 PAYMENT_UPLOAD_LOGS:');
    const uploadLogs = await client.query(`
      SELECT filename, transactions_processed, matched_count, partial_count, 
             overpaid_count, unmatched_count, created_at
      FROM payment_upload_logs 
      ORDER BY created_at DESC 
      LIMIT 5
    `);
    
    console.log('Upload logs:', uploadLogs.rows);

    // 7. Check for orphaned payments (payments without invoice_id)
    console.log('\n⚠️ ORPHANED PAYMENTS (without invoice_id):');
    const orphanedPayments = await client.query(`
      SELECT reference_number, amount, payment_date, status, description
      FROM payment_transactions 
      WHERE invoice_id IS NULL
      ORDER BY created_at DESC
      LIMIT 10
    `);
    
    console.log('Orphaned payments:', orphanedPayments.rows);

    // 8. Check for reference number mismatches
    console.log('\n🔍 REFERENCE NUMBER ANALYSIS:');
    const refAnalysis = await client.query(`
      SELECT 
        'Invoice' as type, reference_number 
      FROM invoices
      UNION ALL
      SELECT 
        'Payment' as type, reference_number 
      FROM payment_transactions
      ORDER BY reference_number
    `);
    
    console.log('All reference numbers:', refAnalysis.rows);

    // 9. Test the invoice update logic
    console.log('\n🧪 TESTING INVOICE UPDATE LOGIC:');
    
    // Find an invoice that should have been paid
    const testInvoice = await client.query(`
      SELECT i.*, pt.amount as payment_amount, pt.id as payment_id
      FROM invoices i
      JOIN payment_transactions pt ON i.reference_number = pt.reference_number
      WHERE pt.invoice_id IS NULL
      LIMIT 1
    `);
    
    if (testInvoice.rows.length > 0) {
      const invoice = testInvoice.rows[0];
      console.log('Found unlinked payment for invoice:', invoice);
      
      // Try to update the invoice manually
      console.log('Attempting manual invoice update...');
      
      const newAmountPaid = parseFloat(invoice.amount_paid || 0) + parseFloat(invoice.payment_amount);
      const newOutstandingBalance = parseFloat(invoice.amount_due) - newAmountPaid;
      let newStatus = 'Unpaid';
      
      if (newAmountPaid >= parseFloat(invoice.amount_due)) {
        newStatus = 'Paid';
      } else if (newAmountPaid > 0) {
        newStatus = 'Partial';
      }
      
      console.log(`Updating invoice ${invoice.id}:`);
      console.log(`- Amount paid: ${invoice.amount_paid} → ${newAmountPaid}`);
      console.log(`- Outstanding: ${invoice.outstanding_balance} → ${newOutstandingBalance}`);
      console.log(`- Status: ${invoice.status} → ${newStatus}`);
      
      // Update the invoice
      await client.query(`
        UPDATE invoices 
        SET amount_paid = $1, outstanding_balance = $2, status = $3, updated_at = NOW()
        WHERE id = $4
      `, [newAmountPaid, newOutstandingBalance, newStatus, invoice.id]);
      
      // Link the payment to the invoice
      await client.query(`
        UPDATE payment_transactions 
        SET invoice_id = $1, status = 'Matched'
        WHERE id = $2
      `, [invoice.id, invoice.payment_id]);
      
      console.log('✅ Manual update completed');
      
      // Verify the update
      const updatedInvoice = await client.query(`
        SELECT id, reference_number, amount_due, amount_paid, outstanding_balance, status
        FROM invoices 
        WHERE id = $1
      `, [invoice.id]);
      
      console.log('Updated invoice:', updatedInvoice.rows[0]);
    } else {
      console.log('No unlinked payments found to test with');
    }

    console.log('\n🎯 DIAGNOSIS COMPLETE');
    console.log('Check the output above to understand the payment processing issue.');

  } catch (error) {
    console.error('❌ Diagnosis failed:', error);
    throw error;
  } finally {
    await client.end();
  }
}

// Run the diagnosis
if (require.main === module) {
  require('dotenv').config();
  diagnosePaymentIssue()
    .then(() => {
      console.log('\n✅ Diagnosis completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n❌ Diagnosis failed:', error);
      process.exit(1);
    });
}

module.exports = diagnosePaymentIssue;
