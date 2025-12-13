import React, { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from 'react-query';
import { 
  ClipboardCheck, 
  Check, 
  X, 
  Clock, 
  AlertCircle,
  Users,
  Calendar,
  ChevronDown,
  Save,
  RefreshCw
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { attendanceAPI, classesAPI } from '../../services/api';
import { useTheme } from '../common/ThemeProvider';
import LoadingSpinner from '../common/LoadingSpinner';

const AttendanceRegister = () => {
  const { user } = useAuth();
  const { theme } = useTheme();
  const queryClient = useQueryClient();
  
  const [selectedClass, setSelectedClass] = useState(null);
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);
  const [attendanceData, setAttendanceData] = useState({});
  const [notes, setNotes] = useState({});
  const [showSuccess, setShowSuccess] = useState(false);
  
  const assignments = user?.assignments || [];
  
  const { data: classAttendance, isLoading: loadingAttendance, refetch: refetchAttendance } = useQuery(
    ['class-attendance', selectedClass?.class_id, selectedDate],
    () => attendanceAPI.getClassAttendance(selectedClass.class_id, selectedDate),
    { 
      enabled: !!selectedClass,
      onSuccess: (response) => {
        const students = response.data.students || [];
        const initialData = {};
        const initialNotes = {};
        students.forEach(student => {
          initialData[student.student_id] = student.status || 'present';
          initialNotes[student.student_id] = student.notes || '';
        });
        setAttendanceData(initialData);
        setNotes(initialNotes);
      }
    }
  );

  const submitMutation = useMutation(
    (data) => attendanceAPI.submitAttendance(data),
    {
      onSuccess: () => {
        setShowSuccess(true);
        setTimeout(() => setShowSuccess(false), 3000);
        queryClient.invalidateQueries(['class-attendance']);
      }
    }
  );

  const students = classAttendance?.data?.students || [];
  const alreadyRecorded = classAttendance?.data?.already_recorded;
  const recordedInfo = classAttendance?.data?.recorded_info;

  const handleStatusChange = (studentId, status) => {
    setAttendanceData(prev => ({
      ...prev,
      [studentId]: status
    }));
  };

  const handleNoteChange = (studentId, note) => {
    setNotes(prev => ({
      ...prev,
      [studentId]: note
    }));
  };

  const handleSubmit = () => {
    if (!selectedClass) return;

    const attendance = Object.entries(attendanceData).map(([student_id, status]) => ({
      student_id: parseInt(student_id),
      status,
      notes: notes[student_id] || null
    }));

    submitMutation.mutate({
      class_id: selectedClass.class_id,
      grade_id: selectedClass.grade_id,
      date: selectedDate,
      attendance
    });
  };

  const getStatusButton = (studentId, status, currentStatus, icon, label, bgColor, textColor) => (
    <button
      onClick={() => handleStatusChange(studentId, status)}
      className={`flex items-center justify-center px-3 py-2 rounded-lg text-sm font-medium transition-all ${
        currentStatus === status 
          ? `${bgColor} ${textColor} ring-2 ring-offset-2` 
          : theme === 'dark' 
            ? 'bg-gray-700 text-gray-300 hover:bg-gray-600' 
            : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
      }`}
    >
      {icon}
      <span className="ml-1 hidden sm:inline">{label}</span>
    </button>
  );

  const getStats = () => {
    const values = Object.values(attendanceData);
    return {
      present: values.filter(s => s === 'present').length,
      absent: values.filter(s => s === 'absent').length,
      late: values.filter(s => s === 'late').length,
      excused: values.filter(s => s === 'excused').length,
      total: values.length
    };
  };

  const stats = getStats();

  return (
    <div className="space-y-6">
      <div className={`rounded-xl shadow-lg p-6 ${
        theme === 'dark' ? 'bg-gray-800' : 'bg-white'
      }`}>
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <ClipboardCheck className="h-8 w-8 text-green-600" />
            <div>
              <h1 className={`text-2xl font-bold ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>
                Attendance Register
              </h1>
              <p className={`text-sm ${theme === 'dark' ? 'text-gray-400' : 'text-gray-500'}`}>
                Mark daily attendance for your class
              </p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
          <div>
            <label className={`block text-sm font-medium mb-2 ${theme === 'dark' ? 'text-gray-300' : 'text-gray-700'}`}>
              Select Class
            </label>
            <div className="relative">
              <select
                value={selectedClass ? `${selectedClass.grade_id}-${selectedClass.class_id}` : ''}
                onChange={(e) => {
                  const [gradeId, classId] = e.target.value.split('-').map(Number);
                  const assignment = assignments.find(a => a.grade_id === gradeId && a.class_id === classId);
                  setSelectedClass(assignment);
                }}
                className={`w-full px-4 py-3 rounded-lg border appearance-none cursor-pointer ${
                  theme === 'dark' 
                    ? 'bg-gray-700 border-gray-600 text-white' 
                    : 'bg-white border-gray-300 text-gray-900'
                }`}
              >
                <option value="">-- Select a class --</option>
                {assignments.map((assignment) => (
                  <option key={`${assignment.grade_id}-${assignment.class_id}`} value={`${assignment.grade_id}-${assignment.class_id}`}>
                    {assignment.grade_name} - {assignment.class_name}
                  </option>
                ))}
              </select>
              <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400 pointer-events-none" />
            </div>
          </div>

          <div>
            <label className={`block text-sm font-medium mb-2 ${theme === 'dark' ? 'text-gray-300' : 'text-gray-700'}`}>
              Date
            </label>
            <div className="relative">
              <input
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                max={new Date().toISOString().split('T')[0]}
                className={`w-full px-4 py-3 rounded-lg border ${
                  theme === 'dark' 
                    ? 'bg-gray-700 border-gray-600 text-white' 
                    : 'bg-white border-gray-300 text-gray-900'
                }`}
              />
              <Calendar className="absolute right-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400 pointer-events-none" />
            </div>
          </div>
        </div>

        {showSuccess && (
          <div className="mb-4 p-4 bg-green-100 border border-green-300 rounded-lg flex items-center gap-3">
            <Check className="h-5 w-5 text-green-600" />
            <span className="text-green-800 font-medium">Attendance recorded successfully!</span>
          </div>
        )}

        {alreadyRecorded && recordedInfo && (
          <div className="mb-4 p-4 bg-blue-50 border border-blue-200 rounded-lg flex items-center gap-3">
            <AlertCircle className="h-5 w-5 text-blue-600" />
            <div>
              <span className="text-blue-800 font-medium">Attendance already recorded for this date</span>
              <p className="text-sm text-blue-600">
                Recorded by {recordedInfo.recorded_by_first_name} {recordedInfo.recorded_by_last_name} at{' '}
                {new Date(recordedInfo.recorded_at).toLocaleTimeString()}
              </p>
            </div>
          </div>
        )}
      </div>

      {selectedClass && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className={`p-4 rounded-xl ${theme === 'dark' ? 'bg-green-900/30' : 'bg-green-50'} border border-green-200`}>
              <div className="flex items-center gap-2">
                <Check className="h-5 w-5 text-green-600" />
                <span className={`text-sm font-medium ${theme === 'dark' ? 'text-green-300' : 'text-green-700'}`}>Present</span>
              </div>
              <p className="text-2xl font-bold text-green-600 mt-1">{stats.present}</p>
            </div>
            <div className={`p-4 rounded-xl ${theme === 'dark' ? 'bg-red-900/30' : 'bg-red-50'} border border-red-200`}>
              <div className="flex items-center gap-2">
                <X className="h-5 w-5 text-red-600" />
                <span className={`text-sm font-medium ${theme === 'dark' ? 'text-red-300' : 'text-red-700'}`}>Absent</span>
              </div>
              <p className="text-2xl font-bold text-red-600 mt-1">{stats.absent}</p>
            </div>
            <div className={`p-4 rounded-xl ${theme === 'dark' ? 'bg-yellow-900/30' : 'bg-yellow-50'} border border-yellow-200`}>
              <div className="flex items-center gap-2">
                <Clock className="h-5 w-5 text-yellow-600" />
                <span className={`text-sm font-medium ${theme === 'dark' ? 'text-yellow-300' : 'text-yellow-700'}`}>Late</span>
              </div>
              <p className="text-2xl font-bold text-yellow-600 mt-1">{stats.late}</p>
            </div>
            <div className={`p-4 rounded-xl ${theme === 'dark' ? 'bg-purple-900/30' : 'bg-purple-50'} border border-purple-200`}>
              <div className="flex items-center gap-2">
                <AlertCircle className="h-5 w-5 text-purple-600" />
                <span className={`text-sm font-medium ${theme === 'dark' ? 'text-purple-300' : 'text-purple-700'}`}>Excused</span>
              </div>
              <p className="text-2xl font-bold text-purple-600 mt-1">{stats.excused}</p>
            </div>
          </div>

          <div className={`rounded-xl shadow-lg overflow-hidden ${
            theme === 'dark' ? 'bg-gray-800' : 'bg-white'
          }`}>
            <div className={`px-6 py-4 border-b ${theme === 'dark' ? 'border-gray-700' : 'border-gray-200'}`}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Users className="h-5 w-5 text-blue-600" />
                  <h2 className={`text-lg font-semibold ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>
                    Students ({stats.total})
                  </h2>
                </div>
                <button
                  onClick={() => refetchAttendance()}
                  className={`p-2 rounded-lg ${theme === 'dark' ? 'hover:bg-gray-700' : 'hover:bg-gray-100'}`}
                >
                  <RefreshCw className="h-4 w-4 text-gray-500" />
                </button>
              </div>
              <p className={`text-sm mt-1 ${theme === 'dark' ? 'text-gray-400' : 'text-gray-500'}`}>
                All students default to Present. Only mark students who are absent, late, or excused.
              </p>
            </div>

            {loadingAttendance ? (
              <div className="p-8 flex justify-center">
                <LoadingSpinner />
              </div>
            ) : students.length === 0 ? (
              <div className="p-8 text-center">
                <Users className="h-12 w-12 mx-auto text-gray-400 mb-3" />
                <p className={theme === 'dark' ? 'text-gray-400' : 'text-gray-500'}>
                  No students found in this class
                </p>
              </div>
            ) : (
              <div className="divide-y divide-gray-200 dark:divide-gray-700">
                {students.map((student, index) => (
                  <div 
                    key={student.student_id} 
                    className={`px-6 py-4 ${index % 2 === 0 ? (theme === 'dark' ? 'bg-gray-800' : 'bg-white') : (theme === 'dark' ? 'bg-gray-850' : 'bg-gray-50')}`}
                  >
                    <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                      <div className="flex-1">
                        <div className="flex items-center gap-3">
                          <div className="h-10 w-10 rounded-full bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center text-white font-semibold">
                            {student.first_name?.[0]}{student.last_name?.[0]}
                          </div>
                          <div>
                            <p className={`font-medium ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>
                              {student.first_name} {student.last_name}
                            </p>
                            <p className={`text-sm ${theme === 'dark' ? 'text-gray-400' : 'text-gray-500'}`}>
                              {student.student_number || 'No student number'}
                            </p>
                          </div>
                        </div>
                      </div>
                      
                      <div className="flex flex-wrap gap-2">
                        {getStatusButton(
                          student.student_id, 
                          'present', 
                          attendanceData[student.student_id],
                          <Check className="h-4 w-4" />,
                          'Present',
                          'bg-green-500',
                          'text-white ring-green-400'
                        )}
                        {getStatusButton(
                          student.student_id, 
                          'absent', 
                          attendanceData[student.student_id],
                          <X className="h-4 w-4" />,
                          'Absent',
                          'bg-red-500',
                          'text-white ring-red-400'
                        )}
                        {getStatusButton(
                          student.student_id, 
                          'late', 
                          attendanceData[student.student_id],
                          <Clock className="h-4 w-4" />,
                          'Late',
                          'bg-yellow-500',
                          'text-white ring-yellow-400'
                        )}
                        {getStatusButton(
                          student.student_id, 
                          'excused', 
                          attendanceData[student.student_id],
                          <AlertCircle className="h-4 w-4" />,
                          'Excused',
                          'bg-purple-500',
                          'text-white ring-purple-400'
                        )}
                      </div>
                    </div>
                    
                    {(attendanceData[student.student_id] === 'absent' || 
                      attendanceData[student.student_id] === 'late' || 
                      attendanceData[student.student_id] === 'excused') && (
                      <div className="mt-3 ml-13">
                        <input
                          type="text"
                          placeholder="Add note (optional)"
                          value={notes[student.student_id] || ''}
                          onChange={(e) => handleNoteChange(student.student_id, e.target.value)}
                          className={`w-full px-3 py-2 text-sm rounded-lg border ${
                            theme === 'dark' 
                              ? 'bg-gray-700 border-gray-600 text-white placeholder-gray-400' 
                              : 'bg-gray-50 border-gray-200 text-gray-900 placeholder-gray-400'
                          }`}
                        />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {students.length > 0 && (
              <div className={`px-6 py-4 border-t ${theme === 'dark' ? 'border-gray-700 bg-gray-850' : 'border-gray-200 bg-gray-50'}`}>
                <div className="flex items-center justify-between">
                  <div className={`text-sm ${theme === 'dark' ? 'text-gray-400' : 'text-gray-500'}`}>
                    {stats.total} students total
                  </div>
                  <button
                    onClick={handleSubmit}
                    disabled={submitMutation.isLoading}
                    className="flex items-center gap-2 px-6 py-3 bg-green-600 hover:bg-green-700 text-white rounded-xl font-medium transition-colors disabled:opacity-50"
                  >
                    {submitMutation.isLoading ? (
                      <RefreshCw className="h-5 w-5 animate-spin" />
                    ) : (
                      <Save className="h-5 w-5" />
                    )}
                    {alreadyRecorded ? 'Update Attendance' : 'Submit Attendance'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {!selectedClass && assignments.length === 0 && (
        <div className={`rounded-xl p-8 text-center ${theme === 'dark' ? 'bg-gray-800' : 'bg-white'} shadow-lg`}>
          <Users className="h-16 w-16 mx-auto text-gray-400 mb-4" />
          <h3 className={`text-lg font-semibold mb-2 ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>
            No Classes Assigned
          </h3>
          <p className={theme === 'dark' ? 'text-gray-400' : 'text-gray-500'}>
            You haven't been assigned to any classes yet. Please contact an administrator.
          </p>
        </div>
      )}
    </div>
  );
};

export default AttendanceRegister;
