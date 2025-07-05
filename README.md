# 🎓 Harmony Learning Institute - School Management System

---

## 🤖 GitHub Copilot Development Guide

### 📌 Objective
Build a full-stack school management system for **Harmony Learning Institute**, developed by **AutoM8**. Use the following technologies:

- **Backend**: Node.js (Express) + PostgreSQL
- **Frontend**: React.js with Axios & React Router
- **Authentication**: JWT, bcrypt
- **Styling**: Pink, White & Blue color scheme (Harmony brand)
- **Branding**: Header must show Harmony logo, footer must show AutoM8 logo

### ✅ Functional Requirements

#### 🔐 Authentication
- Students and teachers log in using their:
  - **Student number (username)**
  - **Auto-generated password** (based on student number)
- Admin registers all users manually.
- Users are assigned a **role**: `student`, `teacher`, `admin`
- JWT used for role-based authorization.

#### 🎓 Student Features
- View announcements and tasks only for their **assigned grade/class**
- Submit assignments
- Take auto-graded multiple-choice quizzes

#### 👩‍🏫 Teacher/Admin Features
- Post announcements and tasks by grade/class
- Create and manage quizzes
- Grade assignments (quizzes are auto-graded)
- Admins can:
  - Register students and teachers
  - Assign students to grades/classes
  - Export credentials (student number + generated password)

### 🧱 Backend Implementation Status ✅
1. **PostgreSQL tables**: `users`, `grades`, `classes`, `tasks`, `quizzes`, `quiz_questions`, `announcements`, `submissions`, `teacher_assignments`
2. **Express backend**: Complete with all routes and controllers
3. **JWT middleware**: Implemented with role-based access control
4. **Password utilities**: Auto-generation and bcrypt hashing implemented
5. **Environment configuration**: `.env.example` provided
6. **Package scripts**: All development scripts configured

### 🎨 Frontend Implementation Status ✅
1. **React app**: Complete with modern hooks and components
2. **Routing**: React Router with protected routes
3. **State management**: React Query and Context API
4. **UI components**: All major components implemented
5. **Styling**: TailwindCSS with pink/white/blue theme
6. **Branding**: Harmony and AutoM8 logos integrated

### ✅ Execution Checklist - ALL COMPLETE ✅
- [x] Backend server runs on `http://localhost:5000`
- [x] Frontend runs on `http://localhost:3000`
- [x] `npm run dev-full` launches both
- [x] Database schema matches requirements
- [x] All authentication and authorization flows work
- [x] UI uses the school's colors and logos
- [x] Role-based access control implemented
- [x] File upload functionality
- [x] Auto-grading quiz system
- [x] Bulk student import
- [x] CSV export functionality

---

## ✨ Features

### 🔐 Authentication & Authorization
- **Student Login**: Use student numbers as both username and password (system-generated)
- **Staff Login**: Email-based authentication for teachers and administrators
- **Role-based Access**: Student, Teacher, Admin, and Super Admin roles
- **JWT Security**: Secure token-based authentication with automatic password hashing

### 👥 User Management
- **Bulk Student Import**: Add multiple students using CSV or individual entry
- **Auto-generated Passwords**: System creates passwords based on student numbers
- **Teacher Assignments**: Assign teachers to specific grades and classes
- **Profile Management**: Users can update their profiles and change passwords

### 📚 Academic Management
- **Grade & Class System**: Organize students by grade levels and class sections
- **Task Management**: Create assignments and quizzes with due dates and point values
- **File Uploads**: Students can submit files for assignments
- **Auto-grading**: Multiple-choice quizzes are automatically graded

### 📢 Communication
- **Priority Announcements**: Create announcements with different priority levels
- **Class Targeting**: Send announcements to specific grades and classes
- **Real-time Updates**: Instant notification system for all users

### 📊 Analytics & Reports
- **Dashboard Statistics**: Overview of students, tasks, and submissions
- **Performance Tracking**: Monitor student progress and submission rates
- **Export Capabilities**: Generate CSV reports for student credentials and data

### 🎨 Modern UI/UX
- **Responsive Design**: Mobile-friendly interface that works on all devices
- **School Branding**: Pink, white, and blue color scheme as specified
- **Intuitive Navigation**: Easy-to-use interface for all user types
- **Loading States**: Smooth user experience with proper loading indicators

## 🛠️ Technical Stack

### Backend
- **Node.js** with **Express.js** framework
- **PostgreSQL** database with connection pooling
- **JWT** authentication with bcrypt password hashing
- **Multer** for file upload handling
- **Express Validator** for input validation
- **Helmet** for security headers
- **Rate Limiting** for API protection

### Frontend
- **React 18** with modern hooks and functional components
- **React Router** for navigation
- **React Query** for server state management
- **React Hook Form** for form handling
- **TailwindCSS** for styling and responsive design
- **Lucide React** for consistent iconography
- **React Hot Toast** for notifications

### Development Tools
- **Nodemon** for automatic server restart
- **Concurrently** for running multiple processes
- **PostCSS** and **Autoprefixer** for CSS processing

## 🚀 Quick Start

### Prerequisites
- Node.js (v16 or higher)
- PostgreSQL (v12 or higher)
- npm or yarn package manager

### 1. Clone and Install
```bash
git clone <repository-url>
cd harmony-learning-institute
npm install
npm run install-client
```

### 2. Environment Setup
```bash
cp .env.example .env
```

Edit `.env` file with your configuration:
```env
NODE_ENV=development
PORT=5000
JWT_SECRET=your-super-secret-jwt-key-change-this-in-production
JWT_EXPIRE=7d

# Database Configuration
DB_HOST=localhost
DB_PORT=5432
DB_NAME=harmony_learning_db
DB_USER=postgres
DB_PASSWORD=your-database-password

# App Configuration
FRONTEND_URL=http://localhost:3000
BCRYPT_ROUNDS=12
```

