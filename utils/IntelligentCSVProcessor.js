// Enhanced CSV Processing Utility for Flexible Bank Statement Uploads
const fs = require('fs');
const csv = require('csv-parser');
const { Pool } = require('pg');

class IntelligentCSVProcessor {
  constructor(db) {
    this.db = db;
    this.commonPatterns = {
      reference: [
        'reference', 'ref', 'student', 'number', 'id', 'account_no', 'account_number',
        'student_id', 'student_number', 'registration', 'reg_no'
      ],
      amount: [
        'amount', 'value', 'sum', 'total', 'payment', 'transaction_amount',
        'debit', 'credit', 'money', 'rands', 'rand', 'r'
      ],
      date: [
        'date', 'time', 'when', 'transaction_date', 'payment_date', 
        'processed_date', 'value_date', 'posting_date'
      ],
      description: [
        'description', 'desc', 'note', 'comment', 'detail', 'memo', 
        'narrative', 'particulars', 'transaction_description'
      ],
      balance: ['balance', 'running_balance', 'available_balance', 'current_balance'],
      debit: ['debit', 'debit_amount', 'withdrawal', 'out', 'minus'],
      credit: ['credit', 'credit_amount', 'deposit', 'in', 'plus']
    };
  }

  // Generate a unique identifier for the CSV format based on headers
  generateBankIdentifier(headers) {
    // Sort headers for consistent identification
    const sortedHeaders = [...headers].sort().join('|').toLowerCase();
    return Buffer.from(sortedHeaders).toString('base64').substring(0, 20);
  }

  // Intelligent column detection based on header names
  detectColumns(headers) {
    const mapping = {};
    const normalizedHeaders = headers.map(h => h.toLowerCase().trim());

    for (const [fieldType, patterns] of Object.entries(this.commonPatterns)) {
      for (let i = 0; i < normalizedHeaders.length; i++) {
        const header = normalizedHeaders[i];
        
        // Check if any pattern matches the header
        for (const pattern of patterns) {
          if (header.includes(pattern) || pattern.includes(header)) {
            if (!mapping[fieldType]) {
              mapping[fieldType] = headers[i]; // Use original header case
              break;
            }
          }
        }
        
        if (mapping[fieldType]) break;
      }
    }

    return mapping;
  }

  // Check if we have a saved mapping for this bank format
  async getSavedMapping(headers) {
    const bankId = this.generateBankIdentifier(headers);
    
    try {
      const result = await this.db.query(
        'SELECT * FROM csv_column_mappings WHERE bank_identifier = $1',
        [bankId]
      );
      
      if (result.rows.length > 0) {
        const saved = result.rows[0];
        return {
          reference: saved.reference_column,
          amount: saved.amount_column || saved.debit_column || saved.credit_column,
          date: saved.date_column,
          description: saved.description_column,
          balance: saved.balance_column,
          debit: saved.debit_column,
          credit: saved.credit_column,
          bankId
        };
      }
    } catch (error) {
      console.error('Error retrieving saved mapping:', error);
    }
    
    return null;
  }

  // Save column mapping for future use
  async saveMapping(headers, mapping) {
    const bankId = this.generateBankIdentifier(headers);
    
    try {
      await this.db.query(`
        INSERT INTO csv_column_mappings (
          bank_identifier, column_headers, reference_column, amount_column, 
          date_column, description_column, balance_column, debit_column, credit_column
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT (bank_identifier) DO UPDATE SET
          column_headers = EXCLUDED.column_headers,
          reference_column = EXCLUDED.reference_column,
          amount_column = EXCLUDED.amount_column,
          date_column = EXCLUDED.date_column,
          description_column = EXCLUDED.description_column,
          balance_column = EXCLUDED.balance_column,
          debit_column = EXCLUDED.debit_column,
          credit_column = EXCLUDED.credit_column,
          updated_at = CURRENT_TIMESTAMP
      `, [
        bankId,
        JSON.stringify(headers),
        mapping.reference,
        mapping.amount,
        mapping.date,
        mapping.description,
        mapping.balance,
        mapping.debit,
        mapping.credit
      ]);
      
      console.log(`Saved column mapping for bank format: ${bankId}`);
    } catch (error) {
      console.error('Error saving column mapping:', error);
    }
  }

  // Enhanced data cleaning and normalization
  cleanTransactionData(row, mapping) {
    let reference = '';
    let amount = 0;
    let date = null;
    let description = '';

    // Extract reference - try multiple strategies
    if (mapping.reference && row[mapping.reference]) {
      reference = String(row[mapping.reference]).trim();
    }

    // If no reference found, try to extract from description
    if (!reference && mapping.description && row[mapping.description]) {
      const desc = String(row[mapping.description]);
      
      // Look for student number patterns (6-7 digits)
      const studentNumMatch = desc.match(/\b\d{6,7}\b/);
      if (studentNumMatch) {
        reference = studentNumMatch[0];
      }
      // Look for names before "Grade" or similar
      else {
        const nameMatch = desc.match(/^([A-Za-z\s]+?)(?:\s+(?:Grade?|Gr\.?|Class)\s*\d+)?/i);
        if (nameMatch && nameMatch[1].trim().length > 2) {
          reference = nameMatch[1].trim();
        } else {
          // Use first part of description as reference
          reference = desc.split(/\s+/).slice(0, 2).join(' ').trim();
        }
      }
    }

    // Extract amount - handle debit/credit columns
    if (mapping.amount && row[mapping.amount]) {
      amount = this.parseAmount(row[mapping.amount]);
    } else if (mapping.debit && row[mapping.debit]) {
      amount = this.parseAmount(row[mapping.debit]);
    } else if (mapping.credit && row[mapping.credit]) {
      amount = this.parseAmount(row[mapping.credit]);
    } else {
      // Fallback: find any numeric value that could be an amount
      for (const [key, value] of Object.entries(row)) {
        const parsed = this.parseAmount(value);
        if (parsed > 0) {
          amount = parsed;
          break;
        }
      }
    }

    // Extract date
    if (mapping.date && row[mapping.date]) {
      date = this.parseDate(row[mapping.date]);
    }

    // Extract description
    if (mapping.description && row[mapping.description]) {
      description = String(row[mapping.description]).trim();
    }

    return {
      reference,
      amount,
      date: date || new Date(), // Use current date as fallback
      description
    };
  }

