const fs = require('fs');
const path = require('path');

// Create sample CSV files with different bank formats

// Standard 3-column format (current system)
const standardCSV = `reference,amount,date,description
SUT001,2850.00,2025-01-15,Student Payment
HAR234,2850.00,2025-01-16,Monthly Fee
098,1425.00,2025-01-17,Partial Payment
SUT567,5700.00,2025-01-18,Double Payment`;

// Standard Bank format with extra columns
const standardBankCSV = `Date,Description,Reference,Debit,Credit,Balance
2025-01-15,"PAYMENT FROM STUDENT SUT001","",,"2850.00","15420.00"
2025-01-16,"MONTHLY FEE HAR234","ONLINE PMT",,"2850.00","18270.00"
2025-01-17,"STUDENT PAYMENT 098","INTERNET",,"1425.00","19695.00"
2025-01-18,"OVERPAYMENT SUT567","BRANCH",,"5700.00","25395.00"
2025-01-19,"OPENING BALANCE","","12570.00",,"12570.00"`;

// FNB Bank format
const fnbCSV = `Transaction Date,Value Date,Description,Debit Amount,Credit Amount,Running Balance
2025-01-15,2025-01-15,"PAYMENT RECEIVED FROM STUDENT SUT001",,"2850.00","15420.00"
2025-01-16,2025-01-16,"SCHOOL FEE FROM HAR234",,"2850.00","18270.00"
2025-01-17,2025-01-17,"PARTIAL PAYMENT FROM STUDENT 098",,"1425.00","19695.00"
2025-01-18,2025-01-18,"EDUCATION FEE SUT567",,"5700.00","25395.00"`;

// ABSA Bank format
const absaCSV = `Account,Date,Transaction Date,Description,Reference,Amount,Balance,Uncategorised
"12345","2025-01-15","2025-01-15","INTERNET PAYMENT","SUT001","2850.00","15420.00",""
"12345","2025-01-16","2025-01-16","PAYMENT RECEIVED","HAR234","2850.00","18270.00",""
"12345","2025-01-17","2025-01-17","STUDENT PAYMENT","098","1425.00","19695.00",""
"12345","2025-01-18","2025-01-18","SCHOOL FEE","SUT567","5700.00","25395.00",""`;

// Capitec Bank format with complex references
const capitecCSV = `Date,Time,Description,Reference,Amount,Balance
2025-01-15,09:30,"PAYMENT FROM HARMONY LEARNING STUDENT ID: SUT001","WEB12345","2850.00","15420.00"
2025-01-16,10:15,"MONTHLY TUITION FEE FOR GRADE R HAR234","APP67890","2850.00","18270.00"
2025-01-17,14:22,"PARTIAL PAYMENT GRADE 3 STUDENT 098","USSD555","1425.00","19695.00"
2025-01-18,16:45,"FULL PAYMENT RECEIVED SUT567","BRANCH001","5700.00","25395.00"`;

// Nedbank format with separate debit/credit
const nedbankCSV = `Date,Narrative,Reference,Debit,Credit,Balance
2025-01-15,"PAYMENT FOR STUDENT SUT001","PMT001","","2850.00","15420.00"
2025-01-16,"SCHOOL FEE HAR234","EDU002","","2850.00","18270.00"
2025-01-17,"PARTIAL PAYMENT STUDENT 098","PAY003","","1425.00","19695.00"
2025-01-18,"OVERPAYMENT SUT567","OVR004","","5700.00","25395.00"
2025-01-19,"BANK CHARGES","CHG001","25.00","","25370.00"`;

// Create uploads directory if it doesn't exist
const uploadsDir = path.join(__dirname, 'test-csv-samples');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Write sample files
fs.writeFileSync(path.join(uploadsDir, 'standard-format.csv'), standardCSV);
fs.writeFileSync(path.join(uploadsDir, 'standard-bank-format.csv'), standardBankCSV);
fs.writeFileSync(path.join(uploadsDir, 'fnb-bank-format.csv'), fnbCSV);
fs.writeFileSync(path.join(uploadsDir, 'absa-bank-format.csv'), absaCSV);
fs.writeFileSync(path.join(uploadsDir, 'capitec-bank-format.csv'), capitecCSV);
fs.writeFileSync(path.join(uploadsDir, 'nedbank-format.csv'), nedbankCSV);

console.log('✅ Sample CSV files created successfully!');
console.log('📁 Files created in: test-csv-samples/');
console.log('');
console.log('📋 Available sample files:');
console.log('  • standard-format.csv - Current 3-column format');
console.log('  • standard-bank-format.csv - Standard Bank with extra columns');
console.log('  • fnb-bank-format.csv - FNB format with debit/credit');
console.log('  • absa-bank-format.csv - ABSA format with multiple columns');
console.log('  • capitec-bank-format.csv - Capitec with complex descriptions');
console.log('  • nedbank-format.csv - Nedbank with separate debit/credit');
console.log('');
console.log('🚀 You can now test the enhanced payment system with these files!');

// Create a README file explaining how to use the samples
const readmeContent = `# Enhanced Payment System - CSV Test Samples

This directory contains sample CSV files in different bank statement formats to test the enhanced payment system's flexible CSV processing capabilities.

## Sample Files

### 1. standard-format.csv
- Current system format with 3 columns
- Columns: reference, amount, date, description
- Should work with existing system and new enhanced system

### 2. standard-bank-format.csv  
- Standard Bank statement format
- Extra columns: Date, Description, Reference, Debit, Credit, Balance
- Tests reference extraction from Description field
- Tests credit/debit column separation

### 3. fnb-bank-format.csv
- FNB bank statement format
- Columns: Transaction Date, Value Date, Description, Debit Amount, Credit Amount, Running Balance
- Tests date column mapping and amount extraction from credit column

### 4. absa-bank-format.csv
- ABSA bank statement format
- Columns: Account, Date, Transaction Date, Description, Reference, Amount, Balance, Uncategorised
- Tests direct reference column mapping

### 5. capitec-bank-format.csv
- Capitec bank statement format
- Complex reference patterns in description field
- Tests advanced reference extraction from descriptions

### 6. nedbank-format.csv
- Nedbank format with separate debit/credit columns
- Tests debit/credit column handling
- Includes bank charges (should be filtered out by amount)

## Testing the Enhanced System

1. **Upload any of these files** through the enhanced payment dashboard
2. **Review auto-detected column mappings** - system should automatically detect most columns
3. **Adjust mappings manually** if auto-detection confidence is low
4. **Save successful mappings** for future use with same bank format
5. **Process transactions** and verify matching works correctly

## Expected Results

All sample files contain the same student references:
- SUT001: R2,850.00 (should match exactly)
- HAR234: R2,850.00 (should match exactly)  
- 098: R1,425.00 (should be partial payment)
- SUT567: R5,700.00 (should be overpayment if invoice amount is R2,850)

The enhanced system should:
- ✅ Auto-detect column mappings with high confidence
- ✅ Extract student references correctly
- ✅ Handle different date formats
- ✅ Process credit amounts properly
- ✅ Skip header/balance rows automatically
- ✅ Normalize amounts correctly
`;

fs.writeFileSync(path.join(uploadsDir, 'README.md'), readmeContent);

console.log('📖 README.md created with detailed testing instructions');
console.log('');
console.log('🎯 Next Steps:');
console.log('1. Start your development server');
console.log('2. Log in as admin user');
console.log('3. Go to Payments → Upload Bank Statement');
console.log('4. Test with different CSV formats from test-csv-samples/');
console.log('5. Verify auto-detection and manual mapping work correctly');
