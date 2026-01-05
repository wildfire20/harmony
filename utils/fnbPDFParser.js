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
        const lineText = line.map(item => item.str.trim()).filter(s => s).join(' ');
        
        const transaction = this.parseTransactionLine(lineText, line);
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

  parseTransactionLine(lineText, lineItems) {
    const dateMatch = this.findDate(lineText);
    if (!dateMatch) return null;
    
    const amounts = this.findAmounts(lineText);
    if (amounts.length === 0) return null;
    
    const creditAmount = amounts.find(a => a > 0) || 0;
    if (creditAmount <= 0) return null;
    
    const description = this.extractDescription(lineText, dateMatch.matchedText, amounts);
    
    const studentIds = lineText.match(this.studentIdPattern) || [];
    const reference = studentIds.length > 0 ? studentIds[0].toUpperCase() : description;
    
    return {
      date: dateMatch.date,
      description: description,
      amount: creditAmount,
      reference: reference,
      rawLine: lineText,
      hasStudentId: studentIds.length > 0
    };
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

  findAmounts(text) {
    const amounts = [];
    const amountRegex = /-?R?\s*([\d,]+\.\d{2})/g;
    let match;
    
    while ((match = amountRegex.exec(text)) !== null) {
      const cleanAmount = match[1].replace(/,/g, '');
      const amount = parseFloat(cleanAmount);
      if (!isNaN(amount) && amount > 0) {
        const isNegative = match[0].trim().startsWith('-');
        amounts.push(isNegative ? -amount : amount);
      }
    }
    
    return amounts;
  }

  extractDescription(lineText, dateText, amounts) {
    let description = lineText;
    
    description = description.replace(dateText, '');
    
    amounts.forEach(amount => {
      const amountStr = amount.toFixed(2);
      description = description.replace(new RegExp(`R?\\s*${amountStr.replace('.', '\\.')}`, 'g'), '');
      const formattedAmount = amount.toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      description = description.replace(new RegExp(`R?\\s*${formattedAmount.replace('.', '\\.')}`, 'g'), '');
    });
    
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
