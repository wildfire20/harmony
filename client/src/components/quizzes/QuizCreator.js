import React, { useState, useEffect } from 'react';
import { ArrowLeft, Plus, Trash2, Save, Eye, EyeOff, HelpCircle, Clock, BookOpen, Target, Sparkles, CheckCircle, X } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useTheme } from '../common/ThemeProvider';
import LoadingSpinner from '../common/LoadingSpinner';
import MathRenderer from '../common/MathRenderer';

const QuizCreator = ({ onBack, onSuccess }) => {
  const { user } = useAuth();
  const { theme } = useTheme();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [grades, setGrades] = useState([]);
  const [classes, setClasses] = useState([]);
  const [showPreview, setShowPreview] = useState({});
  const [showMathHelp, setShowMathHelp] = useState(false);

  const isDark = theme === 'dark';
  const cardBg = isDark ? 'bg-gray-900' : 'bg-white';
  const cardBorder = isDark ? 'border-gray-800' : 'border-gray-100';
  const textPrimary = isDark ? 'text-white' : 'text-gray-900';
  const textSecondary = isDark ? 'text-gray-400' : 'text-gray-600';
  const inputBg = isDark ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200';
  const inputFocus = 'focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500';

  const [quizData, setQuizData] = useState({
    title: '',
    description: '',
    due_date: '',
    grade_id: '',
    class_id: '',
    time_limit: '',
    attempts_allowed: 1,
    show_results: true,
    randomize_questions: false,
    questions: [
      {
        question: '',
        type: 'multiple_choice',
        options: ['', '', '', ''],
        correct_answer: '',
        points: 1,
        explanation: ''
      }
    ]
  });

  useEffect(() => {
    fetchGradesAndClasses();
  }, []);

  const fetchGradesAndClasses = async () => {
    try {
      setLoading(true);
      const token = localStorage.getItem('token');
      
      if (user.role === 'teacher') {
        const assignmentsResponse = await fetch(`/api/admin/teachers/${user.id}/assignments`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        const assignmentsData = await assignmentsResponse.json();
        
        if (assignmentsData.success && assignmentsData.assignments) {
          const uniqueGrades = {};
          const uniqueClasses = {};
          
          assignmentsData.assignments.forEach(assignment => {
            uniqueGrades[assignment.grade_id] = {
              id: assignment.grade_id,
              name: assignment.grade_name
            };
            uniqueClasses[assignment.class_id] = {
              id: assignment.class_id,
              name: assignment.class_name,
              grade_id: assignment.grade_id
            };
          });
          
          setGrades(Object.values(uniqueGrades));
          setClasses(Object.values(uniqueClasses));
        }
      } else {
        const [gradesResponse, classesResponse] = await Promise.all([
          fetch('/api/admin/grades', {
            headers: { 'Authorization': `Bearer ${token}` }
          }),
          fetch('/api/admin/classes', {
            headers: { 'Authorization': `Bearer ${token}` }
          })
        ]);
        
        const gradesData = await gradesResponse.json();
        const classesData = await classesResponse.json();
        
        setGrades(gradesData.grades || []);
        setClasses(classesData.classes || []);
      }
    } catch (err) {
      console.error('Failed to load grades and classes:', err);
      setError('Failed to load grades and classes');
    } finally {
      setLoading(false);
    }
  };

  const addQuestion = () => {
    setQuizData(prev => ({
      ...prev,
      questions: [
        ...prev.questions,
        {
          question: '',
          type: 'multiple_choice',
          options: ['', '', '', ''],
          correct_answer: '',
          points: 1,
          explanation: ''
        }
      ]
    }));
  };

  const removeQuestion = (index) => {
    if (quizData.questions.length > 1) {
      setQuizData(prev => ({
        ...prev,
        questions: prev.questions.filter((_, i) => i !== index)
      }));
    }
  };

  const updateQuestion = (index, field, value) => {
    setQuizData(prev => ({
      ...prev,
      questions: prev.questions.map((q, i) => 
        i === index ? { ...q, [field]: value } : q
      )
    }));
  };

  const updateOption = (questionIndex, optionIndex, value) => {
    setQuizData(prev => ({
      ...prev,
      questions: prev.questions.map((q, i) => 
        i === questionIndex 
          ? { ...q, options: q.options.map((opt, oi) => oi === optionIndex ? value : opt) }
          : q
      )
    }));
  };

  const addOption = (questionIndex) => {
    setQuizData(prev => ({
      ...prev,
      questions: prev.questions.map((q, i) => 
        i === questionIndex 
          ? { ...q, options: [...q.options, ''] }
          : q
      )
    }));
  };

  const removeOption = (questionIndex, optionIndex) => {
    const question = quizData.questions[questionIndex];
    if (question.options.length > 2) {
      setQuizData(prev => ({
        ...prev,
        questions: prev.questions.map((q, i) => 
          i === questionIndex 
            ? { ...q, options: q.options.filter((_, oi) => oi !== optionIndex) }
            : q
        )
      }));
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!quizData.title || !quizData.due_date || !quizData.grade_id || !quizData.class_id) {
      setError('Please fill in all required fields');
      return;
    }

    for (let i = 0; i < quizData.questions.length; i++) {
      const q = quizData.questions[i];
      if (!q.question) {
        setError(`Question ${i + 1}: Question text is required`);
        return;
      }
      if (!q.correct_answer) {
        setError(`Question ${i + 1}: Correct answer is required`);
        return;
      }
      if (q.type === 'multiple_choice') {
        const validOptions = q.options.filter(opt => opt.trim());
        if (validOptions.length < 2) {
          setError(`Question ${i + 1}: At least 2 options are required for multiple choice`);
          return;
        }
        if (!validOptions.includes(q.correct_answer)) {
          setError(`Question ${i + 1}: Correct answer must be one of the options`);
          return;
        }
      }
    }

    try {
      setSaving(true);
      const token = localStorage.getItem('token');
      
      const cleanedQuestions = quizData.questions.map(q => ({
        ...q,
        options: q.type === 'multiple_choice' ? q.options.filter(opt => opt.trim()) : []
      }));

      const response = await fetch('/api/quizzes', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          ...quizData,
          questions: cleanedQuestions,
          grade_id: parseInt(quizData.grade_id),
          class_id: parseInt(quizData.class_id),
          time_limit: quizData.time_limit ? parseInt(quizData.time_limit) : null
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Failed to create quiz');
      }

      onSuccess();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <LoadingSpinner />;
  }

  const totalPoints = quizData.questions.reduce((sum, q) => sum + (parseInt(q.points) || 0), 0);

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button 
            onClick={onBack}
            className={`p-2.5 rounded-xl ${isDark ? 'hover:bg-gray-800' : 'hover:bg-gray-100'} transition-colors`}
          >
            <ArrowLeft className={`h-5 w-5 ${textSecondary}`} />
          </button>
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-gradient-to-br from-amber-500 to-orange-500 rounded-xl shadow-lg shadow-amber-500/25">
              <BookOpen className="h-6 w-6 text-white" />
            </div>
            <div>
              <h1 className={`text-2xl font-bold ${textPrimary}`}>Create New Quiz</h1>
              <p className={`text-sm ${textSecondary}`}>Build an interactive assessment for your students</p>
            </div>
          </div>
        </div>
        <div className={`flex items-center gap-2 px-4 py-2 rounded-xl ${isDark ? 'bg-gray-800' : 'bg-gray-50'}`}>
          <Target className="h-4 w-4 text-emerald-500" />
          <span className={`text-sm font-medium ${textSecondary}`}>Total: {totalPoints} points</span>
        </div>
      </div>

      {/* Error Alert */}
      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-2xl p-4 flex items-start gap-3">
          <div className="p-1 bg-red-100 dark:bg-red-900/50 rounded-lg">
            <X className="h-4 w-4 text-red-600" />
          </div>
          <div className="flex-1">
            <p className="text-red-800 dark:text-red-200 font-medium">{error}</p>
          </div>
          <button 
            onClick={() => setError(null)} 
            className="text-red-600 hover:text-red-800 text-sm font-medium"
          >
            Dismiss
          </button>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Math Formula Help - Collapsible */}
        <div className={`${cardBg} rounded-2xl shadow-sm border ${cardBorder} overflow-hidden`}>
          <button
            type="button"
            onClick={() => setShowMathHelp(!showMathHelp)}
            className={`w-full flex items-center justify-between p-4 ${isDark ? 'hover:bg-gray-800' : 'hover:bg-gray-50'} transition-colors`}
          >
            <div className="flex items-center gap-3">
              <div className="p-2 bg-gradient-to-br from-violet-500 to-purple-500 rounded-lg">
                <Sparkles className="h-4 w-4 text-white" />
              </div>
              <div className="text-left">
                <span className={`font-semibold ${textPrimary}`}>Math Formula Support</span>
                <span className={`text-sm ${textSecondary} ml-2`}>LaTeX enabled for mathematical expressions</span>
              </div>
            </div>
            <HelpCircle className={`h-5 w-5 ${textSecondary}`} />
          </button>
          
          {showMathHelp && (
            <div className={`px-4 pb-4 border-t ${cardBorder}`}>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4">
                <div>
                  <h4 className={`font-medium ${textPrimary} mb-3 text-sm`}>Common Math Symbols</h4>
                  <div className={`space-y-2 ${textSecondary} text-sm font-mono`}>
                    <div className={`p-2 rounded-lg ${isDark ? 'bg-gray-800' : 'bg-gray-50'}`}>{'$x^2$ → x²'}</div>
                    <div className={`p-2 rounded-lg ${isDark ? 'bg-gray-800' : 'bg-gray-50'}`}>{'$x_1$ → x₁'}</div>
                    <div className={`p-2 rounded-lg ${isDark ? 'bg-gray-800' : 'bg-gray-50'}`}>{'$\\frac{a}{b}$ → fractions'}</div>
                    <div className={`p-2 rounded-lg ${isDark ? 'bg-gray-800' : 'bg-gray-50'}`}>{'$\\sqrt{x}$ → square root'}</div>
                  </div>
                </div>
                <div>
                  <h4 className={`font-medium ${textPrimary} mb-3 text-sm`}>Example Expressions</h4>
                  <div className={`space-y-2 ${textSecondary} text-sm font-mono`}>
                    <div className={`p-2 rounded-lg ${isDark ? 'bg-gray-800' : 'bg-gray-50'}`}>{'$ax^2 + bx + c = 0$'}</div>
                    <div className={`p-2 rounded-lg ${isDark ? 'bg-gray-800' : 'bg-gray-50'}`}>{'$$x = \\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}$$'}</div>
                    <div className={`p-2 rounded-lg ${isDark ? 'bg-gray-800' : 'bg-gray-50'}`}>{'$\\sin(x) + \\cos(x) = 1$'}</div>
                    <div className={`p-2 rounded-lg ${isDark ? 'bg-gray-800' : 'bg-gray-50'}`}>{'$\\int_a^b f(x)dx$'}</div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Quiz Information */}
        <div className={`${cardBg} rounded-2xl shadow-sm border ${cardBorder} overflow-hidden`}>
          <div className={`px-6 py-4 border-b ${cardBorder} flex items-center gap-3`}>
            <div className="p-2 bg-gradient-to-br from-blue-500 to-cyan-500 rounded-lg">
              <BookOpen className="h-4 w-4 text-white" />
            </div>
            <h2 className={`text-lg font-semibold ${textPrimary}`}>Quiz Information</h2>
          </div>
          
          <div className="p-6 space-y-5">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <div>
                <label className={`block text-sm font-medium ${textSecondary} mb-2`}>
                  Quiz Title <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={quizData.title}
                  onChange={(e) => setQuizData(prev => ({ ...prev, title: e.target.value }))}
                  className={`w-full ${inputBg} border rounded-xl px-4 py-3 ${inputFocus} ${textPrimary} transition-all`}
                  placeholder="e.g., Chapter 5 Math Quiz"
                  required
                />
              </div>

              <div>
                <label className={`block text-sm font-medium ${textSecondary} mb-2`}>
                  Due Date <span className="text-red-500">*</span>
                </label>
                <input
                  type="datetime-local"
                  value={quizData.due_date}
                  onChange={(e) => setQuizData(prev => ({ ...prev, due_date: e.target.value }))}
                  className={`w-full ${inputBg} border rounded-xl px-4 py-3 ${inputFocus} ${textPrimary} transition-all`}
                  required
                />
              </div>

              <div>
                <label className={`block text-sm font-medium ${textSecondary} mb-2`}>
                  Grade <span className="text-red-500">*</span>
                </label>
                <select
                  value={quizData.grade_id}
                  onChange={(e) => setQuizData(prev => ({ 
                    ...prev, 
                    grade_id: e.target.value,
                    class_id: ''
                  }))}
                  className={`w-full ${inputBg} border rounded-xl px-4 py-3 ${inputFocus} ${textPrimary} transition-all`}
                  required
                >
                  <option value="">Select Grade</option>
                  {grades.map(grade => (
                    <option key={grade.id} value={grade.id}>{grade.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className={`block text-sm font-medium ${textSecondary} mb-2`}>
                  Class <span className="text-red-500">*</span>
                </label>
                <select
                  value={quizData.class_id}
                  onChange={(e) => setQuizData(prev => ({ ...prev, class_id: e.target.value }))}
                  className={`w-full ${inputBg} border rounded-xl px-4 py-3 ${inputFocus} ${textPrimary} transition-all`}
                  required
                  disabled={!quizData.grade_id}
                >
                  <option value="">Select Class</option>
                  {classes
                    .filter(cls => !quizData.grade_id || cls.grade_id == quizData.grade_id)
                    .map(cls => (
                      <option key={cls.id} value={cls.id}>{cls.name}</option>
                    ))}
                </select>
              </div>

              <div>
                <label className={`block text-sm font-medium ${textSecondary} mb-2`}>
                  <Clock className="h-4 w-4 inline mr-1" />
                  Time Limit (minutes)
                </label>
                <input
                  type="number"
                  value={quizData.time_limit}
                  onChange={(e) => setQuizData(prev => ({ ...prev, time_limit: e.target.value }))}
                  className={`w-full ${inputBg} border rounded-xl px-4 py-3 ${inputFocus} ${textPrimary} transition-all`}
                  placeholder="No limit"
                  min="1"
                />
              </div>

              <div>
                <label className={`block text-sm font-medium ${textSecondary} mb-2`}>
                  Attempts Allowed
                </label>
                <input
                  type="number"
                  value={quizData.attempts_allowed}
                  onChange={(e) => setQuizData(prev => ({ ...prev, attempts_allowed: parseInt(e.target.value) }))}
                  className={`w-full ${inputBg} border rounded-xl px-4 py-3 ${inputFocus} ${textPrimary} transition-all`}
                  min="1"
                  required
                />
              </div>
            </div>

            <div>
              <label className={`block text-sm font-medium ${textSecondary} mb-2`}>
                Description (optional)
              </label>
              <textarea
                value={quizData.description}
                onChange={(e) => setQuizData(prev => ({ ...prev, description: e.target.value }))}
                className={`w-full ${inputBg} border rounded-xl px-4 py-3 ${inputFocus} ${textPrimary} transition-all resize-none`}
                rows="3"
                placeholder="Add instructions or details about this quiz..."
              />
            </div>

            {/* Quiz Options */}
            <div className={`flex flex-wrap gap-6 p-4 rounded-xl ${isDark ? 'bg-gray-800' : 'bg-gray-50'}`}>
              <label className="flex items-center gap-3 cursor-pointer">
                <div className="relative">
                  <input
                    type="checkbox"
                    id="show_results"
                    checked={quizData.show_results}
                    onChange={(e) => setQuizData(prev => ({ ...prev, show_results: e.target.checked }))}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-gray-300 peer-focus:ring-2 peer-focus:ring-emerald-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-500"></div>
                </div>
                <span className={`text-sm ${textSecondary}`}>Show results after submission</span>
              </label>

              <label className="flex items-center gap-3 cursor-pointer">
                <div className="relative">
                  <input
                    type="checkbox"
                    id="randomize_questions"
                    checked={quizData.randomize_questions}
                    onChange={(e) => setQuizData(prev => ({ ...prev, randomize_questions: e.target.checked }))}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-gray-300 peer-focus:ring-2 peer-focus:ring-emerald-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-500"></div>
                </div>
                <span className={`text-sm ${textSecondary}`}>Randomize question order</span>
              </label>
            </div>
          </div>
        </div>

        {/* Questions Section */}
        <div className={`${cardBg} rounded-2xl shadow-sm border ${cardBorder} overflow-hidden`}>
          <div className={`px-6 py-4 border-b ${cardBorder} flex items-center justify-between`}>
            <div className="flex items-center gap-3">
              <div className="p-2 bg-gradient-to-br from-emerald-500 to-teal-500 rounded-lg">
                <HelpCircle className="h-4 w-4 text-white" />
              </div>
              <div>
                <h2 className={`text-lg font-semibold ${textPrimary}`}>Questions</h2>
                <span className={`text-sm ${textSecondary}`}>{quizData.questions.length} question{quizData.questions.length !== 1 ? 's' : ''}</span>
              </div>
            </div>
            <button
              type="button"
              onClick={addQuestion}
              className="flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-emerald-500 to-teal-500 text-white rounded-xl font-medium hover:shadow-lg hover:shadow-emerald-500/25 transition-all"
            >
              <Plus className="h-4 w-4" />
              Add Question
            </button>
          </div>

          <div className="p-6 space-y-6">
            {quizData.questions.map((question, qIndex) => (
              <div 
                key={qIndex} 
                className={`rounded-2xl border-2 ${cardBorder} overflow-hidden ${isDark ? 'bg-gray-800/50' : 'bg-gray-50/50'}`}
              >
                {/* Question Header */}
                <div className={`px-5 py-4 ${isDark ? 'bg-gray-800' : 'bg-white'} flex items-center justify-between`}>
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-emerald-500 to-teal-500 flex items-center justify-center">
                      <span className="text-white font-bold text-sm">{qIndex + 1}</span>
                    </div>
                    <select
                      value={question.type}
                      onChange={(e) => updateQuestion(qIndex, 'type', e.target.value)}
                      className={`${inputBg} border rounded-lg px-3 py-1.5 text-sm ${textPrimary}`}
                    >
                      <option value="multiple_choice">Multiple Choice</option>
                      <option value="true_false">True/False</option>
                      <option value="short_answer">Short Answer</option>
                    </select>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        value={question.points}
                        onChange={(e) => updateQuestion(qIndex, 'points', parseInt(e.target.value) || 1)}
                        className={`w-16 ${inputBg} border rounded-lg px-2 py-1.5 text-sm text-center ${textPrimary}`}
                        min="1"
                      />
                      <span className={`text-sm ${textSecondary}`}>pts</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setShowPreview(prev => ({ ...prev, [qIndex]: !prev[qIndex] }))}
                      className={`p-2 rounded-lg ${isDark ? 'hover:bg-gray-700' : 'hover:bg-gray-100'} transition-colors`}
                    >
                      {showPreview[qIndex] ? <EyeOff className="h-4 w-4 text-gray-500" /> : <Eye className="h-4 w-4 text-gray-500" />}
                    </button>
                    {quizData.questions.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeQuestion(qIndex)}
                        className="p-2 rounded-lg text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </div>

                {/* Question Content */}
                <div className="p-5 space-y-4">
                  <div>
                    <label className={`block text-sm font-medium ${textSecondary} mb-2`}>Question Text</label>
                    <textarea
                      value={question.question}
                      onChange={(e) => updateQuestion(qIndex, 'question', e.target.value)}
                      className={`w-full ${inputBg} border rounded-xl px-4 py-3 ${inputFocus} ${textPrimary} transition-all resize-none`}
                      rows="2"
                      placeholder="Enter your question here... (supports LaTeX math)"
                      required
                    />
                    {showPreview[qIndex] && question.question && (
                      <div className={`mt-2 p-3 rounded-lg ${isDark ? 'bg-gray-900' : 'bg-white'} border ${cardBorder}`}>
                        <span className={`text-xs ${textSecondary} block mb-1`}>Preview:</span>
                        <MathRenderer content={question.question} />
                      </div>
                    )}
                  </div>

                  {/* Multiple Choice Options */}
                  {question.type === 'multiple_choice' && (
                    <div className="space-y-3">
                      <label className={`block text-sm font-medium ${textSecondary}`}>Answer Options</label>
                      {question.options.map((option, oIndex) => (
                        <div key={oIndex} className="flex items-center gap-3">
                          <button
                            type="button"
                            onClick={() => updateQuestion(qIndex, 'correct_answer', option)}
                            className={`w-8 h-8 rounded-full border-2 flex items-center justify-center transition-all ${
                              option && question.correct_answer === option 
                                ? 'bg-emerald-500 border-emerald-500 text-white' 
                                : `${isDark ? 'border-gray-600 hover:border-emerald-500' : 'border-gray-300 hover:border-emerald-500'}`
                            }`}
                          >
                            {option && question.correct_answer === option && <CheckCircle className="h-4 w-4" />}
                          </button>
                          <input
                            type="text"
                            value={option}
                            onChange={(e) => updateOption(qIndex, oIndex, e.target.value)}
                            className={`flex-1 ${inputBg} border rounded-xl px-4 py-2.5 ${inputFocus} ${textPrimary} transition-all`}
                            placeholder={`Option ${String.fromCharCode(65 + oIndex)}`}
                          />
                          {question.options.length > 2 && (
                            <button
                              type="button"
                              onClick={() => removeOption(qIndex, oIndex)}
                              className="p-2 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
                            >
                              <X className="h-4 w-4" />
                            </button>
                          )}
                        </div>
                      ))}
                      <button
                        type="button"
                        onClick={() => addOption(qIndex)}
                        className={`flex items-center gap-2 px-4 py-2 text-sm font-medium text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 rounded-xl transition-colors`}
                      >
                        <Plus className="h-4 w-4" />
                        Add Option
                      </button>
                    </div>
                  )}

                  {/* True/False */}
                  {question.type === 'true_false' && (
                    <div className="flex gap-4">
                      {['True', 'False'].map(val => (
                        <button
                          key={val}
                          type="button"
                          onClick={() => updateQuestion(qIndex, 'correct_answer', val)}
                          className={`flex-1 py-3 px-6 rounded-xl font-medium transition-all ${
                            question.correct_answer === val
                              ? 'bg-emerald-500 text-white shadow-lg shadow-emerald-500/25'
                              : `${isDark ? 'bg-gray-800 hover:bg-gray-700' : 'bg-white hover:bg-gray-50'} border ${cardBorder} ${textPrimary}`
                          }`}
                        >
                          {val}
                        </button>
                      ))}
                    </div>
                  )}

                  {/* Short Answer */}
                  {question.type === 'short_answer' && (
                    <div>
                      <label className={`block text-sm font-medium ${textSecondary} mb-2`}>Correct Answer</label>
                      <input
                        type="text"
                        value={question.correct_answer}
                        onChange={(e) => updateQuestion(qIndex, 'correct_answer', e.target.value)}
                        className={`w-full ${inputBg} border rounded-xl px-4 py-3 ${inputFocus} ${textPrimary} transition-all`}
                        placeholder="Enter the correct answer"
                        required
                      />
                    </div>
                  )}

                  {/* Explanation */}
                  <div>
                    <label className={`block text-sm font-medium ${textSecondary} mb-2`}>Explanation (shown after submission)</label>
                    <textarea
                      value={question.explanation}
                      onChange={(e) => updateQuestion(qIndex, 'explanation', e.target.value)}
                      className={`w-full ${inputBg} border rounded-xl px-4 py-3 ${inputFocus} ${textPrimary} transition-all resize-none`}
                      rows="2"
                      placeholder="Explain why this answer is correct..."
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Submit Button */}
        <div className="flex justify-end gap-4">
          <button
            type="button"
            onClick={onBack}
            className={`px-6 py-3 rounded-xl font-medium ${isDark ? 'bg-gray-800 hover:bg-gray-700' : 'bg-gray-100 hover:bg-gray-200'} ${textPrimary} transition-all`}
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className="flex items-center gap-2 px-8 py-3 bg-gradient-to-r from-emerald-500 to-teal-500 text-white rounded-xl font-medium hover:shadow-lg hover:shadow-emerald-500/25 transition-all disabled:opacity-50"
          >
            {saving ? (
              <>
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Creating Quiz...
              </>
            ) : (
              <>
                <Save className="h-4 w-4" />
                Create Quiz
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
};

export default QuizCreator;