  // Enhanced amount parsing
  parseAmount(amountStr) {
    if (!amountStr) return 0;
    
    // Convert to string and clean
    let cleaned = String(amountStr)
      .replace(/[,\s]/g, '') // Remove commas and spaces
      .replace(/[^\d.-]/g, ''); // Keep only digits, dots, and minus signs

    // Handle negative amounts (convert to positive for payments)
    if (cleaned.startsWith('-')) {
      cleaned = cleaned.substring(1);
    }

    const parsed = parseFloat(cleaned);
    return isNaN(parsed) ? 0 : Math.abs(parsed);
  }

  // Enhanced date parsing
  parseDate(dateStr) {
    if (!dateStr) return null;

    // Try different date formats
    const formats = [
      // ISO format
      /^\d{4}-\d{2}-\d{2}$/,
      // DD/MM/YYYY
      /^\d{1,2}\/\d{1,2}\/\d{4}$/,
      // MM/DD/YYYY
      /^\d{1,2}\/\d{1,2}\/\d{4}$/,
      // DD-MM-YYYY
      /^\d{1,2}-\d{1,2}-\d{4}$/,
      // YYYY/MM/DD
      /^\d{4}\/\d{1,2}\/\d{1,2}$/
    ];

    try {
      const date = new Date(dateStr);
      if (!isNaN(date.getTime())) {
        return date;
      }
    } catch (error) {
      console.warn('Date parsing failed for:', dateStr);
    }

    return null;
  }

  // Check if row is valid transaction data (not header, balance info, etc.)
  isValidTransactionRow(row, mapping) {
    // Skip rows that are clearly not transactions
    const values = Object.values(row).join(' ').toLowerCase();
    
    // Skip header-like rows
    if (values.includes('date') && values.includes('amount') && values.includes('balance')) {
      return false;
    }

    // Skip balance summary rows
    if (values.includes('opening balance') || values.includes('closing balance') || 
        values.includes('total') || values.includes('summary')) {
      return false;
    }

    // Skip empty rows
    const nonEmptyValues = Object.values(row).filter(val => val && String(val).trim());
    if (nonEmptyValues.length < 2) {
      return false;
    }

    // Check if we can extract at least a reference and amount
    const cleaned = this.cleanTransactionData(row, mapping);
    return cleaned.reference && cleaned.amount > 0;
  }

  // Process CSV file with intelligent column detection
  async processCSV(filePath, manualMapping = null) {
    return new Promise((resolve, reject) => {
      const transactions = [];
      const errors = [];
      let headers = [];
      let columnMapping = null;
      let isFirstDataRow = true;

      fs.createReadStream(filePath)
        .pipe(csv())
        .on('headers', async (detectedHeaders) => {
          headers = detectedHeaders;
          console.log('CSV Headers detected:', headers);

          try {
            // Try to get saved mapping first
            const savedMapping = await this.getSavedMapping(headers);
            
            if (savedMapping) {
              console.log('Using saved mapping:', savedMapping);
              columnMapping = savedMapping;
            } else if (manualMapping) {
              console.log('Using manual mapping:', manualMapping);
              columnMapping = manualMapping;
              // Save this mapping for future use
              await this.saveMapping(headers, manualMapping);
            } else {
              // Try intelligent detection
              const detectedMapping = this.detectColumns(headers);
              console.log('Auto-detected mapping:', detectedMapping);
              
              // Check if detection was successful
              if (detectedMapping.reference && detectedMapping.amount && detectedMapping.date) {
                columnMapping = detectedMapping;
                await this.saveMapping(headers, detectedMapping);
              } else {
                // Need manual mapping
                return reject({
                  needsMapping: true,
                  headers: headers,
                  detectedMapping: detectedMapping,
                  message: 'Unable to automatically detect column mapping. Manual mapping required.'
                });
              }
            }
          } catch (error) {
            console.error('Error setting up column mapping:', error);
            return reject(error);
          }
        })
        .on('data', (row) => {
          try {
            // Skip invalid rows
            if (!this.isValidTransactionRow(row, columnMapping)) {
              if (isFirstDataRow) {
                console.log('Skipping invalid row (likely header/summary):', row);
              }
              isFirstDataRow = false;
              return;
            }

            isFirstDataRow = false;

            // Clean and extract transaction data
            const transaction = this.cleanTransactionData(row, columnMapping);
            
            if (transaction.reference && transaction.amount > 0) {
              transactions.push(transaction);
              console.log('Processed transaction:', transaction);
            } else {
              errors.push(`Invalid transaction data in row: ${JSON.stringify(row)}`);
            }
          } catch (error) {
            console.error('Error processing row:', error);
            errors.push(`Error processing row: ${JSON.stringify(row)} - ${error.message}`);
          }
        })
        .on('end', () => {
          console.log(`Successfully processed ${transactions.length} transactions`);
          resolve({ transactions, errors, mapping: columnMapping });
        })
        .on('error', reject);
    });
  }
}

module.exports = IntelligentCSVProcessor;
