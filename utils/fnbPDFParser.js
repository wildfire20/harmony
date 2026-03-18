const { PDFExtract } = require('pdf.js-extract');
const pdfExtract = new PDFExtract();

/**
 * FNB Bank Statement PDF Parser
 *
 * Actual FNB PDF format (from real statements):
 *   Date:        "02 Feb"  (DD Mon, NO year - year from statement header)
 *   Description: "Payshap Credit Boikano Seroka Blazr"
 *   Reference:   "Har 375"  (optional column, may contain HAR ref with space)
 *   Amount:      "2,200.00"  (separate item)
 *   Cr/Dr:       "Cr" or blank  (separate item after amount)
 *   Balance:     "86,688.21"
 *   Cr:          "Cr"
 *   Accrued:     "34.92"  (optional)
 */
class FNBPDFParser {
  constructor() {
    this.monthMap = {
      jan: '01', feb: '02', mar: '03', apr: '04',
      may: '05', jun: '06', jul: '07', aug: '08',
      sep: '09', oct: '10', nov: '11', dec: '12'
    };
    // FNB date: "02 Feb" (no year)
    this.datePattern = /^\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)$/i;
    // Amount: digits with optional comma-thousands, mandatory 2 decimal places
    this.amountPattern = /^\d{1,3}(?:,\d{3})*\.\d{2}$|^\d+\.\d{2}$/;
    // HAR reference with optional space: HAR375 or HAR 375 or Har 375
    this.harPattern = /\bHAR\s*(\d+)\b/i;
  }

  async parsePDF(filePath) {
    return new Promise((resolve, reject) => {
      pdfExtract.extract(filePath, {}, (err, data) => {
        if (err) {
          console.error('PDF extraction error:', err);
          return reject(err);
        }
        try {
          // Extract year from statement header (e.g. "Statement Period : 31 January 2026 to 28 February 2026")
          const statementYear = this.extractStatementYear(data);
          console.log(`PDF statement year detected: ${statementYear}`);

          const transactions = this.extractTransactions(data, statementYear);
          console.log(`PDF parsed: found ${transactions.length} credit transactions`);
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

  /**
   * Try to find the statement year from header text like
   * "Statement Period : 31 January 2026 to 28 February 2026"
   * or "Statement Date : 28 February 2026"
   */
  extractStatementYear(pdfData) {
    const fullText = pdfData.pages
      .slice(0, 2) // Only check first 2 pages for header
      .map(p => p.content.map(i => i.str).join(' '))
      .join(' ');

    const yearMatch = fullText.match(/\b(20\d{2})\b/);
    return yearMatch ? parseInt(yearMatch[1]) : new Date().getFullYear();
  }

  extractTransactions(pdfData, statementYear) {
    const transactions = [];
    const seen = new Set();

    for (const page of pdfData.pages) {
      const lines = this.groupContentByLine(page.content);

      for (const lineItems of lines) {
        const tx = this.parseTransactionLine(lineItems, statementYear);
        if (!tx) continue;

        // Deduplicate by date+amount+description
        const key = `${tx.date}_${tx.amount}_${tx.reference.substring(0, 30)}`;
        if (seen.has(key)) continue;
        seen.add(key);

        transactions.push(tx);
      }
    }

    return transactions;
  }

  groupContentByLine(content) {
    if (!content || content.length === 0) return [];

    const sorted = [...content]
      .filter(i => i.str && i.str.trim())
      .sort((a, b) => {
        if (Math.abs(a.y - b.y) < 4) return a.x - b.x;
        return a.y - b.y;
      });

    const lines = [];
    let currentLine = [];
    let currentY = null;

    for (const item of sorted) {
      if (currentY === null || Math.abs(item.y - currentY) <= 4) {
        currentLine.push(item);
        if (currentY === null) currentY = item.y;
      } else {
        if (currentLine.length > 0) lines.push(currentLine);
        currentLine = [item];
        currentY = item.y;
      }
    }
    if (currentLine.length > 0) lines.push(currentLine);

    return lines;
  }

  parseTransactionLine(lineItems, statementYear) {
    if (!lineItems || lineItems.length < 3) return null;

    const texts = lineItems.map(i => i.str.trim()).filter(s => s);
    const lineText = texts.join(' ');

    // ── 1. Find date ──────────────────────────────────────────────────────────
    // FNB format: first two tokens are "02" and "Feb"
    // Must start with day number and month abbreviation
    const firstToken = texts[0];
    const secondToken = texts[1] || '';

    if (!firstToken || !/^\d{1,2}$/.test(firstToken)) return null;

    const combined = `${firstToken} ${secondToken}`;
    if (!this.datePattern.test(combined)) return null;

    const parsedDate = this.parseDate(combined, statementYear);
    if (!parsedDate) return null;

    // ── 2. Find Cr/Dr markers and amounts ────────────────────────────────────
    // Walk items: when we find an amount, check next item for "Cr"/"Dr"
    const creditAmounts = [];
    for (let i = 0; i < lineItems.length; i++) {
      const text = lineItems[i].str.trim();
      if (!this.amountPattern.test(text)) continue;

      const nextText = (lineItems[i + 1]?.str || '').trim();
      const isCredit = nextText === 'Cr';
      const isDebit = nextText === 'Dr' || nextText === '';

      if (isCredit) {
        const amount = this.parseAmount(text);
        if (amount > 0) {
          creditAmounts.push({ amount, x: lineItems[i].x });
        }
      }
    }

    // No credit amounts on this line → skip (debit or non-transaction line)
    if (creditAmounts.length === 0) return null;

    // FNB layout: [payment amount Cr] [balance Cr] [optional accrued]
    // The first credit amount (leftmost x) is the payment; the second is the balance.
    creditAmounts.sort((a, b) => a.x - b.x);
    const paymentAmount = creditAmounts[0].amount;

    // ── 3. Find HAR reference ─────────────────────────────────────────────────
    let harRef = null;
    for (const text of texts) {
      const m = text.match(this.harPattern);
      if (m) {
        harRef = `HAR${m[1]}`; // Normalise: always HAR+digits no space
        break;
      }
    }

    // ── 4. Build description (skip date tokens and amount/Cr tokens) ──────────
    const amountValues = new Set(creditAmounts.map(a => a.amount));
    const descParts = [];
    let skipNext = false;

    for (let i = 2; i < lineItems.length; i++) { // skip first 2 (date)
      const text = lineItems[i].str.trim();
      if (!text) continue;

      if (skipNext) { skipNext = false; continue; } // Skip "Cr"/"Dr" after amount

      if (this.amountPattern.test(text)) {
        const amt = this.parseAmount(text);
        if (amountValues.has(amt)) { skipNext = true; continue; } // Skip amount + next Cr
        // Also skip balance amounts
        const nextT = (lineItems[i + 1]?.str || '').trim();
        if (nextT === 'Cr' || nextT === 'Dr') { skipNext = true; continue; }
      }

      if (text === 'Cr' || text === 'Dr') continue;
      descParts.push(text);
    }

    const description = descParts.join(' ').trim() || 'Payment';
    const reference = harRef || description;

    return {
      date: parsedDate,
      description,
      amount: paymentAmount,
      reference,
      rawLine: lineText,
      hasStudentId: !!harRef
    };
  }

  parseDate(dateStr, year) {
    // "02 Feb" → "2026-02-02"
    const m = dateStr.match(/^(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)$/i);
    if (!m) return null;
    const day = m[1].padStart(2, '0');
    const month = this.monthMap[m[2].toLowerCase()];
    if (!month) return null;
    return `${year}-${month}-${day}`;
  }

  parseAmount(text) {
    const clean = text.replace(/,/g, '');
    const val = parseFloat(clean);
    return isNaN(val) ? 0 : val;
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
