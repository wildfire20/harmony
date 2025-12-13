import React, { useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useTheme } from '../common/ThemeProvider';
import { Settings, Users, BarChart3, GraduationCap, ClipboardList } from 'lucide-react';
import StudentManagement from './StudentManagement';
import TeacherManagement from './TeacherManagement';
import SystemSettings from './SystemSettings';
import AdminReports from './AdminReports';
import EnrollmentManagement from './EnrollmentManagement';

const AdminPanel = () => {
  const { user } = useAuth();
  const { theme } = useTheme();
  const [activeTab, setActiveTab] = useState('overview');

  const isDark = theme === 'dark';
  const cardBg = isDark ? 'bg-gray-900' : 'bg-white';
  const cardBorder = isDark ? 'border-gray-800' : 'border-gray-100';
  const textPrimary = isDark ? 'text-white' : 'text-gray-900';
  const textSecondary = isDark ? 'text-gray-400' : 'text-gray-600';

  const tabs = [
    { id: 'overview', name: 'Overview', icon: BarChart3 },
    { id: 'enrollments', name: 'Enrollments', icon: ClipboardList },
    { id: 'students', name: 'Student Management', icon: GraduationCap },
    { id: 'teachers', name: 'Teacher Management', icon: Users },
    { id: 'settings', name: 'System Settings', icon: Settings },
    { id: 'reports', name: 'Reports', icon: BarChart3 },
  ];

  const renderTabContent = () => {
    switch (activeTab) {
      case 'enrollments':
        return <EnrollmentManagement />;
      case 'students':
        return <StudentManagement />;
      case 'teachers':
        return <TeacherManagement />;
      case 'settings':
        return <SystemSettings />;
      case 'reports':
        return <AdminReports />;
      default:
        return (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            <div className={`${cardBg} rounded-2xl shadow-sm border ${cardBorder} p-6 hover:shadow-lg transition-all duration-200`}>
              <div className="flex items-center gap-3 mb-4">
                <div className="p-2.5 bg-gradient-to-br from-blue-500 to-blue-600 rounded-xl">
                  <GraduationCap className="h-6 w-6 text-white" />
                </div>
                <h2 className={`text-lg font-semibold ${textPrimary}`}>Student Management</h2>
              </div>
              <p className={`${textSecondary} text-sm mb-5`}>
                Add, edit, and manage student accounts and class assignments.
              </p>
              <button 
                onClick={() => setActiveTab('students')}
                className="w-full py-2.5 px-4 bg-gradient-to-r from-blue-500 to-blue-600 text-white rounded-xl font-medium shadow-lg shadow-blue-500/25 hover:shadow-xl transition-all"
              >
                Manage Students
              </button>
            </div>

            <div className={`${cardBg} rounded-2xl shadow-sm border ${cardBorder} p-6 hover:shadow-lg transition-all duration-200`}>
              <div className="flex items-center gap-3 mb-4">
                <div className="p-2.5 bg-gradient-to-br from-emerald-500 to-emerald-600 rounded-xl">
                  <Settings className="h-6 w-6 text-white" />
                </div>
                <h2 className={`text-lg font-semibold ${textPrimary}`}>System Settings</h2>
              </div>
              <p className={`${textSecondary} text-sm mb-5`}>
                Configure system settings, grades, and class structures.
              </p>
              <button 
                onClick={() => setActiveTab('settings')}
                className="w-full py-2.5 px-4 bg-gradient-to-r from-emerald-500 to-emerald-600 text-white rounded-xl font-medium shadow-lg shadow-emerald-500/25 hover:shadow-xl transition-all"
              >
                System Settings
              </button>
            </div>

            <div className={`${cardBg} rounded-2xl shadow-sm border ${cardBorder} p-6 hover:shadow-lg transition-all duration-200`}>
              <div className="flex items-center gap-3 mb-4">
                <div className="p-2.5 bg-gradient-to-br from-purple-500 to-purple-600 rounded-xl">
                  <BarChart3 className="h-6 w-6 text-white" />
                </div>
                <h2 className={`text-lg font-semibold ${textPrimary}`}>Reports</h2>
              </div>
              <p className={`${textSecondary} text-sm mb-5`}>
                View system statistics and generate reports.
              </p>
              <button 
                onClick={() => setActiveTab('reports')}
                className="w-full py-2.5 px-4 bg-gradient-to-r from-purple-500 to-purple-600 text-white rounded-xl font-medium shadow-lg shadow-purple-500/25 hover:shadow-xl transition-all"
              >
                View Reports
              </button>
            </div>
          </div>
        );
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-gradient-to-br from-red-500 to-red-600 rounded-xl shadow-lg shadow-red-500/25">
            <Settings className="h-6 w-6 text-white" />
          </div>
          <h1 className={`text-2xl font-bold ${textPrimary}`}>Admin Panel</h1>
        </div>
        <p className={textSecondary}>Welcome, {user?.first_name}</p>
      </div>

      {/* Tab Navigation */}
      <div className={`${cardBg} rounded-2xl shadow-sm border ${cardBorder} p-1.5`}>
        <nav className="flex flex-wrap gap-1">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-all ${
                  activeTab === tab.id
                    ? 'bg-gradient-to-r from-emerald-500 to-emerald-600 text-white shadow-lg shadow-emerald-500/25'
                    : `${textSecondary} hover:bg-gray-100 dark:hover:bg-gray-800`
                }`}
              >
                <Icon className="h-4 w-4" />
                <span className="hidden sm:inline">{tab.name}</span>
              </button>
            );
          })}
        </nav>
      </div>

      {/* Tab Content */}
      <div>
        {renderTabContent()}
      </div>
    </div>
  );
};

export default AdminPanel;
