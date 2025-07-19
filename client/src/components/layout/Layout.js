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
  CreditCard
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import HarmonyLogo from '../common/HarmonyLogo';
import { ThemeToggle, useTheme, ThemedLayout } from '../common/ThemeProvider';
import { StatusIndicator, DepartmentBadge, AchievementBadge } from '../common/BrandingElements';
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
    navigate('/login');
  };

  const navigation = [
    { name: 'Dashboard', href: '/dashboard', icon: Home, color: 'harmony-navy' },
    { name: 'Tasks', href: '/tasks', icon: BookOpen, color: 'harmony-secondary' },
    { name: 'Quizzes', href: '/quizzes', icon: Award, color: 'harmony-gold' },
    { name: 'Announcements', href: '/announcements', icon: MessageSquare, color: 'harmony-navy' },
    { name: 'Documents', href: '/documents', icon: FileText, color: 'harmony-secondary' },
    { name: 'Calendar', href: '/calendar', icon: Calendar, color: 'harmony-navy' },
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
      className={`group flex items-center px-3 py-3 text-base font-medium rounded-lg w-full text-left transition-all duration-300 touch-manipulation
        ${isMobile ? 'min-h-14 text-lg' : 'min-h-12'}
        ${isTouch ? 'min-h-12 min-w-12' : ''}
        ${theme === 'dark' 
          ? 'text-gray-300 hover:bg-gray-700 hover:text-white' 
          : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
        }
        hover:scale-105 hover:shadow-md
      `}
    >
      <item.icon className={`mr-4 h-6 w-6 flex-shrink-0 text-${item.color}`} />
      <span className="truncate">{item.name}</span>
    </button>
  );

  const getUserStatus = () => {
    if (user?.role === 'admin') return 'Administrator';
    if (user?.role === 'teacher') return 'Teacher';
    if (user?.role === 'student') {
      const gradeName = user?.grade_name || user?.grade || 'N/A';
      // Check if grade name already contains "Grade" to avoid duplication
      return gradeName.toLowerCase().includes('grade') ? gradeName : `Grade ${gradeName}`;
    }
    return 'User';
  };

  const getUserBadge = () => {
    if (user?.role === 'admin') return <StatusIndicator status="active" label="Admin" />;
    if (user?.role === 'teacher') return <DepartmentBadge department={user?.department || 'General'} />;
    if (user?.role === 'student') {
      const gradeName = user?.grade_name || user?.grade || 'N/A';
      // Check if grade name already contains "Grade" to avoid duplication
      const displayName = gradeName.toLowerCase().includes('grade') ? gradeName : `Grade ${gradeName}`;
      return <StatusIndicator status="active" label={displayName} />;
    }
    return null;
  };

  return (
    <ThemedLayout>
      <div className="h-screen flex overflow-hidden">
        {/* Mobile menu */}
        <div className={`fixed inset-0 flex z-40 md:hidden ${sidebarOpen ? '' : 'hidden'}`}>
          <div 
            className="fixed inset-0 bg-gray-600 bg-opacity-75" 
            onClick={() => setSidebarOpen(false)}
            onTouchStart={() => setSidebarOpen(false)}
          />
          <div className={`relative flex-1 flex flex-col max-w-xs w-full ${
            theme === 'dark' ? 'bg-gray-800' : 'bg-white'
          }`}>
            <div className="absolute top-0 right-0 -mr-12 pt-2">
              <button
                className="ml-1 flex items-center justify-center h-12 w-12 rounded-full focus:outline-none focus:ring-2 focus:ring-inset focus:ring-white hover:bg-gray-600 hover:bg-opacity-50 transition-colors duration-200 touch-manipulation"
                onClick={() => setSidebarOpen(false)}
                aria-label="Close navigation menu"
                style={{ minHeight: '48px', minWidth: '48px' }}
              >
                <X className="h-6 w-6 text-white" />
              </button>
            </div>
            <div className="flex-1 h-0 pt-5 pb-4 overflow-y-auto">
              <div className="flex-shrink-0 flex items-center px-4 mb-4">
                <HarmonyLogo size={40} showText={true} theme={theme} />
              </div>
              <nav className="mt-5 px-2 space-y-1">
                {navigation.map((item) => (
                  <NavItem key={item.name} item={item} onClick={() => setSidebarOpen(false)} />
                ))}
              </nav>
            </div>
            <div className={`flex-shrink-0 flex border-t p-4 ${
              theme === 'dark' ? 'border-gray-700' : 'border-gray-200'
            } ${isMobile ? 'mb-20' : ''}`}>
              <div className="flex items-center w-full">
                <div className="h-12 w-12 bg-gradient-primary rounded-full flex items-center justify-center">
                  <User className="h-6 w-6 text-white" />
                </div>
                <div className="ml-3 flex-1">
                  <p className={`text-base font-medium ${
                    theme === 'dark' ? 'text-gray-200' : 'text-gray-700'
                  }`}>
                    {user?.first_name} {user?.last_name}
                  </p>
                  <p className={`text-sm ${
                    theme === 'dark' ? 'text-gray-400' : 'text-gray-500'
                  }`}>
                    {getUserStatus()}
                  </p>
                  <div className="mt-1">
                    {getUserBadge()}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Static sidebar for desktop */}
        <div className="hidden md:flex md:flex-shrink-0">
          <div className="flex flex-col w-64">
            <div className={`flex flex-col h-0 flex-1 border-r ${
              theme === 'dark' 
                ? 'border-gray-700 bg-gray-800' 
                : 'border-gray-200 bg-white'
            }`}>
              <div className="flex-1 flex flex-col pt-5 pb-4 overflow-y-auto">
                <div className="flex items-center flex-shrink-0 px-4 mb-6">
                  <HarmonyLogo size={40} showText={true} theme={theme} />
                </div>
                <nav className="mt-5 flex-1 px-2 space-y-1">
                  {navigation.map((item) => (
                    <NavItem key={item.name} item={item} />
                  ))}
                </nav>
                
                {/* Theme Toggle */}
                <div className="px-4 py-3">
                  <div className="flex items-center justify-between">
                    <span className={`text-sm font-medium ${
                      theme === 'dark' ? 'text-gray-300' : 'text-gray-700'
                    }`}>
                      Theme
                    </span>
                    <ThemeToggle />
                  </div>
                </div>
              </div>
              
              <div className={`flex-shrink-0 flex border-t p-4 ${
                theme === 'dark' ? 'border-gray-700' : 'border-gray-200'
              }`}>
                <div className="flex items-center w-full">
                  <div className="h-12 w-12 bg-gradient-primary rounded-full flex items-center justify-center">
                    <User className="h-6 w-6 text-white" />
                  </div>
                  <div className="ml-3 flex-1">
                    <p className={`text-sm font-medium ${
                      theme === 'dark' ? 'text-gray-200' : 'text-gray-700'
                    }`}>
                      {user?.first_name} {user?.last_name}
                    </p>
                    <p className={`text-xs ${
                      theme === 'dark' ? 'text-gray-400' : 'text-gray-500'
                    }`}>
                      {getUserStatus()}
                    </p>
                    <div className="mt-1">
                      {getUserBadge()}
                    </div>
                  </div>
                  <button
                    onClick={handleLogout}
                    className={`ml-2 p-1 rounded-lg transition-colors duration-200 ${
                      theme === 'dark' 
                        ? 'text-gray-400 hover:text-gray-200 hover:bg-gray-700' 
                        : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'
                    }`}
                    title="Logout"
                  >
                    <LogOut className="h-5 w-5" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Main content */}
        <div className="flex flex-col w-0 flex-1 overflow-hidden">
          <div className="md:hidden pl-2 pt-2 sm:pl-4 sm:pt-4">
            <div className="flex items-center justify-between">
              <button
                className={`h-12 w-12 inline-flex items-center justify-center rounded-lg transition-colors duration-200 touch-manipulation ${
                  theme === 'dark'
                    ? 'text-gray-400 hover:text-gray-200 hover:bg-gray-700'
                    : 'text-gray-500 hover:text-gray-900 hover:bg-gray-100'
                } focus:outline-none focus:ring-2 focus:ring-inset focus:ring-harmony-primary`}
                onClick={() => setSidebarOpen(true)}
                aria-label="Open navigation menu"
                style={{ minHeight: '48px', minWidth: '48px' }}
              >
                <Menu className="h-6 w-6" />
              </button>
              <div className="flex items-center space-x-2">
                <HarmonyLogo size={32} showText={true} theme={theme} />
              </div>
              <ThemeToggle />
            </div>
          </div>
          
          <main className="flex-1 relative overflow-y-auto focus:outline-none" style={{ paddingBottom: isMobile ? '100px' : '0' }}>
            <div className={`${isMobile ? 'py-2 px-3 pb-6' : 'py-4 px-2'} sm:py-6 sm:px-4`}>
              <div className="max-w-7xl mx-auto">
                <Outlet />
              </div>
            </div>
          </main>
          
          {/* Enhanced Footer - Fixed on mobile */}
          <div className={`bg-gradient-primary px-4 py-3 relative overflow-hidden ${
            isMobile ? 'fixed bottom-0 left-0 right-0 z-40' : ''
          }`}>
            <div className="absolute inset-0 bg-black bg-opacity-10"></div>
            <div className="relative flex items-center justify-center">
              <div className={`flex items-center ${isMobile ? 'space-x-3' : 'space-x-6'}`}>
                {/* Harmony Logo */}
                <div className="flex items-center space-x-2">
                  <HarmonyLogo size={isMobile ? 24 : 32} showText={false} theme="white" />
                  <div className="text-white">
                    <div className={`font-brand font-bold ${isMobile ? 'text-sm' : 'text-lg'}`}>Harmony Learning</div>
                    <div className={`opacity-90 ${isMobile ? 'text-xs' : 'text-sm'}`}>Excellence in Education</div>
                  </div>
                </div>
                
                {/* Divider */}
                <div className={`${isMobile ? 'hidden' : 'hidden sm:block'} w-px h-8 bg-white bg-opacity-30`}></div>
                
                {/* AutoM8 Logo */}
                <div className="flex items-center space-x-2">
                  <div className={`border-2 border-white rounded-lg flex items-center justify-center ${isMobile ? 'h-6 w-6' : 'h-8 w-8'}`}>
                    <div className="flex flex-col items-center">
                      <div className={`bg-white rounded-full mb-0.5 ${isMobile ? 'h-0.5 w-0.5' : 'h-1 w-1'}`}></div>
                      <div className="flex space-x-0.5">
                        <div className={`bg-white rounded-full ${isMobile ? 'h-0.5 w-0.5' : 'h-1 w-1'}`}></div>
                        <div className={`bg-white rounded-full ${isMobile ? 'h-0.5 w-0.5' : 'h-1 w-1'}`}></div>
                        <div className={`bg-white rounded-full ${isMobile ? 'h-0.5 w-0.5' : 'h-1 w-1'}`}></div>
                      </div>
                      <div className={`bg-white mt-0.5 ${isMobile ? 'h-px w-2' : 'h-px w-3'}`}></div>
                    </div>
                  </div>
                  <div className="text-white">
                    <div className={`font-bold ${isMobile ? 'text-sm' : 'text-lg'}`}>AutoM8</div>
                    <div className={`opacity-90 ${isMobile ? 'text-xs' : 'text-sm'}`}>Streamlining Innovation</div>
                  </div>
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
