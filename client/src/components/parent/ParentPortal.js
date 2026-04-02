import React, { useState, useEffect } from 'react';
import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import {
  Home, CalendarDays, GraduationCap, Bell, CreditCard,
  LogOut, Menu, X, BookOpen, ChevronRight
} from 'lucide-react';
import ParentDashboard from './ParentDashboard';
import ParentAttendance from './ParentAttendance';
import ParentGrades from './ParentGrades';
import ParentAnnouncements from './ParentAnnouncements';
import ParentInvoices from './ParentInvoices';

const NAV = [
  { path: '/parent/dashboard',      label: 'Home',        icon: Home },
  { path: '/parent/attendance',     label: 'Attendance',  icon: CalendarDays },
  { path: '/parent/grades',         label: 'Grades',      icon: GraduationCap },
  { path: '/parent/announcements',  label: 'Notices',     icon: Bell },
  { path: '/parent/invoices',       label: 'Fees',        icon: CreditCard },
];

export const useParentAuth = () => {
  const token = localStorage.getItem('parentToken');
  const user  = JSON.parse(localStorage.getItem('parentUser')  || 'null');
  const child = JSON.parse(localStorage.getItem('parentChild') || 'null');
  return { token, user, child, isAuthenticated: !!token };
};

export const parentApi = async (path, opts = {}) => {
  const token = localStorage.getItem('parentToken');
  const res = await fetch(`/api/parent${path}`, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(opts.headers || {}),
    },
  });
  if (res.status === 401) {
    localStorage.removeItem('parentToken');
    localStorage.removeItem('parentUser');
    localStorage.removeItem('parentChild');
    window.location.href = '/parent/login';
    return null;
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || 'Request failed');
  }
  return res.json();
};

const ParentPortal = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, child, isAuthenticated } = useParentAuth();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    if (!isAuthenticated) navigate('/parent/login');
  }, [isAuthenticated, navigate]);

  if (!isAuthenticated) return null;

  const handleLogout = () => {
    localStorage.removeItem('parentToken');
    localStorage.removeItem('parentUser');
    localStorage.removeItem('parentChild');
    navigate('/parent/login');
  };

  const isActive = (path) => location.pathname === path;

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Top bar */}
      <header className="bg-gradient-to-r from-blue-900 to-blue-800 text-white sticky top-0 z-30 shadow-lg">
        <div className="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <BookOpen className="h-5 w-5 text-blue-300" />
              <span className="font-bold text-sm hidden sm:block">Harmony Learning</span>
              <span className="font-semibold text-blue-200 text-sm">| Parent Portal</span>
            </div>
          </div>

          {/* Child chip */}
          {child && (
            <div className="hidden md:flex items-center gap-2 bg-white/10 rounded-full px-3 py-1">
              <div className="w-6 h-6 rounded-full bg-blue-400 flex items-center justify-center text-xs font-bold">
                {child.first_name?.[0]}{child.last_name?.[0]}
              </div>
              <span className="text-sm text-white font-medium">
                {child.first_name} {child.last_name}
              </span>
              <span className="text-blue-300 text-xs">• {child.grade_name}</span>
            </div>
          )}

          <div className="flex items-center gap-2">
            <button
              onClick={handleLogout}
              className="hidden sm:flex items-center gap-1.5 text-white/70 hover:text-white text-sm transition-colors"
            >
              <LogOut className="h-4 w-4" />
              Sign out
            </button>
            <button
              className="sm:hidden p-1.5 rounded-lg hover:bg-white/10"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            >
              {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
          </div>
        </div>

        {/* Mobile menu */}
        {mobileMenuOpen && (
          <div className="sm:hidden bg-blue-950/95 border-t border-white/10">
            {child && (
              <div className="px-4 py-3 border-b border-white/10 flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-blue-400 flex items-center justify-center text-sm font-bold">
                  {child.first_name?.[0]}{child.last_name?.[0]}
                </div>
                <div>
                  <p className="text-white font-medium text-sm">{child.first_name} {child.last_name}</p>
                  <p className="text-blue-300 text-xs">{child.grade_name} • {child.student_number}</p>
                </div>
              </div>
            )}
            {NAV.map(({ path, label, icon: Icon }) => (
              <button
                key={path}
                onClick={() => { navigate(path); setMobileMenuOpen(false); }}
                className={`w-full flex items-center gap-3 px-4 py-3 text-sm transition-colors ${
                  isActive(path) ? 'bg-white/10 text-white' : 'text-white/70 hover:text-white hover:bg-white/5'
                }`}
              >
                <Icon className="h-4 w-4" />
                {label}
                <ChevronRight className="h-3.5 w-3.5 ml-auto" />
              </button>
            ))}
            <button
              onClick={handleLogout}
              className="w-full flex items-center gap-3 px-4 py-3 text-sm text-red-300 hover:text-red-200 border-t border-white/10"
            >
              <LogOut className="h-4 w-4" />
              Sign out
            </button>
          </div>
        )}
      </header>

      <div className="flex flex-1 max-w-5xl mx-auto w-full">
        {/* Sidebar (desktop) */}
        <aside className="hidden sm:flex flex-col w-52 shrink-0 pt-6 px-3 gap-1">
          {NAV.map(({ path, label, icon: Icon }) => (
            <button
              key={path}
              onClick={() => navigate(path)}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
                isActive(path)
                  ? 'bg-blue-700 text-white shadow-md shadow-blue-700/30'
                  : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              <Icon className="h-4 w-4 shrink-0" />
              {label}
            </button>
          ))}
        </aside>

        {/* Main content */}
        <main className="flex-1 p-4 sm:p-6 min-w-0">
          <Routes>
            <Route index element={<Navigate to="dashboard" replace />} />
            <Route path="dashboard"     element={<ParentDashboard child={child} user={user} />} />
            <Route path="attendance"    element={<ParentAttendance child={child} />} />
            <Route path="grades"        element={<ParentGrades child={child} />} />
            <Route path="announcements" element={<ParentAnnouncements child={child} />} />
            <Route path="invoices"      element={<ParentInvoices child={child} />} />
          </Routes>
        </main>
      </div>

      {/* Bottom nav (mobile) */}
      <nav className="sm:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 flex z-20 shadow-xl">
        {NAV.map(({ path, label, icon: Icon }) => (
          <button
            key={path}
            onClick={() => navigate(path)}
            className={`flex-1 flex flex-col items-center py-2 gap-0.5 text-xs transition-colors ${
              isActive(path) ? 'text-blue-700' : 'text-gray-400'
            }`}
          >
            <Icon className={`h-5 w-5 ${isActive(path) ? 'text-blue-700' : 'text-gray-400'}`} />
            {label}
          </button>
        ))}
      </nav>
      <div className="sm:hidden h-16" />
    </div>
  );
};

export default ParentPortal;
