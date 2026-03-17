const { PDFExtract } = require('pdf.js-extract');
const pdfExtract = new PDFExtract();

class FNBPDFParser {
  constructor() {
    // FNB date formats
    this.monthMap = {
      'jan': '01', 'january': '01',
      'feb': '02', 'february': '02',
      'mar': '03', 'march': '03',
      'apr': '04', 'april': '04',
      'may': '05',
      'jun': '06', 'june': '06',
      'jul': '07', 'july': '07',
      'aug': '08', 'august': '08',
      'sep': '09', 'september': '09',
      'oct': '10', 'october': '10',
      'nov': '11', 'november': '11',
      'dec': '12', 'december': '12'
    };
    // Supports: R1,234.56  1,234.56  1 234.56  R 1 234.56  1234.56
    this.amountRegex = /R?\s*([\d]{1,3}(?:[,\s]\d{3})*(?:\.\d{2})|\d+\.\d{2})/;
    this.studentIdPattern = /HAR\s*\d+/gi;
  }

  async parsePDF(filePath) {
    return new Promise((resolve, reject) => {
      pdfExtract.extract(filePath, {}, (err, data) => {
        if (err) {
          console.error('PDF extraction error:', err);
          return reject(err);
        }

        try {
          const transactions = this.extractTransactions(data);
          console.log(`PDF parsed: found ${transactions.length} transactions`);
          resolve({
            success: true,
            transactions,
            totalTransactions: transactions.length,
            fileType: 'PDF'
          });
        } catch (parseError) {
          console.error('Transaction extraction error:', parseError);
          reject(parseError);
        }
      });
    });
  }

  extractTransactions(pdfData) {
    const transactions = [];
    const seen = new Set();

    for (const page of pdfData.pages) {
      // Group PDF content items into lines by Y position
      const lines = this.groupContentByLine(page.content);

      for (const lineItems of lines) {
        const lineText = lineItems.map(i => i.str).join(' ').replace(/\s+/g, ' ').trim();
        if (!lineText) continue;

        const tx = this.parseTransactionLine(lineText, lineItems);
        if (!tx) continue;

        // Deduplicate
        const key = `${tx.date}_${tx.amount}_${tx.reference}`;
        if (seen.has(key)) continue;
        seen.add(key);

        transactions.push(tx);
      }
    }

    return transactions;
  }

  groupContentByLine(content) {
    if (!content || content.length === 0) return [];

    const sorted = [...content].sort((a, b) => {
      if (Math.abs(a.y - b.y) < 6) return a.x - b.x;
      return a.y - b.y;
    });

    const lines = [];
    let currentLine = [];
    let currentY = null;

    for (const item of sorted) {
      if (!item.str || !item.str.trim()) continue;
      if (currentY === null || Math.abs(item.y - currentY) <= 6) {
        currentLine.push(item);
        currentY = currentY === null ? item.y : currentY;
      } else {
        if (currentLine.length > 0) lines.push(currentLine);
        currentLine = [item];
        currentY = item.y;
      }
    }
    if (currentLine.length > 0) lines.push(currentLine);

    return lines;
  }

  parseTransactionLine(lineText, lineItems) {
    // Must have a date
    const dateMatch = this.findDate(lineText);
    if (!dateMatch) return null;

    // Find student ID references
    const studentIds = [];
    let match;
    const idRegex = /HAR\s*(\d+)/gi;
    while ((match = idRegex.exec(lineText)) !== null) {
      studentIds.push('HAR' + match[1]);
    }

    // Find all amounts in the line
    const amounts = this.findAllAmounts(lineText, lineItems);
    if (amounts.length === 0) return null;

    // Extract credit amount using multiple strategies
    let creditAmount = this.extractCreditAmount(amounts, lineItems, studentIds.length > 0);
    if (creditAmount <= 0) return null;

    // Extract description
    const description = this.extractDescription(lineText, dateMatch.matchedText);

    // Determine reference
    const reference = studentIds.length > 0 ? studentIds[0].toUpperCase() : description;

    // Only include payments (credits), not debits, unless has student ID
    const isPayment = studentIds.length > 0 || this.isLikelyCredit(lineText);
    if (!isPayment) return null;

    return {
      date: dateMatch.date,
      description: description,
      amount: creditAmount,
      reference: reference,
      rawLine: lineText,
      hasStudentId: studentIds.length > 0
    };
  }

