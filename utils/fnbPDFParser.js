const { PDFExtract } = require('pdf.js-extract');
const pdfExtract = new PDFExtract();

class FNBPDFParser {
  constructor() {
    this.datePatterns = [
      /^(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{4})$/i,
      /^(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})$/i,
      /^(\d{2})\/(\d{2})\/(\d{4})$/,
      /^(\d{4})-(\d{2})-(\d{2})$/
    ];
    
    this.amountPattern = /^-?R?\s*[\d,]+\.\d{2}$/;
    this.studentIdPattern = /HAR\d+/gi;
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
    
    pdfData.pages.forEach((page, pageIndex) => {
      const lines = this.groupContentByLine(page.content);
      
      lines.forEach((line, lineIndex) => {
        const transaction = this.parseTransactionLineWithPositions(line);
        if (transaction) {
          transactions.push(transaction);
        }
      });
    });
    
    return transactions;
  }

  groupContentByLine(content) {
    if (!content || content.length === 0) return [];
    
    const sortedContent = [...content].sort((a, b) => {
      if (Math.abs(a.y - b.y) < 3) {
        return a.x - b.x;
      }
      return a.y - b.y;
    });
    
    const lines = [];
    let currentLine = [];
    let currentY = null;
    const yTolerance = 5;
    
    sortedContent.forEach(item => {
      if (currentY === null || Math.abs(item.y - currentY) <= yTolerance) {
        currentLine.push(item);
        currentY = item.y;
      } else {
        if (currentLine.length > 0) {
          currentLine.sort((a, b) => a.x - b.x);
          lines.push(currentLine);
        }
        currentLine = [item];
        currentY = item.y;
      }
    });
    
    if (currentLine.length > 0) {
      currentLine.sort((a, b) => a.x - b.x);
      lines.push(currentLine);
    }
    
    return lines;
  }

  parseTransactionLineWithPositions(lineItems) {
    if (!lineItems || lineItems.length < 3) return null;
    
    const lineText = lineItems.map(item => item.str.trim()).filter(s => s).join(' ');
    
    const dateMatch = this.findDate(lineText);
    if (!dateMatch) return null;
    
    const studentIds = lineText.match(this.studentIdPattern) || [];
    
    const amountsWithPositions = this.findAmountsWithPositions(lineItems);
    if (amountsWithPositions.length === 0) return null;
    
    amountsWithPositions.sort((a, b) => a.x - b.x);
    
    let creditAmount = 0;
    
    if (amountsWithPositions.length >= 3) {
      const creditCandidate = amountsWithPositions[amountsWithPositions.length - 2];
      if (creditCandidate && creditCandidate.amount > 0) {
        creditAmount = creditCandidate.amount;
      }
    } else if (amountsWithPositions.length === 2) {
      if (studentIds.length > 0) {
        const firstAmount = amountsWithPositions[0];
        if (firstAmount && firstAmount.amount > 0) {
          creditAmount = firstAmount.amount;
        }
      } else {
        return null;
      }
    } else if (amountsWithPositions.length === 1) {
      return null;
    }
    
    if (creditAmount <= 0) return null;
    
    const description = this.extractDescriptionFromItems(lineItems, dateMatch.matchedText, amountsWithPositions);
    
    const reference = studentIds.length > 0 ? studentIds[0].toUpperCase() : description;
    
    const isLikelyPayment = this.isLikelyPaymentTransaction(lineText, studentIds.length > 0);
    if (!isLikelyPayment && amountsWithPositions.length < 3) {
      return null;
    }
    
    return {
      date: dateMatch.date,
      description: description,
      amount: creditAmount,
      reference: reference,
      rawLine: lineText,
      hasStudentId: studentIds.length > 0
    };
  }
  
  isLikelyPaymentTransaction(lineText, hasStudentId) {
    if (hasStudentId) return true;
    
    const paymentKeywords = [
      /deposit/i,
      /payment/i,
      /transfer\s+in/i,
      /eft\s+in/i,
      /credit/i,
      /school\s*fee/i,
      /tuition/i,
      /received/i,
      /inward/i
    ];
    
    for (const pattern of paymentKeywords) {
      if (pattern.test(lineText)) {
        return true;
      }
    }
    
    const debitKeywords = [
      /debit\s+order/i,
      /purchase/i,
      /withdrawal/i,
      /atm/i,
      /transfer\s+out/i,
      /eft\s+out/i,
      /payment\s+to/i,
      /card\s+transaction/i,
      /service\s+fee/i,
      /bank\s+charge/i
    ];
    
    for (const pattern of debitKeywords) {
      if (pattern.test(lineText)) {
        return false;
      }
    }
    
    return false;
  }

  findAmountsWithPositions(lineItems) {
    const amounts = [];
    const amountRegex = /^-?R?\s*([\d,]+\.\d{2})$/;
    
    lineItems.forEach(item => {
      const text = item.str.trim();
      const match = text.match(amountRegex);
      if (match) {
        const cleanAmount = match[1].replace(/,/g, '');
        const amount = parseFloat(cleanAmount);
        if (!isNaN(amount) && amount > 0) {
          const isNegative = text.startsWith('-');
          amounts.push({
            amount: isNegative ? -amount : amount,
            x: item.x,
            text: text
          });
        }
      }
    });
    
    return amounts;
  }

  findDate(text) {
    const parts = text.split(/\s+/);
    
    for (let i = 0; i < parts.length; i++) {
      for (let j = 1; j <= 3 && i + j <= parts.length; j++) {
        const potentialDate = parts.slice(i, i + j).join(' ');
        
        for (const pattern of this.datePatterns) {
          const match = potentialDate.match(pattern);
          if (match) {
            const parsedDate = this.parseDate(potentialDate);
            if (parsedDate) {
              return { date: parsedDate, matchedText: potentialDate };
            }
          }
        }
      }
    }
    
    return null;
  }

  parseDate(dateStr) {
    const monthMap = {
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
    
    const fnbPattern = /^(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})$/i;
    let match = dateStr.match(fnbPattern);
    if (match) {
      const day = match[1].padStart(2, '0');
      const month = monthMap[match[2].toLowerCase()];
      const year = match[3];
      return `${year}-${month}-${day}`;
    }
    
    const slashPattern = /^(\d{2})\/(\d{2})\/(\d{4})$/;
    match = dateStr.match(slashPattern);
    if (match) {
      return `${match[3]}-${match[2]}-${match[1]}`;
    }
    
    const isoPattern = /^(\d{4})-(\d{2})-(\d{2})$/;
    match = dateStr.match(isoPattern);
    if (match) {
      return dateStr;
    }
    
    return null;
  }

  extractDescriptionFromItems(lineItems, dateText, amountsWithPositions) {
    const amountXPositions = new Set(amountsWithPositions.map(a => a.x));
    
    let description = '';
    lineItems.forEach(item => {
      const text = item.str.trim();
      if (!amountXPositions.has(item.x) && text && !text.match(/^-?R?\s*[\d,]+\.\d{2}$/)) {
        description += text + ' ';
      }
    });
    
    description = description.replace(dateText, '');
    description = description.replace(/\s+/g, ' ').trim();
    
    return description || 'Payment';
  }

  async analyzeFile(filePath) {
    const result = await this.parsePDF(filePath);
    
    const sampleTransactions = result.transactions.slice(0, 5).map(t => ({
      date: t.date,
      description: t.description.substring(0, 50) + (t.description.length > 50 ? '...' : ''),
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
