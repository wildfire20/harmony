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
- **Student Payment History Export** - Search for students and download Excel reports showing:
  - Monthly payment breakdown
  - Amount due, paid, and outstanding per month
  - Payment status (Paid, Partial, Missed)
  - Summary totals and statistics

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
