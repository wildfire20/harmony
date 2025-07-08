import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { CheckCircle, XCircle, Clock, Award, User, Calendar } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import LoadingSpinner from '../common/LoadingSpinner';

const QuizResults = () => {
  const { id } = useParams();
  const { user, token } = useAuth();
  const [loading, setLoading] = useState(true);
  const [results, setResults] = useState(null);
  const [editingGrade, setEditingGrade] = useState(null);
  const [newScore, setNewScore] = useState('');
  const [newFeedback, setNewFeedback] = useState('');

  useEffect(() => {
    fetchQuizResults();
  }, [id]);

  const fetchQuizResults = async () => {
    try {
      const response = await fetch(`/api/quizzes/${id}/results`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      if (response.ok) {
        const data = await response.json();
        setResults(data);
      }
    } catch (error) {
      console.error('Error fetching quiz results:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleGradeEdit = async (submissionId) => {
    try {
      const response = await fetch(`/api/quizzes/${id}/results/${submissionId}`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          score: parseInt(newScore),
          feedback: newFeedback
        })
      });

      if (response.ok) {
        await fetchQuizResults();
        setEditingGrade(null);
        setNewScore('');
        setNewFeedback('');
      }
    } catch (error) {
      console.error('Error updating grade:', error);
    }
  };

  const startEditing = (submission) => {
    setEditingGrade(submission.id);
    setNewScore(submission.score.toString());
    setNewFeedback(submission.feedback || '');
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-64">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  if (!results) {
    return (
      <div className="text-center py-8">
        <p className="text-gray-500">Quiz results not found</p>
      </div>
    );
  }

  const { quiz, submissions } = results;
  const isTeacherOrAdmin = user.role === 'teacher' || user.role === 'admin' || user.role === 'super_admin';

  return (
    <div className="space-y-6">
      {/* Quiz Header */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <div className="flex items-center space-x-3 mb-4">
          <Award className="h-8 w-8 text-blue-600" />
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{quiz.title}</h1>
            <p className="text-gray-600">Quiz Results</p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="bg-blue-50 rounded-lg p-4">
            <div className="flex items-center space-x-2">
              <Award className="h-5 w-5 text-blue-600" />
              <span className="text-sm font-medium text-blue-600">Max Points</span>
            </div>
            <p className="text-2xl font-bold text-blue-900">{quiz.max_points}</p>
          </div>

          {quiz.time_limit && (
            <div className="bg-yellow-50 rounded-lg p-4">
              <div className="flex items-center space-x-2">
                <Clock className="h-5 w-5 text-yellow-600" />
                <span className="text-sm font-medium text-yellow-600">Time Limit</span>
              </div>
              <p className="text-2xl font-bold text-yellow-900">{quiz.time_limit} min</p>
            </div>
          )}

          <div className="bg-green-50 rounded-lg p-4">
            <div className="flex items-center space-x-2">
              <User className="h-5 w-5 text-green-600" />
              <span className="text-sm font-medium text-green-600">Attempts</span>
            </div>
            <p className="text-2xl font-bold text-green-900">{quiz.attempts_allowed || '∞'}</p>
          </div>

          <div className="bg-purple-50 rounded-lg p-4">
            <div className="flex items-center space-x-2">
              <CheckCircle className="h-5 w-5 text-purple-600" />
              <span className="text-sm font-medium text-purple-600">Submissions</span>
            </div>
            <p className="text-2xl font-bold text-purple-900">{submissions.length}</p>
          </div>
        </div>
      </div>

      {/* Results Table */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">
            {isTeacherOrAdmin ? 'All Student Results' : 'Your Results'}
          </h2>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                {isTeacherOrAdmin && (
                  <>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Student
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Student Number
                    </th>
                  </>
                )}
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Attempt
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Score
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Percentage
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Status
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Submitted
                </th>
                {isTeacherOrAdmin && (
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Actions
                  </th>
                )}
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {submissions.map((submission) => (
                <tr key={submission.id} className="hover:bg-gray-50">
                  {isTeacherOrAdmin && (
                    <>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm font-medium text-gray-900">
                          {submission.first_name} {submission.last_name}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm text-gray-500">
                          {submission.student_number}
                        </div>
                      </td>
                    </>
                  )}
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                      #{submission.attempt_number}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    {editingGrade === submission.id ? (
                      <input
                        type="number"
                        min="0"
                        max={quiz.max_points}
                        value={newScore}
                        onChange={(e) => setNewScore(e.target.value)}
                        className="w-20 px-2 py-1 border border-gray-300 rounded-md text-sm"
                      />
                    ) : (
                      <div className="text-sm font-medium text-gray-900">
                        {submission.score || 0} / {quiz.max_points}
                      </div>
                    )}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center">
                      <div className={`text-sm font-medium ${
                        submission.percentage >= 80 ? 'text-green-600' :
                        submission.percentage >= 60 ? 'text-yellow-600' :
                        'text-red-600'
                      }`}>
                        {submission.percentage}%
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                      submission.status === 'graded' ? 'bg-green-100 text-green-800' :
                      submission.status === 'submitted' ? 'bg-yellow-100 text-yellow-800' :
                      'bg-gray-100 text-gray-800'
                    }`}>
                      {submission.status}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    <div className="flex items-center space-x-1">
                      <Calendar className="h-4 w-4" />
                      <span>{new Date(submission.submitted_at).toLocaleDateString()}</span>
                    </div>
                  </td>
                  {isTeacherOrAdmin && (
                    <td className="px-6 py-4 whitespace-nowrap text-sm">
                      {editingGrade === submission.id ? (
                        <div className="flex space-x-2">
                          <button
                            onClick={() => handleGradeEdit(submission.id)}
                            className="text-green-600 hover:text-green-900"
                          >
                            Save
                          </button>
                          <button
                            onClick={() => setEditingGrade(null)}
                            className="text-gray-600 hover:text-gray-900"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => startEditing(submission)}
                          className="text-blue-600 hover:text-blue-900"
                        >
                          Edit Grade
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>

          {submissions.length === 0 && (
            <div className="text-center py-8">
              <p className="text-gray-500">No submissions found</p>
            </div>
          )}
        </div>
      </div>

      {/* Feedback Section */}
      {editingGrade && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Add Feedback</h3>
          <textarea
            value={newFeedback}
            onChange={(e) => setNewFeedback(e.target.value)}
            placeholder="Enter feedback for the student..."
            className="w-full px-3 py-2 border border-gray-300 rounded-md resize-none"
            rows={4}
          />
        </div>
      )}
    </div>
  );
};

export default QuizResults;
