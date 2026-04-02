import React, { useState, useEffect, createContext, useContext } from 'react';
import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import {
  Home, CalendarDays, GraduationCap, Bell, CreditCard, FolderOpen,
  LogOut, Menu, X, BookOpen, ChevronDown, ChevronRight, Users
} from 'lucide-react';
import ParentDashboard from './ParentDashboard';
import ParentAttendance from './ParentAttendance';
import ParentGrades from './ParentGrades';
import ParentAnnouncements from './ParentAnnouncements';
import ParentInvoices from './ParentInvoices';
import ParentDocuments from './ParentDocuments';

const NAV = [
  { path: '/parent/dashboard',      label: 'Home',        icon: Home },
  { path: '/parent/attendance',     label: 'Attendance',  icon: CalendarDays },
  { path: '/parent/grades',         label: 'Grades',      icon: GraduationCap },
  { path: '/parent/announcements',  label: 'Notices',     icon: Bell },
  { path: '/parent/documents',      label: 'Documents',   icon: FolderOpen },
  { path: '/parent/invoices',       label: 'Fees',        icon: CreditCard },
];

// ─── Auth helper ─────────────────────────────────────────────────────────────
export const useParentAuth = () => {
  const token    = localStorage.getItem('parentToken');
  const user     = JSON.parse(localStorage.getItem('parentUser')     || 'null');
  const children = JSON.parse(localStorage.getItem('parentChildren') || '[]');
  const child    = JSON.parse(localStorage.getItem('parentChild')    || 'null');
  return { token, user, children, child, isAuthenticated: !!token };
};

// ─── API helper (auto-injects auth + child_id) ────────────────────────────────
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
    localStorage.removeItem('parentChildren');
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

// ─── Child context ────────────────────────────────────────────────────────────
export const ChildContext = createContext({ child: null, children: [] });
export const useSelectedChild = () => useContext(ChildContext);

