import React, { useState, useEffect } from 'react';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  Legend, 
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  LineChart,
  Line
} from 'recharts';
import api from '../../services/api';
import { useAuth } from '../../contexts/AuthContext';
import './Analytics.css';

const Analytics = () => {
  const { user } = useAuth();
  const [analytics, setAnalytics] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [period, setPeriod] = useState(30);
  const [activeTab, setActiveTab] = useState('overview');

  useEffect(() => {
    fetchAnalytics();
  }, [period]);

  const fetchAnalytics = async () => {
    try {
      setLoading(true);
      const response = await api.get(`/analytics/dashboard?period=${period}`);
      
      if (response.data.success) {
        setAnalytics(response.data.analytics);
      }
    } catch (error) {
      console.error('Error fetching analytics:', error);
      setError('Failed to load analytics data');
    } finally {
      setLoading(false);
    }
  };

  const COLORS = ['#1e3a8a', '#3b82f6', '#60a5fa', '#93c5fd', '#dbeafe'];

  const renderStudentAnalytics = () => {
    if (!analytics || !analytics.submission_stats) return null;

    const submissionData = [
      { name: 'Total Submissions', value: analytics.submission_stats.total_submissions || 0 },
      { name: 'Graded', value: analytics.submission_stats.graded_submissions || 0 },
      { name: 'Late Submissions', value: analytics.submission_stats.late_submissions || 0 }
    ];

    return (
      <div className="analytics-content">
        <div className="stats-grid">
          <div className="stat-card">
            <div className="stat-value">{analytics.submission_stats.total_submissions || 0}</div>
            <div className="stat-label">Total Submissions</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">{analytics.submission_stats.graded_submissions || 0}</div>
            <div className="stat-label">Graded</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">
              {analytics.submission_stats.average_score ? 
                Math.round(analytics.submission_stats.average_score * 100) / 100 : 0}%
            </div>
            <div className="stat-label">Average Score</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">{analytics.submission_stats.late_submissions || 0}</div>
            <div className="stat-label">Late Submissions</div>
          </div>
        </div>

        <div className="charts-grid">
          <div className="chart-container">
            <h3>Submission Overview</h3>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={submissionData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" />
                <YAxis />
                <Tooltip />
                <Bar dataKey="value" fill="#1e3a8a" />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="chart-container">
            <h3>Recent Tasks</h3>
            <div className="task-list">
              {analytics.recent_tasks && analytics.recent_tasks.length > 0 ? (
                analytics.recent_tasks.map((task, index) => (
                  <div key={index} className="task-item">
                    <div className="task-title">{task.title}</div>
                    <div className="task-info">
                      <span className="task-type">{task.task_type}</span>
                      <span className="task-score">
                        {task.score !== null ? `${task.score}/${task.max_score}` : 'Not submitted'}
                      </span>
                    </div>
                  </div>
                ))
              ) : (
                <p>No recent tasks available</p>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  };

  const renderTeacherAnalytics = () => {
    if (!analytics) return null;

    const taskTypeData = [
      { name: 'Assignments', value: analytics.task_stats?.assignments || 0 },
      { name: 'Quizzes', value: analytics.task_stats?.quizzes || 0 }
    ];

    return (
      <div className="analytics-content">
        <div className="stats-grid">
          <div className="stat-card">
            <div className="stat-value">{analytics.task_stats?.total_tasks || 0}</div>
            <div className="stat-label">Tasks Created</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">{analytics.submission_stats?.total_submissions || 0}</div>
            <div className="stat-label">Student Submissions</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">{analytics.submission_stats?.pending_grading || 0}</div>
            <div className="stat-label">Pending Grading</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">{analytics.class_stats?.total_students || 0}</div>
            <div className="stat-label">Total Students</div>
          </div>
        </div>

        <div className="charts-grid">
          <div className="chart-container">
            <h3>Task Types Created</h3>
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie
                  data={taskTypeData}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  label={({ name, value }) => `${name}: ${value}`}
                  outerRadius={80}
                  fill="#8884d8"
                  dataKey="value"
                >
                  {taskTypeData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </div>

          <div className="chart-container">
            <h3>Class Statistics</h3>
            <div className="class-stats">
              <div className="stat-item">
                <strong>Grades Taught:</strong> {analytics.class_stats?.grades_taught || 0}
              </div>
              <div className="stat-item">
                <strong>Classes Taught:</strong> {analytics.class_stats?.classes_taught || 0}
              </div>
              <div className="stat-item">
                <strong>Average Score:</strong> {analytics.submission_stats?.average_score ? 
                  Math.round(analytics.submission_stats.average_score * 100) / 100 : 0}%
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  };

  const renderAdminAnalytics = () => {
    if (!analytics) return null;

    const platformData = [
      { name: 'Students', value: analytics.platform_stats?.total_students || 0 },
      { name: 'Teachers', value: analytics.platform_stats?.total_teachers || 0 },
      { name: 'Admins', value: analytics.platform_stats?.total_admins || 0 }
    ];

    const contentData = [
      { name: 'Total Tasks', value: analytics.content_stats?.total_tasks || 0 },
      { name: 'Assignments', value: analytics.content_stats?.assignments || 0 },
      { name: 'Quizzes', value: analytics.content_stats?.quizzes || 0 }
    ];

    return (
      <div className="analytics-content">
        <div className="stats-grid">
          <div className="stat-card">
            <div className="stat-value">{analytics.platform_stats?.total_students || 0}</div>
            <div className="stat-label">Total Students</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">{analytics.platform_stats?.total_teachers || 0}</div>
            <div className="stat-label">Total Teachers</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">{analytics.content_stats?.total_tasks || 0}</div>
            <div className="stat-label">Total Tasks</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">{analytics.content_stats?.total_submissions || 0}</div>
            <div className="stat-label">Total Submissions</div>
          </div>
        </div>

        <div className="charts-grid">
          <div className="chart-container">
            <h3>Platform Users</h3>
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie
                  data={platformData}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  label={({ name, value }) => `${name}: ${value}`}
                  outerRadius={80}
                  fill="#8884d8"
                  dataKey="value"
                >
                  {platformData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </div>

          <div className="chart-container">
            <h3>Content Statistics</h3>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={contentData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" />
                <YAxis />
                <Tooltip />
                <Bar dataKey="value" fill="#1e3a8a" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="additional-stats">
          <div className="stat-section">
            <h3>Platform Performance</h3>
            <div className="performance-stats">
              <div className="perf-item">
                <strong>Average Score:</strong> {analytics.content_stats?.platform_average_score ? 
                  Math.round(analytics.content_stats.platform_average_score * 100) / 100 : 0}%
              </div>
              <div className="perf-item">
                <strong>Grades:</strong> {analytics.platform_stats?.total_grades || 0}
              </div>
              <div className="perf-item">
                <strong>Classes:</strong> {analytics.platform_stats?.total_classes || 0}
              </div>
              <div className="perf-item">
                <strong>Graded Submissions:</strong> {analytics.content_stats?.graded_submissions || 0}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  };

  if (loading) {
    return (
      <div className="analytics-container">
        <div className="loading-spinner">
          <div className="spinner"></div>
          <p>Loading analytics...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="analytics-container">
        <div className="error-message">
          <h3>Error Loading Analytics</h3>
          <p>{error}</p>
          <button onClick={fetchAnalytics}>Retry</button>
        </div>
      </div>
    );
  }

  return (
    <div className="analytics-container">
      <div className="analytics-header">
        <h2>📊 Analytics Dashboard</h2>
        <div className="analytics-controls">
          <select 
            value={period} 
            onChange={(e) => setPeriod(parseInt(e.target.value))}
          >
            <option value={7}>Last 7 days</option>
            <option value={30}>Last 30 days</option>
            <option value={90}>Last 90 days</option>
            <option value={365}>Last year</option>
          </select>
        </div>
      </div>

      {error && (
        <div className="alert alert-danger">
          {error}
          <button onClick={() => setError(null)}>×</button>
        </div>
      )}

      <div className="analytics-body">
        {user.role === 'student' && renderStudentAnalytics()}
        {user.role === 'teacher' && renderTeacherAnalytics()}
        {(user.role === 'admin' || user.role === 'super_admin') && renderAdminAnalytics()}
      </div>
    </div>
  );
};

export default Analytics;
