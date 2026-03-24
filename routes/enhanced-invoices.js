const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const { body, validationResult } = require('express-validator');
const db = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');
const EnhancedCSVParser = require('../utils/enhancedCSVParser');
const FNBPDFParser = require('../utils/fnbPDFParser');

const router = express.Router();

// Configure multer for CSV and PDF uploads
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
    const ext = path.extname(file.originalname).toLowerCase();
    const isCSV = file.mimetype === 'text/csv' || ext === '.csv';
    const isPDF = file.mimetype === 'application/pdf' || ext === '.pdf';
    
    if (isCSV || isPDF) {
      cb(null, true);
    } else {
      cb(new Error('Only CSV and PDF files are allowed'), false);
    }
  },
  limits: { fileSize: 20 * 1024 * 1024 } // 20MB limit for PDFs
});

/**
 * Step 1: Upload CSV or PDF file and analyze columns
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
        message: 'No file uploaded. Please upload a CSV or PDF bank statement.' 
      });
    }

    const ext = path.extname(req.file.originalname).toLowerCase();
    const isPDF = ext === '.pdf' || req.file.mimetype === 'application/pdf';
    
    console.log(`Analyzing ${isPDF ? 'PDF' : 'CSV'} file:`, req.file.filename);

    if (isPDF) {
      // Handle PDF file (FNB format)
      const pdfParser = new FNBPDFParser();
      const analysis = await pdfParser.analyzeFile(req.file.path);
      
      res.json({
        success: true,
        file: {
          filename: req.file.filename,
          originalName: req.file.originalname,
          size: req.file.size,
          path: req.file.path,
          fileType: 'PDF'
        },
        analysis: {
          headers: analysis.headers,
          sampleRows: analysis.sampleData,
          totalRows: analysis.totalTransactions,
          transactionsWithStudentIds: analysis.transactionsWithStudentIds,
          autoDetectedMapping: analysis.suggestedMapping,
          confidence: 100,
          needsManualMapping: false,
          fileType: 'PDF'
        },
        savedMappings: []
      });
    } else {
      // Handle CSV file
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
          path: req.file.path,
          fileType: 'CSV'
        },
        analysis: {
          headers: sampleData.headers,
          sampleRows: sampleData.rows,
          totalRows: sampleData.totalRows,
          autoDetectedMapping: autoMapping,
          confidence: confidence,
          needsManualMapping: confidence < 80,
          fileType: 'CSV'
        },
        savedMappings: savedMappings.rows
      });
    }

  } catch (error) {
    console.error('File analysis error:', error);
    
    // Clean up uploaded file if it exists
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }

    res.status(500).json({
      success: false,
      message: 'Failed to analyze file',
      error: error.message
    });
  }
});

/**
 * Step 2: Process CSV or PDF with confirmed column mapping
 */
