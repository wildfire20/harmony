import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from 'react-query';
import { Toaster } from 'react-hot-toast';
import { AuthProvider } from './contexts/AuthContext';
import { useAuth } from './contexts/AuthContext';
import { ThemeProvider } from './components/common/ThemeProvider';

// Components
import Login from './components/auth/Login';
import Dashboard from './components/dashboard/Dashboard';
import Layout from './components/layout/Layout';
import StudentDashboard from './components/dashboard/StudentDashboard';
import TeacherDashboard from './components/dashboard/TeacherDashboard';
import AdminDashboard from './components/dashboard/AdminDashboard';
import Tasks from './components/tasks/Tasks';
import TaskDetails from './components/tasks/TaskDetails';
import CreateTask from './components/tasks/CreateTask';
import QuizPlayer from './components/quizzes/QuizPlayer';
import QuizResults from './components/quiz/QuizResults';
import Announcements from './components/announcements/Announcements';
import Profile from './components/profile/Profile';
import AdminPanel from './components/admin/AdminPanel';
import Documents from './components/documents/DocumentLibrary';
import LoadingSpinner from './components/common/LoadingSpinner';

// New components
import Calendar from './components/calendar/Calendar';
import Quizzes from './components/quizzes/Quizzes';
import UserManagement from './components/users/UserManagement';
import Analytics from './components/analytics/Analytics';
import DebugPage from './components/debug/DebugPage';
import PaymentDashboard from './components/payments/PaymentDashboard';
import LandingPage from './components/public/LandingPage';
import EnrollmentManagement from './components/admin/EnrollmentManagement';

// Create a client
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

// Protected Route Component
const ProtectedRoute = ({ children, roles = [] }) => {
  const { user, loading } = useAuth();

  if (loading) {
    return <LoadingSpinner />;
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (roles.length > 0 && !roles.includes(user.role)) {
    return <Navigate to="/dashboard" replace />;
  }

  return children;
};

// Public Route Component (redirects to dashboard if logged in)
const PublicRoute = ({ children }) => {
  const { user, loading } = useAuth();

  if (loading) {
    return <LoadingSpinner />;
  }

  if (user) {
    return <Navigate to="/dashboard" replace />;
  }

  return children;
};

// Landing Route - Shows landing for non-authenticated, dashboard redirect for authenticated
const LandingRoute = () => {
  const { user, loading } = useAuth();

  if (loading) {
    return <LoadingSpinner />;
  }

  if (user) {
    return <Navigate to="/dashboard" replace />;
  }

  return <LandingPage />;
};

// Main App Component
const AppContent = () => {
  return (
    <Routes>
      <Route path="/" element={<LandingRoute />} />
      
      <Route path="/login" element={
        <PublicRoute>
          <Login />
        </PublicRoute>
      } />
      
      <Route element={
        <ProtectedRoute>
          <Layout />
        </ProtectedRoute>
      }>
        <Route path="dashboard" element={<Dashboard />} />
        
        <Route path="tasks" element={<Tasks />} />
        <Route path="tasks/create" element={
          <ProtectedRoute roles={['teacher', 'admin', 'super_admin']}>
            <CreateTask />
          </ProtectedRoute>
        } />
        <Route path="tasks/:id" element={<TaskDetails />} />
        <Route path="quiz/:taskId" element={<QuizPlayer />} />
        <Route path="quiz-results" element={<QuizResults />} />
        
        <Route path="quizzes" element={<Quizzes />} />
        <Route path="calendar" element={<Calendar />} />
        
        <Route path="announcements" element={<Announcements />} />
        
        <Route path="documents" element={<Documents />} />
        
        <Route path="profile" element={<Profile />} />
        
        <Route path="admin" element={
          <ProtectedRoute roles={['admin', 'super_admin']}>
            <AdminPanel />
          </ProtectedRoute>
        } />
        
        <Route path="users" element={
          <ProtectedRoute roles={['admin', 'super_admin']}>
            <UserManagement />
          </ProtectedRoute>
        } />
        
        <Route path="analytics" element={
          <ProtectedRoute roles={['admin', 'super_admin']}>
            <Analytics />
          </ProtectedRoute>
        } />
        
        <Route path="payments" element={
          <ProtectedRoute roles={['admin', 'super_admin']}>
            <PaymentDashboard />
          </ProtectedRoute>
        } />
        
        <Route path="enrollments" element={
          <ProtectedRoute roles={['admin', 'super_admin']}>
            <EnrollmentManagement />
          </ProtectedRoute>
        } />
        
        <Route path="debug" element={
          <ProtectedRoute roles={['teacher', 'admin', 'super_admin']}>
            <DebugPage />
          </ProtectedRoute>
        } />
      </Route>
      
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
};

const App = () => {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <ThemeProvider>
          <Router>
            <div className="min-h-screen">
              <AppContent />
              <Toaster
                position="top-right"
                toastOptions={{
                  duration: 4000,
                  style: {
                    background: '#363636',
                    color: '#fff',
                    borderRadius: '8px',
                    fontSize: '14px',
                  },
                  success: {
                    style: {
                      background: '#059669',
                    },
                  },
                  error: {
                    style: {
                      background: '#dc2626',
                    },
                  },
                  loading: {
                    style: {
                      background: '#1e40af',
                    },
                  },
                }}
              />
            </div>
          </Router>
        </ThemeProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
};

export default App;
