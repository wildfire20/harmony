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

## Management System Interface
- **Dark Sidebar Navigation**: Charcoal gray sidebar with all navigation items
- **Admin Navigation Items**: Dashboard, Student Management, Teacher Management, Enrollments, Announcements, Analytics, Class Management, Bulk Import, Gradebook, Resources, Attendance, Calendar
- **User Profile**: Bottom of sidebar shows user avatar, name, role, and Sign Out button
- **Dashboard Layout**: Clean white content area with:
  - Welcome message with user's name
  - Three stat cards (Announcements, Pending Assignments, Available Quizzes)
  - Two-column layout for Recent Announcements and Upcoming Assignments
- **Theme Support**: Light/dark mode toggle in top header

## Recent Changes (December 2025)
- Redesigned management system interface to match client's design mockup
- Created dark sidebar navigation with proper navigation items
- Updated AdminDashboard with clean card-based layout
- Complete design overhaul to match actual school branding
- Added hero carousel with school entrance and activity photos
- Created photo gallery section featuring 9 school images
- Updated color scheme to red/pink/blue/white matching official logo
- Updated all components (logo, login, portal) with new branding
- Added public-facing enrollment system
- Created landing page with enrollment form
- Added admin enrollment management interface
- Fixed enrollment API to accept unauthenticated submissions
