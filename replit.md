# Harmony Learning Institute

## Overview
Harmony Learning Institute is a full-stack Node.js/Express application with a React frontend, designed as a comprehensive school management system. Its purpose is to streamline administrative tasks, enhance communication between staff, students, and parents, and provide robust tools for educational management. The system aims to digitalize core school operations such as attendance, payments, enrollment, and academic progress tracking. Key capabilities include user authentication, task management, quiz systems, document libraries, announcements, and an analytics dashboard. The project also features a public-facing landing page with online enrollment, and a dedicated parent portal to improve engagement and access to student information.

## User Preferences
The user desires an iterative development approach. They want to be asked before major changes are made. The user prefers detailed explanations for features and changes. The user prefers a clean and organized codebase with clear separation of concerns.

## System Architecture
The application is built with a Node.js/Express.js backend and a React 18 frontend, styled with TailwindCSS. PostgreSQL serves as the primary database. The system supports optional AWS S3 integration for file storage and uses JWT for authentication.

**UI/UX Decisions:**
- **Color Scheme**: Utilizes the official school logo's colors: Primary red (#dc2626), Secondary blue (#1e40af), and white, with light pink accents for gradients.
- **Imagery**: Features school-specific images including buildings, students in uniform, and school activities, located in `/client/public/images/school/`.
- **Public Landing Page**: Includes a hero section, about section, programs overview (Preschool, Primary, Boarding), an enrollment form, and a footer with contact information.
- **Parent Portal**: Designed to be mobile-friendly with a responsive layout, including a bottom navigation bar on mobile and a sidebar on desktop. It offers a dashboard view, detailed attendance history, academic progress, notices, and fee/invoice management.
- **Staff Attendance Kiosk**: A full-screen dark kiosk UI (`/staff-scan`) with a global keyboard listener for RFID/barcode scanners, animated states, and a live clock.

**Technical Implementations & Feature Specifications:**
- **User Authentication**: Supports students, teachers, and administrators with distinct roles and access levels.
- **Digital Attendance System**: Teachers can take daily attendance with a one-tap workflow, defaulting students to "Present." Includes statuses like Absent, Late, Excused with notes. Admins get a real-time dashboard and late tracking reports.
- **Payment System**: Enables generation of monthly invoices, payment reconciliation via CSV/PDF bank statement uploads, and manual payment entry. Provides student payment history exports in Excel format, including school branding and banking details.
- **Email Notifications**: Integrated with Gmail for enrollment notifications to admins, detailing applicant information.
- **Grade Promotion System**: Allows for single or bulk promotion of students between grades, resetting class assignments post-promotion, and excluding archived students.
- **Student & Teacher Archive System**: Functionality to mark students and teachers as inactive, with bulk archiving, reason tracking, and restore options. Separate views for active and archived users.
- **Password Management System**: Admin portal for viewing, generating (kid-friendly passwords like "HappyLion42"), resetting, and setting custom passwords for students and teachers.
- **Parent Portal Navigation**: 6-item bottom nav (Home, Attendance, Grades, Notices, Documents, Fees). "Pay" is merged into the Fees screen as a second tab ("Invoices" | "Submit Proof"). Visiting `/parent/payment-proof` redirects to `/parent/invoices`.
- **Parent Portal Authentication (April 2026 Redesign)**:
    - **Phone Number Login**: Parents log in using mobile numbers (SA numbers normalized to 27xx format).
    - **Multiple Children Support**: A single phone number can link to multiple students.
    - **First-Time Login Flow**: Admins create accounts, system auto-generates a temporary password, parents are prompted to set a new one on first login.
    - **Forgot Password (OTP)**: A 3-step process using SMS (via Twilio if configured, otherwise admin-visible OTP) for password reset.
    - **Self-Service Welcome Page**: `/parent/welcome` allows parents to view temporary passwords without staff intervention.
    - **Admin Tools**: "Sync from Enrollments" feature to create parent accounts from approved applications and tools for password resets and sharing welcome links.
- **Push Notifications (April 2026)**:
    - Implements Web Push API for real-time notifications to parents (e.g., new announcements, documents).
    - Utilizes VAPID keys for secure push messaging.
    - A Service Worker (`/sw.js`) handles push events and notification clicks.
    - Opt-in banner for parents, auto-subscription detection, and cleanup of dead subscriptions.
- **Staff Attendance Module (April 2026)**:
    - **Card Assignment**: Admin panel allows assigning RFID/barcode card IDs to staff members.
    - **Scanning Station**: A dedicated public-facing kiosk for staff to scan in/out, recording time stamps.
    - **In/Out Logic**: Tracks first scan as "Time In" and second as "Time Out" for the day.
    - **Daily Report**: Admin dashboard showing real-time staff status (On-Site, Signed-Out, Not Arrived) with auto-refresh and search/filter capabilities.
- **Proof of Payment & Dynamic Billing (April 2026)**:
    - **Proof of Payment (Parent Portal)**: `/parent/payment-proof` — parents select method (EFT/ATM/Cash/Online), enter amount, optionally check one-off fees, and upload receipt (image/PDF). Submissions tracked in `pending_payments` table; parents see status history.
    - **Admin Pending Payments**: Admin Panel → "Pending Payments" tab — lists all submissions with filters, receipt viewer, and Approve/Reject with optional note. Approval auto-applies payment to oldest unpaid invoice(s) and creates payment_transactions record.
    - **Student Enrollment Flags**: `users` table extended with `is_boarder`, `uses_transport`, `uses_aftercare` boolean columns. Admin can toggle these via checkboxes in the Student Management inline edit form.
    - **Dynamic Parent Billing**: Parent Fees screen shows service badges (Boarding, Transport, Aftercare) only when the child's flags are enabled.
    - **One-Off Fees**: Admin Panel → "One-Off Fees" tab — admins create fees (e.g., "Grade 4 Zoo Trip") with name/amount/description/grade/due date. System auto-assigns to all active students in that grade. Parents see their child's assigned fees as optional checkboxes in the Submit Proof form.

## External Dependencies
- **Database**: PostgreSQL
- **File Storage**: AWS S3 (optional)
- **Authentication**: JSON Web Tokens (JWT)
- **Email Service**: Gmail integration for notifications
- **SMS Service**: Twilio (optional, for Parent Portal OTPs if configured)