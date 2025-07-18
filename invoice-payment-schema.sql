-- Invoice and Payment Management System Database Schema
-- Run this migration to create the required tables

-- Invoices table
CREATE TABLE IF NOT EXISTS invoices (
    id SERIAL PRIMARY KEY,
    student_id INTEGER NOT NULL,
    student_number VARCHAR(50) NOT NULL,
    amount_due DECIMAL(10,2) NOT NULL DEFAULT 0,
    amount_paid DECIMAL(10,2) DEFAULT 0,
    outstanding_balance DECIMAL(10,2) DEFAULT 0,
    overpaid_amount DECIMAL(10,2) DEFAULT 0,
    due_date DATE NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'Unpaid' CHECK (status IN ('Unpaid', 'Paid', 'Partial', 'Overpaid')),
    reference_number VARCHAR(50) NOT NULL UNIQUE,
    created_by INTEGER,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE,
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
);

-- Payment transactions table
CREATE TABLE IF NOT EXISTS payment_transactions (
    id SERIAL PRIMARY KEY,
    invoice_id INTEGER,
    reference_number VARCHAR(50) NOT NULL,
    amount DECIMAL(10,2) NOT NULL,
    payment_date DATE NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'Matched' CHECK (status IN ('Matched', 'Unmatched', 'Duplicate')),
    description TEXT,
    uploaded_by INTEGER,
    created_at TIMESTAMP DEFAULT NOW(),
    FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE SET NULL,
    FOREIGN KEY (uploaded_by) REFERENCES users(id) ON DELETE SET NULL
);

-- Payment upload logs table
CREATE TABLE IF NOT EXISTS payment_upload_logs (
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

-- Indexes for better performance
CREATE INDEX IF NOT EXISTS idx_invoices_student_id ON invoices(student_id);
CREATE INDEX IF NOT EXISTS idx_invoices_student_number ON invoices(student_number);
CREATE INDEX IF NOT EXISTS idx_invoices_reference_number ON invoices(reference_number);
CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status);
CREATE INDEX IF NOT EXISTS idx_invoices_due_date ON invoices(due_date);

CREATE INDEX IF NOT EXISTS idx_payment_transactions_invoice_id ON payment_transactions(invoice_id);
CREATE INDEX IF NOT EXISTS idx_payment_transactions_reference_number ON payment_transactions(reference_number);
CREATE INDEX IF NOT EXISTS idx_payment_transactions_payment_date ON payment_transactions(payment_date);
CREATE INDEX IF NOT EXISTS idx_payment_transactions_status ON payment_transactions(status);

CREATE INDEX IF NOT EXISTS idx_payment_upload_logs_uploaded_by ON payment_upload_logs(uploaded_by);
CREATE INDEX IF NOT EXISTS idx_payment_upload_logs_created_at ON payment_upload_logs(created_at);

-- Update trigger for invoices
CREATE OR REPLACE FUNCTION update_invoice_outstanding_balance()
RETURNS TRIGGER AS $$
BEGIN
    -- Calculate outstanding balance
    NEW.outstanding_balance = NEW.amount_due - COALESCE(NEW.amount_paid, 0);
    
    -- Set overpaid amount if applicable
    IF NEW.amount_paid > NEW.amount_due THEN
        NEW.overpaid_amount = NEW.amount_paid - NEW.amount_due;
        NEW.outstanding_balance = 0;
    ELSE
        NEW.overpaid_amount = 0;
    END IF;
    
    -- Update timestamp
    NEW.updated_at = NOW();
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_invoice_balance
    BEFORE UPDATE ON invoices
    FOR EACH ROW
    EXECUTE FUNCTION update_invoice_outstanding_balance();

-- Insert trigger for invoices (set initial outstanding balance)
CREATE OR REPLACE FUNCTION set_initial_invoice_balance()
RETURNS TRIGGER AS $$
BEGIN
    NEW.outstanding_balance = NEW.amount_due;
    NEW.amount_paid = COALESCE(NEW.amount_paid, 0);
    NEW.overpaid_amount = 0;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_set_initial_invoice_balance
    BEFORE INSERT ON invoices
    FOR EACH ROW
    EXECUTE FUNCTION set_initial_invoice_balance();
