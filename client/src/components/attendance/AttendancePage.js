import React, { useState } from 'react';
import { ClipboardCheck, BarChart3 } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useTheme } from '../common/ThemeProvider';
import AttendanceRegister from './AttendanceRegister';
import AttendanceReports from './AttendanceReports';

const AttendancePage = () => {
  const { user, isAdmin } = useAuth();
  const { theme } = useTheme();
  const [activeTab, setActiveTab] = useState('register');

  const isTeacher = user?.role === 'teacher';
  const canViewReports = isAdmin;

  const tabs = [
    { id: 'register', label: 'Take Attendance', icon: ClipboardCheck },
    ...(canViewReports ? [{ id: 'reports', label: 'Reports', icon: BarChart3 }] : [])
  ];

  return (
    <div className="space-y-6">
      {tabs.length > 1 && (
        <div className={`rounded-xl shadow-lg p-2 ${theme === 'dark' ? 'bg-gray-800' : 'bg-white'}`}>
          <div className="flex gap-2">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-all ${
                  activeTab === tab.id
                    ? 'bg-green-600 text-white'
                    : theme === 'dark'
                      ? 'text-gray-300 hover:bg-gray-700'
                      : 'text-gray-600 hover:bg-gray-100'
                }`}
              >
                <tab.icon className="h-5 w-5" />
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {activeTab === 'register' && <AttendanceRegister />}
      {activeTab === 'reports' && canViewReports && <AttendanceReports />}
    </div>
  );
};

export default AttendancePage;
