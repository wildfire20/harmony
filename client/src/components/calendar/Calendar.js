import React, { useState, useEffect } from 'react';
import { Calendar, momentLocalizer } from 'react-big-calendar';
import moment from 'moment';
import api from '../../services/api';
import { useAuth } from '../../contexts/AuthContext';
import 'react-big-calendar/lib/css/react-big-calendar.css';
import './Calendar.css';

const localizer = momentLocalizer(moment);

const CalendarComponent = () => {
  const { user } = useAuth();
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [showCreateEvent, setShowCreateEvent] = useState(false);
  const [currentDate, setCurrentDate] = useState(new Date());

  // Form state for creating events
  const [eventForm, setEventForm] = useState({
    title: '',
    description: '',
    start_date: '',
    end_date: '',
    event_type: 'other',
    target_audience: 'all',
    grade_id: ''
  });

  useEffect(() => {
    fetchCalendarEvents();
  }, [currentDate]);

  const fetchCalendarEvents = async (dateToFetch = currentDate) => {
    try {
      setLoading(true);
      setError(null); // Clear any previous errors
      const month = dateToFetch.getMonth() + 1;
      const year = dateToFetch.getFullYear();
      
      console.log('Fetching calendar events for:', month, year);
      
      const response = await api.get(`/calendar?month=${month}&year=${year}`);
      
      if (response.data.success) {
        // Transform events for react-big-calendar
        const transformedEvents = response.data.events.map(event => ({
          id: event.id,
          title: event.title,
          start: new Date(event.due_date || event.start_date),
          end: new Date(event.end_date || event.due_date || event.start_date),
          resource: event,
          type: event.event_type
        }));
        
        console.log('Loaded events:', transformedEvents.length);
        setEvents(transformedEvents);
      }
    } catch (error) {
      console.error('Error fetching calendar events:', error);
      const errorMessage = error.response?.data?.message || 'Failed to load calendar events';
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateEvent = async (e) => {
    e.preventDefault();
    try {
      setError(null); // Clear any previous errors
      const response = await api.post('/calendar/events', eventForm);
      
      if (response.data.success) {
        setShowCreateEvent(false);
        setEventForm({
          title: '',
          description: '',
          start_date: '',
          end_date: '',
          event_type: 'other',
          target_audience: 'all',
          grade_id: ''
        });
        await fetchCalendarEvents(); // Wait for refresh
        // Show success message
        console.log('Event created successfully');
      }
    } catch (error) {
      console.error('Error creating event:', error);
      const errorMessage = error.response?.data?.message || 'Failed to create event';
      setError(errorMessage);
    }
  };

  const eventStyleGetter = (event) => {
    let backgroundColor = '#3174ad';
    let borderColor = '#3174ad';
    
    if (event.resource.event_type === 'task') {
      backgroundColor = event.resource.task_type === 'quiz' ? '#ff6b6b' : '#4dabf7';
      borderColor = backgroundColor;
    } else if (event.resource.event_type === 'school_event') {
      switch (event.resource.category) {
        case 'holiday':
          backgroundColor = '#51cf66';
          break;
        case 'exam':
          backgroundColor = '#ff8787';
          break;
        case 'meeting':
          backgroundColor = '#ffd43b';
          break;
        case 'deadline':
          backgroundColor = '#ff922b';
          break;
        default:
          backgroundColor = '#868e96';
      }
      borderColor = backgroundColor;
    }

    return {
      style: {
        backgroundColor,
        borderColor,
        color: 'white',
        border: 'none',
        borderRadius: '4px',
        padding: '2px 5px'
      }
    };
  };

  const handleNavigate = (date) => {
    console.log('Navigating to date:', date);
    setCurrentDate(date);
    fetchCalendarEvents(date);
  };

  const handleSelectEvent = (event) => {
    setSelectedEvent(event);
  };

  const formatEventDetails = (event) => {
    const resource = event.resource;
    
    if (resource.event_type === 'task') {
      return (
        <div className="event-details">
          <h4>{resource.title}</h4>
          <p><strong>Type:</strong> {resource.task_type}</p>
          {resource.grade_name && <p><strong>Grade:</strong> {resource.grade_name}</p>}
          {resource.class_name && <p><strong>Class:</strong> {resource.class_name}</p>}
          <p><strong>Due Date:</strong> {moment(resource.due_date).format('MMMM D, YYYY')}</p>
          {resource.max_points && <p><strong>Max Points:</strong> {resource.max_points}</p>}
        </div>
      );
    } else {
      return (
        <div className="event-details">
          <h4>{resource.title}</h4>
          {resource.description && <p>{resource.description}</p>}
          <p><strong>Type:</strong> {resource.category}</p>
          <p><strong>Date:</strong> {moment(resource.due_date).format('MMMM D, YYYY')}</p>
          {resource.end_date && (
            <p><strong>End Date:</strong> {moment(resource.end_date).format('MMMM D, YYYY')}</p>
          )}
        </div>
      );
    }
  };

  if (loading) {
    return (
      <div className="calendar-container">
        <div className="loading-spinner">
          <div className="spinner"></div>
          <p>Loading calendar...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="calendar-container">
      <div className="calendar-header">
        <h2>📅 Academic Calendar</h2>
        {(user.role === 'admin' || user.role === 'super_admin') && (
          <button 
            className="btn btn-primary"
            onClick={() => setShowCreateEvent(true)}
          >
            + Create Event
          </button>
        )}
      </div>

      {error && (
        <div className="alert alert-danger">
          {error}
          <button onClick={() => setError(null)}>×</button>
        </div>
      )}

      <div className="calendar-legend">
        <div className="legend-item">
          <span className="legend-color" style={{ backgroundColor: '#4dabf7' }}></span>
          <span>Assignments</span>
        </div>
        <div className="legend-item">
          <span className="legend-color" style={{ backgroundColor: '#ff6b6b' }}></span>
          <span>Quizzes</span>
        </div>
        <div className="legend-item">
          <span className="legend-color" style={{ backgroundColor: '#51cf66' }}></span>
          <span>Holidays</span>
        </div>
        <div className="legend-item">
          <span className="legend-color" style={{ backgroundColor: '#ff8787' }}></span>
          <span>Exams</span>
        </div>
        <div className="legend-item">
          <span className="legend-color" style={{ backgroundColor: '#ffd43b' }}></span>
          <span>Meetings</span>
        </div>
      </div>

      <Calendar
        localizer={localizer}
        events={events}
        startAccessor="start"
        endAccessor="end"
        style={{ height: 600 }}
        onSelectEvent={handleSelectEvent}
        onNavigate={handleNavigate}
        eventPropGetter={eventStyleGetter}
        views={['month', 'week', 'day']}
        defaultView="month"
        popup
        popupOffset={{ x: 30, y: 20 }}
      />

      {/* Event Details Modal */}
      {selectedEvent && (
        <div className="modal-overlay" onClick={() => setSelectedEvent(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Event Details</h3>
              <button className="close-btn" onClick={() => setSelectedEvent(null)}>×</button>
            </div>
            <div className="modal-body">
              {formatEventDetails(selectedEvent)}
            </div>
          </div>
        </div>
      )}

      {/* Create Event Modal */}
      {showCreateEvent && (user.role === 'admin' || user.role === 'super_admin') && (
        <div className="modal-overlay" onClick={() => setShowCreateEvent(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Create School Event</h3>
              <button className="close-btn" onClick={() => setShowCreateEvent(false)}>×</button>
            </div>
            <div className="modal-body">
              <form onSubmit={handleCreateEvent}>
                <div className="form-group">
                  <label>Event Title</label>
                  <input
                    type="text"
                    value={eventForm.title}
                    onChange={(e) => setEventForm({ ...eventForm, title: e.target.value })}
                    required
                  />
                </div>

                <div className="form-group">
                  <label>Description</label>
                  <textarea
                    value={eventForm.description}
                    onChange={(e) => setEventForm({ ...eventForm, description: e.target.value })}
                    rows="3"
                  />
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label>Start Date</label>
                    <input
                      type="date"
                      value={eventForm.start_date}
                      onChange={(e) => setEventForm({ ...eventForm, start_date: e.target.value })}
                      required
                    />
                  </div>

                  <div className="form-group">
                    <label>End Date (Optional)</label>
                    <input
                      type="date"
                      value={eventForm.end_date}
                      onChange={(e) => setEventForm({ ...eventForm, end_date: e.target.value })}
                    />
                  </div>
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label>Event Type</label>
                    <select
                      value={eventForm.event_type}
                      onChange={(e) => setEventForm({ ...eventForm, event_type: e.target.value })}
                    >
                      <option value="holiday">Holiday</option>
                      <option value="exam">Exam</option>
                      <option value="meeting">Meeting</option>
                      <option value="deadline">Deadline</option>
                      <option value="other">Other</option>
                    </select>
                  </div>

                  <div className="form-group">
                    <label>Target Audience</label>
                    <select
                      value={eventForm.target_audience}
                      onChange={(e) => setEventForm({ ...eventForm, target_audience: e.target.value })}
                    >
                      <option value="all">Everyone</option>
                      <option value="students">Students Only</option>
                      <option value="teachers">Teachers Only</option>
                      <option value="staff">Staff Only</option>
                    </select>
                  </div>
                </div>

                <div className="form-actions">
                  <button type="button" onClick={() => setShowCreateEvent(false)}>
                    Cancel
                  </button>
                  <button type="submit" className="btn btn-primary">
                    Create Event
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default CalendarComponent;
