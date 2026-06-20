import React, { useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { useTheme } from '../common/ThemeProvider';
import { Settings, BarChart3, ClipboardList, GraduationCap, Users, DollarSign, ScanLine, UserCheck, Key, ArrowUpCircle } from 'lucide-react';
import SystemSettings from './SystemSettings';
import EnrollmentManagement from './EnrollmentManagement';

const AdminPanel = () => {
  const { user } = useAuth();
  const { theme } = useTheme();
  const location = useLocation();
  const [activeTab, setActiveTab] = useState(location.state?.tab || 'overview');

  const isDark = theme === 'dark';
  const cardBg = isDark ? 'bg-gray-900' : 'bg-white';
  const cardBorder = isDark ? 'border-gray-800' : 'border-gray-100';
  const textPrimary = isDark ? 'text-white' : 'text-gray-900';
  const textSecondary = isDark ? 'text-gray-400' : 'text-gray-600';

  const tabs = [
    { id: 'overview',     name: 'Overview',        icon: BarChart3 },
    { id: 'enrollments',  name: 'Enrollments',     icon: ClipboardList },
    { id: 'settings',     name: 'System Settings', icon: Settings },
  ];

  const overviewCards = [
    {
      title: 'Users',
      description: 'Manage students, teachers, parents, passwords and grade promotions.',
      gradient: 'from-indigo-500 to-indigo-600',
      shadow: 'shadow-indigo-500/25',
      icon: Users,
      href: '/users',
    },
    {
      title: 'Payments',
      description: 'Invoices, manual payments, pending approvals, service pricing and one-off fees.',
      gradient: 'from-emerald-500 to-emerald-600',
      shadow: 'shadow-emerald-500/25',
      icon: DollarSign,
      href: '/payments',
    },
    {
      title: 'Attendance',
      description: 'Student attendance registers, reports and staff attendance tracking.',
      gradient: 'from-green-500 to-green-600',
      shadow: 'shadow-green-500/25',
      icon: ScanLine,
      href: '/attendance',
    },
    {
      title: 'Analytics & Reports',
      description: 'View system statistics, generate school reports and export data.',
      gradient: 'from-purple-500 to-purple-600',
      shadow: 'shadow-purple-500/25',
      icon: BarChart3,
      href: '/analytics',
    },
    {
      title: 'Enrollments',
      description: 'Review and manage new enrollment applications from the public form.',
      gradient: 'from-orange-500 to-orange-600',
      shadow: 'shadow-orange-500/25',
      icon: ClipboardList,
      action: () => setActiveTab('enrollments'),
    },
    {
      title: 'System Settings',
      description: 'Configure grades, classes and other system-wide settings.',
      gradient: 'from-gray-500 to-gray-600',
      shadow: 'shadow-gray-500/25',
      icon: Settings,
      action: () => setActiveTab('settings'),
    },
  ];

  const renderTabContent = () => {
    switch (activeTab) {
      case 'enrollments':
        return <EnrollmentManagement />;
      case 'settings':
        return <SystemSettings />;
      default:
        return (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {overviewCards.map(({ title, description, gradient, shadow, icon: Icon, href, action }) => (
              <div
                key={title}
                className={`${cardBg} rounded-2xl shadow-sm border ${cardBorder} p-6 hover:shadow-lg transition-all duration-200`}
              >
                <div className="flex items-center gap-3 mb-4">
                  <div className={`p-2.5 bg-gradient-to-br ${gradient} rounded-xl`}>
                    <Icon className="h-6 w-6 text-white" />
                  </div>
                  <h2 className={`text-lg font-semibold ${textPrimary}`}>{title}</h2>
                </div>
                <p className={`${textSecondary} text-sm mb-5`}>{description}</p>
                <button
                  onClick={action ?? (() => (window.location.href = href))}
                  className={`w-full py-2.5 px-4 bg-gradient-to-r ${gradient} text-white rounded-xl font-medium shadow-lg ${shadow} hover:shadow-xl transition-all`}
                >
                  Go to {title}
                </button>
              </div>
            ))}
          </div>
        );
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-gradient-to-br from-red-500 to-red-600 rounded-xl shadow-lg shadow-red-500/25">
            <Settings className="h-6 w-6 text-white" />
          </div>
          <div>
            <h1 className={`text-2xl font-bold ${textPrimary}`}>Admin Panel</h1>
            <p className={`text-sm ${textSecondary}`}>Welcome, {user?.first_name}</p>
          </div>
        </div>
      </div>

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
                    ? 'bg-gradient-to-r from-red-500 to-red-600 text-white shadow-lg shadow-red-500/25'
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

      <div>{renderTabContent()}</div>
    </div>
  );
};

export default AdminPanel;
