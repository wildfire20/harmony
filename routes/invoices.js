const express = require('express');
const multer = require('multer');
const csv = require('csv-parser');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { body, validationResult } = require('express-validator');
const db = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');

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

// Generate monthly invoices for all active students
router.post('/generate-monthly', [
  authenticate,
  authorize('admin', 'super_admin'),
  body('month').isInt({ min: 1, max: 12 }),
  body('year').isInt({ min: 2020, max: 2030 }),
  body('amountDue').isFloat({ min: 0 })
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { month, year, amountDue } = req.body;
    const dueDate = new Date(year, month, 0); // Due on last day of the month (month is 1-based, so month with day 0 = last day of that month)

    console.log('Generating monthly invoices:', { month, year, amountDue });

    // Get all active students from users table
    const studentsResult = await db.query(`
      SELECT u.id, u.student_number, u.first_name, u.last_name, u.grade_id, u.class_id
      FROM users u
      WHERE u.role = 'student' AND u.is_active = true
    `);

    const students = studentsResult.rows;
    console.log(`Found ${students.length} active students`);

    if (students.length === 0) {
      return res.status(400).json({ message: 'No active students found' });
    }

    // Check if invoices already exist for this month/year
    const existingInvoicesResult = await db.query(`
      SELECT COUNT(*) as count FROM invoices 
      WHERE EXTRACT(MONTH FROM due_date) = $1 AND EXTRACT(YEAR FROM due_date) = $2
    `, [month, year]);

    if (parseInt(existingInvoicesResult.rows[0].count) > 0) {
      return res.status(400).json({ 
        message: `Invoices for ${month}/${year} already exist. Use update endpoint to modify existing invoices.` 
      });
    }

    // Generate invoices for all students
    const invoicePromises = students.map(student => {
      const referenceNumber = student.student_number;
      
      return db.query(`
        INSERT INTO invoices (
          student_id, student_number, amount_due, due_date, status, 
          reference_number, created_by, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
        RETURNING *
      `, [
        student.id,
        student.student_number,
        amountDue,
        dueDate,
        'Unpaid',
        referenceNumber,
        req.user.id
      ]);
    });

    const invoiceResults = await Promise.all(invoicePromises);
    const createdInvoices = invoiceResults.map(result => result.rows[0]);

    console.log(`Successfully created ${createdInvoices.length} invoices`);

    res.status(201).json({
      success: true,
      message: `Successfully generated ${createdInvoices.length} invoices for ${month}/${year}`,
      invoices: createdInvoices,
      summary: {
        totalStudents: students.length,
        invoicesCreated: createdInvoices.length,
        totalAmount: createdInvoices.length * amountDue,
        month,
        year,
        dueDate
      }
    });

  } catch (error) {
    console.error('Generate invoices error:', error);
    res.status(500).json({ 
      success: false,
      message: 'Failed to generate invoices',
      error: error.message 
    });
  }
});

