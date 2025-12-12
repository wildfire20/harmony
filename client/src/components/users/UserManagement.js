import React from 'react';
import { Users, Plus, Filter, UserPlus } from 'lucide-react';
import { useTheme } from '../common/ThemeProvider';

const UserManagement = () => {
  const { theme } = useTheme();

  const isDark = theme === 'dark';
  const cardBg = isDark ? 'bg-gray-900' : 'bg-white';
  const cardBorder = isDark ? 'border-gray-800' : 'border-gray-100';
  const textPrimary = isDark ? 'text-white' : 'text-gray-900';
  const textSecondary = isDark ? 'text-gray-400' : 'text-gray-600';

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-gradient-to-br from-indigo-500 to-indigo-600 rounded-xl shadow-lg shadow-indigo-500/25">
            <Users className="h-6 w-6 text-white" />
          </div>
          <h1 className={`text-2xl font-bold ${textPrimary}`}>User Management</h1>
        </div>
        <div className="flex gap-3">
          <button className={`flex items-center gap-2 px-4 py-2.5 rounded-xl border ${cardBorder} ${textPrimary} font-medium hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors`}>
            <Filter className="h-4 w-4" />
            <span>Filter</span>
          </button>
          <button className="flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-emerald-500 to-emerald-600 text-white rounded-xl font-medium shadow-lg shadow-emerald-500/25 hover:shadow-xl transition-all">
            <UserPlus className="h-4 w-4" />
            <span>Add User</span>
          </button>
        </div>
      </div>

      <div className={`${cardBg} rounded-2xl shadow-sm border ${cardBorder} overflow-hidden`}>
        <div className="text-center py-16 px-6">
          <div className="p-4 bg-gray-100 dark:bg-gray-800 rounded-full w-fit mx-auto mb-4">
            <Users className="h-12 w-12 text-gray-400" />
          </div>
          <h3 className={`text-lg font-semibold ${textPrimary} mb-2`}>User Management Available in Admin Panel</h3>
          <p className={`${textSecondary} mb-6 max-w-md mx-auto`}>
            For now, user management features are available in the Admin Panel. 
            A dedicated user management page is coming soon.
          </p>
          <button 
            onClick={() => window.location.href = '/admin'}
            className="inline-flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-emerald-500 to-emerald-600 text-white rounded-xl font-medium shadow-lg shadow-emerald-500/25 hover:shadow-xl transition-all"
          >
            <Plus className="h-4 w-4" />
            <span>Go to Admin Panel</span>
          </button>
        </div>
      </div>
    </div>
  );
};

export default UserManagement;
