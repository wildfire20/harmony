# Enhanced Payment System - CSV Test Samples

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