  findAllAmounts(lineText, lineItems) {
    const amounts = [];
    
    // Strategy 1: Find amounts in individual PDF items (standalone amounts)
    if (lineItems) {
      for (const item of lineItems) {
        const text = item.str.trim();
        // Match standalone amount: optional R, digits with comma/space separators, decimal
        const m = text.match(/^-?\s*R?\s*([\d]{1,3}(?:[,\s]\d{3})*\.\d{2}|\d+\.\d{2})\s*$/);
        if (m) {
          const clean = m[1].replace(/[\s,]/g, '');
          const val = parseFloat(clean);
          if (!isNaN(val) && val > 0) {
            amounts.push({ amount: val, x: item.x, source: 'item' });
          }
        }
      }
    }

    // Strategy 2: Find amounts in the full line text using regex (catches all formats)
    const lineAmountRegex = /(?:^|\s)-?\s*R?\s*([\d]{1,3}(?:[,\s]\d{3})*\.\d{2}|\d+\.\d{2})(?:\s|$)/g;
    let m2;
    while ((m2 = lineAmountRegex.exec(lineText)) !== null) {
      const clean = m2[1].replace(/[\s,]/g, '');
      const val = parseFloat(clean);
      if (!isNaN(val) && val > 0) {
        // Only add if not already captured
        const alreadyHave = amounts.some(a => Math.abs(a.amount - val) < 0.01);
        if (!alreadyHave) {
          amounts.push({ amount: val, x: null, source: 'linetext' });
        }
      }
    }

    return amounts;
  }

  extractCreditAmount(amounts, lineItems, hasStudentId) {
    if (amounts.length === 0) return 0;

    // Sort by x position (left to right) for positional logic
    const withX = amounts.filter(a => a.x !== null).sort((a, b) => a.x - b.x);
    const all = amounts.sort((a, b) => (a.x || 9999) - (b.x || 9999));

    // With 3+ amounts: FNB typical format is [Debit, Credit, Balance]
    // Credit is second-to-last positionally
    if (withX.length >= 3) {
      const creditCandidate = withX[withX.length - 2];
      if (creditCandidate && creditCandidate.amount > 0) {
        return creditCandidate.amount;
      }
    }

    // With 2 positional amounts: [Credit, Balance] or [Debit, Balance]
    if (withX.length === 2) {
      // If this line has a student ID, it's almost certainly a payment/credit
      if (hasStudentId) {
        return withX[0].amount; // First amount is the payment
      }
      // Otherwise skip to avoid debit mismatches
      return 0;
    }

    // With 1 amount (common in some PDF layouts): use it if has student ID
    if (all.length === 1 && hasStudentId) {
      return all[0].amount;
    }

    // Fallback: if we found amounts from linetext but not items, use smallest non-balance amount
    if (all.length >= 2 && hasStudentId) {
      // Use the smallest positive amount as payment (balance is usually larger)
      const sorted = [...all].sort((a, b) => a.amount - b.amount);
      return sorted[0].amount;
    }

    return 0;
  }

  isLikelyCredit(lineText) {
    const creditKeywords = /deposit|payment|transfer\s*in|eft\s*in|credit|school\s*fee|tuition|received|inward/i;
    const debitKeywords = /debit\s*order|purchase|withdrawal|atm|transfer\s*out|eft\s*out|payment\s*to|card\s*transaction|service\s*fee|bank\s*charge/i;
    if (debitKeywords.test(lineText)) return false;
    return creditKeywords.test(lineText);
  }

  findDate(text) {
    // Pattern: "17 Mar 2026" or "17 March 2026"
    const longPattern = /\b(\d{1,2})\s+(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(\d{4})\b/i;
    let m = text.match(longPattern);
    if (m) {
      const day = m[1].padStart(2, '0');
      const month = this.monthMap[m[2].toLowerCase().slice(0, 3)];
      const year = m[3];
      if (month) return { date: `${year}-${month}-${day}`, matchedText: m[0] };
    }

    // Pattern: "17/03/2026" or "2026-03-17"
    const slashPattern = /\b(\d{2})\/(\d{2})\/(\d{4})\b/;
    m = text.match(slashPattern);
    if (m) {
      return { date: `${m[3]}-${m[2]}-${m[1]}`, matchedText: m[0] };
    }

    const isoPattern = /\b(\d{4})-(\d{2})-(\d{2})\b/;
    m = text.match(isoPattern);
    if (m) {
      return { date: m[0], matchedText: m[0] };
    }

    return null;
  }

  extractDescription(lineText, dateText) {
    // Remove the date from line text and amount patterns to get description
    let desc = lineText;
    if (dateText) desc = desc.replace(dateText, '');
    // Remove standalone amounts
    desc = desc.replace(/\b-?\s*R?\s*[\d]{1,3}(?:[,\s]\d{3})*\.\d{2}\b/g, '');
    desc = desc.replace(/\s+/g, ' ').trim();
    return desc || 'Payment';
  }

  async analyzeFile(filePath) {
    const result = await this.parsePDF(filePath);

    const sampleTransactions = result.transactions.slice(0, 5).map(t => ({
      date: t.date,
      description: t.description.substring(0, 60) + (t.description.length > 60 ? '...' : ''),
      amount: t.amount,
      reference: t.reference
    }));

    return {
      success: true,
      fileType: 'PDF',
      totalTransactions: result.transactions.length,
      transactionsWithStudentIds: result.transactions.filter(t => t.hasStudentId).length,
      sampleData: sampleTransactions,
      headers: ['Date', 'Description', 'Amount', 'Reference'],
      suggestedMapping: {
        date: 'date',
        description: 'description',
        amount: 'amount',
        reference: 'reference'
      }
    };
  }
}

module.exports = FNBPDFParser;
