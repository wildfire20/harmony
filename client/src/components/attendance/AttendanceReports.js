import React, { useState } from 'react';
import { useQuery } from 'react-query';
import { 
  BarChart3, 
  Calendar,
  Users,
  Clock,
  AlertTriangle,
  Check,
  X,
  ChevronDown,
  RefreshCw,
  TrendingUp,
  Eye
} from 'lucide-react';
import { attendanceAPI, classesAPI } from '../../services/api';
import { useTheme } from '../common/ThemeProvider';
import LoadingSpinner from '../common/LoadingSpinner';

const AttendanceReports = () => {
  const { theme } = useTheme();
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);
  const [selectedGrade, setSelectedGrade] = useState('');
  const [lateDays, setLateDays] = useState(30);

  const { data: statsData, isLoading: loadingStats, refetch: refetchStats } = useQuery(
    ['attendance-stats', selectedDate, selectedGrade],
    () => attendanceAPI.getStats({ date: selectedDate, grade_id: selectedGrade || undefined }),
    { enabled: true }
  );

  const { data: todayData, isLoading: loadingToday, refetch: refetchToday } = useQuery(
    ['attendance-today'],
    () => attendanceAPI.getTodayAttendance(),
    { refetchInterval: 30000 }
  );

  const { data: lateReportData, isLoading: loadingLate } = useQuery(
    ['late-report', lateDays, selectedGrade],
    () => attendanceAPI.getLateReport({ days: lateDays, grade_id: selectedGrade || undefined }),
    { enabled: true }
  );

  const { data: gradesData } = useQuery(
    ['grades'],
    () => classesAPI.getGrades()
  );

  const stats = statsData?.data;
  const today = todayData?.data;
  const lateReport = lateReportData?.data;
  const grades = gradesData?.data?.grades || [];

  const getAttendanceRate = () => {
    if (!stats?.overall) return 0;
    const { present, late, excused, total_students } = stats.overall;
    const attended = (parseInt(present) || 0) + (parseInt(late) || 0) + (parseInt(excused) || 0);
    return total_students > 0 ? Math.round((attended / total_students) * 100) : 0;
  };

  return (
    <div className="space-y-6">
      <div className={`rounded-xl shadow-lg p-6 ${theme === 'dark' ? 'bg-gray-800' : 'bg-white'}`}>
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <BarChart3 className="h-8 w-8 text-blue-600" />
            <div>
              <h1 className={`text-2xl font-bold ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>
                Attendance Reports
              </h1>
              <p className={`text-sm ${theme === 'dark' ? 'text-gray-400' : 'text-gray-500'}`}>
                School-wide attendance overview and reports
              </p>
            </div>
          </div>
          <button
            onClick={() => { refetchStats(); refetchToday(); }}
            className={`p-2 rounded-lg ${theme === 'dark' ? 'hover:bg-gray-700' : 'hover:bg-gray-100'}`}
          >
            <RefreshCw className="h-5 w-5 text-gray-500" />
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className={`block text-sm font-medium mb-2 ${theme === 'dark' ? 'text-gray-300' : 'text-gray-700'}`}>
              Date
            </label>
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              max={new Date().toISOString().split('T')[0]}
              className={`w-full px-4 py-3 rounded-lg border ${
                theme === 'dark' ? 'bg-gray-700 border-gray-600 text-white' : 'bg-white border-gray-300'
              }`}
            />
          </div>
          <div>
            <label className={`block text-sm font-medium mb-2 ${theme === 'dark' ? 'text-gray-300' : 'text-gray-700'}`}>
              Filter by Grade
            </label>
            <select
              value={selectedGrade}
              onChange={(e) => setSelectedGrade(e.target.value)}
              className={`w-full px-4 py-3 rounded-lg border ${
                theme === 'dark' ? 'bg-gray-700 border-gray-600 text-white' : 'bg-white border-gray-300'
              }`}
            >
              <option value="">All Grades</option>
              {grades.map(grade => (
                <option key={grade.id} value={grade.id}>{grade.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={`block text-sm font-medium mb-2 ${theme === 'dark' ? 'text-gray-300' : 'text-gray-700'}`}>
              Late Report Period
            </label>
            <select
              value={lateDays}
              onChange={(e) => setLateDays(parseInt(e.target.value))}
              className={`w-full px-4 py-3 rounded-lg border ${
                theme === 'dark' ? 'bg-gray-700 border-gray-600 text-white' : 'bg-white border-gray-300'
              }`}
            >
              <option value={7}>Last 7 days</option>
              <option value={14}>Last 14 days</option>
              <option value={30}>Last 30 days</option>
              <option value={60}>Last 60 days</option>
              <option value={90}>Last 90 days</option>
            </select>
          </div>
        </div>
      </div>

      {loadingToday ? (
        <LoadingSpinner />
      ) : today && (
        <div className={`rounded-xl shadow-lg p-6 ${theme === 'dark' ? 'bg-gradient-to-r from-blue-900 to-indigo-900' : 'bg-gradient-to-r from-blue-500 to-indigo-600'} text-white`}>
          <div className="flex items-center gap-3 mb-4">
            <Eye className="h-6 w-6" />
            <h2 className="text-xl font-bold">Real-Time Today's Status</h2>
            <span className="ml-auto text-sm opacity-80">Auto-refreshes every 30s</span>
          </div>
          
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <div className="bg-white/20 rounded-xl p-4">
              <p className="text-3xl font-bold">{today.total_students}</p>
              <p className="text-sm opacity-80">Total Students</p>
            </div>
            <div className="bg-white/20 rounded-xl p-4">
              <p className="text-3xl font-bold text-green-300">{today.stats?.present || 0}</p>
              <p className="text-sm opacity-80">Present</p>
            </div>
            <div className="bg-white/20 rounded-xl p-4">
              <p className="text-3xl font-bold text-red-300">{today.stats?.absent || 0}</p>
              <p className="text-sm opacity-80">Absent</p>
            </div>
            <div className="bg-white/20 rounded-xl p-4">
              <p className="text-3xl font-bold text-yellow-300">{today.stats?.late || 0}</p>
              <p className="text-sm opacity-80">Late</p>
            </div>
            <div className="bg-white/20 rounded-xl p-4">
              <p className="text-3xl font-bold text-orange-300">{today.not_recorded}</p>
              <p className="text-sm opacity-80">Not Recorded</p>
            </div>
          </div>
        </div>
      )}

      {loadingStats ? (
        <LoadingSpinner />
      ) : stats && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className={`p-6 rounded-xl ${theme === 'dark' ? 'bg-gray-800' : 'bg-white'} shadow-lg`}>
              <div className="flex items-center justify-between">
                <div>
                  <p className={`text-sm font-medium ${theme === 'dark' ? 'text-gray-400' : 'text-gray-500'}`}>
                    Attendance Rate
                  </p>
                  <p className="text-3xl font-bold text-green-600">{getAttendanceRate()}%</p>
                </div>
                <TrendingUp className="h-10 w-10 text-green-600 opacity-50" />
              </div>
            </div>
            <div className={`p-6 rounded-xl ${theme === 'dark' ? 'bg-gray-800' : 'bg-white'} shadow-lg`}>
              <div className="flex items-center justify-between">
                <div>
                  <p className={`text-sm font-medium ${theme === 'dark' ? 'text-gray-400' : 'text-gray-500'}`}>
                    Present Today
                  </p>
                  <p className="text-3xl font-bold text-blue-600">{stats.overall?.present || 0}</p>
                </div>
                <Check className="h-10 w-10 text-blue-600 opacity-50" />
              </div>
            </div>
            <div className={`p-6 rounded-xl ${theme === 'dark' ? 'bg-gray-800' : 'bg-white'} shadow-lg`}>
              <div className="flex items-center justify-between">
                <div>
                  <p className={`text-sm font-medium ${theme === 'dark' ? 'text-gray-400' : 'text-gray-500'}`}>
                    Absent
                  </p>
                  <p className="text-3xl font-bold text-red-600">{stats.overall?.absent || 0}</p>
                </div>
                <X className="h-10 w-10 text-red-600 opacity-50" />
              </div>
            </div>
            <div className={`p-6 rounded-xl ${theme === 'dark' ? 'bg-gray-800' : 'bg-white'} shadow-lg`}>
              <div className="flex items-center justify-between">
                <div>
                  <p className={`text-sm font-medium ${theme === 'dark' ? 'text-gray-400' : 'text-gray-500'}`}>
                    Late Arrivals
                  </p>
                  <p className="text-3xl font-bold text-yellow-600">{stats.overall?.late || 0}</p>
                </div>
                <Clock className="h-10 w-10 text-yellow-600 opacity-50" />
              </div>
            </div>
          </div>

          {stats.missing_classes?.length > 0 && (
            <div className={`rounded-xl shadow-lg p-6 ${theme === 'dark' ? 'bg-gray-800' : 'bg-white'}`}>
              <div className="flex items-center gap-2 mb-4">
                <AlertTriangle className="h-5 w-5 text-orange-500" />
                <h3 className={`text-lg font-semibold ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>
                  Classes Missing Attendance ({stats.missing_classes.length})
                </h3>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {stats.missing_classes.map((cls, index) => (
                  <div 
                    key={index}
                    className={`p-3 rounded-lg border ${
                      theme === 'dark' ? 'border-orange-800 bg-orange-900/20' : 'border-orange-200 bg-orange-50'
                    }`}
                  >
                    <p className={`font-medium ${theme === 'dark' ? 'text-orange-300' : 'text-orange-800'}`}>
                      {cls.grade_name}
                    </p>
                    <p className={`text-sm ${theme === 'dark' ? 'text-orange-400' : 'text-orange-600'}`}>
                      {cls.name}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {loadingLate ? (
        <LoadingSpinner />
      ) : lateReport?.students?.length > 0 && (
        <div className={`rounded-xl shadow-lg overflow-hidden ${theme === 'dark' ? 'bg-gray-800' : 'bg-white'}`}>
          <div className={`px-6 py-4 border-b ${theme === 'dark' ? 'border-gray-700' : 'border-gray-200'}`}>
            <div className="flex items-center gap-2">
              <Clock className="h-5 w-5 text-yellow-500" />
              <h3 className={`text-lg font-semibold ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>
                Habitually Late Students (Last {lateReport.period_days} days)
              </h3>
            </div>
            <p className={`text-sm mt-1 ${theme === 'dark' ? 'text-gray-400' : 'text-gray-500'}`}>
              Students with {lateReport.min_late_threshold}+ late arrivals
            </p>
          </div>
          
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className={theme === 'dark' ? 'bg-gray-700' : 'bg-gray-50'}>
                <tr>
                  <th className={`px-6 py-3 text-left text-xs font-medium uppercase tracking-wider ${theme === 'dark' ? 'text-gray-300' : 'text-gray-500'}`}>
                    Student
                  </th>
                  <th className={`px-6 py-3 text-left text-xs font-medium uppercase tracking-wider ${theme === 'dark' ? 'text-gray-300' : 'text-gray-500'}`}>
                    Class
                  </th>
                  <th className={`px-6 py-3 text-center text-xs font-medium uppercase tracking-wider ${theme === 'dark' ? 'text-gray-300' : 'text-gray-500'}`}>
                    Late Count
                  </th>
                  <th className={`px-6 py-3 text-center text-xs font-medium uppercase tracking-wider ${theme === 'dark' ? 'text-gray-300' : 'text-gray-500'}`}>
                    Absent Count
                  </th>
                </tr>
              </thead>
              <tbody className={`divide-y ${theme === 'dark' ? 'divide-gray-700' : 'divide-gray-200'}`}>
                {lateReport.students.map((student, index) => (
                  <tr key={student.student_id} className={index % 2 === 0 ? '' : (theme === 'dark' ? 'bg-gray-750' : 'bg-gray-50')}>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center">
                        <div className="h-10 w-10 rounded-full bg-gradient-to-br from-yellow-500 to-orange-500 flex items-center justify-center text-white font-semibold">
                          {student.first_name?.[0]}{student.last_name?.[0]}
                        </div>
                        <div className="ml-4">
                          <p className={`font-medium ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>
                            {student.first_name} {student.last_name}
                          </p>
                          <p className={`text-sm ${theme === 'dark' ? 'text-gray-400' : 'text-gray-500'}`}>
                            {student.student_number}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className={`px-6 py-4 whitespace-nowrap ${theme === 'dark' ? 'text-gray-300' : 'text-gray-600'}`}>
                      {student.grade_name} - {student.class_name}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-center">
                      <span className="px-3 py-1 rounded-full text-sm font-medium bg-yellow-100 text-yellow-800">
                        {student.late_count}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-center">
                      <span className="px-3 py-1 rounded-full text-sm font-medium bg-red-100 text-red-800">
                        {student.absent_count}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

export default AttendanceReports;