router.post('/process-with-mapping', [
  authenticate,
  authorize('admin', 'super_admin'),
  body('filename').notEmpty(),
  body('mapping').optional().isObject(),
  body('saveMappingAs').optional().isString().isLength({ max: 100 })
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { filename, mapping, saveMappingAs, bankName, fileType } = req.body;
    
    // Find the uploaded file
    const filePath = path.join(__dirname, '..', 'uploads', 'bank-statements', filename);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({
        success: false,
        message: 'Uploaded file not found'
      });
    }

    const ext = path.extname(filename).toLowerCase();
    const isPDF = ext === '.pdf' || fileType === 'PDF';
    
    console.log(`Processing ${isPDF ? 'PDF' : 'CSV'} with mapping:`, filename);

    let parseResult;
    
    if (isPDF) {
      // Process PDF file
      const pdfParser = new FNBPDFParser();
      const pdfResult = await pdfParser.parsePDF(filePath);
      
      parseResult = {
        transactions: pdfResult.transactions,
        errors: []
      };
    } else {
      // Save the column mapping if requested (CSV only)
      if (saveMappingAs) {
        await saveColumnMapping(saveMappingAs, mapping, bankName, req.user.id);
      }

      // Parse CSV with the provided mapping
      const parser = new EnhancedCSVParser();
      parseResult = await parser.parseCSV(filePath, mapping);
    }

    if (parseResult.transactions.length === 0) {
      return res.status(400).json({
        success: false,
        message: `No valid transactions found in ${isPDF ? 'PDF' : 'CSV'} file`,
        errors: parseResult.errors || []
      });
    }

    // Process transactions (same logic for both CSV and PDF)
    const results = await processTransactions(parseResult.transactions, req.user.id);

    // Update mapping usage statistics (CSV only)
    if (!isPDF && saveMappingAs) {
      await updateMappingUsage(saveMappingAs);
    }

    // Log upload activity
    await logUploadActivity(filename, req.user.id, parseResult, results);

    // Clean up uploaded file
    fs.unlinkSync(filePath);

    console.log('\n=== PROCESSING RESULTS SUMMARY ===');
    console.log(`File type: ${isPDF ? 'PDF' : 'CSV'}`);
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
      message: `Processed ${parseResult.transactions.length} transactions from ${isPDF ? 'PDF' : 'CSV'} successfully`,
      summary: {
        totalProcessed: parseResult.transactions.length,
        matched: results.matched.length,
        partial: results.partial.length,
        overpaid: results.overpaid.length,
        unmatched: results.unmatched.length,
        duplicates: results.duplicates.length,
        errors: results.errors.length,
        fileType: isPDF ? 'PDF' : 'CSV'
      },
      results
    });

  } catch (error) {
    console.error('File processing error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to process file',
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

/**
 * Extract a likely student/parent name from an FNB bank statement description.
 * FNB descriptions often look like:
 *   "Payshap Credit Bontle Madiba Grd3"
 *   "Magtape Credit Capitec Elleanor Jordaan G1B"
 *   "FNB App Payment From Mohaugrade3B"
 *   "Rtc Credit Kabelo Mogashoa Grad"
 *   "ADT Cash Deposit Lephmall Watson"
 * Strip payment-method prefixes, bank names, and grade suffixes.
 */
function extractNameFromDescription(description) {
  if (!description) return null;

  let text = description;

  // Remove common FNB payment method prefixes
  const prefixes = [
    /^Payshap\s+Credit\s+/i,
    /^Magtape\s+Credit\s+(?:Capitec|ABSA\s+Bank|Nedbank|Standard\s+Bank|FNB)?\s*/i,
    /^FNB\s+App\s+(?:Rtc\s+Pmt|Payment)\s+(?:From|To)\s+/i,
    /^Rtc\s+Credit\s+/i,
    /^ADT\s+Cash\s+Deposit\s+\S+\s*/i,
    /^Send\s+Money\s+App\s+(?:Dr\s+Send\s+)?/i,
    /^Electricity\s+Prepaid\s+\S+\s*/i,
    /^Rev-Electricity\s+\S+\s*/i,
    /^Payshap\s+Account\s+Off-Us\s+/i,
  ];

  for (const prefix of prefixes) {
    text = text.replace(prefix, '').trim();
  }

  // Remove trailing grade/class indicators — run until stable
  const gradeSuffixPatterns = [
    /\s+(?:Gr(?:ade|d)?|G)\s*\d+\w*\s*$/i,   // "G5", "Grade3B", "Gr5", "Grd3"
    /\s+(?:Grad|Grr|Rrr|Grd|Gr)\s*(?:Grr|Rrr|Rr)?\s*$/i,  // "Gr Rrr", "Grr", "Rrr"
    /\s+\d+[A-Z]?\s*$/i,                        // trailing "3B" or "5"
    /\s+[A-Z]\d[A-Z]\s*$/i,                     // trailing "G1B"
  ];
  let prev = '';
  while (prev !== text) {
    prev = text;
    for (const p of gradeSuffixPatterns) {
      text = text.replace(p, '').trim();
    }
  }

  // Remove trailing single characters (like "R" leftover from "Gr R")
  text = text.replace(/\s+[A-Z]\s*$/i, '').trim();

  // Remove HAR references from text (already handled by HAR strategy)
  text = text.replace(/\bH[A-Z]R\s*\d+\b/i, '').trim();

  // If less than 3 chars left, nothing useful
  if (text.length < 3) return null;

  return text;
}

/**
 * Detect HAR-like references (including common typos like HGR, HBR, HER).
 * Returns normalised "HARxxx" string or null.
 */
function detectHarReference(text) {
  if (!text) return null;
  // Standard HAR: HAR375, Har 375, HAR0375
  const standard = text.match(/\bHAR\s*(\d+)\b/i);
  if (standard) return `HAR${standard[1]}`;
  // Common typos: HGR024, HBR024 (middle letter mistyped)
  const typo = text.match(/\bH[A-Z]R\s*(\d+)\b/i);
  if (typo) return `HAR${typo[1]}`;
  return null;
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
        WHERE reference_number = $1 AND amount = $2 AND (transaction_date = $3 OR payment_date = $3)
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
      console.log(`Looking for invoice with reference: "${transaction.reference}" | desc: "${transaction.description}"`);
      
      let invoiceResult = null;
      let matchStrategy = null;

      // Try to detect HAR reference in description too (catches typos like HGR024)
      const harFromDesc = detectHarReference(transaction.description || '');
      const harRef = transaction.hasStudentId ? transaction.reference : harFromDesc;

      // Helper: find oldest unpaid invoice by student_number variants
      async function findByStudentNumber(ref) {
        if (!ref) return null;
        const num = ref.replace(/^H[A-Z]R0*/i, '');
        const result = await client.query(`
          SELECT i.*, u.first_name, u.last_name, u.student_number as user_student_number
          FROM invoices i
          JOIN users u ON i.student_id = u.id
          WHERE (UPPER(u.student_number) = UPPER($1)
              OR UPPER(u.student_number) = UPPER($2)
              OR UPPER(u.student_number) = UPPER($3)
              OR UPPER(u.student_number) = 'HAR' || $4)
            AND i.status IN ('Unpaid', 'Partial')
          ORDER BY i.due_date ASC LIMIT 1
        `, [
          ref,
          `HAR${num}`,
          `HAR${num.padStart(3,'0')}`,
          num
        ]);
        return result;
      }

      // ── Strategy 1: Exact HAR reference match on invoice reference_number ─
      if (!invoiceResult?.rows.length && harRef) {
        invoiceResult = await client.query(`
          SELECT i.*, u.first_name, u.last_name, u.student_number as user_student_number
          FROM invoices i
          LEFT JOIN users u ON i.student_id = u.id
          WHERE UPPER(i.reference_number) = UPPER($1) AND i.status IN ('Unpaid', 'Partial')
          ORDER BY i.due_date ASC LIMIT 1
        `, [harRef]);
        if (invoiceResult.rows.length) matchStrategy = 'exact_invoice_ref';
      }

      // ── Strategy 2: Match HAR ref against student_number in users table ───
      if (!invoiceResult?.rows.length && harRef) {
        invoiceResult = await findByStudentNumber(harRef);
        if (invoiceResult?.rows.length) matchStrategy = 'student_number';
      }

      // ── Strategy 2b: Try HAR from description (typo catch) ────────────────
      if (!invoiceResult?.rows.length && harFromDesc && harFromDesc !== harRef) {
        invoiceResult = await findByStudentNumber(harFromDesc);
        if (invoiceResult?.rows.length) matchStrategy = 'har_typo_from_desc';
      }

      // ── Strategy 3: Padded/trimmed zeros for HAR reference ────────────────
      if (!invoiceResult?.rows.length && transaction.reference) {
        const padded = transaction.reference.replace(/(\D+)(\d+)/, (_, l, n) => l + n.padStart(3,'0'));
        const trimmed = transaction.reference.replace(/(\D+)0+(\d+)/, '$1$2');
        const variants = [...new Set([padded, trimmed])].filter(v => v !== transaction.reference);
        for (const variant of variants) {
          invoiceResult = await client.query(`
            SELECT i.*, u.first_name, u.last_name, u.student_number as user_student_number
            FROM invoices i
            LEFT JOIN users u ON i.student_id = u.id
            WHERE UPPER(i.reference_number) = UPPER($1) AND i.status IN ('Unpaid', 'Partial')
            ORDER BY i.due_date ASC LIMIT 1
          `, [variant]);
          if (invoiceResult.rows.length) { matchStrategy = 'padded_ref'; break; }
        }
      }

      // ── Strategy 4: Name matching from description ─────────────────────────
      // FNB descriptions often contain parent/student names:
      // "Payshap Credit Bontle Madiba Grd3" → try "Bontle Madiba"
      // "Magtape Credit Capitec Elleanor Jordaan G1B" → try "Elleanor Jordaan"
      if (!invoiceResult?.rows.length) {
        const cleanedName = extractNameFromDescription(transaction.description || transaction.reference);
        if (cleanedName && cleanedName.length >= 3) {
          console.log(`Trying name match: "${cleanedName}"`);
          const nameParts = cleanedName.split(/\s+/).filter(p => p.length >= 2);
          
          // Try full name first, then individual parts
          const nameCandidates = [
            cleanedName,
            ...nameParts
          ];
          
          for (const nameCandidate of nameCandidates) {
            invoiceResult = await client.query(`
              SELECT i.*, u.first_name, u.last_name, u.student_number as user_student_number
              FROM invoices i
              JOIN users u ON i.student_id = u.id
              WHERE (
                UPPER(CONCAT(u.first_name, ' ', u.last_name)) LIKE UPPER($1)
                OR UPPER(u.first_name) LIKE UPPER($1)
                OR UPPER(u.last_name) LIKE UPPER($1)
              ) AND i.status IN ('Unpaid', 'Partial')
              ORDER BY i.due_date ASC LIMIT 1
            `, [`%${nameCandidate}%`]);
            if (invoiceResult.rows.length) { matchStrategy = 'name_from_description'; break; }
          }
        }
      }

      if (!invoiceResult?.rows.length) {
        console.log(`UNMATCHED: "${transaction.reference}" | desc: "${transaction.description}"`);
        await client.query('COMMIT');
        results.unmatched.push({
          ...transaction,
          reason: 'No matching student or invoice found. Parent may have used wrong reference.'
        });
        continue;
      }

      if (matchStrategy) console.log(`Matched via strategy: ${matchStrategy}`);

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

      // Record transaction in payment_transactions table (including month/year from invoice due_date)
      const invoiceDueDate = invoice.due_date ? new Date(invoice.due_date) : null;
      const txMonth = invoiceDueDate ? invoiceDueDate.getMonth() + 1 : null;
      const txYear = invoiceDueDate ? invoiceDueDate.getFullYear() : null;

      const transactionResult = await client.query(`
        INSERT INTO payment_transactions (
          invoice_id, student_id, student_number, reference_number, amount, transaction_date, payment_date, description, payment_method, month, year
        ) VALUES ($1, $2, $3, $4, $5, $6, $6, $7, 'bank_transfer', $8, $9)
        RETURNING id
      `, [
        invoice.id,
        invoice.student_id,
        invoice.student_number,
        transaction.reference,
        transaction.amount,
        transaction.date,
        transaction.description || '',
        txMonth,
        txYear
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

/**
 * Get student payment history and export to Excel
 */
router.get('/student-payment-history/:studentNumber', [
  authenticate,
  authorize('admin', 'super_admin')
], async (req, res) => {
  try {
    const { studentNumber } = req.params;
    const { format } = req.query; // 'json' or 'excel'
    
    // Find the student
    const studentResult = await db.query(`
      SELECT u.id, u.first_name, u.last_name, u.student_number
      FROM users u
      WHERE u.student_number ILIKE $1 OR u.student_number ILIKE $2
      LIMIT 1
    `, [studentNumber, `HAR${studentNumber.replace(/^HAR/i, '')}`]);
    
    if (studentResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Student not found with that student number'
      });
    }
    
    const student = studentResult.rows[0];
    
    // Get all invoices for this student (match by student_id OR student_number for compatibility)
    const invoicesResult = await db.query(`
      SELECT 
        i.id,
        i.reference_number,
        i.amount_due,
        i.amount_paid,
        i.outstanding_balance,
        i.overpaid_amount,
        i.due_date,
        i.status,
        i.created_at,
        i.updated_at
      FROM invoices i
      WHERE i.student_id = $1 OR i.student_number = $2
      ORDER BY i.due_date ASC
    `, [student.id, student.student_number]);
    
    const invoices = invoicesResult.rows;

    // ALSO fetch all payment_transactions for this student grouped by month/year
    // This catches manual payments for months that have no invoice
    const ptResult = await db.query(`
      SELECT 
        month, year,
        SUM(amount) as total_paid,
        MIN(payment_date::text) as earliest_date,
        STRING_AGG(COALESCE(reference, reference_number, 'Manual'), ', ') as refs
      FROM payment_transactions
      WHERE (student_id = $1 OR student_number = $2)
        AND month IS NOT NULL AND year IS NOT NULL
      GROUP BY month, year
      ORDER BY year ASC, month ASC
    `, [student.id, student.student_number]);

    // Build a map: "year-month" → total paid from payment_transactions
    const ptByMonth = {};
    ptResult.rows.forEach(pt => {
      const key = `${pt.year}-${String(pt.month).padStart(2,'0')}`;
      ptByMonth[key] = {
        totalPaid: parseFloat(pt.total_paid) || 0,
        refs: pt.refs || 'Manual Entry'
      };
    });
    
    // Build monthly payment history from invoices, merging payment_transactions data
    const monthlyHistory = [];
    const months = ['January', 'February', 'March', 'April', 'May', 'June', 
                    'July', 'August', 'September', 'October', 'November', 'December'];
    const invoiceMonthKeys = new Set();
    
    invoices.forEach(inv => {
      if (!inv.due_date) return;
      
      const date = new Date(inv.due_date);
      const year = date.getFullYear();
      const monthIndex = date.getMonth();
      const monthNum = monthIndex + 1;
      const key = `${year}-${String(monthNum).padStart(2,'0')}`;
      invoiceMonthKeys.add(key);

      // Use the larger of invoice.amount_paid vs sum from payment_transactions
      // (handles edge case where invoice wasn't updated but payment_transactions was)
      const ptPaid = ptByMonth[key]?.totalPaid || 0;
      const invoicePaid = parseFloat(inv.amount_paid) || 0;
      const effectivePaid = Math.max(invoicePaid, ptPaid);
      const amountDue = parseFloat(inv.amount_due) || 0;
      const effectiveOutstanding = Math.max(amountDue - effectivePaid, 0);

      const normalStatus = (inv.status || '').toLowerCase();
      
      monthlyHistory.push({
        year,
        month: months[monthIndex],
        monthNumber: monthNum,
        amountDue,
        amountPaid: effectivePaid,
        outstanding: effectiveOutstanding,
        status: inv.status,
        paymentStatus: 
          normalStatus === 'paid' || normalStatus === 'overpaid' ? 'Paid' :
          effectivePaid >= amountDue && amountDue > 0 ? 'Paid' :
          effectivePaid > 0 ? 'Partial Payment' : 'Missed Payment',
        reference: inv.reference_number || '-'
      });
    });

    // Add months that only exist in payment_transactions (no invoice for that month)
    // e.g. manual payment entered for December 2025 when invoices start from January 2026
    Object.entries(ptByMonth).forEach(([key, pt]) => {
      if (!invoiceMonthKeys.has(key)) {
        const [yr, mo] = key.split('-').map(Number);
        monthlyHistory.push({
          year: yr,
          month: months[mo - 1],
          monthNumber: mo,
          amountDue: 0,
          amountPaid: pt.totalPaid,
          outstanding: 0,
          status: 'Paid',
          paymentStatus: 'Paid',
          reference: pt.refs
        });
      }
    });
    
    // Sort by year and month
    monthlyHistory.sort((a, b) => {
      if (a.year !== b.year) return a.year - b.year;
      return a.monthNumber - b.monthNumber;
    });
    
    // Calculate summary
    const totalDue = monthlyHistory.reduce((sum, m) => sum + m.amountDue, 0);
    const totalPaid = monthlyHistory.reduce((sum, m) => sum + m.amountPaid, 0);
    const totalOutstanding = monthlyHistory.reduce((sum, m) => sum + m.outstanding, 0);
    const missedCount = monthlyHistory.filter(m => m.paymentStatus === 'Missed Payment').length;
    const paidCount = monthlyHistory.filter(m => m.paymentStatus === 'Paid' || m.paymentStatus === 'Overpaid').length;
    
    const responseData = {
      success: true,
      student: {
        id: student.id,
        studentNumber: student.student_number,
        firstName: student.first_name,
        lastName: student.last_name,
        fullName: `${student.first_name} ${student.last_name}`,
        grade: student.grade
      },
      summary: {
        totalDue,
        totalPaid,
        totalOutstanding,
        missedPayments: missedCount,
        completedPayments: paidCount,
        totalMonths: monthlyHistory.filter(m => m.amountDue > 0).length
      },
      monthlyHistory
    };
    
    if (format === 'excel') {
      // Generate Excel file
      const ExcelJS = require('exceljs');
      const fs = require('fs');
      const path = require('path');
      const workbook = new ExcelJS.Workbook();
      workbook.creator = 'Harmony Learning Institute';
      workbook.created = new Date();
      
      const worksheet = workbook.addWorksheet('Payment History');
      
      // Try to add school logo
      let logoRowOffset = 0;
      try {
        const logoPath = path.join(__dirname, '..', 'assets', 'school-logo.jpg');
        if (fs.existsSync(logoPath)) {
          const logoImage = workbook.addImage({
            filename: logoPath,
            extension: 'jpeg',
          });
          worksheet.addImage(logoImage, {
            tl: { col: 0, row: 0 },
            ext: { width: 100, height: 100 }
          });
          logoRowOffset = 6; // Leave space for logo
          worksheet.getRow(1).height = 80;
        }
      } catch (logoErr) {
        console.log('Could not add logo to Excel:', logoErr.message);
      }
      
      // Title row (after logo)
      const titleRow = 1 + logoRowOffset;
      worksheet.mergeCells(`A${titleRow}:G${titleRow}`);
      worksheet.getCell(`A${titleRow}`).value = 'HARMONY LEARNING INSTITUTE';
      worksheet.getCell(`A${titleRow}`).font = { bold: true, size: 18, color: { argb: 'FFDC2626' } };
      worksheet.getCell(`A${titleRow}`).alignment = { horizontal: 'center' };
      
      worksheet.mergeCells(`A${titleRow + 1}:G${titleRow + 1}`);
      worksheet.getCell(`A${titleRow + 1}`).value = 'STUDENT PAYMENT HISTORY';
      worksheet.getCell(`A${titleRow + 1}`).font = { bold: true, size: 14, color: { argb: 'FF1E40AF' } };
      worksheet.getCell(`A${titleRow + 1}`).alignment = { horizontal: 'center' };
      
      // Student info
      const studentInfoRow = titleRow + 3;
      worksheet.mergeCells(`A${studentInfoRow}:G${studentInfoRow}`);
      worksheet.getCell(`A${studentInfoRow}`).value = `Student: ${student.first_name} ${student.last_name} (${student.student_number})`;
      worksheet.getCell(`A${studentInfoRow}`).font = { bold: true, size: 12 };
      
      worksheet.mergeCells(`A${studentInfoRow + 1}:G${studentInfoRow + 1}`);
      worksheet.getCell(`A${studentInfoRow + 1}`).value = `Grade: ${student.grade || 'N/A'}`;
      
      worksheet.mergeCells(`A${studentInfoRow + 2}:G${studentInfoRow + 2}`);
      worksheet.getCell(`A${studentInfoRow + 2}`).value = `Report Generated: ${new Date().toLocaleDateString('en-ZA')}`;
      
      // Summary section
      const summaryRow = studentInfoRow + 4;
      worksheet.getCell(`A${summaryRow}`).value = 'PAYMENT SUMMARY';
      worksheet.getCell(`A${summaryRow}`).font = { bold: true, size: 12, color: { argb: 'FF1E40AF' } };
      
      worksheet.getCell(`A${summaryRow + 1}`).value = 'Total Amount Due:';
      worksheet.getCell(`B${summaryRow + 1}`).value = totalDue;
      worksheet.getCell(`B${summaryRow + 1}`).numFmt = 'R #,##0.00';
      
      worksheet.getCell(`A${summaryRow + 2}`).value = 'Total Paid:';
      worksheet.getCell(`B${summaryRow + 2}`).value = totalPaid;
      worksheet.getCell(`B${summaryRow + 2}`).numFmt = 'R #,##0.00';
      
      worksheet.getCell(`A${summaryRow + 3}`).value = 'Outstanding Balance:';
      worksheet.getCell(`B${summaryRow + 3}`).value = totalOutstanding;
      worksheet.getCell(`B${summaryRow + 3}`).numFmt = 'R #,##0.00';
      worksheet.getCell(`B${summaryRow + 3}`).font = { bold: true, color: totalOutstanding > 0 ? { argb: 'FFDC2626' } : { argb: 'FF16A34A' } };
      
      worksheet.getCell(`A${summaryRow + 4}`).value = 'Missed Payments:';
      worksheet.getCell(`B${summaryRow + 4}`).value = missedCount;
      
      worksheet.getCell(`A${summaryRow + 5}`).value = 'Completed Payments:';
      worksheet.getCell(`B${summaryRow + 5}`).value = paidCount;
      
      // Banking Details Section
      const bankingRow = summaryRow + 7;
      worksheet.getCell(`A${bankingRow}`).value = 'BANKING DETAILS';
      worksheet.getCell(`A${bankingRow}`).font = { bold: true, size: 12, color: { argb: 'FF1E40AF' } };
      
      worksheet.getCell(`A${bankingRow + 1}`).value = 'Name of Bank:';
      worksheet.getCell(`B${bankingRow + 1}`).value = 'First National Bank (FNB)';
      worksheet.getCell(`B${bankingRow + 1}`).font = { bold: true };
      
      worksheet.getCell(`A${bankingRow + 2}`).value = 'Account Holder:';
      worksheet.getCell(`B${bankingRow + 2}`).value = 'HARMONY LEARNING INSTITUTE';
      worksheet.getCell(`B${bankingRow + 2}`).font = { bold: true };
      
      worksheet.getCell(`A${bankingRow + 3}`).value = 'Type of Account:';
      worksheet.getCell(`B${bankingRow + 3}`).value = 'CHEQUE';
      
      worksheet.getCell(`A${bankingRow + 4}`).value = 'Account Number:';
      worksheet.getCell(`B${bankingRow + 4}`).value = '63053202265';
      worksheet.getCell(`B${bankingRow + 4}`).font = { bold: true, size: 12 };
      
      worksheet.getCell(`A${bankingRow + 5}`).value = 'Branch Code:';
      worksheet.getCell(`B${bankingRow + 5}`).value = '210755';
      worksheet.getCell(`B${bankingRow + 5}`).font = { bold: true };
      
      worksheet.getCell(`A${bankingRow + 6}`).value = 'Reference:';
      worksheet.getCell(`B${bankingRow + 6}`).value = `Use student number: ${student.student_number}`;
      worksheet.getCell(`B${bankingRow + 6}`).font = { bold: true, color: { argb: 'FFDC2626' } };
      
      // Payment history table
      const historyTitleRow = bankingRow + 8;
      worksheet.getCell(`A${historyTitleRow}`).value = 'MONTHLY PAYMENT HISTORY';
      worksheet.getCell(`A${historyTitleRow}`).font = { bold: true, size: 12, color: { argb: 'FF1E40AF' } };
      
      // Table headers
      const headerRowNum = historyTitleRow + 1;
      const headerRow = worksheet.getRow(headerRowNum);
      headerRow.values = ['Year', 'Month', 'Amount Due', 'Amount Paid', 'Outstanding', 'Status', 'Reference'];
      headerRow.font = { bold: true };
      headerRow.eachCell((cell) => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E40AF' } };
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
        cell.border = { 
          top: { style: 'thin' }, 
          left: { style: 'thin' }, 
          bottom: { style: 'thin' }, 
          right: { style: 'thin' } 
        };
      });
      
      // Add data rows
      let rowNum = headerRowNum + 1;
      monthlyHistory.filter(m => m.amountDue > 0 || m.paymentStatus !== 'No Invoice').forEach(month => {
        const row = worksheet.getRow(rowNum);
        row.values = [
          month.year,
          month.month,
          month.amountDue,
          month.amountPaid,
          month.outstanding,
          month.paymentStatus,
          month.reference
        ];
        
        // Format currency columns
        row.getCell(3).numFmt = 'R #,##0.00';
        row.getCell(4).numFmt = 'R #,##0.00';
        row.getCell(5).numFmt = 'R #,##0.00';
        
        // Color status
        const statusCell = row.getCell(6);
        if (month.paymentStatus === 'Paid' || month.paymentStatus === 'Overpaid') {
          statusCell.font = { color: { argb: 'FF16A34A' } };
        } else if (month.paymentStatus === 'Missed Payment') {
          statusCell.font = { bold: true, color: { argb: 'FFDC2626' } };
          row.getCell(5).font = { bold: true, color: { argb: 'FFDC2626' } };
        } else if (month.paymentStatus === 'Partial Payment') {
          statusCell.font = { color: { argb: 'FFEA580C' } };
        }
        
        // Add borders
        row.eachCell((cell) => {
          cell.border = { 
            top: { style: 'thin' }, 
            left: { style: 'thin' }, 
            bottom: { style: 'thin' }, 
            right: { style: 'thin' } 
          };
        });
        
        rowNum++;
      });
      
      // Set column widths
      worksheet.columns = [
        { width: 10 },
        { width: 12 },
        { width: 15 },
        { width: 15 },
        { width: 15 },
        { width: 18 },
        { width: 20 }
      ];
      
      // Generate buffer
      const buffer = await workbook.xlsx.writeBuffer();
      
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename=Payment_History_${student.student_number}_${new Date().toISOString().split('T')[0]}.xlsx`);
      res.send(buffer);
      
    } else {
      res.json(responseData);
    }
    
  } catch (error) {
    console.error('Student payment history error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get student payment history',
      error: error.message
    });
  }
});

/**
 * Search students for payment export
 */
router.get('/search-students', [
  authenticate,
  authorize('admin', 'super_admin')
], async (req, res) => {
  try {
    const { q } = req.query;
    
    if (!q || q.length < 2) {
      return res.json({ success: true, students: [] });
    }
    
    const result = await db.query(`
      SELECT u.id, u.first_name, u.last_name, u.student_number
      FROM users u
      WHERE u.role = 'student' 
        AND (
          u.student_number ILIKE $1 
          OR u.first_name ILIKE $1 
          OR u.last_name ILIKE $1
          OR CONCAT(u.first_name, ' ', u.last_name) ILIKE $1
        )
      ORDER BY u.student_number
      LIMIT 10
    `, [`%${q}%`]);
    
    res.json({
      success: true,
      students: result.rows.map(s => ({
        id: s.id,
        studentNumber: s.student_number,
        firstName: s.first_name,
        lastName: s.last_name,
        fullName: `${s.first_name} ${s.last_name}`
      }))
    });
    
  } catch (error) {
    console.error('Search students error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to search students',
      error: error.message
    });
  }
});

/**
 * Manual Payment Entry - For payments where parent didn't use student number as reference
 */
router.post('/manual-payment', [
  authenticate,
  authorize('admin', 'super_admin'),
  body('student_id').isInt().withMessage('Student ID is required'),
  body('amount').isFloat({ min: 0.01 }).withMessage('Amount must be greater than 0'),
  body('payment_date').isISO8601().withMessage('Valid payment date is required'),
  body('description').optional().isString(),
  body('reference').optional().isString()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const { student_id, amount, payment_date, description, reference, month, year } = req.body;
    const adminId = req.user.id;

    // Verify student exists
    const studentResult = await db.query(
      'SELECT id, first_name, last_name, student_number FROM users WHERE id = $1 AND role = $2',
      [student_id, 'student']
    );

    if (studentResult.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Student not found' });
    }

    const student = studentResult.rows[0];

    // Insert the manual payment
    const refValue = reference || `MANUAL-${Date.now()}`;
    const paymentResult = await db.query(`
      INSERT INTO payment_transactions (
        student_id, amount, payment_date, transaction_date, 
        reference, reference_number, description, 
        payment_method, recorded_by, month, year,
        student_number
      )
      VALUES ($1, $2, $3, $3, $4, $4, $5, 'manual_entry', $6, $7, $8, $9)
      RETURNING *
    `, [
      student_id, 
      amount, 
      payment_date, 
      refValue,
      description || `Manual payment entry by admin`,
      adminId,
      month || new Date(payment_date).getMonth() + 1,
      year || new Date(payment_date).getFullYear(),
      student.student_number || ''
    ]);

    // If there's an invoice for this month/year, update it
    const paymentMonth = month || new Date(payment_date).getMonth() + 1;
    const paymentYear = year || new Date(payment_date).getFullYear();

    const invoiceResult = await db.query(`
      UPDATE invoices 
      SET amount_paid = COALESCE(amount_paid, 0) + $1,
          outstanding_balance = GREATEST(COALESCE(outstanding_balance, amount_due) - $1, 0),
          status = CASE 
            WHEN COALESCE(amount_paid, 0) + $1 >= amount_due THEN 'Paid'
            WHEN COALESCE(amount_paid, 0) + $1 > 0 THEN 'Partial'
            ELSE status
          END
      WHERE student_id = $2 
        AND EXTRACT(MONTH FROM due_date) = $3 
        AND EXTRACT(YEAR FROM due_date) = $4
      RETURNING *
    `, [amount, student_id, paymentMonth, paymentYear]);

    console.log(`✅ Manual payment recorded: R${amount} for ${student.first_name} ${student.last_name} (${student.student_number})`);

    res.json({
      success: true,
      message: `Payment of R${amount} recorded for ${student.first_name} ${student.last_name}`,
      payment: paymentResult.rows[0],
      invoiceUpdated: invoiceResult.rows.length > 0,
      student: {
        id: student.id,
        name: `${student.first_name} ${student.last_name}`,
        studentNumber: student.student_number
      }
    });

  } catch (error) {
    console.error('Manual payment error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to record manual payment',
      error: error.message
    });
  }
});

/**
 * Get payment history for a student
 */
router.get('/student-payments/:studentId', [
  authenticate,
  authorize('admin', 'super_admin')
], async (req, res) => {
  try {
    const { studentId } = req.params;

    // Get student info
    const studentResult = await db.query(
      'SELECT id, first_name, last_name, student_number FROM users WHERE id = $1',
      [studentId]
    );

    if (studentResult.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Student not found' });
    }

    const student = studentResult.rows[0];

    // Get all payments for this student
    const paymentsResult = await db.query(`
      SELECT pt.*, 
             COALESCE(pt.payment_date, pt.transaction_date) as effective_date,
             u.first_name as recorded_by_name, u.last_name as recorded_by_lastname
      FROM payment_transactions pt
      LEFT JOIN users u ON pt.recorded_by = u.id
      WHERE pt.student_id = $1
      ORDER BY COALESCE(pt.payment_date, pt.transaction_date) DESC
    `, [studentId]);

    res.json({
      success: true,
      student: {
        id: student.id,
        name: `${student.first_name} ${student.last_name}`,
        studentNumber: student.student_number
      },
      payments: paymentsResult.rows
    });

  } catch (error) {
    console.error('Get student payments error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get payment history',
      error: error.message
    });
  }
});

/**
 * Edit a manual payment
 */
router.put('/manual-payment/:paymentId', [
  authenticate,
  authorize('admin', 'super_admin'),
  body('amount').optional().isFloat({ min: 0.01 }),
  body('payment_date').optional().isISO8601(),
  body('description').optional().isString()
], async (req, res) => {
  try {
    const { paymentId } = req.params;
    const { amount, payment_date, description, reference, month, year } = req.body;

    // Get original payment
    const originalPayment = await db.query(
      'SELECT * FROM payment_transactions WHERE id = $1',
      [paymentId]
    );

    if (originalPayment.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Payment not found' });
    }

    const original = originalPayment.rows[0];

    // Resolve old and new month/year
    const oldMonth = original.month || (original.payment_date ? new Date(original.payment_date).getMonth() + 1 : null);
    const oldYear  = original.year  || (original.payment_date ? new Date(original.payment_date).getFullYear()  : null);
    const newMonth = month  ? parseInt(month)  : oldMonth;
    const newYear  = year   ? parseInt(year)   : oldYear;
    const oldAmount = parseFloat(original.amount);
    const newAmount = amount ? parseFloat(amount) : oldAmount;

    // Update payment_transactions — save ALL changed fields including month/year
    const updateResult = await db.query(`
      UPDATE payment_transactions 
      SET amount       = COALESCE($1, amount),
          payment_date = COALESCE($2, payment_date),
          transaction_date = COALESCE($2, transaction_date),
          description  = COALESCE($3, description),
          reference    = COALESCE($4, reference),
          reference_number = COALESCE($4, reference_number),
          month        = $5,
          year         = $6
      WHERE id = $7
      RETURNING *
    `, [amount || null, payment_date || null, description || null, reference || null,
        newMonth, newYear, paymentId]);

    // ── Update invoices ────────────────────────────────────────────────────────
    // If the month/year OR the amount changed we need to:
    //   1. Reverse the payment on the OLD invoice
    //   2. Apply  the payment on the NEW invoice
    const monthYearChanged = (newMonth !== oldMonth) || (newYear !== oldYear);
    const amountChanged    = newAmount !== oldAmount;

    if ((monthYearChanged || amountChanged) && original.student_id) {
      // 1. Reverse old invoice (subtract old amount)
      if (oldMonth && oldYear) {
        await db.query(`
          UPDATE invoices
          SET amount_paid        = GREATEST(COALESCE(amount_paid, 0) - $1, 0),
              outstanding_balance = LEAST(COALESCE(outstanding_balance, 0) + $1, amount_due),
              status = CASE
                WHEN GREATEST(COALESCE(amount_paid, 0) - $1, 0) = 0 THEN 'Unpaid'
                WHEN GREATEST(COALESCE(amount_paid, 0) - $1, 0) < amount_due THEN 'Partial'
                ELSE status
              END
          WHERE student_id = $2
            AND EXTRACT(MONTH FROM due_date) = $3
            AND EXTRACT(YEAR  FROM due_date) = $4
        `, [oldAmount, original.student_id, oldMonth, oldYear]);
      }

      // 2. Apply new amount to new invoice
      if (newMonth && newYear) {
        await db.query(`
          UPDATE invoices
          SET amount_paid        = COALESCE(amount_paid, 0) + $1,
              outstanding_balance = GREATEST(COALESCE(outstanding_balance, amount_due) - $1, 0),
              status = CASE
                WHEN COALESCE(amount_paid, 0) + $1 >= amount_due THEN 'Paid'
                WHEN COALESCE(amount_paid, 0) + $1 > 0 THEN 'Partial'
                ELSE 'Unpaid'
              END
          WHERE student_id = $2
            AND EXTRACT(MONTH FROM due_date) = $3
            AND EXTRACT(YEAR  FROM due_date) = $4
        `, [newAmount, original.student_id, newMonth, newYear]);
      }
    }

    console.log(`✅ Manual payment ${paymentId} updated: month ${oldMonth}/${oldYear} → ${newMonth}/${newYear}, amount R${oldAmount} → R${newAmount}`);

    res.json({
      success: true,
      message: 'Payment updated successfully',
      payment: updateResult.rows[0]
    });

  } catch (error) {
    console.error('Edit payment error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update payment',
      error: error.message
    });
  }
});

/**
 * Delete a manual payment
 */
router.delete('/manual-payment/:paymentId', [
  authenticate,
  authorize('admin', 'super_admin')
], async (req, res) => {
  try {
    const { paymentId } = req.params;

    // Get payment before deleting
    const paymentResult = await db.query(
      'SELECT * FROM payment_transactions WHERE id = $1',
      [paymentId]
    );

    if (paymentResult.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Payment not found' });
    }

    const payment = paymentResult.rows[0];

    // Delete payment
    await db.query('DELETE FROM payment_transactions WHERE id = $1', [paymentId]);

    // Update invoice to subtract this amount
    const delMonth = payment.month || (payment.payment_date ? new Date(payment.payment_date).getMonth() + 1 : null);
    const delYear = payment.year || (payment.payment_date ? new Date(payment.payment_date).getFullYear() : null);
    if (delMonth && delYear) {
      await db.query(`
        UPDATE invoices 
        SET amount_paid = GREATEST(COALESCE(amount_paid, 0) - $1, 0),
            outstanding_balance = LEAST(COALESCE(outstanding_balance, 0) + $1, amount_due),
            status = CASE 
              WHEN GREATEST(COALESCE(amount_paid, 0) - $1, 0) >= amount_due THEN 'Paid'
              WHEN GREATEST(COALESCE(amount_paid, 0) - $1, 0) > 0 THEN 'Partial'
              ELSE 'Unpaid'
            END
        WHERE student_id = $2 
          AND EXTRACT(MONTH FROM due_date) = $3 
          AND EXTRACT(YEAR FROM due_date) = $4
      `, [payment.amount, payment.student_id, delMonth, delYear]);
    }

    res.json({
      success: true,
      message: 'Payment deleted successfully'
    });

  } catch (error) {
    console.error('Delete payment error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete payment',
      error: error.message
    });
  }
});

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
