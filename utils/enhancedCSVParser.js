const csv = require('csv-parser');
const fs = require('fs');

class EnhancedCSVParser {
  constructor() {
    // Common column name patterns for auto-detection
    this.columnPatterns = {
      reference: [
        /^ref/i, /reference/i, /student/i, /number/i, /^id$/i,
        /account.?number/i, /customer.?ref/i, /payee.?ref/i, /narrative/i
      ],
      amount: [
        /amount/i, /value/i, /sum/i, /total/i, /payment/i,
        /debit/i, /credit/i, /transaction.?amount/i, /credit.?amount/i, /debit.?amount/i
      ],
      date: [
        /date/i, /time/i, /when/i, /transaction.?date/i,
        /payment.?date/i, /value.?date/i, /posting.?date/i
      ],
      description: [
        /desc/i, /note/i, /comment/i, /detail/i, /memo/i,
        /narrative/i, /particulars/i, /remarks/i
      ],
      debit: [
        /debit/i, /dr/i, /out/i, /withdrawal/i, /debit.?amount/i, /expense/i
      ],
      credit: [
        /credit/i, /cr/i, /in/i, /deposit/i, /credit.?amount/i, /income/i
      ],
      balance: [
        /balance/i, /running.?balance/i, /available.?balance/i
      ]
    };

    // Date formats to try parsing
    this.dateFormats = [
      /^\d{4}-\d{2}-\d{2}$/, // YYYY-MM-DD
      /^\d{2}\/\d{2}\/\d{4}$/, // MM/DD/YYYY or DD/MM/YYYY
      /^\d{2}-\d{2}-\d{4}$/, // MM-DD-YYYY or DD-MM-YYYY
      /^\d{1,2}\/\d{1,2}\/\d{4}$/, // M/D/YYYY or D/M/YYYY
      /^\d{1,2}-\d{1,2}-\d{4}$/, // M-D-YYYY or D-M-YYYY
    ];
  }

  /**
   * Auto-detect column mappings from CSV headers
   */
  autoDetectColumns(headers) {
    const mapping = {};
    const normalizedHeaders = headers.map(h => h.toLowerCase().trim());

    // Find best matches for each field type
    Object.keys(this.columnPatterns).forEach(fieldType => {
      const patterns = this.columnPatterns[fieldType];
      let bestMatch = null;
      let bestScore = 0;

      headers.forEach((header, index) => {
        const normalizedHeader = normalizedHeaders[index];
        
        patterns.forEach(pattern => {
          if (pattern.test(normalizedHeader)) {
            // Calculate match score (more specific patterns get higher scores)
            let score = 1;
            if (normalizedHeader === pattern.source.toLowerCase().replace(/[^a-z]/g, '')) {
              score = 10; // Exact match
            } else if (normalizedHeader.includes(pattern.source.toLowerCase().replace(/[^a-z]/g, ''))) {
              score = 5; // Contains match
            }

            if (score > bestScore) {
              bestScore = score;
              bestMatch = header;
            }
          }
        });
      });

      if (bestMatch) {
        mapping[fieldType] = bestMatch;
      }
    });

    // Handle debit/credit columns specially
    if (mapping.debit && mapping.credit) {
      // If we have both debit and credit columns, don't use the general amount column
      delete mapping.amount;
    }

    return mapping;
  }

  /**
   * Clean and normalize amount values
   */
  normalizeAmount(value, isDebit = false) {
    if (!value || value === '' || value === '-') {
      return 0;
    }

    let cleanValue = value.toString().trim();
    
    // Remove common currency symbols and formatting
    cleanValue = cleanValue.replace(/[R$£€¥₹,\s]/g, '');
    
    // Handle parentheses (usually indicates negative/debit)
    const hasParentheses = cleanValue.includes('(') && cleanValue.includes(')');
    cleanValue = cleanValue.replace(/[()]/g, '');
    
    // Parse as float
    const numValue = parseFloat(cleanValue);
    
    if (isNaN(numValue)) {
      return 0;
    }

    // Apply sign logic
    if (hasParentheses || isDebit) {
      return Math.abs(numValue); // Keep positive for payment amounts
    }

    return Math.abs(numValue);
  }

  /**
   * Normalize date to YYYY-MM-DD format
   */
  normalizeDate(value) {
    if (!value || value === '') {
      return new Date();
    }

    // Try parsing as-is first
    let date = new Date(value);
    if (!isNaN(date.getTime())) {
      return date;
    }

    // Try different date formats
    const dateStr = value.toString().trim();
    
    // Handle DD/MM/YYYY format (common in some regions)
    if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(dateStr)) {
      const parts = dateStr.split('/');
      // Assume DD/MM/YYYY format
      date = new Date(parts[2], parts[1] - 1, parts[0]);
      if (!isNaN(date.getTime())) {
        return date;
      }
    }

    // Handle DD-MM-YYYY format
    if (/^\d{1,2}-\d{1,2}-\d{4}$/.test(dateStr)) {
      const parts = dateStr.split('-');
      // Assume DD-MM-YYYY format
      date = new Date(parts[2], parts[1] - 1, parts[0]);
      if (!isNaN(date.getTime())) {
        return date;
      }
    }

