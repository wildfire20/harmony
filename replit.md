# Harmony Learning Institute

## Overview
A school management system for Harmony Learning Institute. This is a full-stack Node.js/Express application with a React frontend.

## Project Structure
- `server.js` - Main Express backend server
- `client/` - React frontend application
- `config/` - Configuration files (database, S3)
- `routes/` - API route handlers
- `middleware/` - Express middleware
- `services/` - Business logic services
- `utils/` - Utility functions

## Tech Stack
- **Backend**: Node.js, Express.js
- **Frontend**: React 18, TailwindCSS
- **Database**: PostgreSQL
- **File Storage**: AWS S3 (optional)
- **Authentication**: JWT

## Running the Application
- The server runs on port 5000 in production mode
- Frontend is built and served statically by the Express server
- Database is PostgreSQL (Replit-provided)

## Environment Variables
- `NODE_ENV` - Set to "production"
- `PORT` - Server port (5000)
- `JWT_SECRET` - Secret for JWT tokens
- `DATABASE_URL` - PostgreSQL connection URL (auto-provided)
- `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE` - PostgreSQL credentials (auto-provided)

## Default Admin Login
- Email: admin@harmonylearning.edu
- Password: admin123

## Features
- User authentication (students, teachers, admins)
- Task/assignment management
- Quiz system
- Document library
- Announcements
- Payment/invoice system
- Analytics dashboard
- **Public Landing Page** - Beautiful homepage for non-authenticated visitors
- **Online Enrollment** - Parents can submit enrollment applications through the public form
- **Enrollment Management** - Admins can review, approve, or reject enrollment applications

## Public Pages
- **Landing Page** (`/`) - Displays for non-authenticated users with:
  - Hero section with school information
  - About section
  - Programs overview (Preschool, Primary, Boarding)
  - Enrollment form for parents to submit applications
  - Footer with contact information
- **Login Page** (`/login`) - Portal login for existing users

## Design & Branding
- **Color Scheme**: Red/Pink/Blue/White from official school logo
  - Primary: #dc2626 (Red from logo book)
  - Secondary: #1e40af (Blue from logo head and text)
  - Accent: White
  - Light pink accents for gradients
- **School Images**: 14 photos in `/client/public/images/school/` featuring:
  - School entrance and buildings
  - Students in uniform (red tartan/plaid)
  - Heritage Day celebrations
  - Field trips and activities
  - Computer lab and learning
  - Staff team photos
  - Graduation and concerts

## Contact Information
- **Address**: 2 Skilferdoring Street, Onverwacht, Lephalale
- **WhatsApp**: 071 167 9620
- **Phone**: 014 763 1358
- **Email**: harmonylearninginstitute@gmail.com

## Digital Attendance System
- **Attendance Register** - Teachers can take daily class attendance with one-tap workflow
- **Default Present** - All students default to "Present" status, teachers only mark exceptions
- **Status Options**: Present, Absent, Late, Excused (with optional notes)
- **Real-Time Dashboard** - Admins see who is in school right now (auto-refreshes every 30s)
- **Late Tracking Report** - Identifies students habitually late (configurable thresholds)
- **Attendance Statistics** - Daily stats, missing class alerts, grade-by-grade breakdown
- **Timestamp Recording** - Records when and who took attendance
- **Access Control**: Teachers see only assigned classes, admins see school-wide reports

## Payment System
- **Invoice Generation** - Generate monthly invoices for all students
- **CSV Bank Statement Upload** - Upload bank statements with auto-column detection
- **PDF Bank Statement Upload** - Upload FNB PDF bank statements with automatic parsing
- **Payment Reconciliation** - Match payments using HAR-prefixed student IDs
- **Manual Payment Entry** - Admin feature to manually add payments when parents didn't use student number as reference:
  - Search for student by name or number
  - Enter payment amount, date, month/year
  - Add optional bank reference and notes
  - Edit or delete manual payments
  - Automatically updates invoice balances
- **Student Payment History Export** - Search for students and download Excel reports showing:
  - School logo at the top of the document
  - Monthly payment breakdown
  - Amount due, paid, and outstanding per month
  - Payment status (Paid, Partial, Missed)
  - Summary totals and statistics
  - **Banking Details** for parent convenience:
    - Bank: First National Bank (FNB)
    - Account Holder: Harmony Learning Institute
    - Account Type: Cheque
    - Account Number: 63053202265
    - Branch Code: 210755
    - Reference instruction (student number)

## Email Notifications
- **Enrollment Notifications** - Admins receive email alerts when parents submit new enrollment applications
- Emails include: Student name, DOB, grade applying for, parent contact info, boarding preference, previous school, notes
- Uses Gmail integration for reliable delivery
- Email sent to: harmonylearninginstitute@gmail.com (configurable via ADMIN_NOTIFICATION_EMAIL env var)

## Grade Promotion System
- **Single Grade Promotion** - Move all students from one grade to another
- **Bulk Year-End Promotion** - Promote all grades at once (Grade 1→2, 2→3, etc.)
- **Visual Dashboard** - Shows current student distribution across grades
- **Class Assignment Reset** - Students are unassigned from classes after promotion for manual reassignment
- **Archived Student Protection** - Only active students are promoted; archived students are excluded

