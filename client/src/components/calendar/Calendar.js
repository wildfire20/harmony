import React, { useState, useEffect } from 'react';
import { Calendar, momentLocalizer } from 'react-big-calendar';
import moment from 'moment';
import { Calendar as CalendarIcon, Plus, X, Clock, MapPin, Users, BookOpen, AlertCircle, ChevronLeft, ChevronRight, Edit, Trash2 } from 'lucide-react';
import api from '../../services/api';
import { useAuth } from '../../contexts/AuthContext';
import { useTheme } from '../common/ThemeProvider';
import toast from 'react-hot-toast';
import 'react-big-calendar/lib/css/react-big-calendar.css';
import './Calendar.css';

const localizer = momentLocalizer(moment);

const CalendarComponent = () => {
  const { user } = useAuth();
  const { theme } = useTheme();
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [showCreateEvent, setShowCreateEvent] = useState(false);
  const [editingEvent, setEditingEvent] = useState(null);
  const [currentDate, setCurrentDate] = useState(new Date());
  const [currentView, setCurrentView] = useState('month');
  const [grades, setGrades] = useState([]);
  const [classes, setClasses] = useState([]);

  const isDark = theme === 'dark';
  const cardBg = isDark ? 'bg-gray-900' : 'bg-white';
  const cardBorder = isDark ? 'border-gray-800' : 'border-gray-100';
  const textPrimary = isDark ? 'text-white' : 'text-gray-900';
  const textSecondary = isDark ? 'text-gray-400' : 'text-gray-600';
  const inputBg = isDark ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200';

  const defaultForm = {
    title: '',
    description: '',
    start_date: '',
    start_time: '09:00',
    end_date: '',
    end_time: '10:00',
    event_type: 'other',
    target_audience: 'all',
    grade_id: '',
    class_id: '',
    parent_visible: false
  };

  const [eventForm, setEventForm] = useState(defaultForm);

  useEffect(() => {
    fetchCalendarEvents();
  }, [currentDate]);

  useEffect(() => {
    api.get('/classes/grades')
      .then(response => setGrades(response.data?.grades || []))
      .catch(() => setGrades([]));
  }, []);

  useEffect(() => {
    if (!eventForm.grade_id) {
      setClasses([]);
      return;
    }
    api.get(`/classes/classes?grade_id=${eventForm.grade_id}`)
      .then(response => setClasses(response.data?.classes || []))
      .catch(() => setClasses([]));
  }, [eventForm.grade_id]);

  const fetchCalendarEvents = async (dateToFetch = currentDate) => {
    try {
      setLoading(true);
      setError(null);
      const month = dateToFetch.getMonth() + 1;
      const year = dateToFetch.getFullYear();
      
      const response = await api.get(`/calendar?month=${month}&year=${year}`);
      
      if (response.data.success) {
        const transformedEvents = response.data.events.map(event => ({
          id: event.id,
          title: event.title,
          start: new Date(event.due_date || event.start_date),
          end: new Date(event.end_date || event.due_date || event.start_date),
          resource: event,
          type: event.event_type
        }));
        
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
      setError(null);
      
      const startDateTime = eventForm.start_date && eventForm.start_time 
        ? `${eventForm.start_date}T${eventForm.start_time}:00`
        : eventForm.start_date;
      
      const endDateTime = eventForm.end_date && eventForm.end_time
        ? `${eventForm.end_date}T${eventForm.end_time}:00`
        : eventForm.end_date || null;

      const cleanedForm = {
        title: eventForm.title.trim(),
        description: eventForm.description.trim(),
        start_date: startDateTime,
        end_date: endDateTime,
        event_type: eventForm.event_type,
        target_audience: eventForm.target_audience,
        parent_visible: eventForm.parent_visible === true
      };

      if (eventForm.grade_id && eventForm.grade_id !== '') {
        cleanedForm.grade_id = parseInt(eventForm.grade_id);
      }
      if (eventForm.class_id && eventForm.class_id !== '') {
        cleanedForm.class_id = parseInt(eventForm.class_id);
      }

      let response;
      if (editingEvent) {
        response = await api.put(`/calendar/events/${editingEvent.id}`, cleanedForm);
      } else {
        response = await api.post('/calendar/events', cleanedForm);
      }
      
      if (response.data.success) {
        setShowCreateEvent(false);
        setEditingEvent(null);
        setEventForm(defaultForm);
        setSelectedEvent(null);
        await fetchCalendarEvents();
        toast.success(editingEvent ? 'Event updated successfully!' : 'Event created successfully!');
      }
    } catch (error) {
      console.error('Error saving event:', error);
      const errorMessage = error.response?.data?.message || 
                          (error.response?.data?.errors ? 
                           error.response.data.errors.map(e => e.msg).join(', ') : 
                           'Failed to save event');
      setError(errorMessage);
      toast.error(errorMessage);
    }
  };

  const handleEditEvent = (event) => {
    const resource = event.resource;
    const startDate = resource.start_date || resource.due_date;
    const endDate = resource.end_date;

    const startMoment = moment(startDate);
    const endMoment = endDate ? moment(endDate) : null;

    setEventForm({
      title: resource.title || '',
      description: resource.description || '',
      start_date: startMoment.format('YYYY-MM-DD'),
      start_time: startMoment.format('HH:mm'),
      end_date: endMoment ? endMoment.format('YYYY-MM-DD') : '',
      end_time: endMoment ? endMoment.format('HH:mm') : '10:00',
      event_type: resource.category || resource.event_type || 'other',
      target_audience: resource.target_audience || 'all',
      grade_id: resource.grade_id || '',
      class_id: resource.class_id || '',
      parent_visible: resource.parent_visible === true
    });
    setEditingEvent(resource);
    setSelectedEvent(null);
    setShowCreateEvent(true);
  };

  const handleDeleteEvent = async (event) => {
    const resource = event.resource;
    if (!window.confirm(`Are you sure you want to delete "${resource.title}"?`)) return;

    try {
      const response = await api.delete(`/calendar/events/${resource.id}`);
      if (response.data.success) {
        setSelectedEvent(null);
        await fetchCalendarEvents();
        toast.success('Event deleted successfully!');
      }
    } catch (error) {
      console.error('Error deleting event:', error);
      toast.error('Failed to delete event');
    }
  };

  const eventStyleGetter = (event) => {
    let backgroundColor = '#3b82f6';
    
    if (event.resource.event_type === 'task') {
      backgroundColor = event.resource.task_type === 'quiz' ? '#ef4444' : '#3b82f6';
    } else if (event.resource.event_type === 'school_event') {
      switch (event.resource.category) {
        case 'holiday':
          backgroundColor = '#10b981';
          break;
        case 'exam':
          backgroundColor = '#f59e0b';
          break;
        case 'meeting':
          backgroundColor = '#8b5cf6';
          break;
        case 'deadline':
          backgroundColor = '#ef4444';
          break;
        default:
          backgroundColor = '#6b7280';
      }
    }

    return {
      style: {
        backgroundColor,
        color: 'white',
        border: 'none',
        borderRadius: '8px',
        padding: '4px 8px',
        fontSize: '12px',
        fontWeight: '500'
      }
    };
  };

  const CustomToolbar = ({ date, onNavigate, label, onView, view }) => {
    return (
      <div className={`flex flex-col sm:flex-row items-center justify-between gap-4 p-4 mb-4 rounded-2xl ${isDark ? 'bg-gray-800' : 'bg-gray-50'}`}>
        <div className="flex items-center gap-2">
          <button 
            type="button" 
            onClick={() => onNavigate('TODAY')}
            className={`px-4 py-2.5 rounded-xl font-medium text-sm transition-all ${
              isDark ? 'bg-gray-700 hover:bg-gray-600 text-white' : 'bg-white hover:bg-gray-100 text-gray-700 border border-gray-200'
            }`}
          >
            Today
          </button>
          <div className="flex items-center gap-1">
            <button 
              type="button" 
              onClick={() => onNavigate('PREV')}
              className={`p-2.5 rounded-xl transition-all ${
                isDark ? 'bg-gray-700 hover:bg-gray-600 text-white' : 'bg-white hover:bg-gray-100 text-gray-700 border border-gray-200'
              }`}
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button 
              type="button" 
              onClick={() => onNavigate('NEXT')}
              className={`p-2.5 rounded-xl transition-all ${
                isDark ? 'bg-gray-700 hover:bg-gray-600 text-white' : 'bg-white hover:bg-gray-100 text-gray-700 border border-gray-200'
              }`}
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
        
        <h2 className={`text-xl font-bold ${textPrimary}`}>{label}</h2>
        
        <div className={`flex items-center p-1 rounded-xl ${isDark ? 'bg-gray-700' : 'bg-white border border-gray-200'}`}>
          {['month', 'week', 'day'].map((v) => (
            <button 
              key={v}
              type="button" 
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                view === v 
                  ? 'bg-gradient-to-r from-emerald-500 to-teal-500 text-white shadow-sm' 
                  : `${isDark ? 'text-gray-400 hover:text-white' : 'text-gray-600 hover:text-gray-900'}`
              }`}
              onClick={() => onView(v)}
            >
              {v.charAt(0).toUpperCase() + v.slice(1)}
            </button>
          ))}
        </div>
      </div>
    );
  };

  const handleSelectEvent = (event) => {
    setSelectedEvent(event);
  };

  const handleNavigate = (date) => {
    setCurrentDate(date);
  };

  const isAdmin = user.role === 'admin' || user.role === 'super_admin';
  const isSchoolEvent = (event) => event?.resource?.event_type === 'school_event';
  const internalAudienceLabel = {
    all: 'All Staff',
    teachers: 'Teachers Only',
    staff: 'Staff/Admin Only',
    students: 'Legacy Students Only'
  }[eventForm.target_audience] || 'All Staff';
  const selectedGrade = grades.find(grade => String(grade.id) === String(eventForm.grade_id));
  const selectedClass = classes.find(schoolClass => String(schoolClass.id) === String(eventForm.class_id));
  const parentAudienceLabel = !eventForm.parent_visible
    ? 'Not published'
    : !selectedGrade
      ? 'All Parents'
      : selectedClass
        ? `${selectedGrade.name} · ${selectedClass.name} Parents`
        : `${selectedGrade.name} Parents (all classes)`;

  const formatEventDetails = (event) => {
    const resource = event.resource;
    const startTime = moment(event.start).format('h:mm A');
    const endTime = moment(event.end).format('h:mm A');
    const dateStr = moment(event.start).format('MMMM D, YYYY');
    
    return (
      <div className="space-y-4">
        <div className={`flex items-center gap-3 p-3 rounded-xl ${isDark ? 'bg-gray-800' : 'bg-gray-50'}`}>
          <Clock className={`h-5 w-5 ${textSecondary}`} />
          <div>
            <p className={`text-sm ${textSecondary}`}>Date & Time</p>
            <p className={`font-medium ${textPrimary}`}>{dateStr}</p>
            <p className={`text-sm ${textSecondary}`}>{startTime} - {endTime}</p>
          </div>
        </div>
        
        {resource.event_type === 'task' ? (
          <>
            <div className={`flex items-center gap-3 p-3 rounded-xl ${isDark ? 'bg-gray-800' : 'bg-gray-50'}`}>
              <BookOpen className={`h-5 w-5 ${textSecondary}`} />
              <div>
                <p className={`text-sm ${textSecondary}`}>Type</p>
                <p className={`font-medium ${textPrimary} capitalize`}>{resource.task_type}</p>
              </div>
            </div>
            {resource.grade_name && (
              <div className={`flex items-center gap-3 p-3 rounded-xl ${isDark ? 'bg-gray-800' : 'bg-gray-50'}`}>
                <Users className={`h-5 w-5 ${textSecondary}`} />
                <div>
                  <p className={`text-sm ${textSecondary}`}>Class</p>
                  <p className={`font-medium ${textPrimary}`}>{resource.grade_name} - {resource.class_name}</p>
                </div>
              </div>
            )}
            {resource.max_points && (
              <p className={`text-sm ${textSecondary}`}>Points: <span className={`font-medium ${textPrimary}`}>{resource.max_points}</span></p>
            )}
          </>
        ) : (
          <>
            {resource.description && (
              <p className={textSecondary}>{resource.description}</p>
            )}
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`inline-block px-3 py-1.5 rounded-full text-sm font-medium ${
                resource.category === 'holiday' ? 'bg-emerald-100 text-emerald-700' :
                resource.category === 'exam' ? 'bg-amber-100 text-amber-700' :
                resource.category === 'meeting' ? 'bg-purple-100 text-purple-700' :
                resource.category === 'deadline' ? 'bg-red-100 text-red-700' :
                'bg-gray-100 text-gray-700'
              }`}>
                {resource.category || resource.event_type}
              </span>
              {resource.target_audience && resource.target_audience !== 'all' && (
                <span className="inline-block px-3 py-1.5 rounded-full text-sm font-medium bg-blue-100 text-blue-700">
                  {resource.target_audience}
                </span>
              )}
              {resource.parent_visible && (
                <span className="inline-block px-3 py-1.5 rounded-full text-sm font-medium bg-teal-100 text-teal-700">
                  Visible to Parents
                </span>
              )}
            </div>
          </>
        )}
      </div>
    );
  };

  const legendItems = [
    { color: '#3b82f6', label: 'Assignments', icon: '' },
    { color: '#ef4444', label: 'Quizzes', icon: '' },
    { color: '#10b981', label: 'Holidays', icon: '' },
    { color: '#f59e0b', label: 'Exams', icon: '' },
    { color: '#8b5cf6', label: 'Meetings', icon: '' },
    { color: '#6b7280', label: 'Other', icon: '' }
  ];

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin"></div>
          <p className={textSecondary}>Loading calendar...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-gradient-to-br from-emerald-500 to-teal-500 rounded-xl shadow-lg shadow-emerald-500/25">
            <CalendarIcon className="h-6 w-6 text-white" />
          </div>
          <div>
            <h1 className={`text-2xl font-bold ${textPrimary}`}>Academic Calendar</h1>
            <p className={`text-sm ${textSecondary}`}>View tasks, events, and important dates</p>
          </div>
        </div>
        {isAdmin && (
          <button 
            className="flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-emerald-500 to-teal-500 text-white rounded-xl font-medium hover:shadow-lg hover:shadow-emerald-500/25 transition-all"
            onClick={() => {
              setEditingEvent(null);
              setEventForm(defaultForm);
              setShowCreateEvent(true);
            }}
          >
            <Plus className="h-4 w-4" />
            Create Event
          </button>
        )}
      </div>

      {error && (
        <div className="flex items-center gap-3 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-2xl">
          <AlertCircle className="h-5 w-5 text-red-500 flex-shrink-0" />
          <span className="text-red-700 dark:text-red-300">{error}</span>
          <button 
            className="ml-auto p-1 text-red-500 hover:bg-red-100 dark:hover:bg-red-900/30 rounded-lg transition-colors"
            onClick={() => setError(null)}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      <div className={`${cardBg} rounded-2xl shadow-sm border ${cardBorder} p-4`}>
        <div className="flex flex-wrap items-center gap-4">
          {legendItems.map((item, idx) => (
            <div key={idx} className="flex items-center gap-2">
              <div 
                className="w-3 h-3 rounded-full" 
                style={{ backgroundColor: item.color }}
              ></div>
              <span className={`text-sm ${textSecondary}`}>{item.label}</span>
            </div>
          ))}
        </div>
      </div>

      <div className={`${cardBg} rounded-2xl shadow-sm border ${cardBorder} p-6`}>
        <Calendar
          localizer={localizer}
          events={events}
          startAccessor="start"
          endAccessor="end"
          style={{ height: 590 }}
          date={currentDate}
          view={currentView}
          onView={setCurrentView}
          onNavigate={handleNavigate}
          onSelectEvent={handleSelectEvent}
          eventPropGetter={eventStyleGetter}
          views={['month', 'week', 'day']}
          defaultView="month"
          popup
          popupOffset={{ x: 30, y: 20 }}
          showMultiDayTimes
          allDayMaxRows={3}
          step={30}
          timeslots={2}
          components={{
            toolbar: CustomToolbar,
            event: ({ event }) => (
              <div className="flex min-w-0 items-center gap-1.5">
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-white/80" />
                <span className="truncate font-medium">{event.title}</span>
              </div>
            )
          }}
        />
      </div>

      {selectedEvent && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={() => setSelectedEvent(null)}>
          <div className={`${cardBg} rounded-2xl shadow-2xl max-w-md w-full overflow-hidden`} onClick={(e) => e.stopPropagation()}>
            <div className={`px-6 py-4 border-b ${cardBorder} flex items-center justify-between`}>
              <h3 className={`text-lg font-semibold ${textPrimary}`}>{selectedEvent.title}</h3>
              <button 
                className={`p-2 rounded-xl ${isDark ? 'hover:bg-gray-800' : 'hover:bg-gray-100'} transition-colors`}
                onClick={() => setSelectedEvent(null)}
              >
                <X className={`h-5 w-5 ${textSecondary}`} />
              </button>
            </div>
            <div className="p-6">
              {formatEventDetails(selectedEvent)}
            </div>
            {isAdmin && isSchoolEvent(selectedEvent) && (
              <div className={`px-6 py-4 border-t ${cardBorder} flex gap-3`}>
                <button
                  onClick={() => handleEditEvent(selectedEvent)}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-600 text-white rounded-xl font-medium hover:bg-blue-700 transition-all"
                >
                  <Edit className="h-4 w-4" />
                  Edit Event
                </button>
                <button
                  onClick={() => handleDeleteEvent(selectedEvent)}
                  className="flex items-center justify-center gap-2 px-4 py-2.5 bg-red-600 text-white rounded-xl font-medium hover:bg-red-700 transition-all"
                >
                  <Trash2 className="h-4 w-4" />
                  Delete
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {showCreateEvent && isAdmin && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={() => { setShowCreateEvent(false); setEditingEvent(null); }}>
          <div className={`${cardBg} rounded-2xl shadow-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto`} onClick={(e) => e.stopPropagation()}>
            <div className={`px-6 py-4 border-b ${cardBorder} flex items-center justify-between sticky top-0 ${cardBg}`}>
              <div className="flex items-center gap-3">
                <div className={`p-2 rounded-lg ${editingEvent ? 'bg-blue-600' : 'bg-gradient-to-br from-emerald-500 to-teal-500'}`}>
                  {editingEvent ? <Edit className="h-4 w-4 text-white" /> : <Plus className="h-4 w-4 text-white" />}
                </div>
                <h3 className={`text-lg font-semibold ${textPrimary}`}>
                  {editingEvent ? 'Edit School Event' : 'Create School Event'}
                </h3>
              </div>
              <button 
                className={`p-2 rounded-xl ${isDark ? 'hover:bg-gray-800' : 'hover:bg-gray-100'} transition-colors`}
                onClick={() => { setShowCreateEvent(false); setEditingEvent(null); }}
              >
                <X className={`h-5 w-5 ${textSecondary}`} />
              </button>
            </div>
            <form onSubmit={handleCreateEvent} className="p-6 space-y-5">
              <h4 className={`text-xs font-bold uppercase tracking-[0.14em] ${textSecondary}`}>Event details</h4>
              <div>
                <label className={`block text-sm font-medium ${textSecondary} mb-2`}>Event Title *</label>
                <input
                  type="text"
                  value={eventForm.title}
                  onChange={(e) => setEventForm({ ...eventForm, title: e.target.value })}
                  className={`w-full ${inputBg} border rounded-xl px-4 py-3 ${textPrimary} focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition-all`}
                  placeholder="Enter event title"
                  required
                />
              </div>

              <div>
                <label className={`block text-sm font-medium ${textSecondary} mb-2`}>Description</label>
                <textarea
                  value={eventForm.description}
                  onChange={(e) => setEventForm({ ...eventForm, description: e.target.value })}
                  className={`w-full ${inputBg} border rounded-xl px-4 py-3 ${textPrimary} focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition-all resize-none`}
                  rows="3"
                  placeholder="Add event details..."
                />
              </div>

              <h4 className={`pt-1 text-xs font-bold uppercase tracking-[0.14em] ${textSecondary}`}>Date &amp; time</h4>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className={`block text-sm font-medium ${textSecondary} mb-2`}>
                    <CalendarIcon className="h-4 w-4 inline mr-1" />
                    Start Date *
                  </label>
                  <input
                    type="date"
                    value={eventForm.start_date}
                    onChange={(e) => setEventForm({ ...eventForm, start_date: e.target.value })}
                    className={`w-full ${inputBg} border rounded-xl px-4 py-3 ${textPrimary} focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition-all`}
                    required
                  />
                </div>
                <div>
                  <label className={`block text-sm font-medium ${textSecondary} mb-2`}>
                    <Clock className="h-4 w-4 inline mr-1" />
                    Start Time
                  </label>
                  <input
                    type="time"
                    value={eventForm.start_time}
                    onChange={(e) => setEventForm({ ...eventForm, start_time: e.target.value })}
                    className={`w-full ${inputBg} border rounded-xl px-4 py-3 ${textPrimary} focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition-all`}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className={`block text-sm font-medium ${textSecondary} mb-2`}>End Date</label>
                  <input
                    type="date"
                    value={eventForm.end_date}
                    onChange={(e) => setEventForm({ ...eventForm, end_date: e.target.value })}
                    className={`w-full ${inputBg} border rounded-xl px-4 py-3 ${textPrimary} focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition-all`}
                  />
                </div>
                <div>
                  <label className={`block text-sm font-medium ${textSecondary} mb-2`}>End Time</label>
                  <input
                    type="time"
                    value={eventForm.end_time}
                    onChange={(e) => setEventForm({ ...eventForm, end_time: e.target.value })}
                    className={`w-full ${inputBg} border rounded-xl px-4 py-3 ${textPrimary} focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition-all`}
                  />
                </div>
              </div>

              <div>
                  <label className={`block text-sm font-medium ${textSecondary} mb-2`}>Event Type</label>
                  <select
                    value={eventForm.event_type}
                    onChange={(e) => setEventForm({ ...eventForm, event_type: e.target.value })}
                    className={`w-full ${inputBg} border rounded-xl px-4 py-3 ${textPrimary} focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition-all`}
                  >
                    <option value="holiday">Holiday</option>
                    <option value="exam">Exam</option>
                    <option value="meeting">Meeting</option>
                    <option value="deadline">Deadline</option>
                    <option value="other">Other</option>
                  </select>
              </div>

              <section className={`space-y-3 rounded-xl border p-4 ${cardBorder}`}>
                <div>
                  <h4 className={`text-xs font-bold uppercase tracking-[0.14em] ${textSecondary}`}>Internal audience</h4>
                  <p className={`mt-1 text-xs ${textSecondary}`}>Controls which staff members see this event internally.</p>
                </div>
                <div>
                  <label className={`block text-sm font-medium ${textSecondary} mb-2`}>Internal Audience</label>
                  <select
                    value={eventForm.target_audience}
                    onChange={(e) => setEventForm({ ...eventForm, target_audience: e.target.value })}
                    className={`w-full ${inputBg} border rounded-xl px-4 py-3 ${textPrimary} focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition-all`}
                  >
                    {eventForm.target_audience === 'students' && <option value="students">Legacy Students Only</option>}
                    <option value="all">All Staff</option>
                    <option value="teachers">Teachers Only</option>
                    <option value="staff">Staff/Admin Only</option>
                  </select>
                </div>
              </section>

              <section className={`space-y-4 rounded-xl border p-4 ${cardBorder}`}>
                <div>
                  <h4 className={`text-xs font-bold uppercase tracking-[0.14em] ${textSecondary}`}>Parent Portal visibility</h4>
                  <p className={`mt-1 text-xs ${textSecondary}`}>A separate publishing decision from internal visibility.</p>
                </div>
                <label className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    checked={eventForm.parent_visible}
                    onChange={(e) => setEventForm({ ...eventForm, parent_visible: e.target.checked })}
                    className="mt-0.5 h-4 w-4 accent-teal-600"
                  />
                  <span>
                    <span className={`block text-sm font-semibold ${textPrimary}`}>Show this event to Parents</span>
                    <span className={`block text-xs ${textSecondary}`}>Parents only see it when it applies to their learner’s selected grade/class, or when no grade is selected.</span>
                  </span>
                </label>
                {eventForm.parent_visible && eventForm.target_audience === 'staff' && (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                    Internal visibility and Parent publication are separate: Staff/Admin and the targeted Parents will see this event.
                  </div>
                )}
              </section>

              <section className={`space-y-4 rounded-xl border p-4 ${cardBorder}`}>
                <div>
                  <h4 className={`text-xs font-bold uppercase tracking-[0.14em] ${textSecondary}`}>Grade/Class targeting</h4>
                  <p className={`mt-1 text-xs ${textSecondary}`}>{eventForm.parent_visible ? 'All grades publishes to all Parents. A grade limits it to that grade; a class narrows it further.' : 'Used for internal organization. Parents cannot see this event while Parent publication is off.'}</p>
                </div>
                <div>
                <label className={`block text-sm font-medium ${textSecondary} mb-2`}>Target Grade</label>
                <select
                  value={eventForm.grade_id}
                  onChange={(e) => setEventForm({ ...eventForm, grade_id: e.target.value, class_id: '' })}
                  className={`w-full ${inputBg} border rounded-xl px-4 py-3 ${textPrimary} focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition-all`}
                >
                  <option value="">All grades</option>
                  {grades.map(grade => <option key={grade.id} value={grade.id}>{grade.name}</option>)}
                </select>
                </div>

                <div>
                <label className={`block text-sm font-medium ${textSecondary} mb-2`}>Target Class</label>
                <select
                  value={eventForm.class_id}
                  onChange={(e) => setEventForm({ ...eventForm, class_id: e.target.value })}
                  disabled={!eventForm.grade_id}
                  className={`w-full ${inputBg} border rounded-xl px-4 py-3 ${textPrimary} disabled:opacity-50 focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition-all`}
                >
                  <option value="">All classes in grade</option>
                  {classes.map(schoolClass => <option key={schoolClass.id} value={schoolClass.id}>{schoolClass.name}</option>)}
                </select>
                </div>
              </section>

              <section className={`rounded-xl border p-4 ${isDark ? 'border-slate-700 bg-slate-800/60' : 'border-[#cfe0e0] bg-[#f4f8f7]'}`}>
                <h4 className={`text-sm font-bold ${textPrimary}`}>Who will see this?</h4>
                <dl className="mt-2 grid grid-cols-[72px_1fr] gap-x-3 gap-y-1 text-sm">
                  <dt className={textSecondary}>Internal:</dt><dd className={`font-medium ${textPrimary}`}>{internalAudienceLabel}</dd>
                  <dt className={textSecondary}>Parents:</dt><dd className={`font-medium ${eventForm.parent_visible ? 'text-teal-700 dark:text-teal-300' : textPrimary}`}>{parentAudienceLabel}</dd>
                </dl>
              </section>

              <div className={`flex gap-3 pt-4 border-t ${cardBorder}`}>
                <button 
                  type="button" 
                  onClick={() => { setShowCreateEvent(false); setEditingEvent(null); }}
                  className={`flex-1 px-4 py-3 rounded-xl font-medium ${isDark ? 'bg-gray-800 hover:bg-gray-700' : 'bg-gray-100 hover:bg-gray-200'} ${textPrimary} transition-all`}
                >
                  Cancel
                </button>
                <button 
                  type="submit" 
                  className={`flex-1 px-4 py-3 rounded-xl font-medium text-white transition-all ${
                    editingEvent 
                      ? 'bg-blue-600 hover:bg-blue-700' 
                      : 'bg-gradient-to-r from-emerald-500 to-teal-500 hover:shadow-lg hover:shadow-emerald-500/25'
                  }`}
                >
                  {editingEvent ? 'Update Event' : 'Create Event'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default CalendarComponent;
