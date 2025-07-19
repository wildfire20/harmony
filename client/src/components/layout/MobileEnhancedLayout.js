import React, { useState, useEffect } from 'react';
import { Menu, X, ChevronDown, Home, Settings } from 'lucide-react';

const MobileEnhancedLayout = ({ children, navigation, user, onNavigate, onLogout }) => {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768);
    };
    
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // Close sidebar when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (sidebarOpen && !event.target.closest('.mobile-sidebar') && !event.target.closest('.mobile-menu-button')) {
        setSidebarOpen(false);
      }
    };

    if (sidebarOpen) {
      document.addEventListener('touchstart', handleClickOutside);
      document.addEventListener('click', handleClickOutside);
    }

    return () => {
      document.removeEventListener('touchstart', handleClickOutside);
      document.removeEventListener('click', handleClickOutside);
    };
  }, [sidebarOpen]);

  const MobileNavItem = ({ item, onClick }) => (
    <button
      onClick={() => {
        onNavigate(item.href);
        setSidebarOpen(false);
        if (onClick) onClick();
      }}
      className="group flex items-center w-full px-4 py-4 text-left text-base font-medium text-gray-700 hover:bg-blue-50 hover:text-blue-600 transition-colors duration-200 border-b border-gray-100 touch-manipulation"
      style={{ minHeight: '56px' }}
    >
      <item.icon className="mr-4 h-6 w-6 flex-shrink-0" />
      <span className="flex-1">{item.name}</span>
    </button>
  );

  if (!isMobile) {
    return children;
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Mobile Header */}
      <header className="fixed top-0 left-0 right-0 z-50 bg-white border-b border-gray-200 shadow-sm">
        <div className="flex items-center justify-between h-16 px-4">
          <button
            onClick={() => setSidebarOpen(true)}
            className="mobile-menu-button flex items-center justify-center w-12 h-12 rounded-lg hover:bg-gray-100 transition-colors duration-200 touch-manipulation"
            aria-label="Open navigation menu"
          >
            <Menu className="h-6 w-6 text-gray-600" />
          </button>
          
          <div className="flex items-center space-x-2">
            <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
              <span className="text-white font-bold text-sm">H</span>
            </div>
            <span className="font-semibold text-gray-800">Harmony</span>
          </div>
          
          <div className="w-12 h-12 flex items-center justify-center">
            {/* Placeholder for header actions */}
          </div>
        </div>
      </header>

      {/* Mobile Sidebar Overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-40 flex">
          {/* Backdrop */}
          <div 
            className="fixed inset-0 bg-gray-600 bg-opacity-50"
            onClick={() => setSidebarOpen(false)}
          />
          
          {/* Sidebar */}
          <div className="mobile-sidebar relative flex flex-col w-80 max-w-xs bg-white shadow-xl">
            {/* Sidebar Header */}
            <div className="flex items-center justify-between h-16 px-4 border-b border-gray-200">
              <div className="flex items-center space-x-3">
                <div className="w-10 h-10 bg-blue-600 rounded-lg flex items-center justify-center">
                  <span className="text-white font-bold">H</span>
                </div>
                <div>
                  <div className="font-semibold text-gray-800">Harmony Learning</div>
                  <div className="text-xs text-gray-500">Excellence in Education</div>
                </div>
              </div>
              <button
                onClick={() => setSidebarOpen(false)}
                className="flex items-center justify-center w-10 h-10 rounded-lg hover:bg-gray-100 transition-colors duration-200 touch-manipulation"
                aria-label="Close navigation menu"
              >
                <X className="h-5 w-5 text-gray-500" />
              </button>
            </div>

            {/* User Info */}
            <div className="p-4 border-b border-gray-200">
              <div className="flex items-center space-x-3">
                <div className="w-12 h-12 bg-gradient-to-r from-blue-600 to-purple-600 rounded-full flex items-center justify-center">
                  <span className="text-white font-semibold text-lg">
                    {user?.first_name?.[0] || 'U'}
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-gray-800 truncate">
                    {user?.first_name} {user?.last_name}
                  </div>
                  <div className="text-sm text-gray-500 truncate">
                    {user?.role === 'student' ? `Grade ${user?.grade_name || 'N/A'}` : 
                     user?.role === 'teacher' ? 'Teacher' : 
                     user?.role === 'admin' ? 'Administrator' : 'User'}
                  </div>
                </div>
              </div>
            </div>

            {/* Navigation */}
            <nav className="flex-1 overflow-y-auto">
              {navigation.map((item) => (
                <MobileNavItem key={item.name} item={item} />
              ))}
            </nav>

            {/* Logout */}
            <div className="border-t border-gray-200">
              <button
                onClick={() => {
                  onLogout();
                  setSidebarOpen(false);
                }}
                className="flex items-center w-full px-4 py-4 text-left text-base font-medium text-red-600 hover:bg-red-50 transition-colors duration-200 touch-manipulation"
                style={{ minHeight: '56px' }}
              >
                <Settings className="mr-4 h-6 w-6" />
                <span>Logout</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main Content */}
      <main className="pt-16">
        <div className="min-h-screen">
          {children}
        </div>
      </main>

      {/* Mobile Bottom Navigation (Optional) */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 sm:hidden">
        <div className="flex">
          {navigation.slice(0, 5).map((item) => (
            <button
              key={item.name}
              onClick={() => onNavigate(item.href)}
              className="flex-1 flex flex-col items-center justify-center py-2 px-1 text-gray-600 hover:text-blue-600 transition-colors duration-200 touch-manipulation"
              style={{ minHeight: '60px' }}
            >
              <item.icon className="h-5 w-5 mb-1" />
              <span className="text-xs font-medium truncate">{item.name}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};

export default MobileEnhancedLayout;
