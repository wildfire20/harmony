import React, { useState, useEffect } from 'react';
import { Award, Plus, Filter, Play, Clock, Users, BarChart3, Edit, Trash2 } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import QuizCreator from './QuizCreator';
import QuizTaker from './QuizTaker';
import QuizResults from './QuizResults';
import LoadingSpinner from '../common/LoadingSpinner';

const Quizzes = () => {
  const { user } = useAuth();
  const [quizzes, setQuizzes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activeView, setActiveView] = useState('list'); // list, create, take, results
  const [selectedQuiz, setSelectedQuiz] = useState(null);
  const [filter, setFilter] = useState('all'); // all, active, overdue

  useEffect(() => {
    fetchQuizzes();
  }, [filter]);

  const fetchQuizzes = async () => {
    try {
      setLoading(true);
      const token = localStorage.getItem('token');
      const filterParam = filter !== 'all' ? `?status=${filter}` : '';
      
      const response = await fetch(`/api/quizzes${filterParam}`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error('Failed to fetch quizzes');
      }

      const data = await response.json();
      setQuizzes(data.quizzes || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateQuiz = () => {
    setActiveView('create');
  };

  const handleTakeQuiz = (quiz) => {
    setSelectedQuiz(quiz);
    setActiveView('take');
  };

  const handleViewResults = (quiz) => {
    setSelectedQuiz(quiz);
    setActiveView('results');
  };

  const handleDeleteQuiz = async (taskId) => {
    if (!window.confirm('Are you sure you want to delete this quiz?')) return;

    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/quizzes/${taskId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error('Failed to delete quiz');
      }

      await fetchQuizzes();
    } catch (err) {
      setError(err.message);
    }
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'active': return 'bg-green-100 text-green-800';
      case 'overdue': return 'bg-red-100 text-red-800';
      case 'due_today': return 'bg-yellow-100 text-yellow-800';
      default: return 'bg-gray-100 text-gray-800';
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

  if (activeView === 'create') {
    return (
      <QuizCreator 
        onBack={() => setActiveView('list')}
        onSuccess={() => {
          setActiveView('list');
          fetchQuizzes();
        }}
      />
    );
  }

  if (activeView === 'take' && selectedQuiz) {
    return (
      <QuizTaker 
        quiz={selectedQuiz}
        onBack={() => setActiveView('list')}
        onComplete={() => {
          setActiveView('list');
          fetchQuizzes();
        }}
      />
    );
  }

  if (activeView === 'results' && selectedQuiz) {
    return (
      <QuizResults 
        quiz={selectedQuiz}
        onBack={() => setActiveView('list')}
      />
    );
  }

  return (
    <div className="quizzes-header space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <Award className="h-8 w-8 text-harmony-gold" />
          <h1 className="mobile-heading-1 text-3xl font-bold text-gray-900">Quizzes</h1>
        </div>
        <div className="quizzes-filter-row flex space-x-3">
          <select 
            value={filter} 
            onChange={(e) => setFilter(e.target.value)}
            className="quizzes-filter-select bg-white border border-gray-300 rounded-md px-3 py-2"
          >
            <option value="all">All Quizzes</option>
            <option value="active">Active</option>
            <option value="overdue">Overdue</option>
          </select>
          {(user?.role === 'teacher' || user?.role === 'admin' || user?.role === 'super_admin') && (
            <button 
              onClick={handleCreateQuiz}
              className="mobile-btn-gold bg-harmony-gold text-white px-4 py-2 rounded-md hover:bg-opacity-90 flex items-center space-x-2 sm:w-auto"
            >
              <Plus className="h-4 w-4" />
              <span>Create Quiz</span>
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-md p-4">
          <p className="text-red-800">Error: {error}</p>
          <button 
            onClick={() => setError(null)} 
            className="text-red-600 underline mt-2"
          >
            Dismiss
          </button>
        </div>
      )}

      {loading ? (
        <LoadingSpinner />
      ) : quizzes.length === 0 ? (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <div className="text-center py-12">
            <Award className="mx-auto h-16 w-16 text-gray-400 mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">No Quizzes Found</h3>
            <p className="text-gray-600">
              {filter === 'all' 
                ? 'No quizzes have been created yet.' 
                : `No ${filter} quizzes found.`
              }
            </p>
            {(user?.role === 'teacher' || user?.role === 'admin' || user?.role === 'super_admin') && (
              <div className="mt-6">
                <button 
                  onClick={handleCreateQuiz}
                  className="mobile-btn-gold bg-harmony-gold text-white px-6 py-2 rounded-md hover:bg-opacity-90 flex items-center space-x-2 mx-auto sm:w-auto"
                >
                  <Plus className="h-4 w-4" />
                  <span>Create Your First Quiz</span>
                </button>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="quiz-grid grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {quizzes.map((quiz) => (
            <div key={quiz.task_id} className="quiz-card bg-white rounded-lg shadow-sm border border-gray-200 p-6">
              <div className="quiz-card-header flex items-start justify-between mb-4">
                <div className="flex-1">
                  <h3 className="quiz-title text-lg font-semibold text-gray-900 mb-2">{quiz.title}</h3>
                  <p className="quiz-description text-gray-600 text-sm mb-3 line-clamp-2">{quiz.description}</p>
                  
                  <div className="quiz-meta-row flex items-center space-x-4 text-sm text-gray-500 mb-3">
                    <div className="quiz-due-date flex items-center space-x-1">
                      <Clock className="h-4 w-4" />
                      <span>Due: {formatDate(quiz.due_date)}</span>
                    </div>
                  </div>

                  <div className="quiz-status-row flex items-center justify-between mb-4">
                    <span className={`quiz-status-badge px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(quiz.quiz_status)}`}>
                      {quiz.quiz_status.replace('_', ' ').toUpperCase()}
                    </span>
                    <span className="quiz-points text-sm text-gray-500">
                      {quiz.max_points} points
                    </span>
                  </div>

                  <div className="quiz-class-info text-xs text-gray-500 mb-4">
                    {quiz.grade_name} - {quiz.class_name}
                    {quiz.time_limit && (
                      <span className="ml-2">• {quiz.time_limit} min limit</span>
                    )}
                  </div>

                  {user?.role === 'student' && quiz.student_status && (
                    <div className="quiz-student-status mb-4 p-3 bg-gray-50 rounded-md">
                      <div className="text-sm">
                        <div className="quiz-student-status-row flex justify-between">
                          <span>Attempts:</span>
                          <span>{quiz.student_status.attempts}/{quiz.attempts_allowed}</span>
                        </div>
                        {quiz.student_status.best_score !== null && (
                          <div className="quiz-student-status-row flex justify-between">
                            <span>Best Score:</span>
                            <span>{quiz.student_status.best_score}/{quiz.max_points}</span>
                          </div>
                        )}
                        <div className="quiz-student-status-row flex justify-between">
                          <span>Status:</span>
                          <span className="capitalize">{quiz.student_status.status.replace('_', ' ')}</span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div className="mobile-btn-group flex space-x-2">
                {user?.role === 'student' && quiz.student_status?.can_attempt && (
                  <button 
                    onClick={() => handleTakeQuiz(quiz)}
                    className="mobile-btn-success flex-1 bg-harmony-secondary text-white px-3 py-2 rounded-md hover:bg-opacity-90 flex items-center justify-center space-x-1 text-sm sm:flex-initial"
                  >
                    <Play className="h-4 w-4" />
                    <span>Take Quiz</span>
                  </button>
                )}

                {(user?.role === 'teacher' || user?.role === 'admin' || user?.role === 'super_admin') && (
                  <>
                    <button 
                      onClick={() => handleViewResults(quiz)}
                      className="mobile-btn-compact mobile-btn-secondary flex-1 bg-blue-600 text-white px-3 py-2 rounded-md hover:bg-blue-700 flex items-center justify-center space-x-1 text-sm sm:flex-initial"
                    >
                      <BarChart3 className="h-4 w-4" />
                      <span>Results</span>
                    </button>
                    <button 
                      onClick={() => handleDeleteQuiz(quiz.task_id)}
                      className="mobile-btn-icon danger px-3 py-2 text-red-600 hover:bg-red-50 rounded-md"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default Quizzes;
