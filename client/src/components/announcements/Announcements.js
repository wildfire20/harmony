import React, { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import './Announcements.css';

const Announcements = () => {
  const { user } = useAuth();
  const [announcements, setAnnouncements] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [availableTargets, setAvailableTargets] = useState([]);
  const [canCreateGlobal, setCanCreateGlobal] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [formData, setFormData] = useState({
    title: '',
    content: '',
    priority: 'medium',
    target_grade_id: '',
    target_class_id: '',
    is_global: false
  });

  useEffect(() => {
    fetchAnnouncements();
    if (user?.role === 'teacher' || user?.role === 'admin' || user?.role === 'super_admin') {
      fetchAvailableTargets();
    }
  }, [currentPage, user]);

  const fetchAnnouncements = async () => {
    try {
      setLoading(true);
      const response = await fetch(`/api/announcements?page=${currentPage}&limit=10`, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        }
      });

      if (!response.ok) {
        throw new Error('Failed to fetch announcements');
      }

      const data = await response.json();
      setAnnouncements(data.announcements);
      setTotalPages(data.pagination.totalPages);
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const fetchAvailableTargets = async () => {
    try {
      const response = await fetch('/api/announcements/meta/targets', {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        }
      });

      if (!response.ok) {
        throw new Error('Failed to fetch available targets');
      }

      const data = await response.json();
      setAvailableTargets(data.targets);
      setCanCreateGlobal(data.canCreateGlobal);
    } catch (err) {
      console.error('Error fetching targets:', err);
    }
  };

  const handleCreateAnnouncement = async (e) => {
    e.preventDefault();
    
    try {
      const response = await fetch('/api/announcements', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        },
        body: JSON.stringify(formData)
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Failed to create announcement');
      }

      const data = await response.json();
      setAnnouncements([data.announcement, ...announcements]);
      setShowCreateForm(false);
      setFormData({
        title: '',
        content: '',
        priority: 'medium',
        target_grade_id: '',
        target_class_id: '',
        is_global: false
      });
      setError(null);
    } catch (err) {
      setError(err.message);
    }
  };

  const handleDeleteAnnouncement = async (id) => {
    if (!window.confirm('Are you sure you want to delete this announcement?')) {
      return;
    }

    try {
      const response = await fetch(`/api/announcements/${id}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        }
      });

      if (!response.ok) {
        throw new Error('Failed to delete announcement');
      }

      setAnnouncements(announcements.filter(announcement => announcement.id !== id));
    } catch (err) {
      setError(err.message);
    }
  };

  const formatDate = (dateString) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const getPriorityColor = (priority) => {
    switch (priority) {
      case 'high': return 'priority-high';
      case 'medium': return 'priority-medium';
      case 'low': return 'priority-low';
      default: return 'priority-medium';
    }
  };

  const getTargetInfo = (announcement) => {
    if (announcement.is_global) {
      return <span className="target-global">🌍 Global</span>;
    } else if (announcement.grade_name && announcement.class_name) {
      return <span className="target-specific">📚 {announcement.grade_name} - {announcement.class_name}</span>;
    }
    return <span className="target-unknown">📝 Specific Target</span>;
  };

  if (loading) {
    return (
      <div className="announcements-container">
        <div className="loading">Loading announcements...</div>
      </div>
    );
  }

  return (
    <div className="announcements-container">
      <div className="announcements-header">
        <h2>📢 Announcements</h2>
        {(user?.role === 'teacher' || user?.role === 'admin' || user?.role === 'super_admin') && (
          <button 
            className="btn-create-announcement"
            onClick={() => setShowCreateForm(true)}
          >
            ➕ Create Announcement
          </button>
        )}
      </div>

      {error && (
        <div className="error-message">
          ❌ {error}
        </div>
      )}

      {showCreateForm && (
        <div className="create-announcement-modal">
          <div className="modal-content">
            <div className="modal-header">
              <h3>Create New Announcement</h3>
              <button 
                className="close-button"
                onClick={() => setShowCreateForm(false)}
              >
                ✕
              </button>
            </div>
            <form onSubmit={handleCreateAnnouncement}>
              <div className="form-group">
                <label>Title *</label>
                <input
                  type="text"
                  value={formData.title}
                  onChange={(e) => setFormData({...formData, title: e.target.value})}
                  required
                  placeholder="Enter announcement title"
                />
              </div>

              <div className="form-group">
                <label>Content *</label>
                <textarea
                  value={formData.content}
                  onChange={(e) => setFormData({...formData, content: e.target.value})}
                  required
                  placeholder="Enter announcement content"
                  rows="4"
                />
              </div>

              <div className="form-group">
                <label>Priority</label>
                <select
                  value={formData.priority}
                  onChange={(e) => setFormData({...formData, priority: e.target.value})}
                >
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                </select>
              </div>

              {canCreateGlobal && (
                <div className="form-group">
                  <label>
                    <input
                      type="checkbox"
                      checked={formData.is_global}
                      onChange={(e) => setFormData({...formData, is_global: e.target.checked})}
                    />
                    Make this a global announcement (visible to all users)
                  </label>
                </div>
              )}

              {!formData.is_global && (
                <div className="form-group">
                  <label>Target Grade & Class</label>
                  <select
                    value={`${formData.target_grade_id}-${formData.target_class_id}`}
                    onChange={(e) => {
                      const [grade_id, class_id] = e.target.value.split('-');
                      setFormData({
                        ...formData,
                        target_grade_id: parseInt(grade_id),
                        target_class_id: parseInt(class_id)
                      });
                    }}
                    required={!formData.is_global}
                  >
                    <option value="">Select Grade & Class</option>
                    {availableTargets.map(target => (
                      <option 
                        key={`${target.grade_id}-${target.class_id}`}
                        value={`${target.grade_id}-${target.class_id}`}
                      >
                        {target.grade_name} - {target.class_name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="form-actions">
                <button type="button" onClick={() => setShowCreateForm(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn-primary">
                  Create Announcement
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <div className="announcements-list">
        {announcements.length === 0 ? (
          <div className="no-announcements">
            <p>📭 No announcements for your class yet.</p>
            <p>There are no announcements for your class yet.</p>
          </div>
        ) : (
          <>
            {announcements.map(announcement => (
              <div key={announcement.id} className="announcement-card">
                <div className="announcement-header">
                  <div className="announcement-title-row">
                    <h3 className="announcement-title">{announcement.title}</h3>
                    <div className="announcement-meta">
                      <span className={`priority-badge ${getPriorityColor(announcement.priority)}`}>
                        {announcement.priority.toUpperCase()}
                      </span>
                      {getTargetInfo(announcement)}
                    </div>
                  </div>
                  <div className="announcement-info">
                    <span className="announcement-author">
                      By: {announcement.author_first_name} {announcement.author_last_name}
                    </span>
                    <span className="announcement-date">
                      {formatDate(announcement.created_at)}
                    </span>
                  </div>
                </div>
                
                <div className="announcement-content">
                  <p>{announcement.content}</p>
                </div>

                {(user?.role === 'admin' || user?.role === 'super_admin' || 
                  (user?.role === 'teacher' && announcement.created_by === user.id)) && (
                  <div className="announcement-actions">
                    <button 
                      className="btn-delete"
                      onClick={() => handleDeleteAnnouncement(announcement.id)}
                    >
                      🗑️ Delete
                    </button>
                  </div>
                )}
              </div>
            ))}
          </>
        )}
      </div>

      {totalPages > 1 && (
        <div className="pagination">
          <button 
            onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
            disabled={currentPage === 1}
          >
            Previous
          </button>
          <span>Page {currentPage} of {totalPages}</span>
          <button 
            onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
            disabled={currentPage === totalPages}
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
};

export default Announcements;
