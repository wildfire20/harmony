import React, { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from 'react-query';
import { MessageSquare, AlertCircle, Clock, Plus, Trash2, X, Bell } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useTheme } from '../common/ThemeProvider';
import { announcementsAPI } from '../../services/api';
import LoadingSpinner from '../common/LoadingSpinner';
import toast from 'react-hot-toast';

const Announcements = () => {
  const { user } = useAuth();
  const { theme } = useTheme();
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

  const isDark = theme === 'dark';
  const cardBg = isDark ? 'bg-gray-900' : 'bg-white';
  const cardBorder = isDark ? 'border-gray-800' : 'border-gray-100';
  const textPrimary = isDark ? 'text-white' : 'text-gray-900';
  const textSecondary = isDark ? 'text-gray-400' : 'text-gray-600';

  useEffect(() => {
    const saved = localStorage.getItem('announcements_last_visit');
    if (saved) {
      setLastVisit(new Date(saved));
    }
  }, []);

  useEffect(() => {
    const now = new Date();
    localStorage.setItem('announcements_last_visit', now.toISOString());
  }, []);

  const canCreateAnnouncement = user?.role === 'admin' || user?.role === 'super_admin' || user?.role === 'teacher';

  const { data: announcementsData, isLoading } = useQuery(
    ['announcements'],
    () => announcementsAPI.getAnnouncements(),
    { enabled: !!user }
  );

  const announcements = announcementsData?.data?.announcements || [];

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
        const errorMessage = error.response?.data?.message || 
                            (error.response?.data?.errors ? 
                             error.response.data.errors.map(e => e.msg).join(', ') : 
                             'Failed to create announcement');
        toast.error(errorMessage);
      }
    }
  );

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

  const handleSubmit = (e) => {
    e.preventDefault();
    
    if (!formData.title || !formData.content) {
      toast.error('Please fill in all required fields');
      return;
    }

    if (!formData.title.trim() || !formData.content.trim()) {
      toast.error('Title and content cannot be empty');
      return;
    }

    const submitData = {
      title: formData.title.trim(),
      content: formData.content.trim(),
      priority: formData.priority || 'normal',
      target_audience: formData.target_audience || 'everyone'
    };

    createAnnouncementMutation.mutate(submitData);
  };

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
      case 'urgent': return 'bg-red-100 text-red-700';
      case 'high': return 'bg-amber-100 text-amber-700';
      case 'normal': return 'bg-blue-100 text-blue-700';
      default: return 'bg-gray-100 text-gray-700';
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
      case 'staff': return 'bg-purple-100 text-purple-700';
      case 'students': return 'bg-emerald-100 text-emerald-700';
      case 'everyone': return 'bg-blue-100 text-blue-700';
      default: return 'bg-gray-100 text-gray-700';
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

  const linkifyText = (text) => {
    if (!text) return text;
    const urlRegex = /(https?:\/\/[^\s]+|www\.[^\s]+)/gi;
    const parts = text.split(urlRegex);
    
    return parts.map((part, index) => {
      if (urlRegex.test(part)) {
        const href = part.startsWith('www.') ? `https://${part}` : part;
        return (
          <a
            key={index}
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-emerald-600 hover:text-emerald-700 underline break-all transition-colors"
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
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-gradient-to-br from-blue-500 to-blue-600 rounded-xl shadow-lg shadow-blue-500/25">
            <MessageSquare className="h-6 w-6 text-white" />
          </div>
          <h1 className={`text-2xl font-bold ${textPrimary}`}>Announcements</h1>
          {newAnnouncementsCount > 0 && (
            <div className="flex items-center gap-1.5 bg-red-100 text-red-700 px-3 py-1 rounded-full text-sm font-semibold">
              <Bell className="h-4 w-4" />
              {newAnnouncementsCount} New
            </div>
          )}
        </div>
        {canCreateAnnouncement && (
          <button
            onClick={() => setShowCreateModal(true)}
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-emerald-500 to-emerald-600 text-white rounded-xl font-medium shadow-lg shadow-emerald-500/25 hover:shadow-xl transition-all"
          >
            <Plus className="h-4 w-4" />
            Create Announcement
          </button>
        )}
      </div>

      {/* Create Announcement Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className={`${cardBg} rounded-2xl shadow-2xl max-w-md w-full p-6`}>
            <div className="flex items-center justify-between mb-6">
              <h2 className={`text-xl font-semibold ${textPrimary}`}>Create Announcement</h2>
              <button onClick={() => setShowCreateModal(false)} className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-xl transition-colors">
                <X className="h-5 w-5 text-gray-500" />
              </button>
            </div>
            
            <form onSubmit={handleSubmit} className="space-y-5">
              {(user?.role === 'admin' || user?.role === 'super_admin') && (
                <div>
                  <label className={`block text-sm font-medium ${textSecondary} mb-2`}>Target Audience</label>
                  <select
                    className={`w-full px-4 py-2.5 rounded-xl border ${cardBorder} ${cardBg} ${textPrimary} focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all`}
                    value={formData.target_audience}
                    onChange={(e) => setFormData({ ...formData, target_audience: e.target.value })}
                    required
                  >
                    <option value="everyone">Everyone</option>
                    <option value="staff">Staff Only</option>
                    <option value="students">Students Only</option>
                  </select>
                </div>
              )}

              <div>
                <label className={`block text-sm font-medium ${textSecondary} mb-2`}>Title</label>
                <input
                  type="text"
                  className={`w-full px-4 py-2.5 rounded-xl border ${cardBorder} ${cardBg} ${textPrimary} focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all`}
                  value={formData.title}
                  onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                  required
                />
              </div>

              <div>
                <label className={`block text-sm font-medium ${textSecondary} mb-2`}>Content</label>
                <textarea
                  className={`w-full px-4 py-2.5 rounded-xl border ${cardBorder} ${cardBg} ${textPrimary} focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all`}
                  rows="4"
                  value={formData.content}
                  onChange={(e) => setFormData({ ...formData, content: e.target.value })}
                  placeholder="Enter your announcement content here..."
                  required
                />
              </div>

              <div>
                <label className={`block text-sm font-medium ${textSecondary} mb-2`}>Priority</label>
                <select
                  className={`w-full px-4 py-2.5 rounded-xl border ${cardBorder} ${cardBg} ${textPrimary} focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all`}
                  value={formData.priority}
                  onChange={(e) => setFormData({ ...formData, priority: e.target.value })}
                >
                  <option value="normal">Normal</option>
                  <option value="high">High</option>
                  <option value="urgent">Urgent</option>
                </select>
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className={`flex-1 px-4 py-2.5 rounded-xl border ${cardBorder} ${textPrimary} font-medium hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors`}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 px-4 py-2.5 bg-gradient-to-r from-emerald-500 to-emerald-600 text-white rounded-xl font-medium shadow-lg shadow-emerald-500/25 hover:shadow-xl transition-all"
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
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className={`${cardBg} rounded-2xl shadow-2xl max-w-md w-full p-6`}>
            <div className="text-center">
              <div className="mx-auto w-14 h-14 bg-red-100 rounded-full flex items-center justify-center mb-4">
                <AlertCircle className="h-7 w-7 text-red-600" />
              </div>
              <h3 className={`text-lg font-semibold ${textPrimary} mb-2`}>Delete Announcement</h3>
              <p className={textSecondary}>
                Are you sure you want to delete this announcement? This action cannot be undone.
              </p>
            </div>
            <div className="flex gap-3 mt-6">
              <button
                onClick={() => setShowDeleteConfirm(null)}
                className={`flex-1 px-4 py-2.5 rounded-xl border ${cardBorder} ${textPrimary} font-medium hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors`}
              >
                Cancel
              </button>
              <button
                onClick={() => handleDelete(showDeleteConfirm)}
                className="flex-1 px-4 py-2.5 bg-gradient-to-r from-red-500 to-red-600 text-white rounded-xl font-medium shadow-lg shadow-red-500/25 hover:shadow-xl transition-all"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Announcements List */}
      <div className="space-y-4">
        {announcements.length > 0 ? (
          announcements.map((announcement) => {
            const IconComponent = getPriorityIcon(announcement.priority);
            const isNew = isNewAnnouncement(announcement.created_at);
            return (
              <div key={announcement.id} className={`${cardBg} rounded-2xl shadow-sm border ${isNew ? 'border-blue-300 ring-2 ring-blue-100' : cardBorder} p-5 hover:shadow-lg transition-all duration-200`}>
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <div className="flex flex-wrap items-center gap-2 mb-3">
                      <h2 className={`text-lg font-semibold ${textPrimary}`}>{announcement.title}</h2>
                      {isNew && (
                        <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-red-100 text-red-700">
                          NEW
                        </span>
                      )}
                      <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${getPriorityColor(announcement.priority)}`}>
                        {announcement.priority}
                      </span>
                      {announcement.target_audience && (
                        <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${getTargetAudienceColor(announcement.target_audience)}`}>
                          {getTargetAudienceLabel(announcement.target_audience)}
                        </span>
                      )}
                    </div>
                    <div className={`${textSecondary} mb-4 whitespace-pre-wrap`}>{linkifyText(announcement.content)}</div>
                    <div className={`flex flex-wrap items-center gap-4 text-sm ${textSecondary}`}>
                      <div className="flex items-center gap-1.5">
                        <Clock className="h-4 w-4" />
                        {new Date(announcement.created_at).toLocaleDateString()}
                      </div>
                      <div>
                        By: {announcement.author_first_name} {announcement.author_last_name}
                      </div>
                    </div>
                  </div>
                  {canDeleteAnnouncement(announcement) && (
                    <button
                      onClick={() => setShowDeleteConfirm(announcement.id)}
                      className={`p-2.5 rounded-xl border ${cardBorder} text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </div>
            );
          })
        ) : (
          <div className={`${cardBg} rounded-2xl shadow-sm border ${cardBorder} py-16 text-center`}>
            <div className="p-4 bg-gray-100 dark:bg-gray-800 rounded-full w-fit mx-auto mb-4">
              <MessageSquare className="h-12 w-12 text-gray-400" />
            </div>
            <h3 className={`text-lg font-semibold ${textPrimary} mb-2`}>No announcements</h3>
            <p className={textSecondary}>
              There are no announcements for your class yet.
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export default Announcements;
