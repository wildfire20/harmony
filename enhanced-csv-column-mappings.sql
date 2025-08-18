-- Enhanced CSV Column Mappings Table
-- This table stores column mapping configurations for different bank CSV formats

CREATE TABLE IF NOT EXISTS csv_column_mappings (
    id SERIAL PRIMARY KEY,
    mapping_name VARCHAR(100) NOT NULL UNIQUE, -- e.g., "Standard Bank", "FNB", "ABSA"
    bank_name VARCHAR(50), -- Optional bank identifier
    reference_column VARCHAR(50), -- Column name for student reference
    amount_column VARCHAR(50), -- Column name for payment amount
    date_column VARCHAR(50), -- Column name for transaction date
    description_column VARCHAR(50), -- Column name for description/memo
    debit_column VARCHAR(50), -- Optional: specific debit column
    credit_column VARCHAR(50), -- Optional: specific credit column
    is_default BOOLEAN DEFAULT FALSE,
    created_by INTEGER NOT NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    last_used_at TIMESTAMP,
    use_count INTEGER DEFAULT 0,
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE
);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_csv_column_mappings_mapping_name ON csv_column_mappings(mapping_name);
CREATE INDEX IF NOT EXISTS idx_csv_column_mappings_bank_name ON csv_column_mappings(bank_name);
CREATE INDEX IF NOT EXISTS idx_csv_column_mappings_last_used ON csv_column_mappings(last_used_at DESC);

-- Insert default mapping for backward compatibility
INSERT INTO csv_column_mappings (
    mapping_name, 
    reference_column, 
    amount_column, 
    date_column, 
    description_column, 
    is_default,
    created_by
) VALUES (
    'Default (reference, amount, date)',
    'reference',
    'amount', 
    'date',
    'description',
    TRUE,
    1
) ON CONFLICT (mapping_name) DO NOTHING;

-- Sample bank mappings for common formats
INSERT INTO csv_column_mappings (
    mapping_name,
    bank_name,
    reference_column,
    amount_column,
    date_column,
    description_column,
    created_by
) VALUES 
(
    'Standard Bank Format',
    'Standard Bank',
    'Description',
    'Amount',
    'Date',
    'Description',
    1
),
(
    'FNB Bank Format', 
    'FNB',
    'Description',
    'Amount',
    'Date',
    'Description',
    1
),
(
    'ABSA Bank Format',
    'ABSA', 
    'Reference',
    'Amount',
    'Transaction Date',
    'Narrative',
    1
) ON CONFLICT (mapping_name) DO NOTHING;
