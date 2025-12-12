import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from 'react-query';
import { Link } from 'react-router-dom';
import { BookOpen, Clock, CheckCircle, AlertTriangle, Plus, Trash2 } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useTheme } from '../common/ThemeProvider';
import { tasksAPI, classesAPI } from '../../services/api';
import LoadingSpinner from '../common/LoadingSpinner';
import toast from 'react-hot-toast';

const Tasks = () => {
  const { user } = useAuth();
  const { theme } = useTheme();
  const [selectedGrade, setSelectedGrade] = useState('');
  const [selectedClass, setSelectedClass] = useState('');
  const queryClient = useQueryClient();

  const isDark = theme === 'dark';
  const cardBg = isDark ? 'bg-gray-900' : 'bg-white';
  const cardBorder = isDark ? 'border-gray-800' : 'border-gray-100';
  const textPrimary = isDark ? 'text-white' : 'text-gray-900';
  const textSecondary = isDark ? 'text-gray-400' : 'text-gray-600';

  // Fetch grades and classes for admin/teacher selection
  const { data: gradesData } = useQuery('grades', () => classesAPI.getGrades(), {
    enabled: user?.role === 'admin' || user?.role === 'super_admin' || user?.role === 'teacher'
  });
  const { data: classesData } = useQuery('classes', () => classesAPI.getClasses(), {
    enabled: user?.role === 'admin' || user?.role === 'super_admin' || user?.role === 'teacher'
  });

  // Fetch teacher assignments if user is a teacher
  const { data: teacherAssignments } = useQuery(
    ['teacher-assignments', user?.id],
    () => user?.role === 'teacher' ? 
      fetch(`/api/admin/teachers/${user.id}/assignments`, {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
      }).then(res => res.json()) : 
      null,
    { enabled: user?.role === 'teacher' }
  );

  const grades = gradesData?.data?.grades || [];
  const classes = classesData?.data?.classes || [];

  // Determine which grade/class to fetch tasks for
  let gradeToFetch, classToFetch;
  
  if (user?.role === 'student') {
    gradeToFetch = user.grade_id;
    classToFetch = user.class_id;
  } else if (user?.role === 'teacher') {
    if (selectedGrade && selectedClass) {
      gradeToFetch = selectedGrade;
      classToFetch = selectedClass;
    } else if (teacherAssignments?.assignments?.length > 0) {
      gradeToFetch = teacherAssignments.assignments[0].grade_id;
      classToFetch = teacherAssignments.assignments[0].class_id;
    }
  } else if (user?.role === 'admin' || user?.role === 'super_admin') {
    if (selectedGrade && selectedClass) {
      gradeToFetch = selectedGrade;
      classToFetch = selectedClass;
    } else if (grades.length > 0 && classes.length > 0) {
      gradeToFetch = grades[0].id;
      classToFetch = classes[0].id;
    }
  }

  const { data: tasksData, isLoading, error } = useQuery(
    ['tasks', gradeToFetch, classToFetch],
    async () => {
      if (!gradeToFetch || !classToFetch) {
        if (user?.role === 'student') {
          throw new Error('Your account is missing grade or class assignment. Please contact the administrator.');
        } else if (user?.role === 'teacher') {
          throw new Error('You are not assigned to any grades or classes. Please contact the administrator.');
        } else {
          throw new Error('Please select a grade and class to view tasks.');
        }
      }
      
      try {
        const response = await tasksAPI.getTasks(gradeToFetch, classToFetch);
        return response;
      } catch (apiError) {
        throw apiError;
      }
    },
    { 
      enabled: !!(gradeToFetch && classToFetch),
      retry: (failureCount, error) => {
        if (error.message.includes('403') || error.message.includes('401')) {
          return false;
        }
        return failureCount < 2;
      }
    }
  );

  const deleteTaskMutation = useMutation(
    (taskId) => tasksAPI.deleteTask(taskId),
    {
      onSuccess: () => {
        toast.success('Task deleted successfully');
        queryClient.invalidateQueries(['tasks', gradeToFetch, classToFetch]);
      },
      onError: (error) => {
        toast.error(error.response?.data?.message || 'Failed to delete task');
      }
    }
  );

  const handleDeleteTask = (taskId, taskTitle) => {
    if (window.confirm(`Are you sure you want to delete the task "${taskTitle}"? This action cannot be undone.`)) {
      deleteTaskMutation.mutate(taskId);
    }
  };

  let availableGrades = grades;
  let availableClasses = classes;

  if (user?.role === 'teacher' && teacherAssignments?.assignments) {
    const assignedGradeIds = [...new Set(teacherAssignments.assignments.map(a => a.grade_id))];
    const assignedClassIds = [...new Set(teacherAssignments.assignments.map(a => a.class_id))];
    
    availableGrades = grades.filter(grade => assignedGradeIds.includes(grade.id));
    availableClasses = classes.filter(cls => assignedClassIds.includes(cls.id));
  }

  const filteredClasses = availableClasses.filter(cls => 
    selectedGrade ? cls.grade_id == selectedGrade : true
  );

  const tasks = tasksData?.data?.tasks || [];

  if (isLoading) {
    return <LoadingSpinner />;
  }

  if (error) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-gradient-to-br from-blue-500 to-blue-600 rounded-xl shadow-lg shadow-blue-500/25">
            <BookOpen className="h-6 w-6 text-white" />
          </div>
          <h1 className={`text-2xl font-bold ${textPrimary}`}>Tasks & Assignments</h1>
        </div>
        <div className="bg-red-50 border border-red-200 rounded-2xl p-6">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle className="h-5 w-5 text-red-600" />
            <h3 className="text-lg font-semibold text-red-800">Error Loading Tasks</h3>
          </div>
          <p className="text-red-700">
            {error.message || 'Failed to load tasks. Please try again or contact support.'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-gradient-to-br from-blue-500 to-blue-600 rounded-xl shadow-lg shadow-blue-500/25">
            <BookOpen className="h-6 w-6 text-white" />
          </div>
          <h1 className={`text-2xl font-bold ${textPrimary}`}>Tasks & Assignments</h1>
        </div>
        {(user?.role === 'teacher' || user?.role === 'admin' || user?.role === 'super_admin') && (
          <Link
            to="/tasks/create"
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-emerald-500 to-emerald-600 text-white rounded-xl font-medium shadow-lg shadow-emerald-500/25 hover:shadow-xl transition-all"
          >
            <Plus className="h-4 w-4" />
            Create Task
          </Link>
        )}
      </div>

      {/* Grade/Class Selection */}
      {(user?.role === 'admin' || user?.role === 'super_admin' || user?.role === 'teacher') && (
        <div className={`${cardBg} rounded-2xl shadow-sm border ${cardBorder} p-5`}>
          <h3 className={`text-base font-semibold ${textPrimary} mb-4`}>Select Grade & Class</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className={`block text-sm font-medium ${textSecondary} mb-2`}>
                Grade {user?.role === 'teacher' && "(Only your assigned grades)"}
              </label>
              <select
                value={selectedGrade}
                onChange={(e) => {
                  setSelectedGrade(e.target.value);
                  setSelectedClass('');
                }}
                className={`w-full px-4 py-2.5 rounded-xl border ${cardBorder} ${cardBg} ${textPrimary} focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all`}
              >
                <option value="">Select Grade</option>
                {availableGrades.map((grade) => (
                  <option key={grade.id} value={grade.id}>
                    {grade.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={`block text-sm font-medium ${textSecondary} mb-2`}>
                Class {user?.role === 'teacher' && "(Only your assigned classes)"}
              </label>
              <select
                value={selectedClass}
                onChange={(e) => setSelectedClass(e.target.value)}
                disabled={!selectedGrade}
                className={`w-full px-4 py-2.5 rounded-xl border ${cardBorder} ${cardBg} ${textPrimary} focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all disabled:opacity-50`}
              >
                <option value="">Select Class</option>
                {filteredClasses.map((cls) => (
                  <option key={cls.id} value={cls.id}>
                    {cls.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      )}

      {/* Current Selection Info */}
      {user && gradeToFetch && classToFetch && (
        <div className="bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800 rounded-xl p-4">
          <div className="text-sm text-blue-700 dark:text-blue-300">
            <span className="font-medium">Viewing tasks for: </span>
            {grades.find(g => g.id == gradeToFetch)?.name || `Grade ${gradeToFetch}`} - {classes.find(c => c.id == classToFetch)?.name || `Class ${classToFetch}`}
          </div>
        </div>
      )}

      {/* Tasks List */}
      <div className="space-y-4">
        {tasks.length > 0 ? (
          tasks.map((task) => (
            <div key={task.id} className={`${cardBg} rounded-2xl shadow-sm border ${cardBorder} p-5 hover:shadow-lg transition-all duration-200`}>
              <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
                <div className="flex-1">
                  <div className="flex flex-wrap items-center gap-3 mb-2">
                    <h2 className={`text-lg font-semibold ${textPrimary}`}>{task.title}</h2>
                    <span className={`px-3 py-1 rounded-full text-xs font-semibold ${
                      task.task_type === 'quiz' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'
                    }`}>
                      {task.task_type === 'quiz' ? 'Quiz' : 'Assignment'}
                    </span>
                    {task.attachment_s3_url && (
                      <span className="px-2 py-1 rounded-full text-xs font-medium bg-emerald-100 text-emerald-700">
                        📎 Attachment
                      </span>
                    )}
                  </div>
                  <p className={`${textSecondary} text-sm mb-4`}>{task.description}</p>
                  <div className={`flex flex-wrap items-center gap-4 text-sm ${textSecondary}`}>
                    <div className="flex items-center gap-1.5">
                      <Clock className="h-4 w-4" />
                      Due: {new Date(task.due_date).toLocaleDateString()}
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="font-medium">Max Points:</span> {task.max_points}
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="font-medium">Teacher:</span> {task.teacher_first_name} {task.teacher_last_name}
                    </div>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  {task.submission_id ? (
                    <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-emerald-100 text-emerald-700 text-sm font-medium">
                      <CheckCircle className="h-4 w-4" />
                      Submitted
                    </span>
                  ) : new Date(task.due_date) <= new Date() ? (
                    <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-red-100 text-red-700 text-sm font-medium">
                      <AlertTriangle className="h-4 w-4" />
                      Overdue
                    </span>
                  ) : (
                    <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-amber-100 text-amber-700 text-sm font-medium">
                      <Clock className="h-4 w-4" />
                      Pending
                    </span>
                  )}
                  <Link
                    to={`/tasks/${task.id}`}
                    className="px-4 py-2.5 bg-gradient-to-r from-blue-500 to-blue-600 text-white rounded-xl text-sm font-medium shadow-sm hover:shadow-md transition-all"
                  >
                    View Details
                  </Link>
                  {(user?.role === 'teacher' || user?.role === 'admin' || user?.role === 'super_admin') && (
                    <button
                      onClick={() => handleDeleteTask(task.id, task.title)}
                      className={`flex items-center gap-1.5 px-3 py-2.5 rounded-xl border ${cardBorder} text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 text-sm font-medium transition-colors`}
                    >
                      <Trash2 className="h-4 w-4" />
                      Delete
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))
        ) : (
          <div className={`${cardBg} rounded-2xl shadow-sm border ${cardBorder} py-16 text-center`}>
            <div className="p-4 bg-gray-100 dark:bg-gray-800 rounded-full w-fit mx-auto mb-4">
              <BookOpen className="h-12 w-12 text-gray-400" />
            </div>
            <h3 className={`text-lg font-semibold ${textPrimary} mb-2`}>No tasks found</h3>
            <p className={textSecondary}>
              There are no tasks assigned to your class yet.
            </p>
            {user?.role === 'student' && (
              <p className={`mt-2 text-xs ${textSecondary}`}>
                Your grade: {user.grade_name || user.grade_id} | Your class: {user.class_name || user.class_id}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default Tasks;
