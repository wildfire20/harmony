import React, { useState, useEffect } from 'react';
import { Award, Plus, Filter, Play, Clock, Users, BarChart3, Edit, Trash2 } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useTheme } from '../common/ThemeProvider';
import QuizCreator from './QuizCreator';
import QuizTaker from './QuizTaker';
import QuizResults from './QuizResults';
import LoadingSpinner from '../common/LoadingSpinner';

const Quizzes = () => {
  const { user } = useAuth();
  const { theme } = useTheme();
  const [quizzes, setQuizzes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activeView, setActiveView] = useState('list');
  const [selectedQuiz, setSelectedQuiz] = useState(null);
  const [filter, setFilter] = useState('all');

  const isDark = theme === 'dark';
  const cardBg = isDark ? 'bg-gray-900' : 'bg-white';
  const cardBorder = isDark ? 'border-gray-800' : 'border-gray-100';
  const textPrimary = isDark ? 'text-white' : 'text-gray-900';
  const textSecondary = isDark ? 'text-gray-400' : 'text-gray-600';

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
      case 'active': return 'bg-emerald-100 text-emerald-700';
      case 'overdue': return 'bg-red-100 text-red-700';
      case 'due_today': return 'bg-amber-100 text-amber-700';
      default: return 'bg-gray-100 text-gray-700';
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
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-gradient-to-br from-amber-400 to-amber-500 rounded-xl shadow-lg shadow-amber-500/25">
            <Award className="h-6 w-6 text-white" />
          </div>
          <h1 className={`text-2xl font-bold ${textPrimary}`}>Quizzes</h1>
        </div>
        <div className="flex items-center gap-3">
          <select 
            value={filter} 
            onChange={(e) => setFilter(e.target.value)}
            className={`px-4 py-2.5 rounded-xl border ${cardBorder} ${cardBg} ${textPrimary} text-sm font-medium focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all`}
          >
            <option value="all">All Quizzes</option>
            <option value="active">Active</option>
            <option value="overdue">Overdue</option>
          </select>
          {(user?.role === 'teacher' || user?.role === 'admin' || user?.role === 'super_admin') && (
            <button 
              onClick={handleCreateQuiz}
              className="flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-emerald-500 to-emerald-600 text-white rounded-xl font-medium shadow-lg shadow-emerald-500/25 hover:shadow-xl hover:shadow-emerald-500/30 transition-all"
            >
              <Plus className="h-4 w-4" />
              <span>Create Quiz</span>
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4">
          <p className="text-red-700">Error: {error}</p>
          <button 
            onClick={() => setError(null)} 
            className="text-red-600 underline mt-2 text-sm font-medium"
          >
            Dismiss
          </button>
        </div>
      )}

      {loading ? (
        <LoadingSpinner />
      ) : quizzes.length === 0 ? (
        <div className={`${cardBg} rounded-2xl shadow-sm border ${cardBorder} overflow-hidden`}>
          <div className="text-center py-16">
            <div className="p-4 bg-gray-100 dark:bg-gray-800 rounded-full w-fit mx-auto mb-4">
              <Award className="h-12 w-12 text-gray-400" />
            </div>
            <h3 className={`text-lg font-semibold ${textPrimary} mb-2`}>No Quizzes Found</h3>
            <p className={textSecondary}>
              {filter === 'all' 
                ? 'No quizzes have been created yet.' 
                : `No ${filter} quizzes found.`
              }
            </p>
            {(user?.role === 'teacher' || user?.role === 'admin' || user?.role === 'super_admin') && (
              <div className="mt-6">
                <button 
                  onClick={handleCreateQuiz}
                  className="inline-flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-emerald-500 to-emerald-600 text-white rounded-xl font-medium shadow-lg shadow-emerald-500/25 hover:shadow-xl transition-all"
                >
                  <Plus className="h-4 w-4" />
                  <span>Create Your First Quiz</span>
                </button>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {quizzes.map((quiz) => (
            <div key={quiz.task_id} className={`${cardBg} rounded-2xl shadow-sm border ${cardBorder} p-5 hover:shadow-lg transition-all duration-200`}>
              <div className="mb-4">
                <h3 className={`text-lg font-semibold ${textPrimary} mb-2 line-clamp-1`}>{quiz.title}</h3>
                <p className={`${textSecondary} text-sm mb-4 line-clamp-2`}>{quiz.description}</p>
                
                <div className={`flex items-center gap-2 text-sm ${textSecondary} mb-3`}>
                  <Clock className="h-4 w-4" />
                  <span>Due: {formatDate(quiz.due_date)}</span>
                </div>

                <div className="flex items-center justify-between mb-4">
                  <span className={`px-3 py-1 rounded-full text-xs font-semibold ${getStatusColor(quiz.quiz_status)}`}>
                    {quiz.quiz_status.replace('_', ' ').toUpperCase()}
                  </span>
                  <span className={`text-sm font-medium ${textSecondary}`}>
                    {quiz.max_points} pts
                  </span>
                </div>

                <div className={`text-xs ${textSecondary} mb-4 px-3 py-2 rounded-lg ${isDark ? 'bg-gray-800' : 'bg-gray-50'}`}>
                  {quiz.grade_name} - {quiz.class_name}
                  {quiz.time_limit && (
                    <span className="ml-2">• {quiz.time_limit} min</span>
                  )}
                </div>

                {user?.role === 'student' && quiz.student_status && (
                  <div className={`mb-4 p-3 rounded-xl ${isDark ? 'bg-gray-800' : 'bg-gray-50'}`}>
                    <div className="text-sm space-y-1">
                      <div className="flex justify-between">
                        <span className={textSecondary}>Attempts:</span>
                        <span className={`font-medium ${textPrimary}`}>{quiz.student_status.attempts}/{quiz.attempts_allowed}</span>
                      </div>
                      {quiz.student_status.best_score !== null && (
                        <div className="flex justify-between">
                          <span className={textSecondary}>Best Score:</span>
                          <span className={`font-medium ${textPrimary}`}>{quiz.student_status.best_score}/{quiz.max_points}</span>
                        </div>
                      )}
                      <div className="flex justify-between">
                        <span className={textSecondary}>Status:</span>
                        <span className={`capitalize font-medium ${textPrimary}`}>{quiz.student_status.status.replace('_', ' ')}</span>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <div className="flex gap-2">
                {user?.role === 'student' && quiz.student_status?.can_attempt && (
                  <button 
                    onClick={() => handleTakeQuiz(quiz)}
                    className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-gradient-to-r from-emerald-500 to-emerald-600 text-white rounded-xl text-sm font-medium shadow-sm hover:shadow-md transition-all"
                  >
                    <Play className="h-4 w-4" />
                    <span>Take Quiz</span>
                  </button>
                )}

                {(user?.role === 'teacher' || user?.role === 'admin' || user?.role === 'super_admin') && (
                  <>
                    <button 
                      onClick={() => handleViewResults(quiz)}
                      className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-gradient-to-r from-blue-500 to-blue-600 text-white rounded-xl text-sm font-medium shadow-sm hover:shadow-md transition-all"
                    >
                      <BarChart3 className="h-4 w-4" />
                      <span>Results</span>
                    </button>
                    <button 
                      onClick={() => handleDeleteQuiz(quiz.task_id)}
                      className={`p-2.5 rounded-xl border ${cardBorder} text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors`}
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
