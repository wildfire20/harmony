import React from 'react';
import { useQuery } from 'react-query';
import { MessageSquare, AlertCircle, Clock } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { announcementsAPI } from '../../services/api';
import LoadingSpinner from '../common/LoadingSpinner';

const Announcements = () => {
  const { user } = useAuth();

  const { data: announcementsData, isLoading } = useQuery(
    ['announcements', user?.grade_id, user?.class_id],
    () => user?.grade_id && user?.class_id ? announcementsAPI.getAnnouncements(user.grade_id, user.class_id) : null,
    { enabled: !!(user?.grade_id && user?.class_id) }
  );

  const announcements = announcementsData?.data?.announcements || [];

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
      </div>

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
