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
  Settings,
  MessageSquare
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useTheme } from '../common/ThemeProvider';
import { useResponsive } from '../../hooks/useResponsive';

const Layout = () => {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { user, logout, isAdmin } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const location = useLocation();
  const { isMobile } = useResponsive();

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
        className={`group flex items-center gap-3 px-4 py-2.5 text-sm font-medium rounded-xl w-full text-left transition-all duration-200 ${
          active
            ? 'bg-red-600 text-white shadow-lg shadow-red-600/30'
            : 'text-gray-400 hover:bg-gray-800/50 hover:text-gray-200'
        }`}
      >
        <item.icon className={`h-5 w-5 flex-shrink-0 ${active ? 'text-white' : 'text-gray-500 group-hover:text-gray-300'}`} />
        <span className="truncate">{item.name}</span>
      </button>
    );
  };

  const Sidebar = ({ mobile = false, onClose }) => (
    <div className={`flex flex-col h-full bg-gray-900 ${mobile ? 'w-full' : 'w-72'}`}>
      <div className="flex items-center gap-3 px-5 py-6">
        <img 
          src="/images/harmony-logo.png" 
          alt="Harmony Learning" 
          className="h-10 w-10 object-contain rounded-lg"
          onError={(e) => {
            e.target.style.display = 'none';
          }}
        />
        <div>
          <h1 className="font-bold text-white text-lg tracking-tight">Harmony Learning</h1>
          <span className="text-xs text-gray-500">
            {user?.role === 'admin' || user?.role === 'super_admin' ? 'Administrator' : getUserRole()}
          </span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-4">
        <div className="px-3 mb-3">
          <span className="text-[11px] font-semibold text-gray-600 uppercase tracking-widest">Navigation</span>
        </div>
        <nav className="space-y-1">
          {navigation.map((item) => (
            <NavItem key={item.name} item={item} onClick={onClose} />
          ))}
        </nav>
      </div>

      <div className="p-4 border-t border-gray-800">
        <div className="flex items-center gap-3 px-2 py-3 rounded-xl bg-gray-800/50">
          <div className="h-10 w-10 bg-gradient-to-br from-red-500 to-red-600 rounded-full flex items-center justify-center text-white font-semibold shadow-lg">
            {user?.first_name?.[0]}{user?.last_name?.[0]}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-white truncate">
              {user?.first_name} {user?.last_name}
            </p>
            <p className="text-xs text-gray-500">{getUserRole()}</p>
          </div>
        </div>
        <button
          onClick={handleLogout}
          className="mt-3 w-full flex items-center justify-center gap-2 px-4 py-2.5 text-sm text-gray-400 hover:text-white hover:bg-gray-800 rounded-xl transition-all duration-200"
        >
          <LogOut className="h-4 w-4" />
          <span>Sign Out</span>
        </button>
      </div>
    </div>
  );

  const bgColor = theme === 'dark' ? 'bg-gray-950' : 'bg-gray-50';
  const headerBg = theme === 'dark' ? 'bg-gray-900 border-gray-800' : 'bg-white border-gray-200';

  return (
    <div className={`h-screen flex overflow-hidden ${bgColor}`}>
      {sidebarOpen && (
        <div className="fixed inset-0 z-50 flex lg:hidden">
          <div 
            className="fixed inset-0 bg-black/60 backdrop-blur-sm" 
            onClick={() => setSidebarOpen(false)}
          />
          <div className="relative flex-1 flex flex-col max-w-xs w-full animate-slide-in">
            <div className="absolute top-4 right-4">
              <button
                className="p-2 rounded-full text-white bg-gray-800 hover:bg-gray-700 transition-colors"
                onClick={() => setSidebarOpen(false)}
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <Sidebar mobile onClose={() => setSidebarOpen(false)} />
          </div>
        </div>
      )}

      <div className="hidden lg:flex lg:flex-shrink-0">
        <Sidebar />
      </div>

      <div className="flex flex-col w-0 flex-1 overflow-hidden">
        <div className={`flex items-center justify-between px-4 lg:px-6 py-4 border-b ${headerBg}`}>
          <button
            className="lg:hidden p-2 rounded-xl text-gray-500 hover:bg-gray-100 hover:text-gray-700 transition-colors"
            onClick={() => setSidebarOpen(true)}
          >
            <Menu className="h-6 w-6" />
          </button>
          
          <div className="flex-1" />
          
          <button
            onClick={toggleTheme}
            className={`p-2.5 rounded-xl transition-all duration-200 ${
              theme === 'dark' 
                ? 'text-gray-400 hover:bg-gray-800 hover:text-white' 
                : 'text-gray-500 hover:bg-gray-100 hover:text-gray-700'
            }`}
          >
            {theme === 'dark' ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
          </button>
        </div>

        <main className={`flex-1 relative overflow-y-auto ${bgColor}`}>
          <div className="py-6 px-4 lg:px-8">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
};

export default Layout;
