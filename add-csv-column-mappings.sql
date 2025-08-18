-- Create table to store CSV column mappings for different bank formats
CREATE TABLE IF NOT EXISTS csv_column_mappings (
    id SERIAL PRIMARY KEY,
    bank_identifier VARCHAR(255) NOT NULL,
    column_headers JSON NOT NULL,
    reference_column VARCHAR(255),
    amount_column VARCHAR(255),
    date_column VARCHAR(255),
    description_column VARCHAR(255),
    balance_column VARCHAR(255),
    debit_column VARCHAR(255),
    credit_column VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create unique index on bank_identifier to prevent duplicates
CREATE UNIQUE INDEX IF NOT EXISTS idx_csv_mappings_bank_identifier 
ON csv_column_mappings(bank_identifier);

-- Insert some common bank formats as defaults
INSERT INTO csv_column_mappings (
    bank_identifier, 
    column_headers, 
    reference_column, 
    amount_column, 
    date_column, 
    description_column
) VALUES 
-- Standard 3-column format (existing)
('standard_3col', 
 '["Reference", "Amount", "Date"]'::json, 
 'Reference', 
 'Amount', 
 'Date', 
 NULL),

-- Common bank statement format with Date, Amount, Balance, Description
('bank_standard', 
 '["Date", "Amount", "Balance", "Description"]'::json, 
 'Description', 
 'Amount', 
 'Date', 
 'Description'),

-- FNB/Standard Bank format
('fnb_standard', 
 '["Date", "Amount", "Balance", "Description", "Account"]'::json, 
 'Description', 
 'Amount', 
 'Date', 
 'Description'),

-- ABSA format
('absa_standard', 
 '["Transaction Date", "Debit", "Credit", "Balance", "Description"]'::json, 
 'Description', 
 'Debit', 
 'Transaction Date', 
 'Description')

ON CONFLICT (bank_identifier) DO UPDATE SET
    column_headers = EXCLUDED.column_headers,
    reference_column = EXCLUDED.reference_column,
    amount_column = EXCLUDED.amount_column,
    date_column = EXCLUDED.date_column,
    description_column = EXCLUDED.description_column,
    updated_at = CURRENT_TIMESTAMP;
