import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from 'react-query';
import { MessageSquare, AlertCircle, Clock, Plus, Trash2, X } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { announcementsAPI, classesAPI } from '../../services/api';
import LoadingSpinner from '../common/LoadingSpinner';
import toast from 'react-hot-toast';

const Announcements = () => {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(null);
  const [formData, setFormData] = useState({
    title: '',
    content: '',
    priority: 'normal',
    grade_id: '',
    class_id: ''
  });

  // Fetch user's assigned grades and classes if they're a teacher
  const { data: gradesData } = useQuery(
    ['grades'],
    () => classesAPI.getGrades(),
    { enabled: user?.role === 'teacher' }
  );

  const { data: classesData } = useQuery(
    ['classes', formData.grade_id],
    () => classesAPI.getClassesByGrade(formData.grade_id),
    { enabled: !!formData.grade_id }
  );

  const { data: announcementsData, isLoading } = useQuery(
    ['announcements', user?.grade_id, user?.class_id],
    () => user?.grade_id && user?.class_id ? announcementsAPI.getAnnouncements(user.grade_id, user.class_id) : null,
    { enabled: !!(user?.grade_id && user?.class_id) }
  );

  const announcements = announcementsData?.data?.announcements || [];
  const grades = gradesData?.data?.grades || [];
  const classes = classesData?.data?.classes || [];

  // Create announcement mutation
  const createAnnouncementMutation = useMutation(
    (data) => announcementsAPI.createAnnouncement(data),
    {
      onSuccess: () => {
        queryClient.invalidateQueries(['announcements']);
        setShowCreateModal(false);
        setFormData({
          title: '',
          content: '',
          priority: 'normal',
          grade_id: '',
          class_id: ''
        });
        toast.success('Announcement created successfully!');
      },
      onError: (error) => {
        toast.error(error.response?.data?.message || 'Failed to create announcement');
      }
    }
  );

  // Delete announcement mutation
  const deleteAnnouncementMutation = useMutation(
    (id) => announcementsAPI.deleteAnnouncement(id),
    {
      onSuccess: () => {
        queryClient.invalidateQueries(['announcements']);
        setShowDeleteConfirm(null);
        toast.success('Announcement deleted successfully!');
      },
      onError: (error) => {
        toast.error(error.response?.data?.message || 'Failed to delete announcement');
      }
    }
  );

  // Handle form submission
  const handleSubmit = (e) => {
    e.preventDefault();
    createAnnouncementMutation.mutate(formData);
  };

  // Handle delete confirmation
  const handleDelete = (id) => {
    deleteAnnouncementMutation.mutate(id);
  };

  const canCreateAnnouncement = user?.role === 'admin' || user?.role === 'super_admin' || user?.role === 'teacher';
  
  const canDeleteAnnouncement = (announcement) => {
    return user?.role === 'admin' || 
           user?.role === 'super_admin' || 
           (user?.role === 'teacher' && announcement.created_by === user.id);
  };

  const getPriorityColor = (priority) => {
    switch (priority) {
      case 'urgent': return 'bg-red-100 text-red-800 border-red-200';
      case 'high': return 'bg-yellow-100 text-yellow-800 border-yellow-200';
      case 'normal': return 'bg-blue-100 text-blue-800 border-blue-200';
      default: return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  const getPriorityIcon = (priority) => {
    switch (priority) {
      case 'urgent': return AlertCircle;
      case 'high': return AlertCircle;
      default: return MessageSquare;
    }
  };

  if (isLoading) {
    return <LoadingSpinner />;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold text-gray-900">Announcements</h1>
        {canCreateAnnouncement && (
          <button
            onClick={() => setShowCreateModal(true)}
            className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
          >
            <Plus className="h-5 w-5 mr-2" />
            Create Announcement
          </button>
        )}
      </div>

      {/* Create Announcement Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-gray-500 bg-opacity-75 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-semibold">Create Announcement</h2>
              <button onClick={() => setShowCreateModal(false)} className="text-gray-400 hover:text-gray-500">
                <X className="h-6 w-6" />
              </button>
            </div>
            
            <form onSubmit={handleSubmit}>
              <div className="space-y-4">
                {user?.role === 'teacher' && (
                  <>
                    <div>
                      <label className="block text-sm font-medium text-gray-700">Grade</label>
                      <select
                        className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                        value={formData.grade_id}
                        onChange={(e) => setFormData({ ...formData, grade_id: e.target.value })}
                        required
                      >
                        <option value="">Select Grade</option>
                        {grades.map((grade) => (
                          <option key={grade.id} value={grade.id}>{grade.name}</option>
                        ))}
                      </select>
                    </div>
                    
                    <div>
                      <label className="block text-sm font-medium text-gray-700">Class</label>
                      <select
                        className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                        value={formData.class_id}
                        onChange={(e) => setFormData({ ...formData, class_id: e.target.value })}
                        required
                        disabled={!formData.grade_id}
                      >
                        <option value="">Select Class</option>
                        {classes.map((cls) => (
                          <option key={cls.id} value={cls.id}>{cls.name}</option>
                        ))}
                      </select>
                    </div>
                  </>
                )}

                <div>
                  <label className="block text-sm font-medium text-gray-700">Title</label>
                  <input
                    type="text"
                    className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                    value={formData.title}
                    onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700">Content</label>
                  <textarea
                    className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                    rows="4"
                    value={formData.content}
                    onChange={(e) => setFormData({ ...formData, content: e.target.value })}
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700">Priority</label>
                  <select
                    className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                    value={formData.priority}
                    onChange={(e) => setFormData({ ...formData, priority: e.target.value })}
                  >
                    <option value="normal">Normal</option>
                    <option value="high">High</option>
                    <option value="urgent">Urgent</option>
                  </select>
                </div>
              </div>

              <div className="mt-6 flex justify-end space-x-3">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                >
                  Create
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-gray-500 bg-opacity-75 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6">
            <div className="text-center">
              <AlertCircle className="mx-auto h-12 w-12 text-red-500" />
              <h3 className="mt-2 text-lg font-medium text-gray-900">Delete Announcement</h3>
              <p className="mt-2 text-sm text-gray-500">
                Are you sure you want to delete this announcement? This action cannot be undone.
              </p>
            </div>
            <div className="mt-6 flex justify-end space-x-3">
              <button
                onClick={() => setShowDeleteConfirm(null)}
                className="inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
              >
                Cancel
              </button>
              <button
                onClick={() => handleDelete(showDeleteConfirm)}
                className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-red-600 hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="space-y-4">
        {announcements.length > 0 ? (
          announcements.map((announcement) => {
            const IconComponent = getPriorityIcon(announcement.priority);
            return (
              <div key={announcement.id} className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center space-x-3 mb-2">
                      <IconComponent className="h-5 w-5 text-blue-600" />
                      <h2 className="text-xl font-semibold text-gray-900">{announcement.title}</h2>
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getPriorityColor(announcement.priority)}`}>
                        {announcement.priority}
                      </span>
                    </div>
                    <p className="text-gray-600 mb-4">{announcement.content}</p>
                    <div className="flex items-center space-x-4 text-sm text-gray-500">
                      <div className="flex items-center">
                        <Clock className="h-4 w-4 mr-1" />
                        {new Date(announcement.created_at).toLocaleDateString()}
                      </div>
                      <div>
                        By: {announcement.author_first_name} {announcement.author_last_name}
                      </div>
                    </div>
                  </div>
                  {canDeleteAnnouncement(announcement) && (
                    <div className="ml-4">
                      <button
                        onClick={() => setShowDeleteConfirm(announcement.id)}
                        className="p-2 text-gray-400 hover:text-red-500 rounded-full hover:bg-gray-100"
                      >
                        <Trash2 className="h-5 w-5" />
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })
        ) : (
          <div className="text-center py-12">
            <MessageSquare className="mx-auto h-12 w-12 text-gray-400" />
            <h3 className="mt-2 text-sm font-medium text-gray-900">No announcements</h3>
            <p className="mt-1 text-sm text-gray-500">
              There are no announcements for your class yet.
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export default Announcements;
