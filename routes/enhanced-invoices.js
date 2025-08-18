const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const { body, validationResult } = require('express-validator');
const db = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');
const EnhancedCSVParser = require('../utils/enhancedCSVParser');

const router = express.Router();

// Configure multer for CSV uploads
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const uploadDir = path.join(__dirname, '..', 'uploads', 'bank-statements');
      if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir, { recursive: true });
      }
      cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
      const timestamp = Date.now();
      cb(null, `bank-statement-${timestamp}-${file.originalname}`);
    }
  }),
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'text/csv' || path.extname(file.originalname).toLowerCase() === '.csv') {
      cb(null, true);
    } else {
      cb(new Error('Only CSV files are allowed'), false);
    }
  },
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

/**
 * Step 1: Upload CSV file and analyze columns
 */
router.post('/upload-and-analyze', [
  authenticate,
  authorize('admin', 'super_admin'),
  upload.single('bankStatement')
], async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ 
        success: false,
        message: 'No CSV file uploaded' 
      });
    }

    console.log('Analyzing CSV file:', req.file.filename);

    const parser = new EnhancedCSVParser();
    
    // Read just the first few rows to get headers and sample data
    const sampleData = await readCSVSample(req.file.path, 5);
    
    // Auto-detect column mapping
    const autoMapping = parser.autoDetectColumns(sampleData.headers);
    const confidence = parser.getMappingConfidence(autoMapping, sampleData.headers);
    
    // Get saved column mappings for user to choose from
    const savedMappings = await db.query(`
      SELECT id, mapping_name, bank_name, reference_column, amount_column, 
             date_column, description_column, debit_column, credit_column,
             use_count, last_used_at
      FROM csv_column_mappings 
      ORDER BY use_count DESC, last_used_at DESC
    `);

    res.json({
      success: true,
      file: {
        filename: req.file.filename,
        originalName: req.file.originalname,
        size: req.file.size,
        path: req.file.path
      },
      analysis: {
        headers: sampleData.headers,
        sampleRows: sampleData.rows,
        totalRows: sampleData.totalRows,
        autoDetectedMapping: autoMapping,
        confidence: confidence,
        needsManualMapping: confidence < 80
      },
      savedMappings: savedMappings.rows
    });

  } catch (error) {
    console.error('CSV analysis error:', error);
    
    // Clean up uploaded file if it exists
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }

    res.status(500).json({
      success: false,
      message: 'Failed to analyze CSV file',
      error: error.message
    });
  }
});

/**
 * Step 2: Process CSV with confirmed column mapping
 */
router.post('/process-with-mapping', [
  authenticate,
  authorize('admin', 'super_admin'),
  body('filename').notEmpty(),
  body('mapping').isObject(),
  body('saveMappingAs').optional().isString().isLength({ max: 100 })
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { filename, mapping, saveMappingAs, bankName } = req.body;
    
    // Find the uploaded file
    const filePath = path.join(__dirname, '..', 'uploads', 'bank-statements', filename);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({
        success: false,
        message: 'Uploaded file not found'
      });
    }

    console.log('Processing CSV with mapping:', filename, mapping);

    // Save the column mapping if requested
    if (saveMappingAs) {
      await saveColumnMapping(saveMappingAs, mapping, bankName, req.user.id);
    }

    // Parse CSV with the provided mapping
    const parser = new EnhancedCSVParser();
    const parseResult = await parser.parseCSV(filePath, mapping);

    if (parseResult.transactions.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No valid transactions found in CSV file',
        errors: parseResult.errors
      });
    }

    // Process transactions (same logic as before)
    const results = await processTransactions(parseResult.transactions, req.user.id);

    // Update mapping usage statistics
    if (saveMappingAs) {
      await updateMappingUsage(saveMappingAs);
    }

    // Log upload activity
    await logUploadActivity(filename, req.user.id, parseResult, results);

    // Clean up uploaded file
    fs.unlinkSync(filePath);

    console.log('\n=== PROCESSING RESULTS SUMMARY ===');
    console.log(`Total transactions processed: ${parseResult.transactions.length}`);
    console.log(`Matched: ${results.matched.length}`);
    console.log(`Partial: ${results.partial.length}`);
    console.log(`Overpaid: ${results.overpaid.length}`);
    console.log(`Unmatched: ${results.unmatched.length}`);
    console.log(`Duplicates: ${results.duplicates.length}`);
    console.log(`Errors: ${results.errors.length}`);
    console.log('=====================================\n');

    res.json({
      success: true,
      message: `Processed ${parseResult.transactions.length} transactions successfully`,
      summary: {
        totalProcessed: parseResult.transactions.length,
        matched: results.matched.length,
        partial: results.partial.length,
        overpaid: results.overpaid.length,
        unmatched: results.unmatched.length,
        duplicates: results.duplicates.length,
        errors: results.errors.length
      },
      results
    });

  } catch (error) {
    console.error('CSV processing error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to process CSV file',
      error: error.message
    });
  }
});

