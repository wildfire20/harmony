import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from 'react-query';
import { useForm } from 'react-hook-form';
import { Plus, Search, Edit, Trash2, Mail } from 'lucide-react';
import { adminAPI } from '../../services/api';
import LoadingSpinner from '../common/LoadingSpinner';
import toast from 'react-hot-toast';

const TeacherManagement = () => {
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingTeacher, setEditingTeacher] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const queryClient = useQueryClient();

  const { register, handleSubmit, reset, formState: { errors } } = useForm();

  // Fetch teachers
  const { data: teachersData, isLoading } = useQuery(
    ['teachers', searchTerm],
    () => adminAPI.getTeachers({ search: searchTerm })
  );

  // Fetch grades for assignment
  const { data: gradesData } = useQuery('grades', () => adminAPI.getGrades());

  // Fetch classes for assignment
  const { data: classesData } = useQuery('classes', () => adminAPI.getClasses());

  // Add teacher mutation
  const addTeacherMutation = useMutation(
    (data) => {
      console.log('Adding teacher with data:', data);
      return adminAPI.addTeacher(data);
    },
    {
      onSuccess: (response) => {
        console.log('Teacher added successfully:', response);
        queryClient.invalidateQueries(['teachers']);
        setShowAddForm(false);
        reset();
        toast.success('Teacher added successfully!');
      },
      onError: (error) => {
        console.error('Add teacher error:', error);
        console.error('Error response:', error.response?.data);
        const errorMessage = error.response?.data?.message || 
                           error.response?.data?.errors?.[0]?.msg || 
                           'Failed to add teacher';
        toast.error(errorMessage);
      }
    }
  );

  // Update teacher mutation
  const updateTeacherMutation = useMutation(
    ({ id, data }) => {
      console.log('Updating teacher:', id, data);
      return adminAPI.updateTeacher(id, data);
    },
    {
      onSuccess: (response) => {
        console.log('Teacher updated successfully:', response);
        // Force refresh of teachers data
        queryClient.invalidateQueries(['teachers']);
        queryClient.refetchQueries(['teachers']);
        setEditingTeacher(null);
        setShowAddForm(false);
        reset();
        toast.success('Teacher updated successfully!');
      },
      onError: (error) => {
        console.error('Update teacher error:', error);
        console.error('Error response:', error.response?.data);
        const errorMessage = error.response?.data?.message || 
                           error.response?.data?.errors?.[0]?.msg || 
                           'Failed to update teacher';
        toast.error(errorMessage);
      }
    }
  );
  const deleteTeacherMutation = useMutation(
    (id) => adminAPI.deleteTeacher(id),
    {
      onSuccess: () => {
        queryClient.invalidateQueries(['teachers']);
        toast.success('Teacher deleted successfully!');
      },
      onError: (error) => {
        toast.error(error.response?.data?.message || 'Failed to delete teacher');
      }
    }
  );

  const teachers = teachersData?.data?.teachers || [];
  const grades = gradesData?.data?.grades || [];
  const classes = classesData?.data?.classes || [];

  // Debug logging
  console.log('Teachers data:', teachersData);
  console.log('Processed teachers:', teachers);

  // Process teachers to format assigned classes
  const processedTeachers = teachers.map(teacher => {
    let assignedClasses = 'None';
    
    if (teacher.assignments && Array.isArray(teacher.assignments) && teacher.assignments.length > 0) {
      // Filter out null/empty assignments and format them
      const validAssignments = teacher.assignments.filter(assignment => 
        assignment && assignment.class_name && assignment.grade_name
      );
      
      if (validAssignments.length > 0) {
        assignedClasses = validAssignments
          .map(assignment => `${assignment.grade_name} - ${assignment.class_name}`)
          .join(', ');
      }
    }
    
    return {
      ...teacher,
      assigned_classes: assignedClasses
    };
  });

  console.log('Processed teachers with assignments:', processedTeachers);

  const onSubmit = (data) => {
    console.log('Form data being submitted:', data);
    
    // Convert grade_ids and class_ids to arrays if they exist
    const formattedData = {
      ...data,
      grade_ids: data.grade_ids ? (Array.isArray(data.grade_ids) ? data.grade_ids : [data.grade_ids]) : [],
      class_ids: data.class_ids ? (Array.isArray(data.class_ids) ? data.class_ids : [data.class_ids]) : []
    };
    
    console.log('Formatted data being sent:', formattedData);
    
    if (editingTeacher) {
      updateTeacherMutation.mutate({ id: editingTeacher.id, data: formattedData });
    } else {
      addTeacherMutation.mutate(formattedData);
    }
  };

  const handleEdit = (teacher) => {
    setEditingTeacher(teacher);
    setShowAddForm(true);
    
    // Extract grade_ids and class_ids from assignments
    let grade_ids = [];
    let class_ids = [];
    
    if (teacher.assignments && Array.isArray(teacher.assignments)) {
      teacher.assignments.forEach(assignment => {
        if (assignment && assignment.grade_id && assignment.class_id) {
          grade_ids.push(assignment.grade_id);
          class_ids.push(assignment.class_id);
        }
      });
    }
    
    reset({
      first_name: teacher.first_name,
      last_name: teacher.last_name,
      email: teacher.email,
      role: teacher.role,
      grade_ids: grade_ids,
      class_ids: class_ids
    });
  };

  const handleCancelEdit = () => {
    setEditingTeacher(null);
    setShowAddForm(false);
    reset();
  };

  const handleDelete = (id, name) => {
    if (window.confirm(`Are you sure you want to delete ${name}?`)) {
      deleteTeacherMutation.mutate(id);
    }
  };

  if (isLoading) return <LoadingSpinner />;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-gray-900">Teacher Management</h2>
        <button
          onClick={() => setShowAddForm(true)}
          className="bg-green-600 text-white px-4 py-2 rounded-md hover:bg-green-700 flex items-center space-x-2"
        >
          <Plus className="h-4 w-4" />
          <span>Add Teacher</span>
        </button>
      </div>

      {/* Search */}
      <div className="bg-white p-4 rounded-lg shadow-sm border border-gray-200">
        <div className="relative">
          <Search className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search teachers..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-green-500"
          />
        </div>
      </div>

      {/* Add Teacher Form */}
      {showAddForm && (
        <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-gray-900">
              {editingTeacher ? 'Edit Teacher' : 'Add New Teacher'}
            </h3>
            <button
              onClick={handleCancelEdit}
              className="text-gray-400 hover:text-gray-600"
            >
              ×
            </button>
          </div>
          <form onSubmit={handleSubmit(onSubmit)} className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                First Name *
              </label>
              <input
                {...register('first_name', { required: 'First name is required' })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-green-500"
              />
              {errors.first_name && (
                <p className="text-red-500 text-sm mt-1">{errors.first_name.message}</p>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Last Name *
              </label>
              <input
                {...register('last_name', { required: 'Last name is required' })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-green-500"
              />
              {errors.last_name && (
                <p className="text-red-500 text-sm mt-1">{errors.last_name.message}</p>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Email *
              </label>
              <input
                type="email"
                {...register('email', { 
                  required: 'Email is required',
                  pattern: {
                    value: /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i,
                    message: 'Invalid email address'
                  }
                })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-green-500"
              />
              {errors.email && (
                <p className="text-red-500 text-sm mt-1">{errors.email.message}</p>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Role
              </label>
              <select
                {...register('role')}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-green-500"
              >
                <option value="teacher">Teacher</option>
                <option value="admin">Admin</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Assign to Grades (Optional)
              </label>
              <select
                multiple
                {...register('grade_ids')}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-green-500 h-20"
              >
                {grades.map((grade) => (
                  <option key={grade.id} value={grade.id}>
                    {grade.name}
                  </option>
                ))}
              </select>
              <p className="text-sm text-gray-500 mt-1">Hold Ctrl/Cmd to select multiple grades</p>
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Assign to Classes (Optional)
              </label>
              <select
                multiple
                {...register('class_ids')}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-green-500 h-20"
              >
                {classes.map((classItem) => (
                  <option key={classItem.id} value={classItem.id}>
                    {classItem.name} (Grade {classItem.grade_name || classItem.grade_id})
                  </option>
                ))}
              </select>
              <p className="text-sm text-gray-500 mt-1">Hold Ctrl/Cmd to select multiple classes</p>
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Password
              </label>
              <input
                type="password"
                {...register('password')}
                placeholder="Leave empty to auto-generate"
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-green-500"
              />
              <p className="text-sm text-gray-500 mt-1">
                If empty, a password will be auto-generated and sent via email.
              </p>
            </div>
            <div className="md:col-span-2 flex space-x-3">
              <button
                type="submit"
                disabled={addTeacherMutation.isLoading || updateTeacherMutation.isLoading}
                className="bg-green-600 text-white px-4 py-2 rounded-md hover:bg-green-700 disabled:opacity-50"
              >
                {(addTeacherMutation.isLoading || updateTeacherMutation.isLoading) 
                  ? (editingTeacher ? 'Updating...' : 'Adding...') 
                  : (editingTeacher ? 'Update Teacher' : 'Add Teacher')
                }
              </button>
              <button
                type="button"
                onClick={handleCancelEdit}
                className="border border-gray-300 text-gray-700 px-4 py-2 rounded-md hover:bg-gray-50"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Teachers Table */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Teacher
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Email
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Role
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Assigned Classes
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Status
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {processedTeachers.length > 0 ? (
                processedTeachers.map((teacher) => (
                  <tr key={teacher.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div>
                        <div className="text-sm font-medium text-gray-900">
                          {teacher.first_name} {teacher.last_name}
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center space-x-2">
                        <Mail className="h-4 w-4 text-gray-400" />
                        <span className="text-sm text-gray-900">{teacher.email}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                        teacher.role === 'admin' 
                          ? 'bg-purple-100 text-purple-800' 
                          : 'bg-blue-100 text-blue-800'
                      }`}>
                        {teacher.role === 'super_admin' ? 'Super Admin' : 
                         teacher.role === 'admin' ? 'Admin' : 'Teacher'}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {teacher.assigned_classes || 'None'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                        teacher.is_active 
                          ? 'bg-green-100 text-green-800' 
                          : 'bg-red-100 text-red-800'
                      }`}>
                        {teacher.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium space-x-2">
                      <button
                        onClick={() => handleEdit(teacher)}
                        className="text-green-600 hover:text-green-900"
                        title="Edit"
                      >
                        <Edit className="h-4 w-4" />
                      </button>
                      {teacher.role !== 'super_admin' && (
                        <button
                          onClick={() => handleDelete(teacher.id, `${teacher.first_name} ${teacher.last_name}`)}
                          className="text-red-600 hover:text-red-900"
                          title="Delete"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan="6" className="px-6 py-8 text-center text-gray-500">
                    No teachers found. Click "Add Teacher" to get started.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default TeacherManagement;