// ─── Child Switcher ───────────────────────────────────────────────────────────
const ChildSwitcher = ({ children, selectedChild, onSelect }) => {
  const [open, setOpen] = useState(false);
  if (!children || children.length <= 1) {
    return selectedChild ? (
      <div className="hidden md:flex items-center gap-2 bg-white/10 rounded-full px-3 py-1.5">
        <div className="w-6 h-6 rounded-full bg-blue-400 flex items-center justify-center text-xs font-bold">
          {selectedChild.first_name?.[0]}{selectedChild.last_name?.[0]}
        </div>
        <span className="text-sm text-white font-medium">{selectedChild.first_name} {selectedChild.last_name}</span>
        <span className="text-blue-300 text-xs">• {selectedChild.grade_name}</span>
      </div>
    ) : null;
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="hidden md:flex items-center gap-2 bg-white/10 hover:bg-white/20 rounded-full px-3 py-1.5 transition-colors"
      >
        <div className="w-6 h-6 rounded-full bg-blue-400 flex items-center justify-center text-xs font-bold">
          {selectedChild?.first_name?.[0]}{selectedChild?.last_name?.[0]}
        </div>
        <span className="text-sm text-white font-medium">{selectedChild?.first_name} {selectedChild?.last_name}</span>
        <span className="text-blue-300 text-xs">• {selectedChild?.grade_name}</span>
        <ChevronDown className="h-3.5 w-3.5 text-blue-300" />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-2 w-56 bg-white rounded-xl shadow-xl border border-gray-100 z-50 overflow-hidden">
            <p className="px-3 py-2 text-xs font-semibold text-gray-400 uppercase tracking-wide border-b border-gray-50">
              Switch Child
            </p>
            {children.map((child) => (
              <button
                key={child.id}
                onClick={() => { onSelect(child); setOpen(false); }}
                className={`w-full flex items-center gap-3 px-3 py-2.5 hover:bg-blue-50 transition-colors ${
                  selectedChild?.id === child.id ? 'bg-blue-50' : ''
                }`}
              >
                <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-xs font-bold text-blue-700 shrink-0">
                  {child.first_name?.[0]}{child.last_name?.[0]}
                </div>
                <div className="text-left">
                  <p className="text-gray-800 text-sm font-medium">{child.first_name} {child.last_name}</p>
                  <p className="text-gray-400 text-xs">{child.grade_name} • {child.student_number}</p>
                </div>
                {selectedChild?.id === child.id && (
                  <div className="ml-auto w-2 h-2 rounded-full bg-blue-600" />
                )}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
};

// ─── Main Portal ─────────────────────────────────────────────────────────────
const ParentPortal = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, children, isAuthenticated } = useParentAuth();
  const [selectedChild, setSelectedChild] = useState(
    JSON.parse(localStorage.getItem('parentChild') || 'null')
  );
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [mobileChildOpen, setMobileChildOpen] = useState(false);

  useEffect(() => {
    if (!isAuthenticated) navigate('/parent/login');
  }, [isAuthenticated, navigate]);

  if (!isAuthenticated) return null;

  const handleSelectChild = (child) => {
    setSelectedChild(child);
    localStorage.setItem('parentChild', JSON.stringify(child));
  };

  const handleLogout = () => {
    localStorage.removeItem('parentToken');
    localStorage.removeItem('parentUser');
    localStorage.removeItem('parentChildren');
    localStorage.removeItem('parentChild');
    navigate('/parent/login');
  };

  const isActive = (path) => location.pathname === path;

  return (
    <ChildContext.Provider value={{ child: selectedChild, children }}>
      <div className="min-h-screen bg-gray-50 flex flex-col">
        {/* Top bar */}
        <header className="bg-gradient-to-r from-blue-900 to-blue-800 text-white sticky top-0 z-30 shadow-lg">
          <div className="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 shrink-0">
              <BookOpen className="h-5 w-5 text-blue-300" />
              <span className="font-bold text-sm hidden sm:block">Harmony Learning</span>
              <span className="font-semibold text-blue-200 text-sm">| Parent Portal</span>
            </div>

            {/* Child switcher (desktop) */}
            <ChildSwitcher
              children={children}
              selectedChild={selectedChild}
              onSelect={handleSelectChild}
            />

            <div className="flex items-center gap-2 shrink-0">
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
              {/* Child switcher for mobile */}
              {children && children.length > 0 && (
                <div className="border-b border-white/10">
                  <button
                    onClick={() => setMobileChildOpen(!mobileChildOpen)}
                    className="w-full flex items-center justify-between px-4 py-3"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-blue-400 flex items-center justify-center text-sm font-bold">
                        {selectedChild?.first_name?.[0]}{selectedChild?.last_name?.[0]}
                      </div>
                      <div className="text-left">
                        <p className="text-white font-medium text-sm">{selectedChild?.first_name} {selectedChild?.last_name}</p>
                        <p className="text-blue-300 text-xs">{selectedChild?.grade_name}</p>
                      </div>
                    </div>
                    {children.length > 1 && (
                      <div className="flex items-center gap-1 text-blue-300 text-xs">
                        <Users className="h-3.5 w-3.5" />
                        Switch
                        <ChevronDown className={`h-3.5 w-3.5 transition-transform ${mobileChildOpen ? 'rotate-180' : ''}`} />
                      </div>
                    )}
                  </button>
                  {mobileChildOpen && children.length > 1 && (
                    <div className="bg-blue-900/50 border-t border-white/5">
                      {children.map((child) => (
                        <button
                          key={child.id}
                          onClick={() => { handleSelectChild(child); setMobileChildOpen(false); setMobileMenuOpen(false); }}
                          className={`w-full flex items-center gap-3 px-5 py-2.5 ${selectedChild?.id === child.id ? 'bg-white/10' : 'hover:bg-white/5'}`}
                        >
                          <div className="w-7 h-7 rounded-full bg-blue-400 flex items-center justify-center text-xs font-bold">
                            {child.first_name?.[0]}{child.last_name?.[0]}
                          </div>
                          <div className="text-left">
                            <p className="text-white text-sm">{child.first_name} {child.last_name}</p>
                            <p className="text-blue-300 text-xs">{child.grade_name}</p>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
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
              <Route path="dashboard"     element={<ParentDashboard  child={selectedChild} user={user} />} />
              <Route path="attendance"    element={<ParentAttendance child={selectedChild} />} />
              <Route path="grades"        element={<ParentGrades     child={selectedChild} />} />
              <Route path="announcements" element={<ParentAnnouncements child={selectedChild} />} />
              <Route path="documents"     element={<ParentDocuments   child={selectedChild} />} />
              <Route path="invoices"      element={<ParentInvoices    child={selectedChild} />} />
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
    </ChildContext.Provider>
  );
};

export default ParentPortal;