/**
 * Get saved column mappings
 */
router.get('/column-mappings', [
  authenticate,
  authorize('admin', 'super_admin')
], async (req, res) => {
  try {
    const mappings = await db.query(`
      SELECT id, mapping_name, bank_name, reference_column, amount_column, 
             date_column, description_column, debit_column, credit_column,
             use_count, last_used_at, created_at
      FROM csv_column_mappings 
      ORDER BY use_count DESC, last_used_at DESC
    `);

    res.json({
      success: true,
      mappings: mappings.rows
    });
  } catch (error) {
    console.error('Error fetching column mappings:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch column mappings',
      error: error.message
    });
  }
});

/**
 * Delete a saved column mapping
 */
router.delete('/column-mappings/:id', [
  authenticate,
  authorize('admin', 'super_admin')
], async (req, res) => {
  try {
    const { id } = req.params;
    
    const result = await db.query(`
      DELETE FROM csv_column_mappings 
      WHERE id = $1 AND created_by = $2
      RETURNING mapping_name
    `, [id, req.user.id]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Column mapping not found or you do not have permission to delete it'
      });
    }

    res.json({
      success: true,
      message: `Column mapping "${result.rows[0].mapping_name}" deleted successfully`
    });
  } catch (error) {
    console.error('Error deleting column mapping:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete column mapping',
      error: error.message
    });
  }
});

// Helper functions

async function readCSVSample(filePath, maxRows = 5) {
  return new Promise((resolve, reject) => {
    const rows = [];
    let headers = [];
    let totalRows = 0;

    fs.createReadStream(filePath)
      .pipe(require('csv-parser')())
      .on('headers', (csvHeaders) => {
        headers = csvHeaders;
      })
      .on('data', (row) => {
        totalRows++;
        if (rows.length < maxRows) {
          rows.push(row);
        }
      })
      .on('end', () => {
        resolve({ headers, rows, totalRows });
      })
      .on('error', reject);
  });
}

async function saveColumnMapping(name, mapping, bankName, userId) {
  await db.query(`
    INSERT INTO csv_column_mappings (
      mapping_name, bank_name, reference_column, amount_column, 
      date_column, description_column, debit_column, credit_column, 
      created_by
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    ON CONFLICT (mapping_name) DO UPDATE SET
      bank_name = EXCLUDED.bank_name,
      reference_column = EXCLUDED.reference_column,
      amount_column = EXCLUDED.amount_column,
      date_column = EXCLUDED.date_column,
      description_column = EXCLUDED.description_column,
      debit_column = EXCLUDED.debit_column,
      credit_column = EXCLUDED.credit_column,
      last_used_at = NOW()
  `, [
    name,
    bankName || null,
    mapping.reference || null,
    mapping.amount || null,
    mapping.date || null,
    mapping.description || null,
    mapping.debit || null,
    mapping.credit || null,
    userId
  ]);
}

async function updateMappingUsage(mappingName) {
  await db.query(`
    UPDATE csv_column_mappings 
    SET use_count = use_count + 1, last_used_at = NOW()
    WHERE mapping_name = $1
  `, [mappingName]);
}