// Get all invoices with filtering and pagination
router.get('/', [
  authenticate,
  authorize('admin', 'super_admin')
], async (req, res) => {
  try {
    const { 
      status, 
      month, 
      year, 
      studentNumber, 
      page = 1, 
      limit = 50,
      sortBy = 'due_date',
      sortOrder = 'DESC'
    } = req.query;

    // First, let's get the total count of active students
    const studentCountQuery = `
      SELECT COUNT(*) as total_students
      FROM users 
      WHERE role = 'student' AND is_active = true
    `;
    const studentCountResult = await db.query(studentCountQuery);
    const totalStudents = parseInt(studentCountResult.rows[0].total_students);

    // Get invoices query - corrected to use users table
    let query = `
      SELECT 
        i.id, i.student_id, i.student_number, i.amount_due, i.amount_paid, 
        i.outstanding_balance, i.overpaid_amount, i.due_date, i.status, 
        i.reference_number, i.created_at, i.updated_at,
        u.first_name, u.last_name, u.grade_id, u.class_id,
        g.name as grade_name, c.name as class_name
      FROM invoices i
      LEFT JOIN users u ON i.student_id = u.id
      LEFT JOIN grades g ON u.grade_id = g.id
      LEFT JOIN classes c ON u.class_id = c.id
      WHERE 1=1
    `;

    const queryParams = [];
    let paramCount = 0;

    // Add filters
    if (status) {
      paramCount++;
      query += ` AND i.status = $${paramCount}`;
      queryParams.push(status);
    }

    if (month && year) {
      paramCount++;
      query += ` AND EXTRACT(MONTH FROM i.due_date) = $${paramCount}`;
      queryParams.push(parseInt(month));
      
      paramCount++;
      query += ` AND EXTRACT(YEAR FROM i.due_date) = $${paramCount}`;
      queryParams.push(parseInt(year));
    }

    if (studentNumber) {
      paramCount++;
      query += ` AND i.student_number ILIKE $${paramCount}`;
      queryParams.push(`%${studentNumber}%`);
    }

    // Add sorting
    const allowedSortFields = ['due_date', 'amount_due', 'status', 'student_number', 'created_at'];
    const validSortBy = allowedSortFields.includes(sortBy) ? sortBy : 'due_date';
    const validSortOrder = ['ASC', 'DESC'].includes(sortOrder.toUpperCase()) ? sortOrder.toUpperCase() : 'DESC';
    
    query += ` ORDER BY i.${validSortBy} ${validSortOrder}`;

    // Add pagination
    const offset = (parseInt(page) - 1) * parseInt(limit);
    paramCount++;
    query += ` LIMIT $${paramCount}`;
    queryParams.push(parseInt(limit));
    
    paramCount++;
    query += ` OFFSET $${paramCount}`;
    queryParams.push(offset);

    console.log('Invoices query:', query);
    console.log('Query params:', queryParams);

    const result = await db.query(query, queryParams);
    
    // Get total count for pagination
    let countQuery = `
      SELECT COUNT(*) as total 
      FROM invoices i
      LEFT JOIN users u ON i.student_id = u.id
      WHERE 1=1
    `;
    
    const countParams = [];
    let countParamIndex = 0;

    if (status) {
      countParamIndex++;
      countQuery += ` AND i.status = $${countParamIndex}`;
      countParams.push(status);
    }

    if (month && year) {
      countParamIndex++;
      countQuery += ` AND EXTRACT(MONTH FROM i.due_date) = $${countParamIndex}`;
      countParams.push(parseInt(month));
      
      countParamIndex++;
      countQuery += ` AND EXTRACT(YEAR FROM i.due_date) = $${countParamIndex}`;
      countParams.push(parseInt(year));
    }

    if (studentNumber) {
      countParamIndex++;
      countQuery += ` AND i.student_number ILIKE $${countParamIndex}`;
      countParams.push(`%${studentNumber}%`);
    }

    const countResult = await db.query(countQuery, countParams);
    const totalInvoices = parseInt(countResult.rows[0].total);

    // Calculate summary statistics
    const summaryQuery = `
      SELECT 
        COUNT(*) as total_invoices,
        SUM(CASE WHEN status = 'Paid' THEN 1 ELSE 0 END) as paid_count,
        SUM(CASE WHEN status = 'Unpaid' THEN 1 ELSE 0 END) as unpaid_count,
        SUM(CASE WHEN status = 'Partial' THEN 1 ELSE 0 END) as partial_count,
        SUM(CASE WHEN status = 'Overpaid' THEN 1 ELSE 0 END) as overpaid_count,
        SUM(amount_due) as total_amount_due,
        SUM(amount_paid) as total_amount_paid,
        SUM(outstanding_balance) as total_outstanding
      FROM invoices i
      LEFT JOIN users u ON i.student_id = u.id
      WHERE 1=1
      ${status ? `AND i.status = '${status}'` : ''}
      ${month && year ? `AND EXTRACT(MONTH FROM i.due_date) = ${month} AND EXTRACT(YEAR FROM i.due_date) = ${year}` : ''}
      ${studentNumber ? `AND i.student_number ILIKE '%${studentNumber}%'` : ''}
    `;

    const summaryResult = await db.query(summaryQuery);
    const summary = summaryResult.rows[0];

    res.json({
      success: true,
      invoices: result.rows,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(totalInvoices / parseInt(limit)),
        totalInvoices,
        limit: parseInt(limit)
      },
      summary: {
        totalStudents, // Add total students count here
        totalInvoices: parseInt(summary.total_invoices),
        paidCount: parseInt(summary.paid_count),
        unpaidCount: parseInt(summary.unpaid_count),
        partialCount: parseInt(summary.partial_count),
        overpaidCount: parseInt(summary.overpaid_count),
        totalAmountDue: parseFloat(summary.total_amount_due) || 0,
        totalAmountPaid: parseFloat(summary.total_amount_paid) || 0,
        totalOutstanding: parseFloat(summary.total_outstanding) || 0
      }
    });

  } catch (error) {
    console.error('Get invoices error:', error);
    res.status(500).json({ 
      success: false,
      message: 'Failed to fetch invoices',
      error: error.message 
    });
  }
});