    // Fallback to current date
    console.warn(`Could not parse date: ${value}, using current date`);
    return new Date();
  }

  /**
   * Extract reference number from text using various patterns
   */
  extractReference(text, description = '') {
    if (!text && !description) {
      return null;
    }

    const combined = `${text || ''} ${description || ''}`.trim();
    
    // Try to find student number patterns (6-8 digits)
    let match = combined.match(/\b\d{6,8}\b/);
    if (match) {
      return match[0];
    }

    // Try to find reference patterns like "HAR123", "SUT456"
    match = combined.match(/\b[A-Z]{2,4}\d{2,6}\b/i);
    if (match) {
      return match[0];
    }

    // Try to find patterns with specific keywords
    match = combined.match(/(?:ref|student|id|number)[\s:]*([a-z0-9]+)/i);
    if (match) {
      return match[1];
    }

    // Extract names before "Grade" or similar
    match = combined.match(/([A-Za-z\s]{2,})\s+(?:grade?|gr\.?|class)/i);
    if (match) {
      return match[1].trim();
    }

    // Return original text if no patterns found (for manual review)
    return text ? text.toString().trim() : description.toString().trim();
  }

  /**
   * Check if a row should be skipped (headers, empty rows, balances)
   */
  shouldSkipRow(row, headers) {
    if (!row || typeof row !== 'object') {
      return true;
    }

    const values = Object.values(row).filter(v => v && v.toString().trim());
    
    // Skip empty rows
    if (values.length === 0) {
      return true;
    }

    // Skip if it looks like a header row repeated
    const headerWords = ['reference', 'amount', 'date', 'description', 'balance', 'debit', 'credit'];
    const rowText = values.join(' ').toLowerCase();
    const headerWordCount = headerWords.filter(word => rowText.includes(word)).length;
    
    if (headerWordCount >= 3) {
      return true; // Likely a header row
    }

    // Skip balance/summary rows
    if (rowText.includes('balance') || 
        rowText.includes('total') || 
        rowText.includes('summary') ||
        rowText.includes('opening') ||
        rowText.includes('closing')) {
      return true;
    }

    return false;
  }

  /**
   * Parse CSV file and extract transactions
   */
  async parseCSV(filePath, customMapping = null) {
    return new Promise((resolve, reject) => {
      const transactions = [];
      const errors = [];
      let headers = [];
      let mapping = customMapping;
      let rowCount = 0;

      const stream = fs.createReadStream(filePath)
        .pipe(csv())
        .on('headers', (csvHeaders) => {
          headers = csvHeaders;
          console.log('CSV Headers detected:', headers);
          
          // Auto-detect columns if no custom mapping provided
          if (!mapping) {
            mapping = this.autoDetectColumns(headers);
            console.log('Auto-detected column mapping:', mapping);
          } else {
            console.log('Using custom column mapping:', mapping);
          }
        })
        .on('data', (row) => {
          try {
            rowCount++;
            
            // Skip unwanted rows
            if (this.shouldSkipRow(row, headers)) {
              return;
            }

            console.log(`Processing row ${rowCount}:`, row);

            // Extract transaction data
            const transaction = this.extractTransaction(row, mapping);
            
            if (transaction) {
              transactions.push(transaction);
              console.log('Parsed transaction:', transaction);
            }

          } catch (error) {
            console.error(`Error parsing row ${rowCount}:`, error);
            errors.push({
              row: rowCount,
              data: row,
              error: error.message
            });
          }
        })
        .on('end', () => {
          console.log(`Parsing complete. ${transactions.length} transactions extracted, ${errors.length} errors`);
          resolve({
            transactions,
            errors,
            headers,
            mapping,
            totalRows: rowCount
          });
        })
        .on('error', (error) => {
          reject(error);
        });
    });
  }

  /**
   * Extract transaction data from a CSV row using the provided mapping
   */
  extractTransaction(row, mapping) {
    let reference = '';
    let amount = 0;
    let date = null;
    let description = '';

    // Extract reference
    if (mapping.reference && row[mapping.reference]) {
      reference = this.extractReference(row[mapping.reference], row[mapping.description]);
    } else {
      // Try description for reference if no specific reference column
      reference = this.extractReference(row[mapping.description] || '', '');
    }

    // Extract amount
    if (mapping.debit && mapping.credit) {
      // Handle separate debit/credit columns
      const debitAmount = this.normalizeAmount(row[mapping.debit], true);
      const creditAmount = this.normalizeAmount(row[mapping.credit], false);
      
      // Use credit amount for payments (money coming in)
      amount = creditAmount > 0 ? creditAmount : debitAmount;
    } else if (mapping.amount) {
      amount = this.normalizeAmount(row[mapping.amount]);
    }

    // Extract date
    if (mapping.date && row[mapping.date]) {
      date = this.normalizeDate(row[mapping.date]);
    } else {
      date = new Date(); // Fallback to current date
    }

    // Extract description
    if (mapping.description && row[mapping.description]) {
      description = row[mapping.description].toString().trim();
    }

    // Validate transaction
    if (!reference || reference === '') {
      console.warn('No reference found in row:', row);
      return null;
    }

    if (isNaN(amount) || amount <= 0) {
      console.warn('Invalid amount in row:', row);
      return null;
    }

    return {
      reference: reference.toString().trim(),
      amount: Math.round(amount * 100) / 100, // Round to 2 decimal places
      date: date,
      description: description,
      originalRow: row // Keep original data for debugging
    };
  }

  /**
   * Get confidence score for auto-detected mapping
   */
  getMappingConfidence(mapping, headers) {
    let score = 0;
    let maxScore = 0;

    const requiredFields = ['reference', 'amount', 'date'];
    
    requiredFields.forEach(field => {
      maxScore += 10;
      if (mapping[field]) {
        score += 10;
      }
    });

    // Bonus for description
    if (mapping.description) {
      score += 5;
      maxScore += 5;
    }

    // Bonus for debit/credit separation
    if (mapping.debit && mapping.credit) {
      score += 5;
      maxScore += 5;
    }

    return Math.round((score / maxScore) * 100);
  }
}

module.exports = EnhancedCSVParser;