async function processTransactions(transactions, userId) {
  const results = {
    matched: [],
    partial: [],
    overpaid: [],
    unmatched: [],
    duplicates: [],
    errors: []
  };

  for (const transaction of transactions) {
    const client = await db.pool.connect();
    
    try {
      await client.query('BEGIN');
      console.log(`Processing transaction: ${JSON.stringify(transaction)}`);
      
      // Check for duplicate transactions
      const duplicateCheck = await client.query(`
        SELECT id FROM payment_transactions 
        WHERE reference_number = $1 AND amount = $2 AND payment_date = $3
      `, [transaction.reference, transaction.amount, transaction.date]);

      if (duplicateCheck.rows.length > 0) {
        results.duplicates.push({
          ...transaction,
          reason: 'Duplicate transaction already processed'
        });
        await client.query('ROLLBACK');
        continue;
      }

      // Find matching invoice with enhanced reference matching
      console.log(`Looking for invoice with reference: "${transaction.reference}"`);
      
      let invoiceResult = null;
      
      // Strategy 1: Exact match
      invoiceResult = await client.query(`
        SELECT i.*, u.first_name, u.last_name, u.student_number as user_student_number
        FROM invoices i
        LEFT JOIN users u ON i.student_id = u.id
        WHERE UPPER(i.reference_number) = UPPER($1) AND i.status IN ('Unpaid', 'Partial')
        ORDER BY i.due_date ASC
        LIMIT 1
      `, [transaction.reference]);

      // Strategy 2: Try with padded zeros (HAR20 -> HAR020)
      if (invoiceResult.rows.length === 0 && transaction.reference) {
        const paddedRef = transaction.reference.toString().replace(/(\D+)(\d+)/, (match, letters, numbers) => 
          letters + numbers.padStart(3, '0'));
        console.log(`Trying padded reference: "${paddedRef}"`);
        
        invoiceResult = await client.query(`
          SELECT i.*, u.first_name, u.last_name, u.student_number as user_student_number
          FROM invoices i
          LEFT JOIN users u ON i.student_id = u.id
          WHERE UPPER(i.reference_number) = UPPER($1) AND i.status IN ('Unpaid', 'Partial')
          ORDER BY i.due_date ASC
          LIMIT 1
        `, [paddedRef]);
      }

      // Strategy 3: Try removing leading zeros (HAR020 -> HAR20)
      if (invoiceResult.rows.length === 0 && transaction.reference) {
        const trimmedRef = transaction.reference.toString().replace(/(\D+)0+(\d+)/, '$1$2');
        if (trimmedRef !== transaction.reference) {
          console.log(`Trying trimmed reference: "${trimmedRef}"`);
          
          invoiceResult = await client.query(`
            SELECT i.*, u.first_name, u.last_name, u.student_number as user_student_number
            FROM invoices i
            LEFT JOIN users u ON i.student_id = u.id
            WHERE UPPER(i.reference_number) = UPPER($1) AND i.status IN ('Unpaid', 'Partial')
            ORDER BY i.due_date ASC
            LIMIT 1
          `, [trimmedRef]);
        }
      }

      // Strategy 4: Try partial matching with LIKE
      if (invoiceResult.rows.length === 0 && transaction.reference && transaction.reference.length >= 3) {
        console.log(`Trying partial match for: "${transaction.reference}"`);
        
        invoiceResult = await client.query(`
          SELECT i.*, u.first_name, u.last_name, u.student_number as user_student_number
          FROM invoices i
          LEFT JOIN users u ON i.student_id = u.id
          WHERE UPPER(i.reference_number) LIKE UPPER($1) AND i.status IN ('Unpaid', 'Partial')
          ORDER BY i.due_date ASC
          LIMIT 1
        `, [`%${transaction.reference}%`]);
      }

      // Strategy 5: Try matching by student name if reference looks like a name
      if (invoiceResult.rows.length === 0 && transaction.reference && 
          /^[A-Za-z\s]+$/.test(transaction.reference) && transaction.reference.length > 3) {
        console.log(`Trying student name match for: "${transaction.reference}"`);
        
        invoiceResult = await client.query(`
          SELECT i.*, u.first_name, u.last_name FROM invoices i
          JOIN users u ON i.student_id = u.id
          WHERE (UPPER(u.first_name) LIKE UPPER($1) OR 
                 UPPER(u.last_name) LIKE UPPER($1) OR
                 UPPER(CONCAT(u.first_name, ' ', u.last_name)) LIKE UPPER($1))
          AND i.status IN ('Unpaid', 'Partial')
          ORDER BY i.due_date ASC
          LIMIT 1
        `, [`%${transaction.reference}%`]);
      }

      if (invoiceResult.rows.length === 0) {
        console.log(`UNMATCHED: Transaction ${transaction.reference} - ${transaction.description}`);
        
        await client.query('COMMIT');
        
        results.unmatched.push({
          ...transaction,
          reason: 'No matching invoice found'
        });
        continue;
      }

      const invoice = invoiceResult.rows[0];
      const outstandingAmount = invoice.outstanding_balance || invoice.amount_due;

      console.log(`Invoice found: ${invoice.reference_number}`);
      console.log(`Outstanding amount: ${outstandingAmount}`);
      console.log(`Transaction amount: ${transaction.amount}`);

      // Determine payment status and update invoice
      const currentAmountPaid = parseFloat(invoice.amount_paid || 0);
      const transactionAmount = parseFloat(transaction.amount);
      const outstandingAmountNum = parseFloat(outstandingAmount);

      let newStatus, amountPaid, newOutstanding, overpaidAmount, resultCategory;

      if (transactionAmount >= outstandingAmountNum) {
        if (transactionAmount === outstandingAmountNum) {
          newStatus = 'Paid';
          amountPaid = currentAmountPaid + transactionAmount;
          newOutstanding = 0;
          overpaidAmount = 0;
          resultCategory = 'matched';
        } else {
          newStatus = 'Overpaid';
          amountPaid = currentAmountPaid + transactionAmount;
          newOutstanding = 0;
          // FIXED: Calculate overpaid amount based on total amount paid vs total amount due
          overpaidAmount = amountPaid - parseFloat(invoice.amount_due);
          resultCategory = 'overpaid';
          
          // Enhanced logging for overpaid transactions
          console.log(`🔄 OVERPAID PROCESSING for ${transaction.reference}:`);
          console.log(`   Student: ${invoice.first_name || 'N/A'} ${invoice.last_name || 'N/A'} (${invoice.student_number})`);
          console.log(`   Transaction Amount: R${transactionAmount}`);
          console.log(`   Outstanding Amount: R${outstandingAmountNum}`);
          console.log(`   Total Amount Due: R${invoice.amount_due}`);
          console.log(`   Previous Amount Paid: R${currentAmountPaid}`);
          console.log(`   New Total Amount Paid: R${amountPaid}`);
          console.log(`   Corrected Overpaid Amount: R${overpaidAmount}`);
          console.log(`   Transaction Description: "${transaction.description}"`);
        }
      } else {
        newStatus = 'Partial';
        amountPaid = currentAmountPaid + transactionAmount;
        newOutstanding = outstandingAmountNum - transactionAmount;
        overpaidAmount = 0;
        resultCategory = 'partial';
      }

      // Update invoice with proper handling for overpaid amounts
      console.log(`Updating invoice ${invoice.id} with status: ${newStatus}, amount_paid: ${amountPaid}, overpaid: ${overpaidAmount}`);
      
      const properAmountPaid = Math.round(amountPaid * 100) / 100;
      const properNewOutstanding = Math.round(newOutstanding * 100) / 100;
      const properOverpaidAmount = Math.round(overpaidAmount * 100) / 100;
      
      // Always try to update with overpaid_amount, create column if needed
      let updateQuery = `
        UPDATE invoices SET 
          status = $1, 
          amount_paid = $2::DECIMAL(10,2),
          outstanding_balance = $3::DECIMAL(10,2),
          overpaid_amount = $4::DECIMAL(10,2),
          updated_at = NOW()
        WHERE id = $5
        RETURNING id, status, amount_paid, outstanding_balance, overpaid_amount, reference_number
      `;
      let updateParams = [newStatus, properAmountPaid, properNewOutstanding, properOverpaidAmount, invoice.id];
      
      try {
        const updateResult = await client.query(updateQuery, updateParams);
        console.log('✅ Invoice updated successfully:', updateResult.rows[0]);
      } catch (error) {
        if (error.message.includes('overpaid_amount') || error.code === '42703') {
          // Column doesn't exist, create it first
          console.log('⚡ Creating overpaid_amount column...');
          await client.query(`
            ALTER TABLE invoices 
            ADD COLUMN IF NOT EXISTS overpaid_amount DECIMAL(10,2) DEFAULT 0.00
          `);
          
          // Retry the update
          const updateResult = await client.query(updateQuery, updateParams);
          console.log('✅ Invoice updated after creating column:', updateResult.rows[0]);
        } else {
          throw error; // Re-throw if it's a different error
        }
      }

      // Record transaction in payment_transactions table (matching existing schema)
      const transactionResult = await client.query(`
        INSERT INTO payment_transactions (
          invoice_id, student_id, student_number, reference_number, amount, payment_date, description
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING id
      `, [
        invoice.id,
        invoice.student_id,
        invoice.student_number,
        transaction.reference,
        transaction.amount,
        transaction.date,
        transaction.description || ''
      ]);
      
      console.log('Transaction recorded with ID:', transactionResult.rows[0].id);
      
      await client.query('COMMIT');
      console.log(`Successfully processed transaction for ${transaction.reference}`);

      // Enhanced result data with comprehensive student and invoice information
      const resultData = {
        ...transaction,
        invoice: {
          id: invoice.id,
          reference_number: invoice.reference_number,
          student_id: invoice.student_id,
          student_number: invoice.student_number || invoice.user_student_number,
          original_amount: invoice.amount_due,
          amount_paid: properAmountPaid,
          outstanding_balance: properNewOutstanding,
          overpaid_amount: properOverpaidAmount,
          status: newStatus
        },
        student: {
          id: invoice.student_id,
          student_number: invoice.student_number || invoice.user_student_number,
          first_name: invoice.first_name || 'Unknown',
          last_name: invoice.last_name || 'Student',
          name: `${invoice.first_name || 'Unknown'} ${invoice.last_name || 'Student'}`.trim()
        },
        processing: {
          matched_amount: Math.min(transaction.amount, outstandingAmount),
          transaction_amount: transaction.amount,
          previous_balance: outstandingAmount,
          new_balance: properNewOutstanding,
          overpaid_amount: properOverpaidAmount
        },
        bank_details: {
          description: transaction.description,
          reference_extracted: transaction.reference,
          amount: transaction.amount,
          date: transaction.date
        }
      };

      // Add to results with enhanced data
      if (resultCategory === 'matched') {
        results.matched.push(resultData);
      } else if (resultCategory === 'overpaid') {
        const overpaidResult = { 
          ...resultData,
          overpaid_amount: properOverpaidAmount,
          processing: {
            ...resultData.processing,
            overpaid_amount: properOverpaidAmount,
            excess_payment: properOverpaidAmount,
            payment_breakdown: {
              transaction_amount: transaction.amount,
              outstanding_was: outstandingAmount,
              total_amount_due: invoice.amount_due,
              total_amount_paid: properAmountPaid,
              excess_amount: properOverpaidAmount
            },
            debug_info: {
              invoice_reference: invoice.reference_number,
              student_name: `${invoice.first_name || 'Unknown'} ${invoice.last_name || 'Student'}`,
              student_number: invoice.student_number || invoice.user_student_number,
              bank_description: transaction.description,
              extracted_reference: transaction.reference,
              calculation: `Total Paid: R${properAmountPaid} - Amount Due: R${invoice.amount_due} = R${properOverpaidAmount} overpaid`
            }
          }
        };
        
        console.log(`📊 OVERPAID RESULT for ${invoice.reference_number}:`, {
          student: `${invoice.first_name} ${invoice.last_name} (${invoice.student_number || invoice.user_student_number})`,
          transaction_amount: transaction.amount,
          outstanding_was: outstandingAmount,
          overpaid_amount: properOverpaidAmount,
          bank_description: transaction.description
        });
        
        results.overpaid.push(overpaidResult);
      } else if (resultCategory === 'partial') {
        results.partial.push({ 
          ...resultData,
          remaining_balance: newOutstanding,
          processing: {
            ...resultData.processing,
            remaining_balance: newOutstanding,
            partial_amount: transaction.amount
          }
        });
      }

    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Transaction processing error:', error);
      results.errors.push({
        ...transaction,
        error: error.message
      });
    } finally {
      client.release();
    }
  }

  return results;
}

async function logUploadActivity(filename, userId, parseResult, results) {
  try {
    // Simple logging - just console log for now since the table might not exist
    console.log('=== UPLOAD ACTIVITY LOG ===');
    console.log(`Filename: ${filename}`);
    console.log(`User ID: ${userId}`);
    console.log(`Transactions processed: ${parseResult.transactions.length}`);
    console.log(`Matched: ${results.matched.length}`);
    console.log(`Partial: ${results.partial.length}`);
    console.log(`Overpaid: ${results.overpaid.length}`);
    console.log(`Unmatched: ${results.unmatched.length}`);
    console.log(`Duplicates: ${results.duplicates.length}`);
    console.log(`Errors: ${results.errors.length}`);
    console.log('===========================');
  } catch (logError) {
    console.error('Failed to log upload activity:', logError);
  }
}

module.exports = router;