// Upload and process bank statement CSV
router.post('/process-bank-statement', [
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

    console.log('Processing bank statement:', req.file.filename);

    const transactions = [];
    const errors = [];
    const results = {
      matched: [],
      partial: [],
      overpaid: [],
      unmatched: [],
      duplicates: [],
      errors: []
    };

    // Parse CSV file with enhanced column detection
    await new Promise((resolve, reject) => {
      let headerProcessed = false;
      let columnMapping = {};
      
      fs.createReadStream(req.file.path)
        .pipe(csv())
        .on('headers', (headers) => {
          console.log('CSV Headers detected:', headers);
          
          // Create flexible column mapping
          headers.forEach((header, index) => {
            const normalizedHeader = header.toLowerCase().trim();
            
            // Map reference variations
            if (normalizedHeader.includes('ref') || 
                normalizedHeader.includes('student') || 
                normalizedHeader.includes('number') ||
                normalizedHeader === 'id') {
              columnMapping.reference = header;
            }
            
            // Map amount variations
            if (normalizedHeader.includes('amount') || 
                normalizedHeader.includes('value') || 
                normalizedHeader.includes('sum') ||
                normalizedHeader.includes('total') ||
                normalizedHeader.includes('payment')) {
              columnMapping.amount = header;
            }
            
            // Map date variations
            if (normalizedHeader.includes('date') || 
                normalizedHeader.includes('time') ||
                normalizedHeader.includes('when')) {
              columnMapping.date = header;
            }
            
            // Map description variations
            if (normalizedHeader.includes('desc') || 
                normalizedHeader.includes('note') || 
                normalizedHeader.includes('comment') ||
                normalizedHeader.includes('detail') ||
                normalizedHeader.includes('memo')) {
              columnMapping.description = header;
            }
          });
          
          console.log('Column mapping:', columnMapping);
        })
        .on('data', (row) => {
          try {
            // Skip empty rows
            const rowValues = Object.values(row).filter(val => val && val.trim());
            if (rowValues.length === 0) {
              return;
            }
            
            console.log('Processing row:', row);
            
            // Extract data using flexible mapping
            let reference = '';
            let amount = 0;
            let date = null;
            let description = '';
            
            // Try to find reference
            if (columnMapping.reference) {
              reference = row[columnMapping.reference];
            } else {
              // Fallback: look for any field that looks like a reference
              const possibleRefs = Object.keys(row).filter(key => 
                key.toLowerCase().includes('ref') || 
                key.toLowerCase().includes('student') ||
                key.toLowerCase().includes('number')
              );
              if (possibleRefs.length > 0) {
                reference = row[possibleRefs[0]];
              }
            }
            
            // Try to find amount
            if (columnMapping.amount) {
              let amountStr = row[columnMapping.amount];
              // Clean the amount string - remove commas, spaces, and currency symbols
              amountStr = amountStr.toString().replace(/[,\s]/g, '').replace(/[^\d.-]/g, '');
              amount = parseFloat(amountStr);
              console.log(`Amount parsing: "${row[columnMapping.amount]}" -> "${amountStr}" -> ${amount}`);
            } else {
              // Fallback: look for any numeric field that could be amount
              for (const [key, value] of Object.entries(row)) {
                let cleanValue = value.toString().replace(/[,\s]/g, '').replace(/[^\d.-]/g, '');
                const numValue = parseFloat(cleanValue);
                if (!isNaN(numValue) && numValue > 0) {
                  amount = numValue;
                  console.log(`Fallback amount parsing: "${value}" -> "${cleanValue}" -> ${numValue}`);
                  break;
                }
              }
            }
            
            // Try to find date
            if (columnMapping.date) {
              date = new Date(row[columnMapping.date]);
            } else {
              // Fallback: look for any field that looks like a date
              const possibleDates = Object.keys(row).filter(key => 
                key.toLowerCase().includes('date') || 
                key.toLowerCase().includes('time')
              );
              if (possibleDates.length > 0) {
                date = new Date(row[possibleDates[0]]);
              }
            }
            
            // Description is optional
            if (columnMapping.description) {
              description = row[columnMapping.description] || '';
            }
            
            // Clean and validate reference
            reference = String(reference || '').trim();
            
            // If no clear reference found, try to extract from description
            if (!reference && description) {
              // Look for patterns like "Grade X", "Gr X", student names, etc.
              const descLower = description.toLowerCase();
              
              // Try to extract student number patterns
              const studentNumMatch = description.match(/\b\d{6,7}\b/); // 6-7 digit student numbers
              if (studentNumMatch) {
                reference = studentNumMatch[0];
              }
              // Try to extract grade references that might map to student numbers
              else if (descLower.includes('grade') || descLower.includes('gr')) {
                // Extract names before "Grade" or "Gr"
                const nameMatch = description.match(/([A-Za-z\s]+)\s+(Grade?|Gr\.?)/i);
                if (nameMatch) {
                  reference = nameMatch[1].trim();
                }
              }
              // Last resort: use the full description as reference for manual review
              else {
                reference = description.trim();
              }
            }
            
            // Validate transaction data
            if (!reference) {
              errors.push(`Missing reference in row: ${JSON.stringify(row)}`);
              return;
            }
            
            if (isNaN(amount) || amount <= 0) {
              errors.push(`Invalid amount in row: ${JSON.stringify(row)}`);
              return;
            }
            
            if (!date || isNaN(date.getTime())) {
              // Try current date as fallback
              date = new Date();
              console.log('Using current date as fallback for row:', row);
            }

            const transaction = {
              reference,
              amount,
              date,
              description: String(description || '').trim()
            };
            
            console.log('Parsed transaction:', transaction);
            transactions.push(transaction);
            
          } catch (error) {
            console.error('Error parsing row:', error);
            errors.push(`Error parsing row: ${JSON.stringify(row)} - ${error.message}`);
          }
        })
        .on('end', resolve)
        .on('error', reject);
    });

    console.log(`Parsed ${transactions.length} transactions from CSV`);
    console.log('Sample transactions:', transactions.slice(0, 3));
    console.log('Parsing errors:', errors);

    if (transactions.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No valid transactions found in CSV file',
        errors,
        debug: {
          fileSize: req.file.size,
          fileName: req.file.filename,
          mimetype: req.file.mimetype
        }
      });
    }

    // Process each transaction with better error handling
    console.log('Starting transaction processing...');
    
    for (const transaction of transactions) {
      // Start a database transaction for each payment
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

        // Find matching invoice with improved reference matching
        console.log(`Looking for invoice with reference: "${transaction.reference}"`);
        
        // Try exact match first
        let invoiceResult = await client.query(`
          SELECT * FROM invoices 
          WHERE reference_number = $1 AND status IN ('Unpaid', 'Partial')
          ORDER BY due_date ASC
          LIMIT 1
        `, [transaction.reference]);

        // If no exact match, try normalized matching
        if (invoiceResult.rows.length === 0) {
          // Normalize reference number (pad with zeros for numeric values)
          const normalizedRef = transaction.reference.toString().padStart(3, '0');
          console.log(`Trying normalized reference: "${normalizedRef}"`);
          
          invoiceResult = await client.query(`
            SELECT * FROM invoices 
            WHERE reference_number = $1 AND status IN ('Unpaid', 'Partial')
            ORDER BY due_date ASC
            LIMIT 1
          `, [normalizedRef]);
        }

        // If still no match, try removing leading zeros
        if (invoiceResult.rows.length === 0) {
          const trimmedRef = transaction.reference.toString().replace(/^0+/, '') || '0';
          console.log(`Trying trimmed reference: "${trimmedRef}"`);
          
          invoiceResult = await client.query(`
            SELECT * FROM invoices 
            WHERE reference_number = $1 AND status IN ('Unpaid', 'Partial')
            ORDER BY due_date ASC
            LIMIT 1
          `, [trimmedRef]);
        }

        // Debug: Show available references if no match found
        if (invoiceResult.rows.length === 0) {
          const availableRefs = await client.query(`
            SELECT reference_number, status FROM invoices 
            WHERE status IN ('Unpaid', 'Partial') 
            LIMIT 10
          `);
          console.log('Available invoice references:', availableRefs.rows.map(r => r.reference_number));
        }

        if (invoiceResult.rows.length === 0) {
          // For unmatched transactions, just count them (don't insert to DB due to NOT NULL constraints)
          console.log(`UNMATCHED: Transaction ${transaction.reference} - ${transaction.description}`);
          
          await client.query('COMMIT');
          
          // Add to results AFTER successful commit
          results.unmatched.push({
            ...transaction,
            reason: 'No matching invoice found'
          });
          continue;
        }

        const invoice = invoiceResult.rows[0];
        const outstandingAmount = invoice.outstanding_balance || invoice.amount_due;

        console.log(`Invoice found: ${invoice.reference_number}`);
        console.log(`Invoice amount_due: ${invoice.amount_due}, amount_paid: ${invoice.amount_paid || 0}`);
        console.log(`Outstanding amount: ${outstandingAmount}`);
        console.log(`Transaction amount: ${transaction.amount} (type: ${typeof transaction.amount})`);

        // Determine payment status
        let newStatus, amountPaid, newOutstanding, overpaidAmount;
        let resultCategory = null;

        // Ensure numeric values for calculations
        const currentAmountPaid = parseFloat(invoice.amount_paid || 0);
        const transactionAmount = parseFloat(transaction.amount);
        const outstandingAmountNum = parseFloat(outstandingAmount);

        if (transactionAmount >= outstandingAmountNum) {
          // Full payment or overpayment
          if (transactionAmount === outstandingAmountNum) {
            newStatus = 'Paid';
            amountPaid = currentAmountPaid + transactionAmount;
            newOutstanding = 0;
            overpaidAmount = 0;
            console.log(`MATCHED: Exact payment of ${transactionAmount} for invoice ${invoice.reference_number}, new amount_paid: ${amountPaid}`);
            resultCategory = 'matched';
          } else {
            newStatus = 'Overpaid';
            amountPaid = currentAmountPaid + transactionAmount;
            newOutstanding = 0;
            // FIXED: Calculate overpaid amount based on total amount paid vs total amount due
            overpaidAmount = amountPaid - parseFloat(invoice.amount_due);
            console.log(`OVERPAID: Total payment of ${amountPaid} exceeds amount due ${invoice.amount_due} by ${overpaidAmount} for invoice ${invoice.reference_number}`);
            resultCategory = 'overpaid';
          }
        } else {
          // Partial payment
          newStatus = 'Partial';
          amountPaid = currentAmountPaid + transactionAmount;
          newOutstanding = outstandingAmountNum - transactionAmount;
          overpaidAmount = 0;
          console.log(`PARTIAL: Payment of ${transactionAmount} is less than outstanding ${outstandingAmountNum}, remaining: ${newOutstanding} for invoice ${invoice.reference_number}`);
          resultCategory = 'partial';
        }

        // Update invoice - only update fields we can modify (not computed columns)
        console.log(`Updating invoice ${invoice.id} with status: ${newStatus}, amount_paid: ${amountPaid} (type: ${typeof amountPaid})`);
        
        // Ensure amountPaid is a proper number with 2 decimal places
        const properAmountPaid = Math.round(amountPaid * 100) / 100;
        console.log(`Properly formatted values - amount_paid: ${properAmountPaid}`);
        
        const updateResult = await client.query(`
          UPDATE invoices SET 
            status = $1, 
            amount_paid = $2::DECIMAL(10,2),
            updated_at = NOW()
          WHERE id = $3
          RETURNING id, status, amount_paid, outstanding_balance, overpaid_amount
        `, [newStatus, properAmountPaid, invoice.id]);
        
        console.log('Invoice update result:', updateResult.rows[0]);

        // Record transaction
        console.log(`Recording transaction for invoice ${invoice.id}`);
        
        const transactionResult = await client.query(`
          INSERT INTO payment_transactions (
            invoice_id, student_id, student_number, reference_number, amount, payment_date,
            description
          ) VALUES ($1, $2, $3, $4, $5, $6, $7)
          RETURNING id
        `, [
          invoice.id,
          invoice.student_id,
          invoice.student_number,
          transaction.reference,
          transaction.amount,
          transaction.date,
          transaction.description
        ]);
        
        console.log('Transaction recorded with ID:', transactionResult.rows[0].id);
        
        // Commit the transaction
        await client.query('COMMIT');
        console.log(`Successfully processed transaction for ${transaction.reference}`);

        // Add to results AFTER successful commit
        if (resultCategory === 'matched') {
          results.matched.push({ ...transaction, invoice: invoice.reference_number });
        } else if (resultCategory === 'overpaid') {
          results.overpaid.push({ 
            ...transaction, 
            invoice: invoice.reference_number,
            overpaidAmount 
          });
        } else if (resultCategory === 'partial') {
          results.partial.push({ 
            ...transaction, 
            invoice: invoice.reference_number,
            remainingBalance: newOutstanding 
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

    // Log upload activity - match actual database schema
    try {
      await db.query(`
        INSERT INTO payment_upload_logs (
          filename, uploaded_by, transactions_processed, 
          matched_count, partial_count, overpaid_count,
          unmatched_count, duplicate_count, error_count
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      `, [
        req.file.filename,
        req.user.id,
        transactions.length,
        results.matched.length,
        results.partial.length,
        results.overpaid.length,
        results.unmatched.length,
        results.duplicates.length,
        results.errors.length
      ]);
      console.log('Upload log recorded successfully');
    } catch (logError) {
      console.error('Failed to log upload activity:', logError);
      // Don't fail the entire process if logging fails
    }

    // Clean up uploaded file
    fs.unlinkSync(req.file.path);

    console.log('\n=== PROCESSING RESULTS SUMMARY ===');
    console.log(`Total transactions processed: ${transactions.length}`);
    console.log(`Matched: ${results.matched.length}`);
    console.log(`Partial: ${results.partial.length}`);
    console.log(`Overpaid: ${results.overpaid.length}`);
    console.log(`Unmatched: ${results.unmatched.length}`);
    console.log(`Duplicates: ${results.duplicates.length}`);
    console.log(`Errors: ${results.errors.length}`);
    console.log('=====================================\n');

    res.json({
      success: true,
      message: `Processed ${transactions.length} transactions successfully`,
      summary: {
        totalProcessed: transactions.length,
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
    console.error('Bank statement processing error:', error);
    console.error('Error stack:', error.stack);
    
    // Clean up uploaded file if it exists
    if (req.file && fs.existsSync(req.file.path)) {
      try {
        fs.unlinkSync(req.file.path);
        console.log('Cleaned up uploaded file');
      } catch (cleanupError) {
        console.error('Error cleaning up file:', cleanupError);
      }
    }

    res.status(500).json({
      success: false,
      message: 'Failed to process bank statement',
      error: error.message,
      debug: {
        fileName: req.file?.filename,
        fileSize: req.file?.size,
        errorType: error.constructor.name,
        errorStack: error.stack
      }
    });
  }
});

// Get payment transactions with filtering
router.get('/transactions', [
  authenticate,
  authorize('admin', 'super_admin')
], async (req, res) => {
  try {
    const { 
      status, 
      referenceNumber, 
      dateFrom, 
      dateTo,
      page = 1, 
      limit = 50 
    } = req.query;

    let query = `
      SELECT 
        pt.id, pt.invoice_id, pt.reference_number, pt.amount, 
        pt.payment_date, pt.description, pt.created_at,
        i.student_number, i.amount_due, i.status as invoice_status,
        s.first_name, s.last_name
      FROM payment_transactions pt
      LEFT JOIN invoices i ON pt.invoice_id = i.id
      LEFT JOIN students s ON i.student_id = s.id
      WHERE 1=1
    `;

    const queryParams = [];
    let paramCount = 0;

    if (status) {
      paramCount++;
      query += ` AND pt.status = $${paramCount}`;
      queryParams.push(status);
    }

    if (referenceNumber) {
      paramCount++;
      query += ` AND pt.reference_number ILIKE $${paramCount}`;
      queryParams.push(`%${referenceNumber}%`);
    }

    if (dateFrom) {
      paramCount++;
      query += ` AND pt.payment_date >= $${paramCount}`;
      queryParams.push(dateFrom);
    }

    if (dateTo) {
      paramCount++;
      query += ` AND pt.payment_date <= $${paramCount}`;
      queryParams.push(dateTo);
    }

    query += ` ORDER BY pt.payment_date DESC, pt.created_at DESC`;

    // Add pagination
    const offset = (parseInt(page) - 1) * parseInt(limit);
    paramCount++;
    query += ` LIMIT $${paramCount}`;
    queryParams.push(parseInt(limit));
    
    paramCount++;
    query += ` OFFSET $${paramCount}`;
    queryParams.push(offset);

    const result = await db.query(query, queryParams);

    // Get total count
    let countQuery = `SELECT COUNT(*) as total FROM payment_transactions pt WHERE 1=1`;
    const countParams = [];
    let countParamIndex = 0;

    if (status) {
      countParamIndex++;
      countQuery += ` AND pt.status = $${countParamIndex}`;
      countParams.push(status);
    }

    if (referenceNumber) {
      countParamIndex++;
      countQuery += ` AND pt.reference_number ILIKE $${countParamIndex}`;
      countParams.push(`%${referenceNumber}%`);
    }

    if (dateFrom) {
      countParamIndex++;
      countQuery += ` AND pt.payment_date >= $${countParamIndex}`;
      countParams.push(dateFrom);
    }

    if (dateTo) {
      countParamIndex++;
      countQuery += ` AND pt.payment_date <= $${countParamIndex}`;
      countParams.push(dateTo);
    }

    const countResult = await db.query(countQuery, countParams);
    const totalTransactions = parseInt(countResult.rows[0].total);

    res.json({
      success: true,
      transactions: result.rows,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(totalTransactions / parseInt(limit)),
        totalTransactions,
        limit: parseInt(limit)
      }
    });

  } catch (error) {
    console.error('Get transactions error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch transactions',
      error: error.message
    });
  }
});

// Export invoices to CSV
router.get('/export/csv', [
  authenticate,
  authorize('admin', 'super_admin')
], async (req, res) => {
  try {
    const { status, month, year } = req.query;

    let query = `
      SELECT 
        i.reference_number, u.first_name, u.last_name, i.student_number,
        i.amount_due, i.amount_paid, i.outstanding_balance, i.overpaid_amount,
        i.due_date, i.status, i.created_at, i.updated_at,
        g.name as grade_name, c.name as class_name
      FROM invoices i
      LEFT JOIN users u ON i.student_id = u.id
      LEFT JOIN grades g ON u.grade_id = g.id
      LEFT JOIN classes c ON u.class_id = c.id
      WHERE 1=1
    `;

    const queryParams = [];
    let paramCount = 0;

    if (status) {
      paramCount++;
      query += ` AND i.status = $${paramCount}`;
      queryParams.push(status);
    }

    if (month && year) {
      paramCount++;
      query += ` AND EXTRACT(MONTH FROM i.due_date) = $${paramCount}`;
      queryParams.push(parseInt(month));
      
      paramCount++;
      query += ` AND EXTRACT(YEAR FROM i.due_date) = $${paramCount}`;
      queryParams.push(parseInt(year));
    }

    query += ` ORDER BY i.due_date DESC`;

    const result = await db.query(query, queryParams);

    // Generate CSV content
    const csvHeaders = [
      'Reference Number', 'Student Number', 'First Name', 'Last Name',
      'Grade', 'Class', 'Amount Due', 'Amount Paid', 'Outstanding Balance',
      'Overpaid Amount', 'Due Date', 'Status', 'Created', 'Updated'
    ];

    let csvContent = csvHeaders.join(',') + '\n';

    result.rows.forEach(row => {
      const csvRow = [
        row.reference_number || '',
        row.student_number || '',  // This comes from the invoice table
        row.first_name || '',
        row.last_name || '',
        row.grade_name || '',
        row.class_name || '',
        row.amount_due || 0,
        row.amount_paid || 0,
        row.outstanding_balance || 0,
        row.overpaid_amount || 0,
        row.due_date?.toISOString().split('T')[0] || '',
        row.status || '',
        row.created_at?.toISOString().split('T')[0] || '',
        row.updated_at?.toISOString().split('T')[0] || ''
      ].map(field => {
        // Handle special characters and quotes in CSV
        const stringField = String(field);
        if (stringField.includes('"') || stringField.includes(',') || stringField.includes('\n')) {
          return `"${stringField.replace(/"/g, '""')}"`;
        }
        return `"${stringField}"`;
      }).join(',');
      
      csvContent += csvRow + '\n';
    });

    const filename = `invoices-export-${Date.now()}.csv`;
    
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csvContent);

  } catch (error) {
    console.error('Export CSV error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to export invoices',
      error: error.message
    });
  }
});