## Student Archive System
- **Archive Students** - Mark students as inactive when they leave the school
- **Bulk Archive** - Archive multiple students at once from filtered views
- **Archive Reason Tracking** - Optional reason field for audit trail
- **Unarchive/Restore** - Reactivate archived students when needed
- **Separate Views** - Toggle between active and archived students in management

## Password Management System
- **Password Portal** - Admins can view and manage student/teacher passwords
- **Kid-Friendly Passwords** - System generates easy-to-remember passwords (e.g., "HappyLion42", "BraveTiger78")
- **Password Reset** - Reset individual or bulk passwords with one click
- **Display Passwords** - Admins can view current passwords to share with students/parents
- **Custom Passwords** - Option to set custom passwords or auto-generate
- **Copy to Clipboard** - Easy copy button for sharing passwords

## Parent Portal Auth System (April 2026 – Redesign)
- **Phone Number Login** – parents log in with their mobile number (no email required); normalizes SA numbers (0xx → 27xx)
- **Multiple Children** – one phone number can link to many students; portal shows a child-switcher dropdown/tabs in the header
- **First-Time Login Flow** – admin creates parent → system auto-generates a temporary password → parent forced to set a new one on first login
- **Forgot Password (OTP)** – 3-step flow: enter phone → receive 6-digit code (SMS via Twilio if configured, otherwise code shown to admin) → enter new password
- **Admin Tools** – "Sync from Enrollments" button auto-creates parent accounts from approved enrollment records using the `parent_phone` field; admin can also reset passwords (shows new temp password in UI)
- **Database** – added `phone_number`, `must_change_password` columns to `users`; `parent_students` now allows multiple rows per parent (`uq_parent_student` unique on pair); new `parent_otps` table for OTP/reset tokens
- **SMS** – Twilio used if `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER` env vars are set; falls back to console log + admin-visible OTP

## Parent Portal (April 2026)
- **Separate Parent Portal** at `/parent/login` — parents log in with email + password (completely separate from the main staff/student portal)
- **Dashboard** — shows this week's attendance summary, recent grades, outstanding fee balance, and latest notices
- **Attendance View** — full monthly attendance history with status breakdown (Present / Absent / Late / Excused), month/year filter
- **Academic Progress** — graded submissions with scores, percentage bars, teacher feedback, and pending/overdue tasks
- **Notices & Announcements** — school-wide and grade-specific announcements from teachers and admin, tap to expand
- **Fees / Invoices** — full invoice history, payment status, outstanding balance, and FNB banking details with child's student number as reference
- **Mobile-Friendly** — responsive layout with bottom navigation bar on mobile, sidebar on desktop
- **Parent Account Management** — admins create parent accounts in Admin Panel → "Parent Accounts" tab; link each parent to their child by searching by name or student number
- **Secure & Isolated** — parents can only see their own linked child's data; uses a separate `parent_students` link table and `parent` role in the database
- **Landing Page** — "Parent Portal" button added to the public homepage navbar alongside "Staff Login"

## Recent Changes (March 2026)
- **Weekly Attendance Report** - Admin can now view all grades' attendance for an entire week (Mon-Fri) in one view. Select start/end dates, navigate weeks with Previous/Next buttons. Shows daily attendance percentages per class with expandable student-by-student grids showing P/A/L/E status for each day. Weekly summary column per student.
- **Payment System Schema Fix** - Fixed `payment_transactions` table schema mismatch between bank statement processing and manual payment features. Added missing columns (`recorded_by`, `payment_method`, `month`, `year`, `payment_date`, `reference`) with automatic migration. Fixed invoice update queries to use `due_date`-based month/year matching instead of non-existent `month`/`year` columns on `invoices` table. Disabled destructive `quick-db-fix.js` that was dropping and recreating tables on every startup.
- **Calendar Edit/Delete** - Added edit and delete functionality for school events. Migrated `school_events` table from DATE to TIMESTAMP columns to preserve event times.

## Recent Changes (January 2026)
- **Password Management Portal** - Admin tool to view and reset student/teacher passwords with kid-friendly generation
- **Teacher Archiving** - Archive inactive teachers who leave school (with restore option)
- **Active-Only Default Views** - Student and teacher lists now show only active users by default
- **Grade Promotion System** - End-of-year tool for moving students to next grade level
- **Student Archiving** - Archive inactive students who leave school (with restore option)
- **Email Enrollment Notifications** - Gmail integration to notify admins of new applications

## Recent Changes (December 2025)
- **Student Payment Excel Export** - Added feature to search students and download individual payment history as Excel
- **Preschool Age Range Updated** - Preschool now accepts ages 0-6 (was 3-5)
- **Enrollment Message Updated** - Now accepting applications for 2026
- **Digital Attendance System** - Complete attendance tracking for teachers and admins
- Complete design overhaul to match actual school branding
- Added hero carousel with school entrance and activity photos
- Created photo gallery section featuring 9 school images
- Updated color scheme from pink/navy to orange/yellow/red/blue
- Updated all components (logo, login, portal) with new branding
- Added public-facing enrollment system
- Created landing page with enrollment form
- Added admin enrollment management interface
- Fixed enrollment API to accept unauthenticated submissions
- Added floating WhatsApp button on landing page
- Updated footer contact information with new address, phone numbers, and email
- Added Enrollments tab to Admin Panel for managing applications
- Logout now redirects to homepage instead of login page
