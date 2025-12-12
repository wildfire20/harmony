import React from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useTheme } from '../common/ThemeProvider';
import { User, Mail, GraduationCap, Calendar, Shield, BookOpen } from 'lucide-react';

const Profile = () => {
  const { user } = useAuth();
  const { theme } = useTheme();

  const isDark = theme === 'dark';
  const cardBg = isDark ? 'bg-gray-900' : 'bg-white';
  const cardBorder = isDark ? 'border-gray-800' : 'border-gray-100';
  const textPrimary = isDark ? 'text-white' : 'text-gray-900';
  const textSecondary = isDark ? 'text-gray-400' : 'text-gray-600';

  if (!user) {
    return null;
  }

  const getRoleBadge = () => {
    switch (user.role) {
      case 'admin':
      case 'super_admin':
        return { color: 'from-red-500 to-red-600', label: 'Administrator' };
      case 'teacher':
        return { color: 'from-blue-500 to-blue-600', label: 'Teacher' };
      case 'student':
        return { color: 'from-emerald-500 to-emerald-600', label: 'Student' };
      default:
        return { color: 'from-gray-500 to-gray-600', label: user.role };
    }
  };

  const roleBadge = getRoleBadge();

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="p-2.5 bg-gradient-to-br from-purple-500 to-purple-600 rounded-xl shadow-lg shadow-purple-500/25">
          <User className="h-6 w-6 text-white" />
        </div>
        <h1 className={`text-2xl font-bold ${textPrimary}`}>Profile</h1>
      </div>

      {/* Profile Card */}
      <div className={`${cardBg} rounded-2xl shadow-sm border ${cardBorder} overflow-hidden`}>
        {/* Header with gradient */}
        <div className="h-24 bg-gradient-to-r from-emerald-500 via-teal-500 to-blue-600 relative">
          <div className="absolute inset-0 opacity-10" style={{backgroundImage: 'radial-gradient(circle at 2px 2px, white 1px, transparent 0)', backgroundSize: '24px 24px'}}></div>
        </div>
        
        {/* Profile content */}
        <div className="px-6 pb-6">
          <div className="flex flex-col sm:flex-row items-center sm:items-end gap-4 -mt-12 relative z-10">
            <div className="h-24 w-24 bg-gradient-to-br from-red-500 to-red-600 rounded-2xl flex items-center justify-center shadow-xl border-4 border-white dark:border-gray-900">
              <User className="h-12 w-12 text-white" />
            </div>
            <div className="text-center sm:text-left pb-2">
              <h2 className={`text-2xl font-bold ${textPrimary}`}>
                {user.first_name} {user.last_name}
              </h2>
              <span className={`inline-flex items-center gap-1.5 px-3 py-1 mt-2 rounded-full text-xs font-semibold text-white bg-gradient-to-r ${roleBadge.color} shadow-sm`}>
                <Shield className="h-3 w-3" />
                {roleBadge.label}
              </span>
            </div>
          </div>

          <div className="mt-8 grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-4">
              <div className={`flex items-center gap-4 p-4 rounded-xl ${isDark ? 'bg-gray-800' : 'bg-gray-50'}`}>
                <div className="p-2.5 bg-blue-100 dark:bg-blue-900/30 rounded-xl">
                  <Mail className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                </div>
                <div>
                  <p className={`text-sm font-medium ${textSecondary}`}>Email</p>
                  <p className={`font-medium ${textPrimary}`}>{user.email || 'Not provided'}</p>
                </div>
              </div>
              
              {user.student_number && (
                <div className={`flex items-center gap-4 p-4 rounded-xl ${isDark ? 'bg-gray-800' : 'bg-gray-50'}`}>
                  <div className="p-2.5 bg-purple-100 dark:bg-purple-900/30 rounded-xl">
                    <GraduationCap className="h-5 w-5 text-purple-600 dark:text-purple-400" />
                  </div>
                  <div>
                    <p className={`text-sm font-medium ${textSecondary}`}>Student Number</p>
                    <p className={`font-medium ${textPrimary}`}>{user.student_number}</p>
                  </div>
                </div>
              )}
            </div>

            <div className="space-y-4">
              {user.grade_name && (
                <div className={`flex items-center gap-4 p-4 rounded-xl ${isDark ? 'bg-gray-800' : 'bg-gray-50'}`}>
                  <div className="p-2.5 bg-emerald-100 dark:bg-emerald-900/30 rounded-xl">
                    <BookOpen className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
                  </div>
                  <div>
                    <p className={`text-sm font-medium ${textSecondary}`}>Grade</p>
                    <p className={`font-medium ${textPrimary}`}>
                      {user.grade_name.replace(/^grade\s+/i, '')}
                    </p>
                  </div>
                </div>
              )}
              
              {user.class_name && (
                <div className={`flex items-center gap-4 p-4 rounded-xl ${isDark ? 'bg-gray-800' : 'bg-gray-50'}`}>
                  <div className="p-2.5 bg-amber-100 dark:bg-amber-900/30 rounded-xl">
                    <Calendar className="h-5 w-5 text-amber-600 dark:text-amber-400" />
                  </div>
                  <div>
                    <p className={`text-sm font-medium ${textSecondary}`}>Class</p>
                    <p className={`font-medium ${textPrimary}`}>{user.class_name}</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Profile;
