import React, { useState } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import { 
  Home, 
  BookOpen, 
  MessageSquare, 
  User, 
  Settings, 
  LogOut,
  Menu,
  X,
  GraduationCap,
  Users,
  BarChart3,
  FileText,
  Award,
  Calendar,
  Bell,
  CreditCard,
  ClipboardCheck
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import HarmonyLogo from '../common/HarmonyLogo';
import { ThemeToggle, useTheme, ThemedLayout } from '../common/ThemeProvider';
import { StatusIndicator, DepartmentBadge } from '../common/BrandingElements';
import { useResponsive, useTouchDevice } from '../../hooks/useResponsive';

const Layout = () => {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { user, logout, isAdmin } = useAuth();
  const { theme } = useTheme();
  const navigate = useNavigate();
  const { isMobile, isTablet } = useResponsive();
  const isTouch = useTouchDevice();

  const handleLogout = async () => {
    await logout();
    navigate('/');
  };

  const isTeacherOrAdmin = user?.role === 'teacher' || user?.role === 'admin' || user?.role === 'super_admin';
  
  const navigation = [
    { name: 'Dashboard', href: '/dashboard', icon: Home, color: 'harmony-navy' },
    { name: 'Tasks', href: '/tasks', icon: BookOpen, color: 'harmony-secondary' },
    { name: 'Quizzes', href: '/quizzes', icon: Award, color: 'harmony-gold' },
    { name: 'Announcements', href: '/announcements', icon: MessageSquare, color: 'harmony-navy' },
    { name: 'Documents', href: '/documents', icon: FileText, color: 'harmony-secondary' },
    { name: 'Calendar', href: '/calendar', icon: Calendar, color: 'harmony-navy' },
    ...(isTeacherOrAdmin ? [
      { name: 'Attendance', href: '/attendance', icon: ClipboardCheck, color: 'harmony-gold' }
    ] : []),
    { name: 'Profile', href: '/profile', icon: User, color: 'harmony-secondary' },
    ...(isAdmin ? [
      { name: 'Admin Panel', href: '/admin', icon: Settings, color: 'harmony-navy' },
      { name: 'Users', href: '/users', icon: Users, color: 'harmony-secondary' },
      { name: 'Analytics', href: '/analytics', icon: BarChart3, color: 'harmony-gold' },
      { name: 'Payments', href: '/payments', icon: CreditCard, color: 'harmony-gold' }
    ] : []),
  ];

  const NavItem = ({ item, onClick }) => (
    <button
      onClick={() => {
        navigate(item.href);
        if (onClick) onClick();
      }}
      className={`group flex items-center px-4 py-3 text-sm font-medium rounded-xl w-full text-left transition-all duration-200
        ${isMobile ? 'min-h-14' : 'min-h-11'}
        ${isTouch ? 'min-h-12' : ''}
        ${theme === 'dark' 
          ? 'text-gray-300 hover:bg-white/10 hover:text-white' 
          : 'text-gray-600 hover:bg-gradient-to-r hover:from-red-50 hover:to-transparent hover:text-red-700'
        }
      `}
    >
      <item.icon className={`mr-3 h-5 w-5 flex-shrink-0 ${
        theme === 'dark' ? 'text-gray-400 group-hover:text-white' : 'text-gray-400 group-hover:text-red-600'
      }`} />
      <span className="font-medium">{item.name}</span>
    </button>
  );

  const getUserStatus = () => {
    if (user?.role === 'admin') return 'Administrator';
    if (user?.role === 'teacher') return 'Teacher';
    if (user?.role === 'student') {
      const gradeName = user?.grade_name || user?.grade || 'N/A';
      return gradeName.toLowerCase().includes('grade') ? gradeName : `Grade ${gradeName}`;
    }
    return 'User';
  };

  const getUserBadge = () => {
    if (user?.role === 'admin') return <StatusIndicator status="active" label="Admin" />;
    if (user?.role === 'teacher') return <DepartmentBadge department={user?.department || 'General'} />;
    if (user?.role === 'student') {
      const gradeName = user?.grade_name || user?.grade || 'N/A';
      const displayName = gradeName.toLowerCase().includes('grade') ? gradeName : `Grade ${gradeName}`;
      return <StatusIndicator status="active" label={displayName} />;
    }
    return null;
  };

  return (
    <ThemedLayout>
      <div className="h-screen flex overflow-hidden">
        {/* Mobile menu */}
        <div className={`fixed inset-0 flex z-[1100] md:hidden ${sidebarOpen ? '' : 'hidden'}`}>
          <div 
            className="fixed inset-0 bg-black/50 backdrop-blur-sm" 
            onClick={() => setSidebarOpen(false)}
          />
          <div className={`relative flex-1 flex flex-col max-w-xs w-full shadow-2xl ${
            theme === 'dark' ? 'bg-gray-900' : 'bg-white'
          }`}>
            <div className="absolute top-4 right-4">
              <button
                className="p-2 rounded-full bg-gray-100 hover:bg-gray-200 transition-colors"
                onClick={() => setSidebarOpen(false)}
              >
                <X className="h-5 w-5 text-gray-600" />
              </button>
            </div>
            <div className="flex flex-col h-full">
              <div className="flex-shrink-0 pt-6 pb-4 px-4">
                <div className="flex items-center gap-3 mb-4">
                  <img 
                    src="/images/harmony-logo.png" 
                    alt="Harmony Learning" 
                    className="h-12 w-12 object-contain"
                    onError={(e) => { e.target.style.display = 'none'; }}
                  />
                  <div>
                    <h1 className="text-lg font-bold text-red-600">HARMONY LEARNING</h1>
                    <p className="text-xs text-gray-500">INSTITUTE</p>
                  </div>
                </div>
              </div>
              <nav className="flex-1 overflow-y-auto px-4 space-y-1 pb-4">
                {navigation.map((item) => (
                  <NavItem key={item.name} item={item} onClick={() => setSidebarOpen(false)} />
                ))}
              </nav>
            </div>
            <div className={`flex-shrink-0 border-t p-4 ${
              theme === 'dark' ? 'border-gray-800' : 'border-gray-100'
            }`}>
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 bg-gradient-to-br from-red-500 to-red-600 rounded-full flex items-center justify-center shadow-lg">
                  <User className="h-5 w-5 text-white" />
                </div>
                <div className="flex-1">
                  <p className={`text-sm font-semibold ${theme === 'dark' ? 'text-white' : 'text-gray-800'}`}>
                    {user?.first_name} {user?.last_name}
                  </p>
                  <p className="text-xs text-gray-500">{getUserStatus()}</p>
                </div>
                <button onClick={handleLogout} className="p-2 text-gray-400 hover:text-red-600 transition-colors">
                  <LogOut className="h-5 w-5" />
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Desktop sidebar */}
        <div className="hidden md:flex md:flex-shrink-0">
          <div className="flex flex-col w-64">
            <div className={`flex flex-col h-full border-r ${
              theme === 'dark' ? 'border-gray-800 bg-gray-900' : 'border-gray-100 bg-white'
            }`}>
              <div className="p-5">
                <div className="flex items-center gap-3">
                  <img 
                    src="/images/harmony-logo.png" 
                    alt="Harmony Learning" 
                    className="h-12 w-12 object-contain"
                    onError={(e) => { e.target.style.display = 'none'; }}
                  />
                  <div>
                    <h1 className="text-base font-bold text-red-600 leading-tight">HARMONY<br/>LEARNING</h1>
                    <p className="text-[10px] text-gray-400 tracking-wider">INSTITUTE</p>
                  </div>
                </div>
              </div>
              
              <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
                {navigation.map((item) => (
                  <NavItem key={item.name} item={item} />
                ))}
              </nav>
              
              <div className={`px-4 py-3 border-t ${theme === 'dark' ? 'border-gray-800' : 'border-gray-100'}`}>
                <div className="flex items-center justify-between mb-3">
                  <span className={`text-xs font-medium ${theme === 'dark' ? 'text-gray-400' : 'text-gray-500'}`}>Theme</span>
                  <ThemeToggle />
                </div>
              </div>
              
              <div className={`p-4 border-t ${theme === 'dark' ? 'border-gray-800' : 'border-gray-100'}`}>
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 bg-gradient-to-br from-red-500 to-red-600 rounded-full flex items-center justify-center shadow-lg">
                    <User className="h-5 w-5 text-white" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-semibold truncate ${theme === 'dark' ? 'text-white' : 'text-gray-800'}`}>
                      {user?.first_name} {user?.last_name}
                    </p>
                    <p className="text-xs text-gray-500">{getUserStatus()}</p>
                  </div>
                  <button
                    onClick={handleLogout}
                    className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                    title="Logout"
                  >
                    <LogOut className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Main content */}
        <div className="flex flex-col w-0 flex-1 overflow-hidden">
          <div className="md:hidden px-4 py-3 flex items-center justify-between border-b border-gray-100">
            <button
              className="p-2 rounded-lg text-gray-500 hover:bg-gray-100 transition-colors"
              onClick={() => setSidebarOpen(true)}
            >
              <Menu className="h-6 w-6" />
            </button>
            <div className="flex items-center gap-2">
              <img src="/images/harmony-logo.png" alt="" className="h-8 w-8" onError={(e) => { e.target.style.display = 'none'; }} />
              <span className="font-bold text-red-600 text-sm">HARMONY LEARNING</span>
            </div>
            <ThemeToggle />
          </div>
          
          <main className={`flex-1 relative overflow-y-auto ${
            theme === 'dark' ? 'bg-gray-950' : 'bg-gray-50'
          }`} style={{ paddingBottom: isMobile ? '80px' : '0' }}>
            <div className="py-6 px-4 sm:px-6 lg:px-8">
              <div className="max-w-7xl mx-auto">
                <Outlet />
              </div>
            </div>
          </main>
          
          {/* Footer */}
          <div className={`bg-gradient-to-r from-red-600 to-red-700 px-4 py-3 ${
            isMobile ? 'fixed bottom-0 left-0 right-0 z-40' : ''
          }`}>
            <div className="flex items-center justify-center gap-8">
              <div className="flex items-center gap-2">
                <img 
                  src="/images/harmony-logo.png" 
                  alt="Harmony Learning Institute" 
                  className="h-8 w-8 object-contain bg-white rounded-full p-0.5" 
                  onError={(e) => { e.target.style.display = 'none'; }} 
                />
                <div className="text-white">
                  <div className="font-bold text-sm">Harmony Learning</div>
                  <div className="text-[10px] opacity-80">Excellence in Education</div>
                </div>
              </div>
              <div className="w-px h-6 bg-white/20" />
              <div className="flex items-center gap-2">
                <img 
                  src="/images/autom8-logo.png" 
                  alt="AutoM8" 
                  className="h-8 w-8 object-contain" 
                  onError={(e) => { e.target.style.display = 'none'; }} 
                />
                <div className="text-white">
                  <div className="font-bold text-sm">AutoM8</div>
                  <div className="text-[10px] opacity-80">Streamlining Innovation</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </ThemedLayout>
  );
};

export default Layout;
