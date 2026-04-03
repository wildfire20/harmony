import React, { useState } from 'react';
import { CreditCard, BarChart2 } from 'lucide-react';
import { useTheme } from '../common/ThemeProvider';
import StaffCardAssignment from './StaffCardAssignment';
import StaffAttendanceReport from './StaffAttendanceReport';

const VIEWS = [
  { id: 'report', label: "Today's Report", icon: BarChart2 },
  { id: 'cards', label: 'Card Management', icon: CreditCard },
];

const StaffAttendance = () => {
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const [view, setView] = useState('report');

  return (
    <div>
      {/* Sub-navigation */}
      <div className={`flex gap-1 p-1 rounded-2xl mb-6 w-fit ${isDark ? 'bg-gray-800' : 'bg-gray-100'}`}>
        {VIEWS.map(v => {
          const Icon = v.icon;
          const active = view === v.id;
          return (
            <button
              key={v.id}
              onClick={() => setView(v.id)}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all ${
                active
                  ? 'bg-white shadow text-gray-900 dark:bg-gray-700 dark:text-white'
                  : isDark
                    ? 'text-gray-400 hover:text-gray-200'
                    : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              <Icon className="w-4 h-4" />
              {v.label}
            </button>
          );
        })}
      </div>

      {view === 'report' && <StaffAttendanceReport />}
      {view === 'cards' && <StaffCardAssignment />}
    </div>
  );
};

export default StaffAttendance;
