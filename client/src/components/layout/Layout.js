import React, { useState } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { 
  Home, 
  Users, 
  GraduationCap,
  ClipboardList,
  Bell,
  BarChart3,
  Layers,
  Upload,
  BookOpen,
  FileText,
  UserCheck,
  Calendar,
  LogOut,
  Menu,
  X,
  Sun,
  Moon,
  Award,
  CreditCard,
  User,
  Settings
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useTheme } from '../common/ThemeProvider';
import { useResponsive, useTouchDevice } from '../../hooks/useResponsive';

const Layout = () => {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { user, logout, isAdmin } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const location = useLocation();
  const { isMobile } = useResponsive();
  const isTouch = useTouchDevice();

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const adminNavigation = [
    { name: 'Dashboard', href: '/dashboard', icon: Home },
    { name: 'Student Management', href: '/users?role=student', icon: Users },
    { name: 'Teacher Management', href: '/users?role=teacher', icon: GraduationCap },
    { name: 'Enrollments', href: '/enrollments', icon: ClipboardList },
    { name: 'Announcements', href: '/announcements', icon: Bell },
    { name: 'Analytics', href: '/analytics', icon: BarChart3 },
    { name: 'Class Management', href: '/admin', icon: Layers },
    { name: 'Bulk Import', href: '/admin/import', icon: Upload },
    { name: 'Gradebook', href: '/tasks', icon: BookOpen },
    { name: 'Resources', href: '/documents', icon: FileText },
    { name: 'Attendance', href: '/attendance', icon: UserCheck },
    { name: 'Calendar', href: '/calendar', icon: Calendar },
  ];

  const teacherNavigation = [
    { name: 'Dashboard', href: '/dashboard', icon: Home },
    { name: 'Tasks', href: '/tasks', icon: BookOpen },
    { name: 'Quizzes', href: '/quizzes', icon: Award },
    { name: 'Announcements', href: '/announcements', icon: Bell },
    { name: 'Documents', href: '/documents', icon: FileText },
    { name: 'Calendar', href: '/calendar', icon: Calendar },
    { name: 'Profile', href: '/profile', icon: User },
  ];

  const studentNavigation = [
    { name: 'Dashboard', href: '/dashboard', icon: Home },
    { name: 'Tasks', href: '/tasks', icon: BookOpen },
    { name: 'Quizzes', href: '/quizzes', icon: Award },
    { name: 'Announcements', href: '/announcements', icon: Bell },
    { name: 'Documents', href: '/documents', icon: FileText },
    { name: 'Calendar', href: '/calendar', icon: Calendar },
    { name: 'Profile', href: '/profile', icon: User },
  ];

  const getNavigation = () => {
    if (user?.role === 'admin' || user?.role === 'super_admin') {
      return adminNavigation;
    }
    if (user?.role === 'teacher') {
      return teacherNavigation;
    }
    return studentNavigation;
  };

  const navigation = getNavigation();

  const isActive = (href) => {
    if (href === '/dashboard') {
      return location.pathname === '/dashboard';
    }
    return location.pathname.startsWith(href.split('?')[0]);
  };

  const getUserRole = () => {
    if (user?.role === 'admin' || user?.role === 'super_admin') return 'Admin';
    if (user?.role === 'teacher') return 'Teacher';
    return 'Student';
  };

  const NavItem = ({ item, onClick }) => {
    const active = isActive(item.href);
    return (
      <button
        onClick={() => {
          navigate(item.href);
          if (onClick) onClick();
        }}
        className={`group flex items-center px-3 py-2.5 text-sm font-medium rounded-lg w-full text-left transition-all duration-200 ${
          active
            ? 'bg-red-600 text-white'
            : 'text-gray-300 hover:bg-gray-700 hover:text-white'
        }`}
      >
        <item.icon className={`mr-3 h-5 w-5 flex-shrink-0 ${active ? 'text-white' : 'text-gray-400'}`} />
        <span className="truncate">{item.name}</span>
      </button>
    );
  };

  const Sidebar = ({ mobile = false, onClose }) => (
    <div className={`flex flex-col h-full bg-gray-900 ${mobile ? 'w-full' : 'w-64'}`}>
      <div className="flex items-center gap-3 px-4 py-5 border-b border-gray-700">
        <img 
          src="/images/harmony-logo.png" 
          alt="Harmony Learning" 
          className="h-10 w-10 object-contain"
        />
        <div>
          <span className="font-bold text-white text-lg">Harmony Learning</span>
          <span className="block text-xs text-gray-400">
            {user?.role === 'admin' || user?.role === 'super_admin' ? 'Administrator' : getUserRole()}
          </span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto py-4">
        <div className="px-4 mb-2">
          <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Navigation</span>
        </div>
        <nav className="px-2 space-y-1">
          {navigation.map((item) => (
            <NavItem key={item.name} item={item} onClick={onClose} />
          ))}
        </nav>
      </div>

      <div className="border-t border-gray-700 p-4">
        <div className="flex items-center">
          <div className="h-10 w-10 bg-red-600 rounded-full flex items-center justify-center text-white font-semibold">
            {user?.first_name?.[0]}{user?.last_name?.[0]}
          </div>
          <div className="ml-3 flex-1">
            <p className="text-sm font-medium text-white">
              {user?.first_name} {user?.last_name}
            </p>
            <p className="text-xs text-gray-400">{getUserRole()}</p>
          </div>
        </div>
        <button
          onClick={handleLogout}
          className="mt-3 w-full flex items-center justify-center gap-2 px-3 py-2 text-sm text-gray-300 hover:text-white hover:bg-gray-800 rounded-lg transition-colors"
        >
          <LogOut className="h-4 w-4" />
          Sign Out
        </button>
      </div>
    </div>
  );

  return (
    <div className={`h-screen flex overflow-hidden ${theme === 'dark' ? 'bg-gray-800' : 'bg-gray-50'}`}>
      {/* Mobile sidebar */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-50 flex md:hidden">
          <div 
            className="fixed inset-0 bg-black/50" 
            onClick={() => setSidebarOpen(false)}
          />
          <div className="relative flex-1 flex flex-col max-w-xs w-full">
            <div className="absolute top-0 right-0 -mr-12 pt-2">
              <button
                className="ml-1 flex items-center justify-center h-10 w-10 rounded-full text-white hover:bg-gray-600"
                onClick={() => setSidebarOpen(false)}
              >
                <X className="h-6 w-6" />
              </button>
            </div>
            <Sidebar mobile onClose={() => setSidebarOpen(false)} />
          </div>
        </div>
      )}

      {/* Desktop sidebar */}
      <div className="hidden md:flex md:flex-shrink-0">
        <Sidebar />
      </div>

      {/* Main content */}
      <div className="flex flex-col w-0 flex-1 overflow-hidden">
        {/* Top header bar */}
        <div className={`flex items-center justify-between px-4 py-3 border-b ${
          theme === 'dark' ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'
        }`}>
          <button
            className="md:hidden p-2 rounded-lg text-gray-500 hover:bg-gray-100"
            onClick={() => setSidebarOpen(true)}
          >
            <Menu className="h-6 w-6" />
          </button>
          
          <div className="flex-1 md:ml-0" />
          
          <button
            onClick={toggleTheme}
            className={`p-2 rounded-lg transition-colors ${
              theme === 'dark' 
                ? 'text-gray-300 hover:bg-gray-700' 
                : 'text-gray-500 hover:bg-gray-100'
            }`}
          >
            {theme === 'dark' ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
          </button>
        </div>

        {/* Page content */}
        <main className={`flex-1 relative overflow-y-auto focus:outline-none ${
          theme === 'dark' ? 'bg-gray-800' : 'bg-gray-50'
        }`}>
          <div className="py-6 px-4 sm:px-6 lg:px-8">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
};

export default Layout;
