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
  ChevronUp,
  RefreshCw,
  TrendingUp,
  Eye,
  CalendarDays
} from 'lucide-react';
import { attendanceAPI, classesAPI } from '../../services/api';
import { useTheme } from '../common/ThemeProvider';
import LoadingSpinner from '../common/LoadingSpinner';

const getMonday = (d) => {
  const date = new Date(d);
  const day = date.getDay();
  const diff = date.getDate() - day + (day === 0 ? -6 : 1);
  date.setDate(diff);
  return date.toISOString().split('T')[0];
};

const getFriday = (mondayStr) => {
  const d = new Date(mondayStr);
  d.setDate(d.getDate() + 4);
  return d.toISOString().split('T')[0];
};

const formatShortDate = (dateStr) => {
  const d = new Date(dateStr + 'T00:00:00');
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${days[d.getDay()]} ${d.getDate()} ${months[d.getMonth()]}`;
};

const AttendanceReports = () => {
  const { theme } = useTheme();
  const [activeTab, setActiveTab] = useState('weekly');
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);
  const [selectedGrade, setSelectedGrade] = useState('');
  const [lateDays, setLateDays] = useState(30);
  const [expandedClasses, setExpandedClasses] = useState({});
  const [expandedWeeklyClasses, setExpandedWeeklyClasses] = useState({});

  const today = new Date();
  const [weekStart, setWeekStart] = useState(getMonday(today));
  const [weekEnd, setWeekEnd] = useState(getFriday(getMonday(today)));

  const isDark = theme === 'dark';
  const cardBg = isDark ? 'bg-gray-800' : 'bg-white';
  const cardBorder = isDark ? 'border-gray-700' : 'border-gray-200';
  const textPrimary = isDark ? 'text-white' : 'text-gray-900';
  const textSecondary = isDark ? 'text-gray-400' : 'text-gray-500';
  const inputClass = `w-full px-4 py-3 rounded-lg border ${isDark ? 'bg-gray-700 border-gray-600 text-white' : 'bg-white border-gray-300'}`;

  const { data: statsData, isLoading: loadingStats, refetch: refetchStats } = useQuery(
    ['attendance-stats', selectedDate, selectedGrade],
    () => attendanceAPI.getStats({ date: selectedDate, grade_id: selectedGrade || undefined }),
    { enabled: activeTab === 'daily' }
  );

  const { data: todayData, isLoading: loadingToday, refetch: refetchToday } = useQuery(
    ['attendance-today'],
    () => attendanceAPI.getTodayAttendance(),
    { refetchInterval: 30000 }
  );

  const { data: lateReportData, isLoading: loadingLate } = useQuery(
    ['late-report', lateDays, selectedGrade],
    () => attendanceAPI.getLateReport({ days: lateDays, grade_id: selectedGrade || undefined }),
    { enabled: activeTab === 'daily' }
  );

  const { data: classBreakdownData, isLoading: loadingBreakdown } = useQuery(
    ['class-breakdown', selectedDate, selectedGrade],
    () => attendanceAPI.getClassBreakdown({ date: selectedDate, grade_id: selectedGrade || undefined }),
    { enabled: activeTab === 'daily' }
  );

  const { data: weeklyData, isLoading: loadingWeekly, refetch: refetchWeekly } = useQuery(
    ['weekly-attendance', weekStart, weekEnd, selectedGrade],
    () => attendanceAPI.getWeeklyReport({ 
      start_date: weekStart, 
      end_date: weekEnd,
      grade_id: selectedGrade || undefined 
    }),
    { enabled: activeTab === 'weekly' }
  );

  const { data: gradesData } = useQuery(
    ['grades'],
    () => classesAPI.getGrades()
  );

  const stats = statsData?.data;
  const todayStats = todayData?.data;
  const lateReport = lateReportData?.data;
  const classBreakdown = classBreakdownData?.data?.classes || [];
  const grades = gradesData?.data?.grades || [];
  const weekly = weeklyData?.data;

  const getAttendanceRate = () => {
    if (!stats?.overall) return 0;
    const { present, late, excused, total_students } = stats.overall;
    const attended = (parseInt(present) || 0) + (parseInt(late) || 0) + (parseInt(excused) || 0);
    return total_students > 0 ? Math.round((attended / total_students) * 100) : 0;
  };

  const toggleClassExpand = (classId) => {
    setExpandedClasses(prev => ({ ...prev, [classId]: !prev[classId] }));
  };

  const toggleWeeklyClassExpand = (classId) => {
    setExpandedWeeklyClasses(prev => ({ ...prev, [classId]: !prev[classId] }));
  };

  const shiftWeek = (direction) => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + (direction * 7));
    const newStart = d.toISOString().split('T')[0];
    setWeekStart(newStart);
    setWeekEnd(getFriday(newStart));
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'present': return 'bg-green-100 text-green-800';
      case 'absent': return 'bg-red-100 text-red-800';
      case 'late': return 'bg-yellow-100 text-yellow-800';
      case 'excused': return 'bg-blue-100 text-blue-800';
      default: return 'bg-gray-100 text-gray-600';
    }
  };

  const getStatusDot = (status) => {
    switch (status) {
      case 'present': return 'bg-green-500';
      case 'absent': return 'bg-red-500';
      case 'late': return 'bg-yellow-500';
      case 'excused': return 'bg-blue-500';
      default: return 'bg-gray-300';
    }
  };

  const getStatusInitial = (status) => {
    switch (status) {
      case 'present': return 'P';
      case 'absent': return 'A';
      case 'late': return 'L';
      case 'excused': return 'E';
      default: return '-';
    }
  };

  const getCellBg = (status) => {
    if (isDark) {
      switch (status) {
        case 'present': return 'bg-green-900/30 text-green-300';
        case 'absent': return 'bg-red-900/30 text-red-300';
        case 'late': return 'bg-yellow-900/30 text-yellow-300';
        case 'excused': return 'bg-blue-900/30 text-blue-300';
        default: return 'bg-gray-700/30 text-gray-500';
      }
    }
    switch (status) {
      case 'present': return 'bg-green-50 text-green-700';
      case 'absent': return 'bg-red-50 text-red-700';
      case 'late': return 'bg-yellow-50 text-yellow-700';
      case 'excused': return 'bg-blue-50 text-blue-700';
      default: return 'bg-gray-50 text-gray-400';
    }
  };

  const renderWeeklyView = () => {
    if (loadingWeekly) return <LoadingSpinner />;
    if (!weekly || !weekly.classes) return null;

    const dates = weekly.dates || [];
    const classes = weekly.classes || [];

    const gradeGroups = {};
    classes.forEach(cls => {
      if (!gradeGroups[cls.grade_name]) gradeGroups[cls.grade_name] = [];
      gradeGroups[cls.grade_name].push(cls);
    });

    return (
      <div className="space-y-6">
        <div className={`rounded-xl shadow-lg p-6 ${cardBg}`}>
          <div className="flex items-center gap-2 mb-2">
            <CalendarDays className="h-6 w-6 text-indigo-600" />
            <h3 className={`text-xl font-bold ${textPrimary}`}>
              Weekly Attendance Overview
            </h3>
          </div>
          <p className={`text-sm mb-4 ${textSecondary}`}>
            {formatShortDate(weekStart)} - {formatShortDate(weekEnd)}
          </p>

          <div className="flex items-center gap-2 mb-2">
            <span className="flex items-center gap-1 text-xs"><span className="w-3 h-3 rounded-full bg-green-500 inline-block"></span> Present</span>
            <span className="flex items-center gap-1 text-xs"><span className="w-3 h-3 rounded-full bg-red-500 inline-block"></span> Absent</span>
            <span className="flex items-center gap-1 text-xs"><span className="w-3 h-3 rounded-full bg-yellow-500 inline-block"></span> Late</span>
            <span className="flex items-center gap-1 text-xs"><span className="w-3 h-3 rounded-full bg-blue-500 inline-block"></span> Excused</span>
            <span className="flex items-center gap-1 text-xs"><span className="w-3 h-3 rounded-full bg-gray-300 inline-block"></span> Not Recorded</span>
          </div>
        </div>

        {Object.entries(gradeGroups).map(([gradeName, gradeClasses]) => (
          <div key={gradeName} className={`rounded-xl shadow-lg overflow-hidden ${cardBg}`}>
            <div className={`px-5 py-3 font-bold text-lg border-b ${isDark ? 'bg-indigo-900/40 border-gray-700 text-indigo-300' : 'bg-indigo-50 border-indigo-100 text-indigo-800'}`}>
              {gradeName}
            </div>

            {gradeClasses.map(cls => {
              const isExpanded = expandedWeeklyClasses[cls.class_id];
              const weekTotals = { present: 0, absent: 0, late: 0, excused: 0, recorded: 0 };
              dates.forEach(dt => {
                const d = cls.daily[dt];
                if (d) {
                  weekTotals.present += d.present;
                  weekTotals.absent += d.absent;
                  weekTotals.late += d.late;
                  weekTotals.excused += d.excused;
                  weekTotals.recorded += d.total_recorded;
                }
              });
              const totalPossible = cls.total_students * dates.length;
              const weekRate = totalPossible > 0 ? Math.round(((weekTotals.present + weekTotals.late) / totalPossible) * 100) : 0;

              return (
                <div key={cls.class_id} className={`border-b last:border-b-0 ${cardBorder}`}>
                  <button
                    onClick={() => toggleWeeklyClassExpand(cls.class_id)}
                    className={`w-full text-left px-5 py-4 ${isDark ? 'hover:bg-gray-700/50' : 'hover:bg-gray-50'} transition-colors`}
                  >
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-3">
                        <h4 className={`font-semibold ${textPrimary}`}>{cls.class_name}</h4>
                        <span className={`text-sm ${textSecondary}`}>{cls.total_students} students</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className={`text-sm font-bold ${weekRate >= 80 ? 'text-green-600' : weekRate >= 60 ? 'text-yellow-600' : 'text-red-600'}`}>
                          {weekRate}% weekly
                        </span>
                        {isExpanded ? (
                          <ChevronUp className={`h-5 w-5 ${textSecondary}`} />
                        ) : (
                          <ChevronDown className={`h-5 w-5 ${textSecondary}`} />
                        )}
                      </div>
                    </div>

                    <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${dates.length}, 1fr)` }}>
                      {dates.map(dt => {
                        const d = cls.daily[dt];
                        const hasData = d && d.total_recorded > 0;
                        const dayRate = hasData && cls.total_students > 0 
                          ? Math.round(((d.present + d.late) / cls.total_students) * 100) 
                          : null;

                        return (
                          <div 
                            key={dt} 
                            className={`rounded-lg p-2 text-center text-xs ${
                              hasData 
                                ? (isDark ? 'bg-gray-700' : 'bg-gray-50') 
                                : (isDark ? 'bg-gray-800 opacity-50' : 'bg-gray-100 opacity-60')
                            }`}
                          >
                            <div className={`font-medium mb-1 ${textSecondary}`}>
                              {formatShortDate(dt).split(' ')[0]}
                            </div>
                            <div className={`text-xs ${textSecondary}`}>
                              {formatShortDate(dt).split(' ').slice(1).join(' ')}
                            </div>
                            {hasData ? (
                              <>
                                <div className={`text-lg font-bold mt-1 ${dayRate >= 80 ? 'text-green-600' : dayRate >= 60 ? 'text-yellow-600' : 'text-red-600'}`}>
                                  {dayRate}%
                                </div>
                                <div className="flex justify-center gap-1 mt-1 flex-wrap">
                                  <span className="text-green-600">{d.present}P</span>
                                  {d.absent > 0 && <span className="text-red-600">{d.absent}A</span>}
                                  {d.late > 0 && <span className="text-yellow-600">{d.late}L</span>}
                                </div>
                              </>
                            ) : (
                              <div className={`text-sm mt-1 ${textSecondary}`}>--</div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </button>

                  {isExpanded && (
                    <div className={`px-5 pb-4 border-t ${cardBorder}`}>
                      <div className="overflow-x-auto mt-3">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className={isDark ? 'bg-gray-700' : 'bg-gray-50'}>
                              <th className={`px-3 py-2 text-left font-medium ${textSecondary}`}>Student</th>
                              {dates.map(dt => (
                                <th key={dt} className={`px-3 py-2 text-center font-medium ${textSecondary}`}>
                                  {formatShortDate(dt)}
                                </th>
                              ))}
                              <th className={`px-3 py-2 text-center font-medium ${textSecondary}`}>Summary</th>
                            </tr>
                          </thead>
                          <tbody>
                            {(() => {
                              const allStudentIds = new Set();
                              const studentInfo = {};
                              const studentStatuses = {};
                              
                              dates.forEach(dt => {
                                const students = cls.studentsByDate?.[dt] || [];
                                students.forEach(s => {
                                  allStudentIds.add(s.id);
                                  studentInfo[s.id] = s;
                                  if (!studentStatuses[s.id]) studentStatuses[s.id] = {};
                                  studentStatuses[s.id][dt] = s.status;
                                });
                              });

                              const sortedStudents = [...allStudentIds]
                                .map(id => studentInfo[id])
                                .sort((a, b) => `${a.last_name} ${a.first_name}`.localeCompare(`${b.last_name} ${b.first_name}`));

                              if (sortedStudents.length === 0) {
                                return (
                                  <tr>
                                    <td colSpan={dates.length + 2} className={`px-3 py-4 text-center ${textSecondary}`}>
                                      No attendance recorded this week
                                    </td>
                                  </tr>
                                );
                              }

                              return sortedStudents.map(student => {
                                const statuses = studentStatuses[student.id] || {};
                                let pCount = 0, aCount = 0, lCount = 0;
                                dates.forEach(dt => {
                                  const s = statuses[dt] || 'not_recorded';
                                  if (s === 'present') pCount++;
                                  if (s === 'absent') aCount++;
                                  if (s === 'late') lCount++;
                                });

                                return (
                                  <tr key={student.id} className={`border-t ${cardBorder}`}>
                                    <td className={`px-3 py-2 ${textPrimary} whitespace-nowrap`}>
                                      <div className="font-medium">{student.first_name} {student.last_name}</div>
                                      <div className={`text-xs ${textSecondary}`}>{student.student_number}</div>
                                    </td>
                                    {dates.map(dt => {
                                      const status = statuses[dt] || 'not_recorded';
                                      return (
                                        <td key={dt} className="px-1 py-2 text-center">
                                          <span className={`inline-flex items-center justify-center w-8 h-8 rounded-lg text-xs font-bold ${getCellBg(status)}`}>
                                            {getStatusInitial(status)}
                                          </span>
                                        </td>
                                      );
                                    })}
                                    <td className={`px-3 py-2 text-center ${textSecondary} text-xs whitespace-nowrap`}>
                                      {pCount > 0 && <span className="text-green-600">{pCount}P </span>}
                                      {aCount > 0 && <span className="text-red-600">{aCount}A </span>}
                                      {lCount > 0 && <span className="text-yellow-600">{lCount}L</span>}
                                      {pCount === 0 && aCount === 0 && lCount === 0 && '--'}
                                    </td>
                                  </tr>
                                );
                              });
                            })()}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ))}

        {classes.length === 0 && (
          <div className={`rounded-xl shadow-lg p-8 text-center ${cardBg}`}>
            <CalendarDays className={`h-12 w-12 mx-auto mb-3 ${textSecondary}`} />
            <p className={textSecondary}>No classes found for this period</p>
          </div>
        )}
      </div>
    );
  };

  const renderDailyView = () => (
    <>
      {loadingStats ? (
        <LoadingSpinner />
      ) : stats && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className={`p-6 rounded-xl ${cardBg} shadow-lg`}>
              <div className="flex items-center justify-between">
                <div>
                  <p className={`text-sm font-medium ${textSecondary}`}>Attendance Rate</p>
                  <p className="text-3xl font-bold text-green-600">{getAttendanceRate()}%</p>
                </div>
                <TrendingUp className="h-10 w-10 text-green-600 opacity-50" />
              </div>
            </div>
            <div className={`p-6 rounded-xl ${cardBg} shadow-lg`}>
              <div className="flex items-center justify-between">
                <div>
                  <p className={`text-sm font-medium ${textSecondary}`}>Present Today</p>
                  <p className="text-3xl font-bold text-blue-600">{stats.overall?.present || 0}</p>
                </div>
                <Check className="h-10 w-10 text-blue-600 opacity-50" />
              </div>
            </div>
            <div className={`p-6 rounded-xl ${cardBg} shadow-lg`}>
              <div className="flex items-center justify-between">
                <div>
                  <p className={`text-sm font-medium ${textSecondary}`}>Absent</p>
                  <p className="text-3xl font-bold text-red-600">{stats.overall?.absent || 0}</p>
                </div>
                <X className="h-10 w-10 text-red-600 opacity-50" />
              </div>
            </div>
            <div className={`p-6 rounded-xl ${cardBg} shadow-lg`}>
              <div className="flex items-center justify-between">
                <div>
                  <p className={`text-sm font-medium ${textSecondary}`}>Late Arrivals</p>
                  <p className="text-3xl font-bold text-yellow-600">{stats.overall?.late || 0}</p>
                </div>
                <Clock className="h-10 w-10 text-yellow-600 opacity-50" />
              </div>
            </div>
          </div>

          {stats.missing_classes?.length > 0 && (
            <div className={`rounded-xl shadow-lg p-6 ${cardBg}`}>
              <div className="flex items-center gap-2 mb-4">
                <AlertTriangle className="h-5 w-5 text-orange-500" />
                <h3 className={`text-lg font-semibold ${textPrimary}`}>
                  Classes Missing Attendance ({stats.missing_classes.length})
                </h3>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {stats.missing_classes.map((cls, index) => (
                  <div 
                    key={index}
                    className={`p-3 rounded-lg border ${isDark ? 'border-orange-800 bg-orange-900/20' : 'border-orange-200 bg-orange-50'}`}
                  >
                    <p className={`font-medium ${isDark ? 'text-orange-300' : 'text-orange-800'}`}>{cls.grade_name}</p>
                    <p className={`text-sm ${isDark ? 'text-orange-400' : 'text-orange-600'}`}>{cls.name}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {loadingBreakdown ? (
        <LoadingSpinner />
      ) : classBreakdown.length > 0 && (
        <div className={`rounded-xl shadow-lg p-6 ${cardBg}`}>
          <div className="flex items-center gap-2 mb-6">
            <Users className="h-6 w-6 text-indigo-600" />
            <h3 className={`text-xl font-bold ${textPrimary}`}>Class-by-Class Attendance</h3>
          </div>

          <div className="space-y-4">
            {classBreakdown.map((cls) => {
              const isExpanded = expandedClasses[cls.class_id];
              const presentStudents = cls.students?.filter(s => s.status === 'present') || [];
              const absentStudents = cls.students?.filter(s => s.status === 'absent') || [];
              const lateStudents = cls.students?.filter(s => s.status === 'late') || [];
              const excusedStudents = cls.students?.filter(s => s.status === 'excused') || [];
              const notRecorded = cls.students?.filter(s => s.status === 'not_recorded') || [];
              const totalStudents = parseInt(cls.total_students) || 0;
              const attendancePercent = totalStudents > 0 
                ? Math.round(((parseInt(cls.present) || 0) + (parseInt(cls.late) || 0)) / totalStudents * 100) 
                : 0;

              return (
                <div 
                  key={cls.class_id}
                  className={`border rounded-xl overflow-hidden ${cardBorder}`}
                >
                  <button
                    onClick={() => toggleClassExpand(cls.class_id)}
                    className={`w-full px-5 py-4 flex items-center justify-between ${isDark ? 'hover:bg-gray-700' : 'hover:bg-gray-50'}`}
                  >
                    <div className="flex items-center gap-4">
                      <div>
                        <h4 className={`font-semibold text-left ${textPrimary}`}>{cls.grade_name} - {cls.class_name}</h4>
                        <p className={`text-sm text-left ${textSecondary}`}>{totalStudents} students</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="flex gap-2">
                        <span className="px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">{cls.present || 0} Present</span>
                        <span className="px-2 py-1 rounded-full text-xs font-medium bg-red-100 text-red-800">{cls.absent || 0} Absent</span>
                        <span className="px-2 py-1 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">{cls.late || 0} Late</span>
                      </div>
                      <div className={`text-sm font-bold ${attendancePercent >= 80 ? 'text-green-600' : attendancePercent >= 60 ? 'text-yellow-600' : 'text-red-600'}`}>
                        {attendancePercent}%
                      </div>
                      {isExpanded ? (
                        <ChevronUp className={`h-5 w-5 ${textSecondary}`} />
                      ) : (
                        <ChevronDown className={`h-5 w-5 ${textSecondary}`} />
                      )}
                    </div>
                  </button>

                  {isExpanded && cls.students && (
                    <div className={`px-5 pb-4 border-t ${cardBorder}`}>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                        {presentStudents.length > 0 && (
                          <div className={`rounded-lg p-4 ${isDark ? 'bg-green-900/20 border border-green-800' : 'bg-green-50 border border-green-200'}`}>
                            <h5 className={`font-semibold mb-3 flex items-center gap-2 ${isDark ? 'text-green-300' : 'text-green-800'}`}>
                              <Check className="h-4 w-4" /> Present ({presentStudents.length})
                            </h5>
                            <div className="space-y-1">
                              {presentStudents.map(s => (
                                <div key={s.id} className={`text-sm py-1 ${isDark ? 'text-green-200' : 'text-green-700'}`}>
                                  {s.first_name} {s.last_name} <span className="opacity-60">({s.student_number})</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                        {absentStudents.length > 0 && (
                          <div className={`rounded-lg p-4 ${isDark ? 'bg-red-900/20 border border-red-800' : 'bg-red-50 border border-red-200'}`}>
                            <h5 className={`font-semibold mb-3 flex items-center gap-2 ${isDark ? 'text-red-300' : 'text-red-800'}`}>
                              <X className="h-4 w-4" /> Absent ({absentStudents.length})
                            </h5>
                            <div className="space-y-1">
                              {absentStudents.map(s => (
                                <div key={s.id} className={`text-sm py-1 ${isDark ? 'text-red-200' : 'text-red-700'}`}>
                                  {s.first_name} {s.last_name} <span className="opacity-60">({s.student_number})</span>
                                  {s.notes && <span className="italic ml-1">- {s.notes}</span>}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                        {lateStudents.length > 0 && (
                          <div className={`rounded-lg p-4 ${isDark ? 'bg-yellow-900/20 border border-yellow-800' : 'bg-yellow-50 border border-yellow-200'}`}>
                            <h5 className={`font-semibold mb-3 flex items-center gap-2 ${isDark ? 'text-yellow-300' : 'text-yellow-800'}`}>
                              <Clock className="h-4 w-4" /> Late ({lateStudents.length})
                            </h5>
                            <div className="space-y-1">
                              {lateStudents.map(s => (
                                <div key={s.id} className={`text-sm py-1 ${isDark ? 'text-yellow-200' : 'text-yellow-700'}`}>
                                  {s.first_name} {s.last_name} <span className="opacity-60">({s.student_number})</span>
                                  {s.notes && <span className="italic ml-1">- {s.notes}</span>}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                        {excusedStudents.length > 0 && (
                          <div className={`rounded-lg p-4 ${isDark ? 'bg-blue-900/20 border border-blue-800' : 'bg-blue-50 border border-blue-200'}`}>
                            <h5 className={`font-semibold mb-3 flex items-center gap-2 ${isDark ? 'text-blue-300' : 'text-blue-800'}`}>
                              <Calendar className="h-4 w-4" /> Excused ({excusedStudents.length})
                            </h5>
                            <div className="space-y-1">
                              {excusedStudents.map(s => (
                                <div key={s.id} className={`text-sm py-1 ${isDark ? 'text-blue-200' : 'text-blue-700'}`}>
                                  {s.first_name} {s.last_name} <span className="opacity-60">({s.student_number})</span>
                                  {s.notes && <span className="italic ml-1">- {s.notes}</span>}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                        {notRecorded.length > 0 && (
                          <div className={`rounded-lg p-4 ${isDark ? 'bg-gray-900/40 border border-gray-600' : 'bg-gray-50 border border-gray-200'}`}>
                            <h5 className={`font-semibold mb-3 flex items-center gap-2 ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
                              <AlertTriangle className="h-4 w-4" /> Not Recorded ({notRecorded.length})
                            </h5>
                            <div className="space-y-1">
                              {notRecorded.map(s => (
                                <div key={s.id} className={`text-sm py-1 ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>
                                  {s.first_name} {s.last_name} <span className="opacity-60">({s.student_number})</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {loadingLate ? (
        <LoadingSpinner />
      ) : lateReport?.students?.length > 0 && (
        <div className={`rounded-xl shadow-lg overflow-hidden ${cardBg}`}>
          <div className={`px-6 py-4 border-b ${cardBorder}`}>
            <div className="flex items-center gap-2">
              <Clock className="h-5 w-5 text-yellow-500" />
              <h3 className={`text-lg font-semibold ${textPrimary}`}>
                Habitually Late Students (Last {lateReport.period_days} days)
              </h3>
            </div>
            <p className={`text-sm mt-1 ${textSecondary}`}>
              Students with {lateReport.min_late_threshold}+ late arrivals
            </p>
          </div>
          
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className={isDark ? 'bg-gray-700' : 'bg-gray-50'}>
                <tr>
                  <th className={`px-6 py-3 text-left text-xs font-medium uppercase tracking-wider ${textSecondary}`}>Student</th>
                  <th className={`px-6 py-3 text-left text-xs font-medium uppercase tracking-wider ${textSecondary}`}>Class</th>
                  <th className={`px-6 py-3 text-center text-xs font-medium uppercase tracking-wider ${textSecondary}`}>Late Count</th>
                  <th className={`px-6 py-3 text-center text-xs font-medium uppercase tracking-wider ${textSecondary}`}>Absent Count</th>
                </tr>
              </thead>
              <tbody>
                {lateReport.students.map((student, index) => (
                  <tr key={student.student_id} className={`border-t ${cardBorder}`}>
                    <td className={`px-6 py-4 ${textPrimary}`}>
                      <div className="font-medium">{student.first_name} {student.last_name}</div>
                      <div className={`text-sm ${textSecondary}`}>{student.student_number}</div>
                    </td>
                    <td className={`px-6 py-4 ${textSecondary}`}>
                      {student.grade_name} - {student.class_name}
                    </td>
                    <td className="px-6 py-4 text-center">
                      <span className="px-3 py-1 rounded-full text-sm font-medium bg-yellow-100 text-yellow-800">
                        {student.late_count}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-center">
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
    </>
  );

  return (
    <div className="space-y-6">
      <div className={`rounded-xl shadow-lg p-6 ${cardBg}`}>
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <BarChart3 className="h-8 w-8 text-blue-600" />
            <div>
              <h1 className={`text-2xl font-bold ${textPrimary}`}>Attendance Reports</h1>
              <p className={`text-sm ${textSecondary}`}>School-wide attendance overview and reports</p>
            </div>
          </div>
          <button
            onClick={() => { 
              if (activeTab === 'weekly') refetchWeekly();
              else { refetchStats(); refetchToday(); }
            }}
            className={`p-2 rounded-lg ${isDark ? 'hover:bg-gray-700' : 'hover:bg-gray-100'}`}
          >
            <RefreshCw className="h-5 w-5 text-gray-500" />
          </button>
        </div>

        <div className="flex gap-2 mb-6">
          <button
            onClick={() => setActiveTab('weekly')}
            className={`flex items-center gap-2 px-5 py-2.5 rounded-xl font-medium transition-all ${
              activeTab === 'weekly'
                ? 'bg-indigo-600 text-white shadow-md'
                : isDark ? 'bg-gray-700 text-gray-300 hover:bg-gray-600' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            <CalendarDays className="h-4 w-4" />
            Weekly View
          </button>
          <button
            onClick={() => setActiveTab('daily')}
            className={`flex items-center gap-2 px-5 py-2.5 rounded-xl font-medium transition-all ${
              activeTab === 'daily'
                ? 'bg-indigo-600 text-white shadow-md'
                : isDark ? 'bg-gray-700 text-gray-300 hover:bg-gray-600' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            <Calendar className="h-4 w-4" />
            Daily View
          </button>
        </div>

        {activeTab === 'weekly' ? (
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div>
              <label className={`block text-sm font-medium mb-2 ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
                Week Start (Monday)
              </label>
              <input
                type="date"
                value={weekStart}
                onChange={(e) => {
                  setWeekStart(e.target.value);
                  setWeekEnd(getFriday(e.target.value));
                }}
                className={inputClass}
              />
            </div>
            <div>
              <label className={`block text-sm font-medium mb-2 ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
                Week End (Friday)
              </label>
              <input
                type="date"
                value={weekEnd}
                onChange={(e) => setWeekEnd(e.target.value)}
                className={inputClass}
              />
            </div>
            <div>
              <label className={`block text-sm font-medium mb-2 ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
                Filter by Grade
              </label>
              <select
                value={selectedGrade}
                onChange={(e) => setSelectedGrade(e.target.value)}
                className={inputClass}
              >
                <option value="">All Grades</option>
                {grades.map(grade => (
                  <option key={grade.id} value={grade.id}>{grade.name}</option>
                ))}
              </select>
            </div>
            <div className="flex items-end gap-2">
              <button
                onClick={() => shiftWeek(-1)}
                className={`flex-1 px-4 py-3 rounded-lg font-medium ${isDark ? 'bg-gray-700 hover:bg-gray-600 text-white' : 'bg-gray-100 hover:bg-gray-200 text-gray-700'}`}
              >
                Previous Week
              </button>
              <button
                onClick={() => shiftWeek(1)}
                className={`flex-1 px-4 py-3 rounded-lg font-medium ${isDark ? 'bg-gray-700 hover:bg-gray-600 text-white' : 'bg-gray-100 hover:bg-gray-200 text-gray-700'}`}
              >
                Next Week
              </button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className={`block text-sm font-medium mb-2 ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>Date</label>
              <input
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                max={new Date().toISOString().split('T')[0]}
                className={inputClass}
              />
            </div>
            <div>
              <label className={`block text-sm font-medium mb-2 ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>Filter by Grade</label>
              <select
                value={selectedGrade}
                onChange={(e) => setSelectedGrade(e.target.value)}
                className={inputClass}
              >
                <option value="">All Grades</option>
                {grades.map(grade => (
                  <option key={grade.id} value={grade.id}>{grade.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={`block text-sm font-medium mb-2 ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>Late Report Period</label>
              <select
                value={lateDays}
                onChange={(e) => setLateDays(parseInt(e.target.value))}
                className={inputClass}
              >
                <option value={7}>Last 7 days</option>
                <option value={14}>Last 14 days</option>
                <option value={30}>Last 30 days</option>
                <option value={60}>Last 60 days</option>
                <option value={90}>Last 90 days</option>
              </select>
            </div>
          </div>
        )}
      </div>

      {loadingToday ? (
        <LoadingSpinner />
      ) : todayStats && (
        <div className={`rounded-xl shadow-lg p-6 ${isDark ? 'bg-gradient-to-r from-blue-900 to-indigo-900' : 'bg-gradient-to-r from-blue-500 to-indigo-600'} text-white`}>
          <div className="flex items-center gap-3 mb-4">
            <Eye className="h-6 w-6" />
            <h2 className="text-xl font-bold">Real-Time Today's Status</h2>
            <span className="ml-auto text-sm opacity-80">Auto-refreshes every 30s</span>
          </div>
          
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <div className="bg-white/20 rounded-xl p-4">
              <p className="text-3xl font-bold">{todayStats.total_students}</p>
              <p className="text-sm opacity-80">Total Students</p>
            </div>
            <div className="bg-white/20 rounded-xl p-4">
              <p className="text-3xl font-bold text-green-300">{todayStats.stats?.present || 0}</p>
              <p className="text-sm opacity-80">Present</p>
            </div>
            <div className="bg-white/20 rounded-xl p-4">
              <p className="text-3xl font-bold text-red-300">{todayStats.stats?.absent || 0}</p>
              <p className="text-sm opacity-80">Absent</p>
            </div>
            <div className="bg-white/20 rounded-xl p-4">
              <p className="text-3xl font-bold text-yellow-300">{todayStats.stats?.late || 0}</p>
              <p className="text-sm opacity-80">Late</p>
            </div>
            <div className="bg-white/20 rounded-xl p-4">
              <p className="text-3xl font-bold text-orange-300">{todayStats.not_recorded}</p>
              <p className="text-sm opacity-80">Not Recorded</p>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'weekly' ? renderWeeklyView() : renderDailyView()}
    </div>
  );
};

export default AttendanceReports;