// Clear all invoices (admin only)
router.delete('/clear-all', [
  authenticate,
  authorize('admin', 'super_admin')
], async (req, res) => {
  try {
    console.log('Admin clearing all invoices:', req.user.email);

    // Start transaction
    await db.query('BEGIN');

    try {
      // Delete all payment transactions first (due to foreign key constraints)
      const transactionsResult = await db.query('DELETE FROM payment_transactions RETURNING id');
      console.log(`Deleted ${transactionsResult.rowCount} payment transactions`);

      // Delete all payment upload logs
      const uploadsResult = await db.query('DELETE FROM payment_upload_logs RETURNING id');
      console.log(`Deleted ${uploadsResult.rowCount} payment upload logs`);

      // Delete all invoices
      const invoicesResult = await db.query('DELETE FROM invoices RETURNING id');
      console.log(`Deleted ${invoicesResult.rowCount} invoices`);

      // Commit transaction
      await db.query('COMMIT');

      res.json({
        success: true,
        message: 'All invoices and related data cleared successfully',
        deleted: {
          invoices: invoicesResult.rowCount,
          transactions: transactionsResult.rowCount,
          uploadLogs: uploadsResult.rowCount
        }
      });

    } catch (innerError) {
      // Rollback on error
      await db.query('ROLLBACK');
      throw innerError;
    }

  } catch (error) {
    console.error('Clear invoices error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to clear invoices',
      error: error.message
    });
  }
});

