const express = require('express');
const BANKING_DETAILS = require('../config/bankingDetails');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const { body, validationResult } = require('express-validator');
const db = require('../config/database');
const { notifyPayment } = require('../services/parentNotificationService');
const { authenticate, authorize } = require('../middleware/auth');
const EnhancedCSVParser = require('../utils/enhancedCSVParser');
const FNBPDFParser = require('../utils/fnbPDFParser');

const router = express.Router();
const { logAudit, getIp } = require('../utils/auditLogger');
const { allocatePayment, getStudentLedger, reversePayment } = require('../services/financeLedger');

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

      // ── ARREARS-FIRST ALLOCATION ─────────────────────────────────────────────
      // The matched invoice tells us WHICH student this payment belongs to.
      // We then fetch ALL their unpaid/partial invoices oldest-first and distribute
      // the payment across them in order: previous-year arrears are always settled
      // before any current-year invoices receive credit.
      const matchedInvoice = invoiceResult.rows[0];
      const studentId    = matchedInvoice.student_id;
      const studentNumber = matchedInvoice.student_number || matchedInvoice.user_student_number;
      const studentFirstName = matchedInvoice.first_name || 'Unknown';
      const studentLastName  = matchedInvoice.last_name  || 'Student';

      const allocationResult = await allocatePayment(client, {
        studentId,
        amount: transaction.amount,
        paymentDate: transaction.date,
        paymentMethod: 'bank_transfer',
        reference: transaction.reference,
        description: transaction.description,
        recordedBy: userId,
      });
      const allocations = allocationResult.allocations.map((allocation) => ({
        transactionId: allocation.transactionId,
        invoiceId: allocation.invoiceId,
        reference: allocation.reference,
        dueDate: allocation.dueDate,
        status: allocation.status,
        appliedAmount: allocation.amount,
        isArrears: allocation.dueDate
          ? new Date(allocation.dueDate).getUTCFullYear() < new Date().getUTCFullYear()
          : false,
      }));
      const overpayment = allocations.find((allocation) => allocation.invoiceId == null);
      const totalApplied = allocations
        .filter((allocation) => allocation.invoiceId != null)
        .reduce((sum, allocation) => sum + allocation.appliedAmount, 0);

      await client.query('COMMIT');
      console.log(`✅ Processed R${transaction.amount} for ${studentFirstName} ${studentLastName} (${studentNumber}) — ${allocations.length} allocation(s) recorded`);
      await Promise.allSettled(allocations
          .filter((allocation) => allocation.transactionId != null)
        .map((allocation) => notifyPayment({
          kind: 'applied',
          paymentId: allocation.transactionId,
          learnerId: studentId,
          amount: allocation.appliedAmount,
        })));

      // ── Build result data for the response ──────────────────────────────────
      const arrearsAllocations  = allocations.filter(a => a.isArrears);
      const currentAllocations  = allocations.filter(a => !a.isArrears);
      const remaining            = Math.max(0, Math.round((parseFloat(transaction.amount) - totalApplied) * 100) / 100);
      const primaryAllocation   = allocations.find((allocation) => allocation.invoiceId != null) || allocations[0];

      // Overall result category
      let resultCategory;
      if (overpayment) {
        resultCategory = 'overpaid';
      } else {
        resultCategory = 'matched';
      }

      const arrearsNote = arrearsAllocations.length > 0
        ? `Payment applied to arrears first: R${arrearsAllocations.reduce((s,a)=>s+a.appliedAmount,0).toFixed(2)} to previous-year invoices${currentAllocations.length > 0 ? `, R${currentAllocations.reduce((s,a)=>s+a.appliedAmount,0).toFixed(2)} to current-year invoices` : ''}.`
        : null;

      const resultData = {
        ...transaction,
        invoice: {
          id:                primaryAllocation.invoiceId,
          reference_number:  matchedInvoice.reference_number,
          student_id:        studentId,
          student_number:    studentNumber,
          original_amount:   matchedInvoice.amount_due,
          amount_paid:       primaryAllocation.appliedAmount,
          status:            overpayment ? 'Overpaid' : 'Applied'
        },
        student: {
          id:             studentId,
          student_number: studentNumber,
          first_name:     studentFirstName,
          last_name:      studentLastName,
          name:           `${studentFirstName} ${studentLastName}`.trim()
        },
        processing: {
          transaction_amount:    parseFloat(transaction.amount),
          total_applied:         totalApplied,
          invoices_updated:      allocations.filter((allocation) => allocation.invoiceId != null).length,
          arrears_invoices:      arrearsAllocations.length,
          current_invoices:      currentAllocations.length,
          arrears_note:          arrearsNote,
          allocations
        },
        bank_details: {
          description:        transaction.description,
          reference_extracted: transaction.reference,
          amount:             transaction.amount,
          date:               transaction.date
        }
      };

      // Push to correct bucket
      if (resultCategory === 'overpaid') {
        results.overpaid.push({ ...resultData, overpaid_amount: remaining });
      } else {
        results.matched.push(resultData);
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
    
    // Find the student (include created_at as enrollment date and service flags)
    const studentResult = await db.query(`
      SELECT u.id, u.first_name, u.last_name, u.student_number, u.created_at,
             g.name AS grade,
             COALESCE(u.is_boarder, false)              AS is_boarder,
             COALESCE(u.uses_transport, false)          AS uses_transport,
             COALESCE(u.uses_aftercare, false)          AS uses_aftercare,
             COALESCE(u.has_sibling_discount, false)    AS has_sibling_discount,
             COALESCE(u.has_teacher_discount, false)    AS has_teacher_discount
      FROM users u
      LEFT JOIN grades g ON u.grade_id = g.id
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

    // Every history row and total comes from the authoritative ledger. Raw
    // payment month aggregation is intentionally not used: a transaction's
    // month can disagree with the invoice it was allocated to (HAR049).
    const authoritativeLedger = await getStudentLedger(student.id);
    const monthlyHistory = [];
    const months = ['January', 'February', 'March', 'April', 'May', 'June', 
                    'July', 'August', 'September', 'October', 'November', 'December'];
    authoritativeLedger.invoices.forEach(inv => {
      if (!inv.counted_in_totals) return;
      if (!inv.due_date) return;
      const date = new Date(inv.due_date);
      const year = date.getUTCFullYear();
      const monthIndex = date.getUTCMonth();
      const monthNum = monthIndex + 1;
      const normalStatus = (inv.status || '').toLowerCase();
      monthlyHistory.push({
        invoiceId: inv.id,
        year,
        month: months[monthIndex],
        monthNumber: monthNum,
        amountDue: inv.net_due,
        amountPaid: inv.allocated_effective_payments,
        outstanding: inv.outstanding_balance,
        credit: inv.credit,
        grossCharges: inv.gross_charges,
        discountLines: inv.discount_lines,
        discountTotal: inv.discount_total,
        netDue: inv.net_due,
        allocatedPayments: inv.allocated_effective_payments,
        reviewFlags: inv.payment_review_flags,
        reviewRequired: inv.review_required,
        status: inv.status,
        paymentStatus: 
          normalStatus === 'overpaid' ? 'Overpaid' :
          normalStatus === 'paid' ? 'Paid' :
          normalStatus === 'partial' ? 'Partial Payment' :
          normalStatus === 'carried forward' ? 'Carried Forward' : 'Missed Payment',
        reference: inv.reference_number || '-'
      });
    });
    
    // Sort by year and month
    monthlyHistory.sort((a, b) => {
      if (a.year !== b.year) return a.year - b.year;
      return a.monthNumber - b.monthNumber;
    });
    
    const totalDue = authoritativeLedger.totals.totalDue;
    const totalPaid = authoritativeLedger.totals.totalPaid;
    const totalOutstanding = authoritativeLedger.totals.outstanding;
    const activeInvoices = authoritativeLedger.invoices.filter((invoice) => invoice.counted_in_totals);
    const missedCount = activeInvoices.filter((invoice) =>
      invoice.outstanding_balance > 0 && invoice.amount_paid <= 0).length;
    const paidCount = activeInvoices.filter((invoice) =>
      invoice.status === 'Paid' || invoice.status === 'Overpaid').length;
    const historicalPaymentReview = authoritativeLedger.transactions
      .filter((transaction) => transaction.review_required)
      .map((transaction) => ({
        transactionId: transaction.id,
        amount: transaction.amount,
        invoiceId: transaction.invoice_id,
        flags: transaction.review_flags || [],
        paymentDate: transaction.payment_date,
      }));
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
        overpaid: authoritativeLedger.totals.overpaid,
        unallocated: authoritativeLedger.totals.unallocated,
        missedPayments: missedCount,
        completedPayments: paidCount,
        totalMonths: monthlyHistory.filter(m => m.amountDue > 0).length,
        credit: authoritativeLedger.totals.credit,
        netOutstanding: authoritativeLedger.totals.netOutstanding,
      },
      monthlyHistory,
      serviceComponents: authoritativeLedger.service_components,
      paymentTransactions: authoritativeLedger.transactions,
      historicalPaymentReview,
      reviewRequired: historicalPaymentReview.length > 0 ||
        monthlyHistory.some((month) => month.reviewRequired),
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

      const feeStructureRow = studentInfoRow + 4;
      worksheet.getCell(`A${feeStructureRow}`).value = 'INVOICE BREAKDOWN';
      worksheet.getCell(`A${feeStructureRow}`).font = { bold: true, size: 12, color: { argb: 'FF1E40AF' } };
      worksheet.getCell(`A${feeStructureRow + 1}`).value =
        'Persisted invoice charge and discount lines are provided on the Invoice Breakdown worksheet. Legacy invoices are marked snapshot unavailable.';
      worksheet.mergeCells(`A${feeStructureRow + 1}:G${feeStructureRow + 1}`);
      const feeStructureHeight = 2;

      // Summary section
      const summaryRow = feeStructureRow + feeStructureHeight + 2;
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

      worksheet.getCell(`A${summaryRow + 4}`).value = 'Credit / Overpaid:';
      worksheet.getCell(`B${summaryRow + 4}`).value = authoritativeLedger.totals.credit;
      worksheet.getCell(`B${summaryRow + 4}`).numFmt = 'R #,##0.00';
      
      worksheet.getCell(`A${summaryRow + 5}`).value = 'Missed Payments:';
      worksheet.getCell(`B${summaryRow + 5}`).value = missedCount;
      
      worksheet.getCell(`A${summaryRow + 6}`).value = 'Completed Payments:';
      worksheet.getCell(`B${summaryRow + 6}`).value = paidCount;
      
      // Banking Details Section
      const bankingRow = summaryRow + 8;
      worksheet.getCell(`A${bankingRow}`).value = 'BANKING DETAILS';
      worksheet.getCell(`A${bankingRow}`).font = { bold: true, size: 12, color: { argb: 'FF1E40AF' } };
      
      worksheet.getCell(`A${bankingRow + 1}`).value = 'Name of Bank:';
      worksheet.getCell(`B${bankingRow + 1}`).value = BANKING_DETAILS.bank;
      worksheet.getCell(`B${bankingRow + 1}`).font = { bold: true };
      
      worksheet.getCell(`A${bankingRow + 2}`).value = 'Account Holder:';
      worksheet.getCell(`B${bankingRow + 2}`).value = BANKING_DETAILS.accountHolder;
      worksheet.getCell(`B${bankingRow + 2}`).font = { bold: true };
      
      worksheet.getCell(`A${bankingRow + 3}`).value = 'Type of Account:';
      worksheet.getCell(`B${bankingRow + 3}`).value = BANKING_DETAILS.accountType;
      
      worksheet.getCell(`A${bankingRow + 4}`).value = 'Account Number:';
      worksheet.getCell(`B${bankingRow + 4}`).value = BANKING_DETAILS.accountNumber;
      worksheet.getCell(`B${bankingRow + 4}`).font = { bold: true, size: 12 };
      
      worksheet.getCell(`A${bankingRow + 5}`).value = 'Branch Code:';
      worksheet.getCell(`B${bankingRow + 5}`).value = BANKING_DETAILS.branchCode;
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
      headerRow.values = [
        'Year', 'Month', 'Gross Charges', 'Discounts', 'Net Due',
        'Allocated Payments', 'Outstanding', 'Credit', 'Status', 'Review Flags', 'Reference',
      ];
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
      const exportRows = [...monthlyHistory];
      if (authoritativeLedger.totals.unallocated > 0) {
        exportRows.push({
          year: '',
          month: 'Unallocated payment (review)',
          grossCharges: 0,
          discountLines: [],
          amountDue: 0,
          amountPaid: 0,
          outstanding: 0,
          credit: authoritativeLedger.totals.unallocated,
          paymentStatus: 'Review',
          reviewFlags: [{ type: 'unallocated_payment' }],
          reference: 'Admin review required',
        });
      }
      exportRows.forEach(month => {
        const row = worksheet.getRow(rowNum);
        row.values = [
          month.year,
          month.month,
          month.grossCharges,
          -(month.discountLines || []).reduce((sum, line) => sum + Number(line.amount || 0), 0),
          month.amountDue,
          month.amountPaid,
          month.outstanding,
          month.credit,
          month.paymentStatus,
          (month.reviewFlags || []).map((flag) => flag.type).join(', '),
          month.reference
        ];
        
        // Format currency columns
        row.getCell(3).numFmt = 'R #,##0.00';
        row.getCell(4).numFmt = 'R #,##0.00';
        row.getCell(5).numFmt = 'R #,##0.00';
        row.getCell(6).numFmt = 'R #,##0.00';
        row.getCell(7).numFmt = 'R #,##0.00';
        row.getCell(8).numFmt = 'R #,##0.00';
        
        // Color status
        const statusCell = row.getCell(9);
        if (month.paymentStatus === 'Paid' || month.paymentStatus === 'Overpaid') {
          statusCell.font = { color: { argb: 'FF16A34A' } };
        } else if (month.paymentStatus === 'Missed Payment') {
          statusCell.font = { bold: true, color: { argb: 'FFDC2626' } };
          row.getCell(7).font = { bold: true, color: { argb: 'FFDC2626' } };
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
      
      // Set column widths — narrowed to fit on one A4 landscape page
      worksheet.columns = [
        { width: 22 },  // A: labels ("Outstanding Balance:", "Reference Number:", …)
        { width: 22 },  // B: values ("HARMONY LEARNING INSTITUTE", amounts, …)
        { width: 13 },  // C: Gross charges
        { width: 13 },  // D: Discounts
        { width: 13 },  // E: Net due
        { width: 13 },  // F: Allocated payments
        { width: 13 },  // G: Outstanding
        { width: 11 },  // H: Credit
        { width: 14 },  // I: Status
        { width: 24 },  // J: Review flags
        { width: 20 },  // K: Reference number
      ];

      // Page setup — A4 landscape, always fit to one page width
      worksheet.pageSetup = {
        paperSize:   9,           // 9 = A4
        orientation: 'landscape',
        fitToPage:   true,
        fitToWidth:  1,           // shrink to exactly 1 page wide
        fitToHeight: 0,           // allow as many rows tall as needed
        margins: {
          left: 0.5, right: 0.5, top: 0.75, bottom: 0.75,
          header: 0.3, footer: 0.3
        }
      };

      const breakdownSheet = workbook.addWorksheet('Invoice Breakdown');
      breakdownSheet.columns = [
        { header: 'Invoice ID', key: 'invoiceId', width: 12 },
        { header: 'Due Date', key: 'dueDate', width: 14 },
        { header: 'Line Type', key: 'lineType', width: 14 },
        { header: 'Service Key', key: 'serviceKey', width: 18 },
        { header: 'Label', key: 'label', width: 28 },
        { header: 'Included Bundle Line', key: 'included', width: 18 },
        { header: 'Line Amount', key: 'lineAmount', width: 14 },
        { header: 'Gross Charges', key: 'gross', width: 14 },
        { header: 'Discount Total', key: 'discountTotal', width: 14 },
        { header: 'Net Due', key: 'netDue', width: 14 },
        { header: 'Allocated Payments', key: 'paid', width: 16 },
        { header: 'Outstanding', key: 'outstanding', width: 14 },
        { header: 'Credit', key: 'credit', width: 12 },
        { header: 'Status', key: 'status', width: 14 },
        { header: 'Review Flags', key: 'review', width: 28 },
        { header: 'Snapshot', key: 'snapshot', width: 24 },
      ];
      breakdownSheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
      breakdownSheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E40AF' } };
      authoritativeLedger.invoices.forEach((invoice) => {
        const lines = invoice.line_items || [];
        const base = {
          invoiceId: invoice.id,
          dueDate: invoice.due_date ? new Date(invoice.due_date).toISOString().slice(0, 10) : '',
          gross: invoice.gross_charges,
          discountTotal: invoice.discount_total,
          netDue: invoice.net_due,
          paid: invoice.allocated_effective_payments,
          outstanding: invoice.outstanding_balance,
          credit: invoice.credit,
          status: invoice.status,
          review: (invoice.payment_review_flags || []).map((flag) => flag.type).join(', '),
          snapshot: lines.length ? 'Persisted snapshot' : 'Snapshot unavailable (legacy invoice)',
        };
        if (!lines.length) {
          breakdownSheet.addRow({ ...base, lineType: 'unavailable', label: 'Detailed snapshot unavailable' });
        } else {
          lines.forEach((line) => breakdownSheet.addRow({
            ...base,
            lineType: line.line_type,
            serviceKey: line.service_key || '',
            label: line.label,
            included: line.included ? 'Yes' : 'No',
            lineAmount: line.line_type === 'discount' ? -line.amount : line.amount,
          }));
        }
      });
      breakdownSheet.eachRow((row, rowNumber) => {
        if (rowNumber === 1) return;
        [7, 8, 9, 10, 11, 12, 13].forEach((column) => {
          row.getCell(column).numFmt = 'R #,##0.00';
        });
      });
      
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
  body('invoice_id').optional({ nullable: true }).isInt({ min: 1 }),
  body('payment_method').optional().isIn(['manual_entry', 'cash', 'bank_transfer', 'card', 'other']),
  body('description').optional().isString(),
  body('reference').optional().isString()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const { student_id, amount, payment_date, description, reference, month, year, invoice_id, payment_method } = req.body;
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
    const paymentMonth = month || new Date(payment_date).getUTCMonth() + 1;
    const paymentYear = year || new Date(payment_date).getUTCFullYear();

    // Manual, bank, and proof payments all use the same locked allocation
    // algorithm.  The requested month/year are retained in the audit details;
    // allocation itself is arrears-first and cannot silently double-charge a
    // selected invoice.
    const refValue = reference || `MANUAL-${Date.now()}`;
    const client = await db.pool.connect();
    let allocation;
    let paymentResult;
    try {
      await client.query('BEGIN');
      allocation = await allocatePayment(client, {
        studentId: student_id,
        amount,
        paymentDate: payment_date,
        paymentMethod: payment_method || 'manual_entry',
        reference: refValue,
        description: description || 'Manual payment entry by admin',
        recordedBy: adminId,
        invoiceId: invoice_id == null ? null : Number(invoice_id),
        transactionMonth: month || null,
        transactionYear: year || null,
      });
      if (invoice_id != null && !allocation.allocations.some((item) => item.invoiceId === Number(invoice_id))) {
        const error = new Error('Selected invoice is not an outstanding invoice for this learner');
        error.status = 409;
        throw error;
      }
      const firstPaymentId = allocation.allocations[0]?.transactionId;
      paymentResult = await client.query(
        'SELECT * FROM payment_transactions WHERE id = $1',
        [firstPaymentId],
      );
      await logAudit({
        userId: req.user.id,
        userName: `${req.user.first_name || ''} ${req.user.last_name || ''}`.trim(),
        userRole: req.user.role,
        action: 'manual_payment_add',
        entityType: 'payment',
        entityId: paymentResult.rows[0]?.id || null,
        details: {
          summary: `R${amount} recorded for ${student.first_name} ${student.last_name} (${student.student_number})`,
          student: `${student.first_name} ${student.last_name}`,
          student_number: student.student_number,
          student_id,
          amount,
          month: paymentMonth,
          year: paymentYear,
          reference: refValue,
          invoice_id: invoice_id == null ? null : Number(invoice_id),
          allocation_transaction_ids: allocation.allocations.map((item) => item.transactionId),
          invoice_updated: allocation.allocations.some((item) => item.invoiceId != null),
        },
        ipAddress: getIp(req),
        executor: client,
        required: true,
      });
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    const invoiceUpdated = allocation.allocations.some((item) => item.invoiceId != null);

    console.log(`✅ Manual payment recorded: R${amount} for ${student.first_name} ${student.last_name} (${student.student_number})`);

    await notifyPayment({
      kind: 'recorded',
      paymentId: paymentResult.rows[0]?.id,
      learnerId: student.id,
      amount,
    });

    res.json({
      success: true,
      message: `Payment of R${amount} recorded for ${student.first_name} ${student.last_name}`,
      payment: paymentResult.rows[0],
      allocations: allocation.allocations,
      invoiceUpdated,
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
             pt.reverses_transaction_id,
             (pt.reverses_transaction_id IS NOT NULL) AS is_reversal,
             reversal.id AS reversal_id,
             (reversal.id IS NOT NULL) AS is_reversed,
             COALESCE(pt.payment_date, pt.transaction_date) as effective_date,
             u.first_name as recorded_by_name, u.last_name as recorded_by_lastname
      FROM payment_transactions pt
      LEFT JOIN payment_transactions reversal
        ON reversal.reverses_transaction_id = pt.id
      LEFT JOIN users u ON pt.recorded_by = u.id
      WHERE pt.student_id = $1
      ORDER BY COALESCE(pt.payment_date, pt.transaction_date) DESC
    `, [studentId]);
    const invoicesResult = await db.query(`
      SELECT id, reference_number, due_date, amount_due, amount_paid,
             GREATEST(amount_due - amount_paid, 0) AS outstanding_balance, status
      FROM invoices
      WHERE student_id = $1
        AND status <> 'Carried Forward'
        AND amount_paid < amount_due
      ORDER BY due_date ASC, id ASC
    `, [studentId]);

    res.json({
      success: true,
      student: {
        id: student.id,
        name: `${student.first_name} ${student.last_name}`,
        studentNumber: student.student_number
      },
      payments: paymentsResult.rows,
      invoices: invoicesResult.rows,
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
  body('description').optional().isString(),
  body('payment_method').optional().isIn(['manual_entry', 'cash', 'bank_transfer', 'card', 'other']),
  body('reason').isString().trim().isLength({ min: 3, max: 500 }).withMessage('A correction reason is required')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });
    const { paymentId } = req.params;
    const { amount, payment_date, description, reference, month, year, payment_method, reason } = req.body;

    const client = await db.pool.connect();
    let original;
    let replacement;
    let replacementTransactionIds = [];
    let replacementPayment;
    let reversalId;
    try {
      await client.query('BEGIN');
      const originalResult = await client.query(`
        SELECT *
        FROM payment_transactions
        WHERE id = $1
        FOR UPDATE
      `, [paymentId]);
      if (!originalResult.rows.length) {
        await client.query('ROLLBACK');
        return res.status(404).json({ success: false, message: 'Payment not found' });
      }
      original = originalResult.rows[0];
      const oldAmount = parseFloat(original.amount);
      const newAmount = amount == null ? oldAmount : parseFloat(amount);
      const newDate = payment_date || original.payment_date || original.transaction_date;
      const newMonth = month ? parseInt(month, 10) : (original.month || (newDate ? new Date(newDate).getUTCMonth() + 1 : null));
      const newYear = year ? parseInt(year, 10) : (original.year || (newDate ? new Date(newDate).getUTCFullYear() : null));

      const reversal = await reversePayment(client, {
        transactionId: paymentId,
        recordedBy: req.user.id,
        description: `Correction reversal for payment ${paymentId}: ${reason}`,
      });
      if (reversal.alreadyReversed) {
        const error = new Error('Payment was already reversed and cannot be edited');
        error.status = 409;
        throw error;
      }
      reversalId = reversal.reversalId;
      const allocation = await allocatePayment(client, {
        studentId: original.student_id,
        amount: newAmount,
        paymentDate: newDate,
        paymentMethod: payment_method || original.payment_method || 'manual_entry',
        reference: reference || original.reference || original.reference_number,
        description: `Correction replacement for payment ${paymentId}: ${description || original.description || reason}`,
        recordedBy: req.user.id,
        // Preserve the original allocation identity. A month/year edit must
        // never touch every invoice for that student and period.
        // Carry-forward reversals can target the active arrears successor,
        // not the historical source invoice. Never blindly reuse the source
        // transaction's invoice_id after reversePayment has resolved it.
        invoiceId: reversal.effectiveInvoiceId == null ? 0 : reversal.effectiveInvoiceId,
        transactionMonth: newMonth,
        transactionYear: newYear,
      });
      replacement = allocation.allocations[0] || null;
      replacementTransactionIds = allocation.allocations.map((item) => item.transactionId);
      if (replacement?.transactionId) {
        const replacementResult = await client.query(
          'SELECT * FROM payment_transactions WHERE id = $1',
          [replacement.transactionId],
        );
        replacementPayment = replacementResult.rows[0] || null;
      }
      await logAudit({
        userId: req.user.id,
        userName: `${req.user.first_name || ''} ${req.user.last_name || ''}`.trim(),
        userRole: req.user.role,
        action: 'manual_payment_edit',
        entityType: 'payment',
        entityId: parseInt(paymentId),
        details: {
          summary: `Payment #${paymentId} corrected by reversal and replacement`,
          student_id: original.student_id,
          invoice_id: reversal.effectiveInvoiceId,
          original_transaction_id: Number(paymentId),
          reversal_transaction_id: reversalId,
          replacement_transaction_ids: replacementTransactionIds,
          old_amount: oldAmount,
          new_amount: newAmount,
          old_date: original.payment_date || original.transaction_date,
          new_date: newDate,
          old_reference: original.reference || original.reference_number,
          new_reference: reference || original.reference || original.reference_number,
          previous_method: original.payment_method,
          new_method: payment_method || original.payment_method,
          reason,
        },
        ipAddress: getIp(req),
        executor: client,
        required: true,
      });
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    console.log(`✅ Manual payment ${paymentId} reversed and reapplied as transaction ${replacement?.transactionId || 'unallocated'}`);

    await notifyPayment({
      kind: 'adjusted',
      paymentId: replacement?.transactionId || reversalId,
      learnerId: original.student_id,
      amount: amount == null ? original.amount : amount,
    });

    res.json({
      success: true,
      message: 'Payment updated successfully',
      payment: replacementPayment || replacement,
      replacement_transaction_ids: replacementTransactionIds,
    });

  } catch (error) {
    console.error('Edit payment error:', error);
    res.status(error.status || 500).json({
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
  authorize('admin', 'super_admin'),
  body('reason').isString().trim().isLength({ min: 3, max: 500 }).withMessage('A reversal reason is required')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });
    const { paymentId } = req.params;
    const { reason } = req.body;

    const client = await db.pool.connect();
    let payment;
    let reversalId;
    try {
      await client.query('BEGIN');
      const paymentResult = await client.query(`
        SELECT *
        FROM payment_transactions
        WHERE id = $1
        FOR UPDATE
      `, [paymentId]);
      if (!paymentResult.rows.length) {
        await client.query('ROLLBACK');
        return res.status(404).json({ success: false, message: 'Payment not found' });
      }
      payment = paymentResult.rows[0];
      const reversal = await reversePayment(client, {
        transactionId: paymentId,
        recordedBy: req.user.id,
        description: `Admin reversal of payment ${paymentId}: ${reason}`,
      });
      if (reversal.alreadyReversed) {
        const error = new Error('Payment was already reversed');
        error.status = 409;
        throw error;
      }
      reversalId = reversal.reversalId;
      await logAudit({
        userId: req.user.id,
        userName: `${req.user.first_name || ''} ${req.user.last_name || ''}`.trim(),
        userRole: req.user.role,
        action: 'manual_payment_reverse',
        entityType: 'payment',
        entityId: parseInt(paymentId),
        details: {
          summary: `Payment #${paymentId} reversed (R${payment.amount})`,
          student_id: payment.student_id,
          invoice_id: payment.invoice_id,
          original_transaction_id: Number(paymentId),
          reversal_transaction_id: reversalId,
          amount: payment.amount,
          month: payment.month,
          year: payment.year,
          method: payment.payment_method,
          reason,
        },
        ipAddress: getIp(req),
        executor: client,
        required: true,
      });
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    await notifyPayment({
      kind: 'reversed',
      paymentId: reversalId,
      learnerId: payment.student_id,
      amount: Math.abs(Number(payment.amount)),
    });

    res.json({
      success: true,
      message: 'Payment reversed successfully',
      reversal_transaction_id: reversalId
    });

  } catch (error) {
    console.error('Delete payment error:', error);
    res.status(error.status || 500).json({
      success: false,
      message: 'Failed to reverse payment',
      error: error.message
    });
  }
});

