import React, { useState } from 'react';
import { GraduationCap, Users, UserCheck, Key, ArrowUpCircle } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useTheme } from '../common/ThemeProvider';
import StudentManagement from '../admin/StudentManagement';
import TeacherManagement from '../admin/TeacherManagement';
import ParentManagement from '../admin/ParentManagement';
import GradePromotion from '../admin/GradePromotion';
import PasswordManagement from '../admin/PasswordManagement';

const UserManagement = () => {
  const { user } = useAuth();
  const { theme } = useTheme();
  const [activeTab, setActiveTab] = useState('students');

  const isDark = theme === 'dark';
  const cardBg = isDark ? 'bg-gray-900' : 'bg-white';
  const cardBorder = isDark ? 'border-gray-800' : 'border-gray-100';
  const textPrimary = isDark ? 'text-white' : 'text-gray-900';
  const textSecondary = isDark ? 'text-gray-400' : 'text-gray-600';

  const tabs = [
    { id: 'students',   label: 'Students',        icon: GraduationCap },
    { id: 'teachers',   label: 'Teachers',         icon: Users },
    { id: 'parents',    label: 'Parent Accounts',  icon: UserCheck },
    { id: 'promotion',  label: 'Grade Promotion',  icon: ArrowUpCircle },
    { id: 'passwords',  label: 'Passwords',        icon: Key },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="p-2.5 bg-gradient-to-br from-indigo-500 to-indigo-600 rounded-xl shadow-lg shadow-indigo-500/25">
          <Users className="h-6 w-6 text-white" />
        </div>
        <div>
          <h1 className={`text-2xl font-bold ${textPrimary}`}>Users</h1>
          <p className={`text-sm ${textSecondary}`}>Manage students, teachers, parents and access</p>
        </div>
      </div>

      <div className={`${cardBg} rounded-2xl shadow-sm border ${cardBorder} p-1.5`}>
        <nav className="flex flex-wrap gap-1">
          {tabs.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-all ${
                activeTab === id
                  ? 'bg-gradient-to-r from-indigo-500 to-indigo-600 text-white shadow-lg shadow-indigo-500/25'
                  : `${textSecondary} hover:bg-gray-100 dark:hover:bg-gray-800`
              }`}
            >
              <Icon className="h-4 w-4" />
              <span className="hidden sm:inline">{label}</span>
            </button>
          ))}
        </nav>
      </div>

      <div>
        {activeTab === 'students'  && <StudentManagement />}
        {activeTab === 'teachers'  && <TeacherManagement />}
        {activeTab === 'parents'   && <ParentManagement />}
        {activeTab === 'promotion' && <GradePromotion />}
        {activeTab === 'passwords' && <PasswordManagement />}
      </div>
    </div>
  );
};

export default UserManagement;