// Database migration endpoint - SUPER ADMIN ONLY
router.post('/migrate-database', [
  authenticate,
  authorize('super_admin')
], async (req, res) => {
  try {
    console.log('🔄 Starting comprehensive database migration...');
    
    let migrationResults = [];
    
    // 1. Fix payment_transactions table
    console.log('Step 1: Fixing payment_transactions table...');
    
    // Check current columns
    const currentColumns = await db.query(`
      SELECT column_name, data_type
      FROM information_schema.columns 
      WHERE table_name = 'payment_transactions'
      ORDER BY ordinal_position
    `);
    
    console.log('Current payment_transactions columns:', currentColumns.rows.map(r => r.column_name));
    migrationResults.push(`Current columns: ${currentColumns.rows.map(r => r.column_name).join(', ')}`);
    
    const hasTransactionDate = currentColumns.rows.some(r => r.column_name === 'transaction_date');
    const hasPaymentDate = currentColumns.rows.some(r => r.column_name === 'payment_date');
    
    // Fix payment_date column - code expects payment_date but production has transaction_date
    if (hasTransactionDate && !hasPaymentDate) {
      console.log('Renaming transaction_date to payment_date...');
      await db.query(`ALTER TABLE payment_transactions RENAME COLUMN transaction_date TO payment_date`);
      migrationResults.push('✅ Renamed transaction_date to payment_date');
    } else if (!hasPaymentDate) {
      console.log('Adding payment_date column...');
      await db.query(`ALTER TABLE payment_transactions ADD COLUMN payment_date DATE NOT NULL DEFAULT CURRENT_DATE`);
      migrationResults.push('✅ Added payment_date column');
    } else {
      migrationResults.push('✅ payment_date column already exists');
    }
    
    // 2. Fix payment_upload_logs table
    console.log('Step 2: Fixing payment_upload_logs table...');
    
    const uploadLogColumns = await db.query(`
      SELECT column_name
      FROM information_schema.columns 
      WHERE table_name = 'payment_upload_logs'
      ORDER BY ordinal_position
    `);
    
    console.log('Current payment_upload_logs columns:', uploadLogColumns.rows.map(r => r.column_name));
    
    const hasTransactionsProcessed = uploadLogColumns.rows.some(r => r.column_name === 'transactions_processed');
    
    if (!hasTransactionsProcessed) {
      console.log('Recreating payment_upload_logs table with correct schema...');
      
      // Drop and recreate the table
      await db.query(`DROP TABLE IF EXISTS payment_upload_logs CASCADE`);
      
      await db.query(`
        CREATE TABLE payment_upload_logs (
          id SERIAL PRIMARY KEY,
          filename VARCHAR(255) NOT NULL,
          uploaded_by INTEGER NOT NULL,
          transactions_processed INTEGER DEFAULT 0,
          matched_count INTEGER DEFAULT 0,
          partial_count INTEGER DEFAULT 0,
          overpaid_count INTEGER DEFAULT 0,
          unmatched_count INTEGER DEFAULT 0,
          duplicate_count INTEGER DEFAULT 0,
          error_count INTEGER DEFAULT 0,
          created_at TIMESTAMP DEFAULT NOW(),
          FOREIGN KEY (uploaded_by) REFERENCES users(id) ON DELETE CASCADE
        )
      `);
      
      migrationResults.push('✅ Recreated payment_upload_logs table with correct schema');
    } else {
      migrationResults.push('✅ payment_upload_logs table already has correct schema');
    }
    
    // 3. Test the fixed schema
    console.log('Step 3: Testing the fixed schema...');
    
    try {
      // Test payment_transactions
      await db.query(`
        INSERT INTO payment_transactions (
          reference_number, amount, payment_date, 
          description, status
        ) VALUES ($1, $2, $3, $4, $5)
      `, ['MIGRATION_TEST', 1.00, new Date(), 'Migration test transaction', 'Matched']);
      
      // Test payment_upload_logs
      await db.query(`
        INSERT INTO payment_upload_logs (
          filename, uploaded_by, transactions_processed, 
          matched_count, partial_count, overpaid_count,
          unmatched_count, duplicate_count, error_count
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      `, ['test-migration.csv', 1, 1, 1, 0, 0, 0, 0, 0]);
      
      // Clean up test data
      await db.query(`DELETE FROM payment_transactions WHERE reference_number = 'MIGRATION_TEST'`);
      await db.query(`DELETE FROM payment_upload_logs WHERE filename = 'test-migration.csv'`);
      
      migrationResults.push('✅ Schema test successful - both tables working correctly');
      
    } catch (testError) {
      migrationResults.push(`❌ Schema test failed: ${testError.message}`);
    }
    
    // 4. Show final schema
    const finalPaymentTransactions = await db.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns 
      WHERE table_name = 'payment_transactions' 
      ORDER BY ordinal_position
    `);
    
    const finalUploadLogs = await db.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns 
      WHERE table_name = 'payment_upload_logs' 
      ORDER BY ordinal_position
    `);
    
    res.json({
      success: true,
      message: 'Comprehensive database migration completed successfully',
      migrationResults,
      finalSchemas: {
        payment_transactions: finalPaymentTransactions.rows,
        payment_upload_logs: finalUploadLogs.rows
      }
    });
    
  } catch (error) {
    console.error('Migration error:', error);
    res.status(500).json({
      success: false,
      message: 'Database migration failed',
      error: error.message
    });
  }
});

module.exports = router;