/**
 * Apply an existing unallocated payment to one exact outstanding invoice.
 * The original event is reversed and a replacement allocation is created;
 * neither event is overwritten or deleted.
 */
router.post('/manual-payment/:paymentId/apply', [
  authenticate,
  authorize('admin', 'super_admin'),
  body('invoice_id').isInt({ min: 1 }).withMessage('Invoice is required'),
  body('reason').isString().trim().isLength({ min: 3, max: 500 }).withMessage('An allocation reason is required')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

    const paymentId = Number(req.params.paymentId);
    const invoiceId = Number(req.body.invoice_id);
    const reason = req.body.reason;
    const client = await db.pool.connect();
    let original;
    let reversalId;
    let replacement;
    let replacementTransactionIds = [];
    try {
      await client.query('BEGIN');
      const originalResult = await client.query(`
        SELECT * FROM payment_transactions
        WHERE id = $1
        FOR UPDATE
      `, [paymentId]);
      if (!originalResult.rows.length) {
        const error = new Error('Payment not found');
        error.status = 404;
        throw error;
      }
      original = originalResult.rows[0];
      if (original.invoice_id != null || Number(original.amount) <= 0 || original.reverses_transaction_id != null) {
        const error = new Error('Only a positive unallocated payment can be applied');
        error.status = 409;
        throw error;
      }
      const invoiceResult = await client.query(`
        SELECT id FROM invoices
        WHERE id = $1 AND student_id = $2
          AND status IN ('Unpaid', 'Partial')
          AND amount_paid < amount_due
        FOR UPDATE
      `, [invoiceId, original.student_id]);
      if (!invoiceResult.rows.length) {
        const error = new Error('Selected invoice is not an outstanding invoice for this learner');
        error.status = 409;
        throw error;
      }

      const reversal = await reversePayment(client, {
        transactionId: paymentId,
        recordedBy: req.user.id,
        description: `Reallocation reversal for payment ${paymentId}: ${reason}`,
      });
      if (reversal.alreadyReversed) {
        const error = new Error('Payment was already reversed');
        error.status = 409;
        throw error;
      }
      reversalId = reversal.reversalId;
      const allocation = await allocatePayment(client, {
        studentId: original.student_id,
        amount: Number(original.amount),
        paymentDate: original.payment_date || original.transaction_date,
        paymentMethod: original.payment_method || 'manual_entry',
        reference: original.reference || original.reference_number,
        description: `Reallocated from payment ${paymentId}: ${original.description || reason}`,
        recordedBy: req.user.id,
        invoiceId,
        transactionMonth: original.month,
        transactionYear: original.year,
      });
      replacement = allocation.allocations[0] || null;
      replacementTransactionIds = allocation.allocations.map((item) => item.transactionId);
      if (!replacement || replacement.invoiceId !== invoiceId) {
        throw new Error('Payment could not be applied to the selected invoice');
      }
      await logAudit({
        userId: req.user.id,
        userName: `${req.user.first_name || ''} ${req.user.last_name || ''}`.trim(),
        userRole: req.user.role,
        action: 'manual_payment_reallocated',
        entityType: 'payment',
        entityId: paymentId,
        details: {
          summary: `Unallocated payment #${paymentId} applied to invoice #${invoiceId}`,
          student_id: original.student_id,
          invoice_id: invoiceId,
          original_transaction_id: paymentId,
          reversal_transaction_id: reversalId,
          replacement_transaction_ids: replacementTransactionIds,
          amount: Number(original.amount),
          reason,
        },
        ipAddress: getIp(req),
        executor: client,
        required: true,
      });
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    await notifyPayment({
      kind: 'adjusted',
      paymentId: replacement.transactionId,
      learnerId: original.student_id,
      amount: original.amount,
    });

    res.json({
      success: true,
      message: 'Unallocated payment applied successfully',
      original_transaction_id: paymentId,
      reversal_transaction_id: reversalId,
      replacement_transaction_ids: replacementTransactionIds,
      invoice_id: invoiceId,
    });
  } catch (error) {
    console.error('Apply unallocated payment error:', error);
    res.status(error.status || 500).json({
      success: false,
      message: error.message || 'Failed to apply unallocated payment',
    });
  }
});

