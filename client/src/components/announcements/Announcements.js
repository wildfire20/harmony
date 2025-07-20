import React, { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from 'react-query';
import { MessageSquare, AlertCircle, Clock, Plus, Trash2, X, Bell } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { announcementsAPI, classesAPI } from '../../services/api';
import LoadingSpinner from '../common/LoadingSpinner';
import toast from 'react-hot-toast';

const Announcements = () => {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(null);
  const [lastVisit, setLastVisit] = useState(null);
  const [formData, setFormData] = useState({
    title: '',
    content: '',
    priority: 'normal',
    target_audience: 'everyone'
  });

  // Load last visit time from localStorage
  useEffect(() => {
    const saved = localStorage.getItem('announcements_last_visit');
    if (saved) {
      setLastVisit(new Date(saved));
    }
  }, []);

  // Update last visit time when component loads
  useEffect(() => {
    const now = new Date();
    localStorage.setItem('announcements_last_visit', now.toISOString());
  }, []);

  const canCreateAnnouncement = user?.role === 'admin' || user?.role === 'super_admin' || user?.role === 'teacher';

  // Remove the grades and classes queries since we don't need them anymore

  const { data: announcementsData, isLoading } = useQuery(
    ['announcements'],
    () => announcementsAPI.getAnnouncements(),
    { enabled: !!user }
  );

  const announcements = announcementsData?.data?.announcements || [];

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
          target_audience: 'everyone'
        });
        toast.success('Announcement created successfully!');
      },
      onError: (error) => {
        console.error('Create announcement error:', error);
        console.error('Error response:', error.response);
        console.error('Error data:', error.response?.data);
        
        const errorMessage = error.response?.data?.message || 
                            (error.response?.data?.errors ? 
                             error.response.data.errors.map(e => e.msg).join(', ') : 
                             'Failed to create announcement');
        
        console.log('Showing error message:', errorMessage);
        toast.error(errorMessage);
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
    
    console.log('📝 Form submission started');
    console.log('Form data:', formData);
    console.log('Current user:', user);
    
    // Validate form data
    if (!formData.title || !formData.content) {
      console.log('❌ Validation failed: Missing required fields');
      toast.error('Please fill in all required fields');
      return;
    }

    if (!formData.title.trim() || !formData.content.trim()) {
      console.log('❌ Validation failed: Empty required fields');
      toast.error('Title and content cannot be empty');
      return;
    }

    // For teachers, announcements are created for their assigned grade/class
    // For admins, announcements are global with target_audience setting
    const submitData = {
      title: formData.title.trim(),
      content: formData.content.trim(),
      priority: formData.priority || 'normal',
      target_audience: formData.target_audience || 'everyone'
    };

    console.log('📤 Submitting announcement data:', submitData);
    createAnnouncementMutation.mutate(submitData);
  };

  // Handle delete confirmation
  const handleDelete = (id) => {
    deleteAnnouncementMutation.mutate(id);
  };

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

  const getTargetAudienceColor = (targetAudience) => {
    switch (targetAudience) {
      case 'staff': return 'bg-purple-100 text-purple-800 border-purple-200';
      case 'students': return 'bg-green-100 text-green-800 border-green-200';
      case 'everyone': return 'bg-blue-100 text-blue-800 border-blue-200';
      default: return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  const getTargetAudienceLabel = (targetAudience) => {
    switch (targetAudience) {
      case 'staff': return 'Staff Only';
      case 'students': return 'Students Only';
      case 'everyone': return 'Everyone';
      default: return targetAudience;
    }
  };

  const isNewAnnouncement = (announcementDate) => {
    if (!lastVisit) return false;
    return new Date(announcementDate) > lastVisit;
  };

  // Function to detect URLs and make them clickable
  const linkifyText = (text) => {
    if (!text) return text;
    
    // Enhanced regular expression to detect various URL formats
    const urlRegex = /(https?:\/\/[^\s]+|www\.[^\s]+)/gi;
    
    // Split text by URLs and create clickable links
    const parts = text.split(urlRegex);
    
    return parts.map((part, index) => {
      if (urlRegex.test(part)) {
        // Add https:// if the URL starts with www
        const href = part.startsWith('www.') ? `https://${part}` : part;
        return (
          <a
            key={index}
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-600 hover:text-blue-800 underline break-all transition-colors duration-200"
          >
            {part}
          </a>
        );
      }
      return part;
    });
  };

  const newAnnouncementsCount = announcements.filter(announcement => 
    isNewAnnouncement(announcement.created_at)
  ).length;

  if (isLoading) {
    return <LoadingSpinner />;
  }

  return (
    <div className="space-y-6">
      <div className="announcements-header flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <h1 className="mobile-heading-1 text-3xl font-bold text-gray-900">Announcements</h1>
          {newAnnouncementsCount > 0 && (
            <div className="new-badge flex items-center bg-red-100 text-red-800 px-3 py-1 rounded-full text-sm font-medium">
              <Bell className="h-4 w-4 mr-1" />
              {newAnnouncementsCount} New
            </div>
          )}
        </div>
        {canCreateAnnouncement && (
          <button
            onClick={() => setShowCreateModal(true)}
            className="mobile-btn-primary inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 sm:w-auto"
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
                {(user?.role === 'admin' || user?.role === 'super_admin') && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Target Audience</label>
                    <select
                      className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                      value={formData.target_audience}
                      onChange={(e) => setFormData({ ...formData, target_audience: e.target.value })}
                      required
                    >
                      <option value="everyone">Everyone</option>
                      <option value="staff">Staff Only</option>
                      <option value="students">Students Only</option>
                    </select>
                    <p className="mt-1 text-xs text-gray-500">
                      Choose who can see this announcement
                    </p>
                  </div>
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
                    placeholder="Enter your announcement content here. URLs will automatically become clickable links."
                    required
                  />
                  <p className="mt-1 text-xs text-gray-500">
                    💡 Tip: You can paste URLs (like https://example.com) and they'll automatically become clickable links
                  </p>
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

              <div className="mobile-modal-buttons mt-6 flex justify-end space-x-3">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="mobile-btn-secondary inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 sm:w-auto"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="mobile-btn-primary inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 sm:w-auto"
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
            <div className="mobile-modal-buttons mt-6 flex justify-end space-x-3">
              <button
                onClick={() => setShowDeleteConfirm(null)}
                className="mobile-btn-secondary inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 sm:w-auto"
              >
                Cancel
              </button>
              <button
                onClick={() => handleDelete(showDeleteConfirm)}
                className="mobile-btn-danger inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-red-600 hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 sm:w-auto"
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
            const isNew = isNewAnnouncement(announcement.created_at);
            return (
              <div key={announcement.id} className={`announcement-card bg-white rounded-lg shadow-sm border border-gray-200 p-6 ${isNew ? 'ring-2 ring-blue-200 bg-blue-50' : ''}`}>
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="announcement-meta flex items-center space-x-3 mb-2">
                      <IconComponent className="h-5 w-5 text-blue-600" />
                      <h2 className="announcement-title text-xl font-semibold text-gray-900">{announcement.title}</h2>
                      {isNew && (
                        <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-red-100 text-red-800">
                          NEW
                        </span>
                      )}
                      <span className={`announcement-priority-badge inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getPriorityColor(announcement.priority)}`}>
                        {announcement.priority}
                      </span>
                      {announcement.target_audience && (
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getTargetAudienceColor(announcement.target_audience)}`}>
                          {getTargetAudienceLabel(announcement.target_audience)}
                        </span>
                      )}
                    </div>
                    <div className="text-gray-600 mb-4 whitespace-pre-wrap">{linkifyText(announcement.content)}</div>
                    <div className="flex items-center space-x-4 text-sm text-gray-500">
                      <div className="flex items-center">
                        <Clock className="h-4 w-4 mr-1" />
                        {new Date(announcement.created_at).toLocaleDateString()}
                      </div>
                      <div>
                        By: {announcement.author_first_name} {announcement.author_last_name}
                        {user?.role === 'teacher' && announcement.created_by === user.id && (
                          <span className="ml-2 text-green-600 text-xs font-medium">(You can delete this)</span>
                        )}
                        {user?.role === 'teacher' && (
                          <span className="ml-2 text-xs text-gray-400">
                            [Creator ID: {announcement.created_by}]
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  {canDeleteAnnouncement(announcement) && (
                    <div className="ml-4 flex-shrink-0">
                      <button
                        onClick={() => setShowDeleteConfirm(announcement.id)}
                        className="p-2 text-red-400 hover:text-red-600 rounded-full hover:bg-red-50 transition-colors duration-200 border border-red-200 hover:border-red-300"
                        title="Delete announcement"
                      >
                        <Trash2 className="h-5 w-5" />
                      </button>
                    </div>
                  )}
                  
                  {/* Message for teachers when they can't delete */}
                  {user?.role === 'teacher' && !canDeleteAnnouncement(announcement) && (
                    <div className="ml-4 flex-shrink-0">
                      <div className="p-2 text-gray-300" title="You can only delete announcements you created">
                        <Trash2 className="h-5 w-5" />
                      </div>
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
