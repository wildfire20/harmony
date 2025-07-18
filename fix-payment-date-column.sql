-- Migration to fix payment_transactions table column name
-- This script will rename transaction_date to payment_date if it exists

-- Check if the old column exists and rename it
DO $$
BEGIN
    -- Check if transaction_date column exists
    IF EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'payment_transactions' 
        AND column_name = 'transaction_date'
    ) THEN
        -- Rename the column
        ALTER TABLE payment_transactions 
        RENAME COLUMN transaction_date TO payment_date;
        
        RAISE NOTICE 'Renamed transaction_date to payment_date in payment_transactions table';
    ELSE
        RAISE NOTICE 'Column transaction_date does not exist, no change needed';
    END IF;
    
    -- Ensure payment_date column exists with correct type
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'payment_transactions' 
        AND column_name = 'payment_date'
    ) THEN
        -- Add the column if it doesn't exist
        ALTER TABLE payment_transactions 
        ADD COLUMN payment_date DATE NOT NULL DEFAULT CURRENT_DATE;
        
        RAISE NOTICE 'Added payment_date column to payment_transactions table';
    END IF;
END $$;