/**
 * Apply payment manually using arrears-first logic
 * Finds all unpaid invoices for a student, applies oldest first.
 */
router.post('/manual-payment/apply-arrears-first', [
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
    if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

    const { student_id, amount, payment_date, description, reference } = req.body;

    const studentResult = await db.query(
      'SELECT id, first_name, last_name, student_number FROM users WHERE id=$1 AND role=$2',
      [student_id, 'student']
    );
    if (!studentResult.rows.length) return res.status(404).json({ success: false, message: 'Student not found' });
    const student = studentResult.rows[0];

    const refValue    = reference || `MANUAL-${Date.now()}`;
    const client      = await db.pool.connect();
    let allocations;

    try {
      await client.query('BEGIN');

      const allocationResult = await allocatePayment(client, {
        studentId: student_id,
        amount,
        paymentDate: payment_date,
        paymentMethod: 'manual_entry',
        reference: refValue,
        description: description || 'Manual payment',
        recordedBy: req.user.id,
      });
      allocations = allocationResult.allocations.map((allocation) => ({
        transactionId: allocation.transactionId,
        invoiceId: allocation.invoiceId,
        reference: allocation.reference,
        dueDate: allocation.dueDate,
        status: allocation.status,
        appliedAmount: allocation.amount,
        isArrears: allocation.dueDate
          ? new Date(allocation.dueDate).getUTCFullYear() < new Date().getUTCFullYear()
          : false,
      }));

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    const arrearsAllocations = allocations.filter(a => a.isArrears);
    const currentAllocations = allocations.filter(a => !a.isArrears && a.invoiceId != null);
    const totalApplied = allocations
      .filter((allocation) => allocation.invoiceId != null)
      .reduce((sum, allocation) => sum + allocation.appliedAmount, 0);

    const summaryMsg = arrearsAllocations.length > 0
      ? `R${parseFloat(amount).toFixed(2)} applied: R${arrearsAllocations.reduce((s,a)=>s+a.appliedAmount,0).toFixed(2)} to previous-year arrears${currentAllocations.length ? `, R${currentAllocations.reduce((s,a)=>s+a.appliedAmount,0).toFixed(2)} to current year` : ''}`
      : `R${parseFloat(amount).toFixed(2)} applied across ${currentAllocations.length} invoice(s)`;

    await logAudit({
      userId: req.user.id, userName: `${req.user.first_name || ''} ${req.user.last_name || ''}`.trim(),
      userRole: req.user.role, action: 'manual_payment_arrears',
      entityType: 'payment', entityId: null,
      details: {
        summary: summaryMsg, student: `${student.first_name} ${student.last_name}`,
        student_number: student.student_number, amount: parseFloat(amount),
        invoices_updated: allocations.filter((allocation) => allocation.invoiceId != null).length,
        arrears_invoices: arrearsAllocations.length,
        current_invoices: currentAllocations.length
      },
      ipAddress: getIp(req)
    });
    await Promise.allSettled(allocations
      .filter((allocation) => allocation.transactionId != null)
      .map((allocation) => notifyPayment({
        kind: 'applied',
        paymentId: allocation.transactionId,
        learnerId: student.id,
        amount: allocation.appliedAmount,
      })));

    res.json({
      success: true,
      message: summaryMsg,
      allocations,
      arrearsCount:  arrearsAllocations.length,
      currentCount:  currentAllocations.length,
      totalApplied,
      student: { id: student.id, name: `${student.first_name} ${student.last_name}`, studentNumber: student.student_number }
    });

  } catch (error) {
    console.error('Apply arrears-first error:', error);
    res.status(500).json({ success: false, message: 'Failed to apply payment', error: error.message });
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

/**
 * Allocate an unmatched payment directly to a student from the results screen
 */
router.post('/allocate-unmatched', [
  authenticate,
  authorize('admin', 'super_admin')
], async (req, res) => {
  try {
    const { student_id, amount, date, description } = req.body;
    if (!student_id || !amount || parseFloat(amount) <= 0) {
      return res.status(400).json({ success: false, message: 'student_id and amount are required' });
    }

    const studentResult = await db.query(
      'SELECT id, first_name, last_name, student_number FROM users WHERE id = $1 AND role = $2 AND is_active = true',
      [student_id, 'student']
    );
    if (studentResult.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Student not found' });
    }
    const student = studentResult.rows[0];
    const adminId = req.user.id;
    const client = await db.pool.connect();
    let allocation;
    try {
      await client.query('BEGIN');
      allocation = await allocatePayment(client, {
        studentId: student_id,
        amount,
        paymentDate: date || new Date().toISOString().split('T')[0],
        paymentMethod: 'bank_statement',
        description: description || 'Allocated from unmatched bank statement payment',
        recordedBy: adminId,
      });
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    const txIds = allocation.allocations.map((item) => ({
      id: item.transactionId,
      amount: item.amount,
    }));

    console.log(`✅ Unmatched payment allocated: R${amount} → ${student.first_name} ${student.last_name}`);
    await logAudit({
      userId: adminId,
      userName: `${req.user.first_name || ''} ${req.user.last_name || ''}`.trim(),
      userRole: req.user.role,
      action: 'unmatched_payment_allocated',
      entityType: 'payment',
      entityId: txIds[0]?.id || null,
      details: {
        student_id: student.id,
        student_number: student.student_number,
        amount: parseFloat(amount),
        allocations: txIds,
      },
      ipAddress: getIp(req),
    });
    await Promise.allSettled(txIds.map((transaction) => notifyPayment({
      kind: 'applied',
      paymentId: transaction.id,
      learnerId: student.id,
      amount: transaction.amount,
    })));
    return res.json({
      success: true,
      message: `R${parseFloat(amount).toFixed(2)} allocated to ${student.first_name} ${student.last_name}`,
      student: { id: student.id, name: `${student.first_name} ${student.last_name}`, studentNumber: student.student_number }
    });
  } catch (error) {
    console.error('Allocate unmatched error:', error);
    return res.status(500).json({ success: false, message: 'Failed to allocate payment', error: error.message });
  }
});

module.exports = router;
