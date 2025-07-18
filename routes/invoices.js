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
    const dueDate = new Date(year, month, 15); // Due on 15th of the month

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
              amount = parseFloat(row[columnMapping.amount]);
            } else {
              // Fallback: look for any numeric field that could be amount
              for (const [key, value] of Object.entries(row)) {
                const numValue = parseFloat(value);
                if (!isNaN(numValue) && numValue > 0) {
                  amount = numValue;
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
          WHERE reference_number = $1 AND amount = $2 AND transaction_date = $3
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
        console.log(`Transaction amount: ${transaction.amount}`);

        // Determine payment status
        let newStatus, amountPaid, newOutstanding, overpaidAmount;
        let resultCategory = null;

        if (transaction.amount >= outstandingAmount) {
          // Full payment or overpayment
          if (transaction.amount === outstandingAmount) {
            newStatus = 'Paid';
            amountPaid = (invoice.amount_paid || 0) + transaction.amount;
            newOutstanding = 0;
            overpaidAmount = 0;
            console.log(`MATCHED: Exact payment of ${transaction.amount} for invoice ${invoice.reference_number}`);
            resultCategory = 'matched';
          } else {
            newStatus = 'Overpaid';
            amountPaid = (invoice.amount_paid || 0) + transaction.amount;
            newOutstanding = 0;
            overpaidAmount = transaction.amount - outstandingAmount;
            console.log(`OVERPAID: Payment of ${transaction.amount} exceeds outstanding ${outstandingAmount} by ${overpaidAmount} for invoice ${invoice.reference_number}`);
            resultCategory = 'overpaid';
          }
        } else {
          // Partial payment
          newStatus = 'Partial';
          amountPaid = (invoice.amount_paid || 0) + transaction.amount;
          newOutstanding = outstandingAmount - transaction.amount;
          overpaidAmount = 0;
          console.log(`PARTIAL: Payment of ${transaction.amount} is less than outstanding ${outstandingAmount}, remaining: ${newOutstanding} for invoice ${invoice.reference_number}`);
          resultCategory = 'partial';
        }

        // Update invoice - only update fields we can modify (not computed columns)
        console.log(`Updating invoice ${invoice.id} with status: ${newStatus}, amount_paid: ${amountPaid}`);
        
        const updateResult = await client.query(`
          UPDATE invoices SET 
            status = $1, 
            amount_paid = $2, 
            updated_at = NOW()
          WHERE id = $3
          RETURNING id, status, amount_paid, outstanding_balance
        `, [newStatus, amountPaid, invoice.id]);
        
        console.log('Invoice update result:', updateResult.rows[0]);

        // Record transaction
        console.log(`Recording transaction for invoice ${invoice.id}`);
        
        const transactionResult = await client.query(`
          INSERT INTO payment_transactions (
            invoice_id, student_id, student_number, reference_number, amount, transaction_date,
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
        pt.transaction_date, pt.description, pt.created_at,
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
      query += ` AND pt.transaction_date >= $${paramCount}`;
      queryParams.push(dateFrom);
    }

    if (dateTo) {
      paramCount++;
      query += ` AND pt.transaction_date <= $${paramCount}`;
      queryParams.push(dateTo);
    }

    query += ` ORDER BY pt.transaction_date DESC, pt.created_at DESC`;

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
      countQuery += ` AND pt.transaction_date >= $${countParamIndex}`;
      countParams.push(dateFrom);
    }

    if (dateTo) {
      countParamIndex++;
      countQuery += ` AND pt.transaction_date <= $${countParamIndex}`;
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
        i.reference_number, s.first_name, s.last_name, s.student_number,
        i.amount_due, i.amount_paid, i.outstanding_balance, i.overpaid_amount,
        i.due_date, i.status, i.created_at, i.updated_at,
        g.name as grade_name, c.name as class_name
      FROM invoices i
      LEFT JOIN students s ON i.student_id = s.id
      LEFT JOIN grades g ON s.grade_id = g.id
      LEFT JOIN classes c ON s.class_id = c.id
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
        row.reference_number,
        row.student_number,
        row.first_name,
        row.last_name,
        row.grade_name || '',
        row.class_name || '',
        row.amount_due,
        row.amount_paid || 0,
        row.outstanding_balance || 0,
        row.overpaid_amount || 0,
        row.due_date?.toISOString().split('T')[0] || '',
        row.status,
        row.created_at?.toISOString().split('T')[0] || '',
        row.updated_at?.toISOString().split('T')[0] || ''
      ].map(field => `"${field}"`).join(',');
      
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
    console.log('🔄 Starting database migration...');
    
    // 1. Check current payment_transactions table schema
    const columnCheck = await db.query(`
      SELECT column_name, data_type
      FROM information_schema.columns 
      WHERE table_name = 'payment_transactions' 
      AND column_name IN ('transaction_date', 'payment_date')
    `);
    
    console.log('Current date columns:', columnCheck.rows.map(r => r.column_name));
    
    const hasTransactionDate = columnCheck.rows.some(r => r.column_name === 'transaction_date');
    const hasPaymentDate = columnCheck.rows.some(r => r.column_name === 'payment_date');
    
    let migrationResults = [];
    
    // 2. Ensure we have transaction_date column (which is what the production DB uses)
    if (!hasTransactionDate && hasPaymentDate) {
      console.log('Renaming payment_date to transaction_date...');
      await db.query(`ALTER TABLE payment_transactions RENAME COLUMN payment_date TO transaction_date`);
      migrationResults.push('✅ Renamed payment_date to transaction_date');
    } else if (!hasTransactionDate) {
      console.log('Adding transaction_date column...');
      await db.query(`ALTER TABLE payment_transactions ADD COLUMN transaction_date DATE NOT NULL DEFAULT CURRENT_DATE`);
      migrationResults.push('✅ Added transaction_date column');
    } else {
      migrationResults.push('✅ transaction_date column already exists');
    }
    
    // 3. Test the fixed schema
    console.log('Testing payment_transactions schema...');
    try {
      await db.query(`
        INSERT INTO payment_transactions (
          reference_number, amount, transaction_date, 
          description
        ) VALUES ($1, $2, $3, $4)
      `, ['MIGRATION_TEST', 1.00, new Date(), 'Migration test transaction']);
      
      // Clean up test data
      await db.query(`DELETE FROM payment_transactions WHERE reference_number = 'MIGRATION_TEST'`);
      migrationResults.push('✅ Schema test successful');
      
    } catch (testError) {
      migrationResults.push(`❌ Schema test failed: ${testError.message}`);
    }
    
    // 4. Show final schema
    const finalColumns = await db.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns 
      WHERE table_name = 'payment_transactions' 
      ORDER BY ordinal_position
    `);
    
    res.json({
      success: true,
      message: 'Database migration completed',
      migrationResults,
      finalSchema: finalColumns.rows
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
