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

// Main App Component
const AppContent = () => {
  const { user } = useAuth();

  return (
    <Routes>
      <Route path="/login" element={
        <PublicRoute>
          <Login />
        </PublicRoute>
      } />
      
      <Route path="/" element={
        <ProtectedRoute>
          <Layout />
        </ProtectedRoute>
      }>
        <Route index element={<Navigate to="/dashboard" replace />} />
        
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
        
        <Route path="debug" element={
          <ProtectedRoute roles={['teacher', 'admin', 'super_admin']}>
            <DebugPage />
          </ProtectedRoute>
        } />
      </Route>
      
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
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
