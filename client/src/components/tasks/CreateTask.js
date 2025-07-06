import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from 'react-query';
import { Calendar, Clock, BookOpen, Save, ArrowLeft, AlertTriangle } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { tasksAPI, classesAPI } from '../../services/api';
import LoadingSpinner from '../common/LoadingSpinner';
import toast from 'react-hot-toast';

const CreateTask = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    instructions: '',
    due_date: '',
    max_points: 100,
    task_type: 'assignment',
    grade_id: '',
    class_id: ''
  });

  // Fetch grades and classes
  const { data: gradesData } = useQuery('grades', () => classesAPI.getGrades());
  const { data: classesData } = useQuery('classes', () => classesAPI.getClasses());
  
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

  // Filter grades and classes based on user role
  let availableGrades = grades;
  let availableClasses = classes;

  if (user?.role === 'teacher' && teacherAssignments?.assignments) {
    // For teachers, only show grades/classes they are assigned to
    const assignedGradeIds = [...new Set(teacherAssignments.assignments.map(a => a.grade_id))];
    const assignedClassIds = [...new Set(teacherAssignments.assignments.map(a => a.class_id))];
    
    availableGrades = grades.filter(grade => assignedGradeIds.includes(grade.id));
    availableClasses = classes.filter(cls => assignedClassIds.includes(cls.id));
  }

  // Filter classes based on selected grade
  const filteredClasses = availableClasses.filter(cls => 
    formData.grade_id ? cls.grade_id == formData.grade_id : true
  );

  // Create task mutation
  const createTaskMutation = useMutation(
    (taskData) => tasksAPI.createTask(taskData),
    {
      onSuccess: (response) => {
        toast.success('Task created successfully!');
        queryClient.invalidateQueries(['tasks']);
        navigate('/tasks');
      },
      onError: (error) => {
        const message = error.response?.data?.message || 'Failed to create task';
        toast.error(message);
        console.error('Create task error:', error);
      }
    }
  );

  const handleSubmit = (e) => {
    e.preventDefault();
    
    // Validation
    if (!formData.title.trim()) {
      toast.error('Task title is required');
      return;
    }
    
    if (!formData.grade_id || !formData.class_id) {
      toast.error('Please select both grade and class');
      return;
    }

    if (!formData.due_date) {
      toast.error('Due date is required');
      return;
    }

    // Additional validation for teachers
    if (user?.role === 'teacher') {
      const isValidAssignment = teacherAssignments?.assignments?.some(
        assignment => assignment.grade_id == formData.grade_id && assignment.class_id == formData.class_id
      );
      
      if (!isValidAssignment) {
        toast.error('You can only create tasks for your assigned grade/class combinations');
        return;
      }
    }

    // Format due date for backend
    const taskData = {
      ...formData,
      grade_id: parseInt(formData.grade_id),
      class_id: parseInt(formData.class_id),
      max_points: parseInt(formData.max_points),
      due_date: new Date(formData.due_date).toISOString()
    };

    createTaskMutation.mutate(taskData);
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));

    // Reset class selection when grade changes
    if (name === 'grade_id') {
      setFormData(prev => ({
        ...prev,
        class_id: ''
      }));
    }
  };

  // Set minimum date to today
  const today = new Date().toISOString().split('T')[0];

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center space-x-4">
        <button
          onClick={() => navigate('/tasks')}
          className="flex items-center text-gray-600 hover:text-gray-900"
        >
          <ArrowLeft className="h-5 w-5 mr-2" />
          Back to Tasks
        </button>
        <h1 className="text-3xl font-bold text-gray-900">Create New Task</h1>
      </div>

      {/* Teacher Assignment Warning */}
      {user?.role === 'teacher' && availableGrades.length === 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
          <div className="flex items-center">
            <AlertTriangle className="h-5 w-5 text-amber-600 mr-2" />
            <div>
              <h3 className="text-sm font-medium text-amber-800">No Grade/Class Assignments</h3>
              <p className="text-sm text-amber-700 mt-1">
                You are not currently assigned to any grades or classes. Please contact an administrator to assign you to grades and classes before creating tasks.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Teacher Info Panel */}
      {user?.role === 'teacher' && availableGrades.length > 0 && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <div className="flex items-center">
            <BookOpen className="h-5 w-5 text-blue-600 mr-2" />
            <div>
              <h3 className="text-sm font-medium text-blue-800">Your Assigned Grades/Classes</h3>
              <p className="text-sm text-blue-700 mt-1">
                You can create tasks for: {availableGrades.map(g => g.name).join(', ')}
              </p>
            </div>
          </div>
        </div>
      )}

      <div className="bg-white rounded-lg shadow-sm border border-gray-200">
        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          {/* Disable form if teacher has no assignments */}
          {user?.role === 'teacher' && availableGrades.length === 0 ? (
            <div className="text-center py-12">
              <AlertTriangle className="mx-auto h-12 w-12 text-amber-400 mb-4" />
              <h3 className="text-lg font-medium text-gray-900 mb-2">Cannot Create Tasks</h3>
              <p className="text-gray-600">
                You need to be assigned to at least one grade and class to create tasks. 
                Please contact an administrator.
              </p>
            </div>
          ) : (
            <>
              {/* Basic Information */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="md:col-span-2">
              <label htmlFor="title" className="block text-sm font-medium text-gray-700 mb-2">
                Task Title *
              </label>
              <input
                type="text"
                id="title"
                name="title"
                value={formData.title}
                onChange={handleChange}
                required
                placeholder="Enter task title"
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>

            <div>
              <label htmlFor="task_type" className="block text-sm font-medium text-gray-700 mb-2">
                Task Type *
              </label>
              <select
                id="task_type"
                name="task_type"
                value={formData.task_type}
                onChange={handleChange}
                required
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                <option value="assignment">Assignment</option>
                <option value="quiz">Quiz</option>
              </select>
            </div>

            <div>
              <label htmlFor="max_points" className="block text-sm font-medium text-gray-700 mb-2">
                Maximum Points *
              </label>
              <input
                type="number"
                id="max_points"
                name="max_points"
                value={formData.max_points}
                onChange={handleChange}
                min="1"
                required
                placeholder="100"
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>

            <div>
              <label htmlFor="due_date" className="block text-sm font-medium text-gray-700 mb-2">
                Due Date *
              </label>
              <input
                type="datetime-local"
                id="due_date"
                name="due_date"
                value={formData.due_date}
                onChange={handleChange}
                min={today}
                required
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>

            <div>
              <label htmlFor="grade_id" className="block text-sm font-medium text-gray-700 mb-2">
                Grade *
                {user?.role === 'teacher' && (
                  <span className="text-xs text-gray-500 ml-2">(Only your assigned grades)</span>
                )}
              </label>
              <select
                id="grade_id"
                name="grade_id"
                value={formData.grade_id}
                onChange={handleChange}
                required
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
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
              <label htmlFor="class_id" className="block text-sm font-medium text-gray-700 mb-2">
                Class *
                {user?.role === 'teacher' && (
                  <span className="text-xs text-gray-500 ml-2">(Only your assigned classes)</span>
                )}
              </label>
              <select
                id="class_id"
                name="class_id"
                value={formData.class_id}
                onChange={handleChange}
                required
                disabled={!formData.grade_id}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-100"
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

          {/* Description */}
          <div>
            <label htmlFor="description" className="block text-sm font-medium text-gray-700 mb-2">
              Description
            </label>
            <textarea
              id="description"
              name="description"
              value={formData.description}
              onChange={handleChange}
              rows={3}
              placeholder="Brief description of the task"
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          {/* Instructions */}
          <div>
            <label htmlFor="instructions" className="block text-sm font-medium text-gray-700 mb-2">
              Instructions
            </label>
            <textarea
              id="instructions"
              name="instructions"
              value={formData.instructions}
              onChange={handleChange}
              rows={4}
              placeholder="Detailed instructions for students"
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          {/* Submit Button */}
          <div className="flex items-center justify-end space-x-4 pt-6 border-t border-gray-200">
            <button
              type="button"
              onClick={() => navigate('/tasks')}
              className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={createTaskMutation.isLoading || (user?.role === 'teacher' && availableGrades.length === 0)}
              className="inline-flex items-center px-4 py-2 border border-transparent rounded-md text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {createTaskMutation.isLoading ? (
                <LoadingSpinner size="sm" />
              ) : (
                <>
                  <Save className="h-4 w-4 mr-2" />
                  Create Task
                </>
              )}
            </button>
          </div>
          </>
          )}
        </form>
      </div>
    </div>
  );
};

export default CreateTask;
