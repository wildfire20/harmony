const { PDFExtract } = require('pdf.js-extract');
const pdfExtract = new PDFExtract();

/**
 * FNB Bank Statement PDF Parser — Regex-based approach
 *
 * Actual FNB format (from real statements):
 *   "02 Feb Payshap Credit Boikano Seroka Blazr 400.00 Cr 78,198.21 Cr"
 *   "02 Feb ADT Cash Deposit Lephmall Har 375 2,200.00 Cr 86,688.21 Cr 34.92"
 *   "02 Feb Magtape Credit Capitec Har116 4B 950.00 Cr 105,368.03 Cr"
 *
 * Key observations:
 *   - Date is "DD Mon" (no year) — year comes from statement header
 *   - Amounts end with "Cr" (credit) or have no suffix (debit)
 *   - HAR references appear as "Har 375" or "Har116" anywhere in the description
 *   - The FIRST "amount Cr" on a line is the payment; the second is the balance
 */
class FNBPDFParser {
  constructor() {
    this.monthMap = {
      jan: '01', feb: '02', mar: '03', apr: '04',
      may: '05', jun: '06', jul: '07', aug: '08',
      sep: '09', oct: '10', nov: '11', dec: '12'
    };
  }

  async parsePDF(filePath) {
    return new Promise((resolve, reject) => {
      pdfExtract.extract(filePath, {}, (err, data) => {
        if (err) {
          console.error('PDF extraction error:', err);
          return reject(err);
        }
        try {
          // Log a sample of raw items to help with debugging
          if (data.pages && data.pages[0] && data.pages[0].content) {
            const sample = data.pages[0].content
              .slice(0, 20)
              .map(i => `[y=${Math.round(i.y)} x=${Math.round(i.x)}] "${i.str}"`)
              .join('\n');
            console.log('PDF raw items sample (page 1, first 20):\n' + sample);
          }

          const statementYear = this.extractStatementYear(data);
          console.log(`PDF statement year: ${statementYear}`);

          const transactions = this.extractTransactions(data, statementYear);
          console.log(`PDF parsed: ${transactions.length} credit transactions found`);

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
   * Extract year from statement header text.
   * Looks for "20XX" in the first two pages.
   */
  extractStatementYear(pdfData) {
    const fullText = pdfData.pages
      .slice(0, 2)
      .map(p => p.content.map(i => i.str || '').join(' '))
      .join(' ');
    const m = fullText.match(/\b(20\d{2})\b/);
    return m ? parseInt(m[1]) : new Date().getFullYear();
  }

  /**
   * Main extraction: group PDF text items into visual lines, then parse each line.
   */
  extractTransactions(pdfData, statementYear) {
    const transactions = [];
    const seen = new Set();

    for (const page of pdfData.pages) {
      const lines = this.groupIntoLines(page.content);

      for (const lineText of lines) {
        const tx = this.parseLineText(lineText, statementYear);
        if (!tx) continue;

        const key = `${tx.date}|${tx.amount}|${tx.description.substring(0, 25)}`;
        if (seen.has(key)) continue;
        seen.add(key);

        transactions.push(tx);
      }
    }

    return transactions;
  }

  /**
   * Group PDF content items into text lines using Y-coordinate proximity.
   * Returns array of combined strings, one per visual line.
   */
  groupIntoLines(content) {
    if (!content || content.length === 0) return [];

    // Filter out empty items and sort by y then x
    const items = content
      .filter(i => i.str && i.str.trim())
      .sort((a, b) => {
        const yDiff = a.y - b.y;
        if (Math.abs(yDiff) < 6) return a.x - b.x;
        return yDiff;
      });

    if (items.length === 0) return [];

    // Group items into lines where items within 6 y-units are on the same line
    const lineGroups = [];
    let currentGroup = [items[0]];
    let currentY = items[0].y;

    for (let i = 1; i < items.length; i++) {
      if (Math.abs(items[i].y - currentY) <= 6) {
        currentGroup.push(items[i]);
      } else {
        lineGroups.push(currentGroup);
        currentGroup = [items[i]];
        currentY = items[i].y;
      }
    }
    if (currentGroup.length > 0) lineGroups.push(currentGroup);

    // Convert each group to a single string (items ordered left→right)
    return lineGroups.map(group => {
      group.sort((a, b) => a.x - b.x);
      return group.map(i => i.str.trim()).filter(s => s).join(' ');
    });
  }

  /**
   * Parse a single combined line string for an FNB transaction.
   * 
   * FNB credit transaction pattern:
   *   "DD Mon [description] [amount] Cr [balance] Cr [optional accrued]"
   */
  parseLineText(lineText, statementYear) {
    if (!lineText || lineText.length < 10) return null;

    // ── 1. Must start with a date: "DD Mon" or "D Mon" ──────────────────────
    const dateMatch = lineText.match(
      /^(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b/i
    );
    if (!dateMatch) return null;

    const day = dateMatch[1].padStart(2, '0');
    const month = this.monthMap[dateMatch[2].toLowerCase()];
    if (!month) return null;
    const date = `${statementYear}-${month}-${day}`;

    // ── 2. Must have at least one "amount Cr" (credit) ───────────────────────
    // Regex: a number (with optional comma thousands) followed by whitespace then "Cr"
    const creditRegex = /([\d,]+\.\d{2})\s+Cr\b/gi;
    const creditMatches = [];
    let cm;
    while ((cm = creditRegex.exec(lineText)) !== null) {
      const amount = parseFloat(cm[1].replace(/,/g, ''));
      if (amount > 0) {
        creditMatches.push({ amount, index: cm.index });
      }
    }

    // FNB format rule:
    //   Credit (payment): "400.00 Cr  78,198.21 Cr"  → TWO credit markers
    //   Debit:            "500.00     77,188.21 Cr"   → ONE credit marker (just the balance)
    // If there is only one Cr on the line, it's a debit — skip it.
    if (creditMatches.length < 2) return null;

    // First (leftmost) credit is the payment amount; the second is the running balance
    creditMatches.sort((a, b) => a.index - b.index);
    const paymentAmount = creditMatches[0].amount;

    // ── 3. Find HAR reference anywhere in the line ───────────────────────────
    // Also catches common typos like HGR024, HBR024 (parent mistyped middle letter)
    const harMatch = lineText.match(/\bH[A-Z]R\s*(\d+)\b/i);
    const harRef = harMatch ? `HAR${harMatch[1]}` : null;

    // ── 4. Build description: everything between the date and the first amount ─
    const dateEnd = dateMatch[0].length;
    const firstAmountIdx = lineText.indexOf(creditMatches[0].amount.toString().replace('.', ',') || creditMatches[0].amount.toFixed(2));

    // Find position of first credit pattern in line
    const firstCreditPatternIdx = lineText.search(/([\d,]+\.\d{2})\s+Cr\b/i);

    // Description is between end of date and start of first amount
    let description = '';
    if (firstCreditPatternIdx > dateEnd) {
      description = lineText.substring(dateEnd, firstCreditPatternIdx).trim();
    }
    // Clean up description: remove trailing/leading whitespace, normalise spaces
    description = description.replace(/\s+/g, ' ').trim() || 'Payment';

    const reference = harRef || description;

    console.log(`TX: date=${date} amount=${paymentAmount} ref="${reference.substring(0,30)}" desc="${description.substring(0,40)}"`);

    return {
      date,
      description,
      amount: paymentAmount,
      reference,
      rawLine: lineText,
      hasStudentId: !!harRef
    };
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
