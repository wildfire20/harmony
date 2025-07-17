import React, { useState, useEffect } from 'react';
import { ArrowLeft, Clock, CheckCircle, AlertCircle } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import LoadingSpinner from '../common/LoadingSpinner';
import MathRenderer from '../common/MathRenderer';

const QuizTaker = ({ quiz, onBack, onComplete }) => {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [quizData, setQuizData] = useState(null);
  const [answers, setAnswers] = useState({});
  const [timeRemaining, setTimeRemaining] = useState(null);
  const [quizStartTime, setQuizStartTime] = useState(null);

  useEffect(() => {
    fetchQuizDetails();
  }, []);

  useEffect(() => {
    if (quizData && quizData.time_limit && !quizStartTime) {
      setQuizStartTime(Date.now());
      setTimeRemaining(quizData.time_limit * 60); // Convert minutes to seconds
    }
  }, [quizData, quizStartTime]);

  useEffect(() => {
    if (timeRemaining === null) return;

    const timer = setInterval(() => {
      setTimeRemaining(prev => {
        if (prev <= 1) {
          // Time's up! Auto-submit
          handleSubmitQuiz();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [timeRemaining]);

  const fetchQuizDetails = async () => {
    try {
      setLoading(true);
      const token = localStorage.getItem('token');
      
      const response = await fetch(`/api/quizzes/${quiz.task_id}`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Failed to fetch quiz details');
      }

      const data = await response.json();
      setQuizData(data.quiz);
      
      // Initialize answers object
      const initialAnswers = {};
      data.quiz.questions.forEach(q => {
        initialAnswers[q.id] = '';
      });
      setAnswers(initialAnswers);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleAnswerChange = (questionId, answer) => {
    setAnswers(prev => ({
      ...prev,
      [questionId]: answer
    }));
  };

  const handleSubmitQuiz = async () => {
    if (submitting) return;

    // Validate that all questions are answered
    const unansweredQuestions = quizData.questions.filter(q => !answers[q.id] || answers[q.id].trim() === '');
    if (unansweredQuestions.length > 0) {
      const proceed = window.confirm(
        `You have ${unansweredQuestions.length} unanswered question(s). Are you sure you want to submit?`
      );
      if (!proceed) return;
    }

    try {
      setSubmitting(true);
      const token = localStorage.getItem('token');
      
      // Calculate time taken
      const timeTaken = quizStartTime ? Math.floor((Date.now() - quizStartTime) / 1000) : null;
      
      // Format answers for submission
      const submissionAnswers = Object.entries(answers).map(([questionId, answer]) => ({
        question_id: parseInt(questionId),
        answer: answer
      }));

      const response = await fetch(`/api/quizzes/${quiz.task_id}/submit`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          answers: submissionAnswers,
          time_taken: timeTaken
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Failed to submit quiz');
      }

      const result = await response.json();
      
      // Show results or completion message
      alert(`Quiz submitted successfully! Score: ${result.submission.score}/${result.submission.max_score} (${result.submission.percentage}%)`);
      onComplete();
    } catch (err) {
      setError(err.message);
      setSubmitting(false);
    }
  };

  const formatTime = (seconds) => {
    if (seconds === null) return '';
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const getTimeColor = () => {
    if (timeRemaining === null) return 'text-gray-600';
    if (timeRemaining < 300) return 'text-red-600'; // Less than 5 minutes
    if (timeRemaining < 600) return 'text-yellow-600'; // Less than 10 minutes
    return 'text-green-600';
  };

  if (loading) {
    return <LoadingSpinner />;
  }

  if (error) {
    return (
      <div className="space-y-6">
        <div className="flex items-center space-x-3">
          <button onClick={onBack} className="p-2 hover:bg-gray-100 rounded-md">
            <ArrowLeft className="h-6 w-6" />
          </button>
          <h1 className="text-3xl font-bold text-gray-900">Quiz Error</h1>
        </div>
        <div className="bg-red-50 border border-red-200 rounded-md p-6">
          <div className="flex items-center space-x-2">
            <AlertCircle className="h-6 w-6 text-red-600" />
            <p className="text-red-800 font-medium">Error loading quiz</p>
          </div>
          <p className="text-red-700 mt-2">{error}</p>
          <button 
            onClick={onBack}
            className="mt-4 bg-red-600 text-white px-4 py-2 rounded-md hover:bg-red-700"
          >
            Go Back
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <button 
            onClick={onBack} 
            className="p-2 hover:bg-gray-100 rounded-md"
            disabled={submitting}
          >
            <ArrowLeft className="h-6 w-6" />
          </button>
          <div>
            <h1 className="text-3xl font-bold text-gray-900">{quizData.title}</h1>
            <p className="text-gray-600">{quizData.description}</p>
          </div>
        </div>
        
        {timeRemaining !== null && (
          <div className={`flex items-center space-x-2 font-mono text-lg ${getTimeColor()}`}>
            <Clock className="h-5 w-5" />
            <span>Time Remaining: {formatTime(timeRemaining)}</span>
          </div>
        )}
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-md p-4">
          <p className="text-red-800">{error}</p>
          <button 
            onClick={() => setError(null)} 
            className="text-red-600 underline mt-2"
          >
            Dismiss
          </button>
        </div>
      )}

      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-8">
        <div className="space-y-8">
          {quizData.questions.map((question, index) => (
            <div key={question.id} className="bg-white rounded-xl shadow-sm border-2 border-gray-100 hover:border-harmony-gold/30 transition-all duration-200">
              <div className="bg-gradient-to-r from-harmony-primary to-harmony-secondary p-4 rounded-t-xl">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-semibold text-white">
                    Question {index + 1}
                  </h3>
                  <span className="bg-white/20 backdrop-blur-sm text-white text-sm font-medium px-3 py-1.5 rounded-full border border-white/30">
                    {question.points} {question.points === 1 ? 'point' : 'points'}
                  </span>
                </div>
              </div>
              
              <div className="p-6">
                <div className="mb-6">
                  <div className="text-lg text-gray-900 leading-relaxed mb-4">
                    <MathRenderer 
                      math={question.question} 
                      className="question-text"
                    />
                  </div>
                </div>

                <div className="space-y-3">
                  {question.type === 'multiple_choice' && (
                    <div className="grid gap-3">
                      {question.options.map((option, optionIndex) => (
                        <label 
                          key={optionIndex} 
                          className={`flex items-center space-x-4 p-4 rounded-lg border-2 cursor-pointer transition-all duration-200 group ${
                            answers[question.id] === option 
                              ? 'border-harmony-gold bg-harmony-gold/5 shadow-sm' 
                              : 'border-gray-200 hover:border-harmony-gold/50 hover:bg-gray-50'
                          }`}
                        >
                          <div className="flex-shrink-0">
                            <input
                              type="radio"
                              name={`question_${question.id}`}
                              value={option}
                              checked={answers[question.id] === option}
                              onChange={(e) => handleAnswerChange(question.id, e.target.value)}
                              className="sr-only"
                              disabled={submitting}
                            />
                            <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all duration-200 ${
                              answers[question.id] === option 
                                ? 'border-harmony-gold bg-harmony-gold' 
                                : 'border-gray-300 group-hover:border-harmony-gold/50'
                            }`}>
                              {answers[question.id] === option && (
                                <div className="w-2 h-2 rounded-full bg-white"></div>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center space-x-3 flex-1">
                            <span className={`text-sm font-semibold px-2 py-1 rounded-md min-w-[28px] text-center ${
                              answers[question.id] === option 
                                ? 'bg-harmony-gold text-white' 
                                : 'bg-gray-100 text-gray-600 group-hover:bg-harmony-gold/10'
                            }`}>
                              {String.fromCharCode(65 + optionIndex)}
                            </span>
                            <div className="flex-1 text-gray-800">
                              <MathRenderer 
                                math={option} 
                                inline={true}
                                className="option-text"
                              />
                            </div>
                          </div>
                        </label>
                      ))}
                    </div>
                  )}

                  {question.type === 'true_false' && (
                    <div className="grid gap-3">
                      {['true', 'false'].map((value, valueIndex) => (
                        <label 
                          key={value}
                          className={`flex items-center space-x-4 p-4 rounded-lg border-2 cursor-pointer transition-all duration-200 group ${
                            answers[question.id] === value 
                              ? 'border-harmony-gold bg-harmony-gold/5 shadow-sm' 
                              : 'border-gray-200 hover:border-harmony-gold/50 hover:bg-gray-50'
                          }`}
                        >
                          <div className="flex-shrink-0">
                            <input
                              type="radio"
                              name={`question_${question.id}`}
                              value={value}
                              checked={answers[question.id] === value}
                              onChange={(e) => handleAnswerChange(question.id, e.target.value)}
                              className="sr-only"
                              disabled={submitting}
                            />
                            <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all duration-200 ${
                              answers[question.id] === value 
                                ? 'border-harmony-gold bg-harmony-gold' 
                                : 'border-gray-300 group-hover:border-harmony-gold/50'
                            }`}>
                              {answers[question.id] === value && (
                                <div className="w-2 h-2 rounded-full bg-white"></div>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center space-x-3 flex-1">
                            <span className={`text-sm font-semibold px-2 py-1 rounded-md min-w-[28px] text-center ${
                              answers[question.id] === value 
                                ? 'bg-harmony-gold text-white' 
                                : 'bg-gray-100 text-gray-600 group-hover:bg-harmony-gold/10'
                            }`}>
                              {String.fromCharCode(65 + valueIndex)}
                            </span>
                            <div className="flex-1 text-gray-800 capitalize font-medium">
                              {value}
                            </div>
                          </div>
                        </label>
                      ))}
                    </div>
                  )}

                  {question.type === 'short_answer' && (
                    <div className="space-y-3">
                      <label className="block text-sm font-medium text-gray-700">
                        Your Answer:
                      </label>
                      <div className="relative">
                        <textarea
                          value={answers[question.id] || ''}
                          onChange={(e) => handleAnswerChange(question.id, e.target.value)}
                          className="w-full border-2 border-gray-200 rounded-lg px-4 py-3 focus:ring-2 focus:ring-harmony-gold focus:border-harmony-gold transition-all duration-200 resize-none"
                          rows="4"
                          placeholder="Enter your answer here... (You can use LaTeX for math: $x^2 + y^2 = z^2$)"
                          disabled={submitting}
                        />
                        <div className="absolute bottom-2 right-2 text-xs text-gray-400">
                          LaTeX supported
                        </div>
                      </div>
                      {answers[question.id] && (
                        <div className="mt-2 p-3 bg-gray-50 rounded-lg border">
                          <div className="text-sm text-gray-600 mb-1">Preview:</div>
                          <MathRenderer 
                            math={answers[question.id]} 
                            className="answer-preview text-gray-800"
                          />
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Progress Bar */}
        <div className="mt-8 bg-gradient-to-r from-gray-50 to-white p-6 rounded-xl border-2 border-gray-100">
          <div className="space-y-4">
            <div className="space-y-2">
              <div className="text-sm font-medium text-gray-700">
                Progress: {Object.values(answers).filter(a => a && a.trim()).length} / {quizData.questions.length} questions answered
              </div>
              <div className="w-full bg-gray-200 rounded-full h-3">
                <div 
                  className="bg-gradient-to-r from-harmony-gold to-harmony-secondary h-3 rounded-full transition-all duration-300"
                  style={{ 
                    width: `${(Object.values(answers).filter(a => a && a.trim()).length / quizData.questions.length) * 100}%` 
                  }}
                ></div>
              </div>
            </div>
            
            {/* Submit Button */}
            <div className="flex justify-center pt-4">
              <button
                onClick={handleSubmitQuiz}
                disabled={submitting}
                className="bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white px-12 py-4 rounded-xl shadow-lg hover:shadow-xl transform hover:scale-105 transition-all duration-200 flex items-center space-x-3 disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none font-bold text-lg border-2 border-blue-800"
              >
                {submitting ? (
                  <>
                    <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-white"></div>
                    <span>Submitting Quiz...</span>
                  </>
                ) : (
                  <>
                    <CheckCircle className="h-6 w-6" />
                    <span>Submit Quiz</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Quiz Info */}
      <div className="bg-blue-50 border border-blue-200 rounded-md p-4">
        <h4 className="font-medium text-blue-900 mb-2">Quiz Information</h4>
        <div className="text-sm text-blue-800 space-y-1">
          <p>Total Points: {quizData.max_points}</p>
          <p>Questions: {quizData.questions.length}</p>
          {quizData.time_limit && <p>Time Limit: {quizData.time_limit} minutes</p>}
          {quizData.attempts_remaining && <p>Attempts Remaining: {quizData.attempts_remaining}</p>}
        </div>
      </div>
    </div>
  );
};

export default QuizTaker;