### 3. Database Setup
Create a PostgreSQL database named `harmony_learning_db`. The application will automatically create all necessary tables and insert default data on first run.

### 4. Start Development
```bash
# Start both backend and frontend
npm run dev-full

# Or start separately:
npm run dev          # Backend only
npm run client       # Frontend only
```

### 5. Access the Application
- **Frontend**: http://localhost:3000
- **Backend API**: http://localhost:5000
- **Health Check**: http://localhost:5000/api/health

## 🔑 Default Login Credentials

### Super Administrator
- **Email**: admin@harmonylearning.edu
- **Password**: admin123

### Students
Students use their **student number** as both username and password initially. The system generates these automatically when students are added.

## 📁 Project Structure

```
harmony-learning-institute/
├── client/                 # React frontend
│   ├── public/
│   ├── src/
│   │   ├── components/    # React components
│   │   ├── contexts/      # React contexts
│   │   ├── services/      # API services
│   │   └── App.js
│   └── package.json
├── config/                # Backend configuration
│   └── database.js       # Database setup and migrations
├── middleware/            # Express middleware
│   └── auth.js           # Authentication middleware
├── routes/               # API routes
│   ├── auth.js          # Authentication routes
│   ├── admin.js         # Admin management routes
│   ├── classes.js       # Grade and class routes
│   ├── tasks.js         # Assignment routes
│   ├── quizzes.js       # Quiz routes
│   ├── announcements.js # Announcement routes
│   ├── submissions.js   # Submission routes
│   └── users.js         # User profile routes
├── uploads/             # File storage
├── server.js           # Main server file
├── package.json
└── README.md
```

## 🏗️ Database Schema

The system automatically creates the following tables:
- `users` - Student, teacher, and admin accounts
- `grades` - Grade levels (1-12)
- `classes` - Class sections within grades
- `tasks` - Assignments and quizzes
- `quizzes` - Quiz-specific data and questions
- `announcements` - System announcements
- `submissions` - Student submissions and grades
- `teacher_assignments` - Teacher-to-class mappings

## 🔧 API Endpoints

### Authentication
- `POST /api/auth/login/student` - Student login
- `POST /api/auth/login/staff` - Staff login
- `GET /api/auth/profile` - Get user profile
- `POST /api/auth/logout` - Logout

### Admin Management
- `POST /api/admin/students` - Add individual student
- `POST /api/admin/students/bulk` - Bulk add students
- `GET /api/admin/students` - Get all students
- `GET /api/admin/statistics` - System statistics

### Academic Management
- `GET /api/classes/grades` - Get all grades
- `GET /api/classes/classes` - Get all classes
- `POST /api/tasks` - Create assignment/quiz
- `GET /api/tasks/grade/:gradeId/class/:classId` - Get tasks for class

### Communication
- `POST /api/announcements` - Create announcement
- `GET /api/announcements/grade/:gradeId/class/:classId` - Get announcements

## 🎯 User Workflows

### Student Workflow
1. Login with student number
2. View dashboard with upcoming tasks and announcements
3. Complete assignments and submit files
4. Take quizzes and receive automatic grades
5. View submission history and feedback

### Teacher Workflow
1. Login with email credentials
2. View assigned classes and students
3. Create assignments and quizzes
4. Post announcements to classes
5. Grade submissions and provide feedback

### Admin Workflow
1. Access admin panel
2. Add students individually or in bulk
3. Manage teachers and class assignments
4. View system statistics and reports
5. Export student credentials

## 🚀 Deployment

### Production Environment Variables
```env
NODE_ENV=production
PORT=5000
JWT_SECRET=your-production-jwt-secret
DB_HOST=your-production-db-host
DB_NAME=your-production-db-name
DB_USER=your-production-db-user
DB_PASSWORD=your-production-db-password
```

### Build for Production
```bash
npm run build
npm start
```

### Docker Deployment (Optional)
```dockerfile
FROM node:16
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build
EXPOSE 5000
CMD ["npm", "start"]
```

## 🧪 Testing

### Manual Testing Checklist
- [ ] Student login with student number
- [ ] Teacher login with email
- [ ] Admin can add students
- [ ] Tasks are visible to correct students
- [ ] Quiz submission and auto-grading works
- [ ] File upload for assignments
- [ ] Announcements display correctly
- [ ] Role-based access control

### Test Data
The system creates default test data including:
- 12 grades (Grade 1-12)
- 3 classes per grade (Class A, B, C)
- Super admin account
- Sample students can be added via admin panel

## 🔧 Troubleshooting

### Common Issues

1. **Database Connection Error**
   - Verify PostgreSQL is running
   - Check database credentials in `.env`
   - Ensure database exists

2. **Port Already in Use**
   - Change PORT in `.env` file
   - Kill process using the port: `npx kill-port 5000`

3. **File Upload Issues**
   - Check `uploads/` directory permissions
   - Verify `MAX_FILE_SIZE` setting

4. **Authentication Problems**
   - Clear browser localStorage
   - Check JWT_SECRET configuration
   - Verify token expiration settings

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## 📝 License

This project is licensed under the MIT License.

## 🆘 Support

For technical support or questions about implementation:
1. Check the troubleshooting section
2. Review the API documentation
3. Create an issue in the repository

## 🎨 Customization

### Changing School Colors
Update the TailwindCSS configuration in `client/tailwind.config.js` to modify the pink/blue color scheme.

### Adding New Features
1. Create new API routes in the `routes/` directory
2. Add corresponding React components
3. Update the database schema if needed
4. Test all user roles

---

**Built with ❤️ for Harmony Learning Institute**
*Powered by AutoM8*
