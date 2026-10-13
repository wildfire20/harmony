
  CREATE TABLE grades (
    id SERIAL PRIMARY KEY, name VARCHAR(80) NOT NULL UNIQUE
  );
  CREATE TABLE users (
    id SERIAL PRIMARY KEY, student_number VARCHAR(50) UNIQUE, email VARCHAR(255),
    password VARCHAR(255) NOT NULL DEFAULT 'test', first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL, role VARCHAR(30) NOT NULL, grade_id INTEGER,
    class_id INTEGER, is_active BOOLEAN NOT NULL DEFAULT true,
    is_boarder BOOLEAN NOT NULL DEFAULT false, uses_transport BOOLEAN NOT NULL DEFAULT false,
    uses_aftercare BOOLEAN NOT NULL DEFAULT false, has_sibling_discount BOOLEAN NOT NULL DEFAULT false,
    has_teacher_discount BOOLEAN NOT NULL DEFAULT false, phone_number VARCHAR(50),
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE parent_students (
    parent_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    PRIMARY KEY (parent_id, student_id)
  );
  CREATE TABLE invoices (
    id SERIAL PRIMARY KEY, student_id INTEGER NOT NULL REFERENCES users(id),
    student_number VARCHAR(50), amount_due NUMERIC(12,2) NOT NULL,
    amount_paid NUMERIC(12,2) NOT NULL DEFAULT 0,
    outstanding_balance NUMERIC(12,2) NOT NULL DEFAULT 0,
    overpaid_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
    due_date DATE, status VARCHAR(40) NOT NULL,
    carried_forward_to_invoice_id INTEGER, description TEXT,
    reference_number VARCHAR(255), created_by INTEGER, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE invoice_line_items (
    id SERIAL PRIMARY KEY, invoice_id INTEGER NOT NULL REFERENCES invoices(id),
    line_type VARCHAR(30) NOT NULL DEFAULT 'charge', service_key VARCHAR(80),
    bundle_key VARCHAR(80), label VARCHAR(255), description TEXT,
    quantity NUMERIC(12,2) DEFAULT 1, unit_amount NUMERIC(12,2) NOT NULL,
    amount NUMERIC(12,2) NOT NULL, is_included BOOLEAN NOT NULL DEFAULT false,
    discount_assignment_id INTEGER, metadata JSONB NOT NULL DEFAULT '{}'::jsonb
  );
  CREATE TABLE learner_discount_assignments (
    id SERIAL PRIMARY KEY, student_id INTEGER NOT NULL REFERENCES users(id),
    discount_type VARCHAR(40) NOT NULL, calculation_method VARCHAR(30) NOT NULL,
    amount NUMERIC(12,2) NOT NULL DEFAULT 0, percentage NUMERIC(6,2),
    applicable_service_key VARCHAR(80), reason TEXT, is_active BOOLEAN NOT NULL DEFAULT true,
    starts_on DATE NOT NULL, ends_on DATE
  );
  CREATE TABLE service_prices (
    id SERIAL PRIMARY KEY, service_key VARCHAR(80) NOT NULL UNIQUE, label VARCHAR(255) NOT NULL,
    description TEXT, amount NUMERIC(12,2) NOT NULL, display_order INTEGER NOT NULL DEFAULT 0,
    billing_mode VARCHAR(40) NOT NULL DEFAULT 'standalone', bundle_key VARCHAR(80),
    included_service_keys JSONB NOT NULL DEFAULT '[]'::jsonb,
    CONSTRAINT service_prices_billing_mode_check
      CHECK (billing_mode IN ('standalone', 'bundle_component', 'informational'))
  );
  CREATE TABLE student_fee_assignments (
    id SERIAL PRIMARY KEY, student_id INTEGER NOT NULL REFERENCES users(id),
    name VARCHAR(255), amount NUMERIC(12,2) DEFAULT 0
  );
  CREATE TABLE student_one_off_fees (
    id SERIAL PRIMARY KEY, student_id INTEGER NOT NULL REFERENCES users(id),
    name VARCHAR(255), description TEXT, due_date DATE, is_active BOOLEAN DEFAULT true
  );
  CREATE TABLE pending_payments (
    id SERIAL PRIMARY KEY, parent_id INTEGER NOT NULL REFERENCES users(id),
    student_id INTEGER NOT NULL REFERENCES users(id), amount NUMERIC(12,2) NOT NULL,
    payment_method VARCHAR(50) NOT NULL, reference VARCHAR(255), notes TEXT,
    receipt_file_name VARCHAR(255), receipt_file_path VARCHAR(500),
    receipt_s3_key VARCHAR(500), receipt_s3_url VARCHAR(1000), receipt_mime_type VARCHAR(100),
    receipt_data BYTEA, selected_obligations JSONB, status VARCHAR(30) NOT NULL DEFAULT 'pending',
    submitted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, payment_date DATE,
    reviewed_by INTEGER, reviewed_at TIMESTAMP, admin_note TEXT
  );
  CREATE TABLE payment_transactions (
    id SERIAL PRIMARY KEY, invoice_id INTEGER REFERENCES invoices(id),
    student_id INTEGER NOT NULL REFERENCES users(id), student_number VARCHAR(50),
    reference_number VARCHAR(255), reference VARCHAR(255), reverses_transaction_id INTEGER,
    amount NUMERIC(12,2) NOT NULL, transaction_date DATE NOT NULL, payment_date DATE,
    description TEXT, payment_method VARCHAR(50), recorded_by INTEGER,
    month INTEGER, year INTEGER, allocation_category VARCHAR(50),
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (reverses_transaction_id)
  );
  CREATE TABLE audit_logs (
    id SERIAL PRIMARY KEY, user_id INTEGER, user_name VARCHAR(255), user_role VARCHAR(50),
    action VARCHAR(120) NOT NULL, entity_type VARCHAR(80), entity_id INTEGER,
    details JSONB, ip_address VARCHAR(100), created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
