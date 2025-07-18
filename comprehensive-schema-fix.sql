-- Comprehensive database schema fix for payment processing
-- This script fixes all column mismatches and ensures proper schema alignment

-- 1. Fix payment_transactions table
DO $$
BEGIN
    -- Check if transaction_date exists and payment_date doesn't
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'payment_transactions' AND column_name = 'transaction_date'
    ) AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'payment_transactions' AND column_name = 'payment_date'
    ) THEN
        -- Rename transaction_date to payment_date
        ALTER TABLE payment_transactions RENAME COLUMN transaction_date TO payment_date;
        RAISE NOTICE 'Renamed transaction_date to payment_date';
    END IF;

    -- Ensure payment_date exists if it doesn't
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'payment_transactions' AND column_name = 'payment_date'
    ) THEN
        ALTER TABLE payment_transactions ADD COLUMN payment_date DATE NOT NULL DEFAULT CURRENT_DATE;
        RAISE NOTICE 'Added payment_date column';
    END IF;
END $$;

-- 2. Fix payment_upload_logs table schema
DO $$
BEGIN
    -- Drop and recreate payment_upload_logs with correct schema
    DROP TABLE IF EXISTS payment_upload_logs CASCADE;
    
    CREATE TABLE payment_upload_logs (
        id SERIAL PRIMARY KEY,
        filename VARCHAR(255) NOT NULL,
        uploaded_by INTEGER NOT NULL,
        transactions_processed INTEGER DEFAULT 0,
        matched_count INTEGER DEFAULT 0,
        partial_count INTEGER DEFAULT 0,
        overpaid_count INTEGER DEFAULT 0,
        unmatched_count INTEGER DEFAULT 0,
        duplicate_count INTEGER DEFAULT 0,
        error_count INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW(),
        FOREIGN KEY (uploaded_by) REFERENCES users(id) ON DELETE CASCADE
    );
    
    RAISE NOTICE 'Recreated payment_upload_logs table with correct schema';
END $$;
