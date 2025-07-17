import React, { useState, useEffect } from 'react';
import { ArrowLeft, Plus, Trash2, Save, Eye, EyeOff } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import LoadingSpinner from '../common/LoadingSpinner';
import MathRenderer from '../common/MathRenderer';

const QuizCreator = ({ onBack, onSuccess }) => {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [grades, setGrades] = useState([]);
  const [classes, setClasses] = useState([]);
  const [showPreview, setShowPreview] = useState({});

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
        // Teachers: fetch only their assigned grades and classes
        const assignmentsResponse = await fetch(`/api/admin/teachers/${user.id}/assignments`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        const assignmentsData = await assignmentsResponse.json();
        
        if (assignmentsData.success && assignmentsData.assignments) {
          // Extract unique grades and classes from assignments
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
        // Admins: fetch all grades and classes
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
    
    // Validation
    if (!quizData.title || !quizData.due_date || !quizData.grade_id || !quizData.class_id) {
      setError('Please fill in all required fields');
      return;
    }

    // Validate questions
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
      
      // Clean up questions data
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

  return (
    <div className="space-y-6">
      <div className="flex items-center space-x-3">
        <button 
          onClick={onBack}
          className="p-2 hover:bg-gray-100 rounded-md"
        >
          <ArrowLeft className="h-6 w-6" />
        </button>
        <h1 className="text-3xl font-bold text-gray-900">Create New Quiz</h1>
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

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* LaTeX Help Guide */}
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-lg font-semibold text-blue-900">Math Formula Support</h3>
            <div className="text-sm text-blue-700">LaTeX Enabled ✨</div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
            <div>
              <h4 className="font-medium text-blue-800 mb-2">Common Math Symbols:</h4>
              <div className="space-y-1 text-blue-700 font-mono">
                <div>{'$x^2$ → x²'}</div>
                <div>{'$x_1$ → x₁'}</div>
                <div>{'$\\frac{a}{b}$ → fractions'}</div>
                <div>{'$\\sqrt{x}$ → square root'}</div>
              </div>
            </div>
            <div>
              <h4 className="font-medium text-blue-800 mb-2">Examples:</h4>
              <div className="space-y-1 text-blue-700 font-mono">
                <div>{'$ax^2 + bx + c = 0$'}</div>
                <div>{'$$x = \\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}$$'}</div>
                <div>{'$\\sin(x) + \\cos(x) = 1$'}</div>
                <div>{'$\\int_a^b f(x)dx$'}</div>
              </div>
            </div>
          </div>
        </div>

        {/* Basic Quiz Information */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h2 className="text-xl font-semibold mb-4">Quiz Information</h2>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Quiz Title *
              </label>
              <input
                type="text"
                value={quizData.title}
                onChange={(e) => setQuizData(prev => ({ ...prev, title: e.target.value }))}
                className="w-full border border-gray-300 rounded-md px-3 py-2"
                placeholder="Enter quiz title"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Due Date *
              </label>
              <input
                type="datetime-local"
                value={quizData.due_date}
                onChange={(e) => setQuizData(prev => ({ ...prev, due_date: e.target.value }))}
                className="w-full border border-gray-300 rounded-md px-3 py-2"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Grade *
              </label>
              <select
                value={quizData.grade_id}
                onChange={(e) => setQuizData(prev => ({ 
                  ...prev, 
                  grade_id: e.target.value,
                  class_id: '' // Reset class when grade changes
                }))}
                className="w-full border border-gray-300 rounded-md px-3 py-2"
                required
              >
                <option value="">Select Grade</option>
                {grades.map(grade => (
                  <option key={grade.id} value={grade.id}>{grade.name}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Class *
              </label>
              <select
                value={quizData.class_id}
                onChange={(e) => setQuizData(prev => ({ ...prev, class_id: e.target.value }))}
                className="w-full border border-gray-300 rounded-md px-3 py-2"
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
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Time Limit (minutes)
              </label>
              <input
                type="number"
                value={quizData.time_limit}
                onChange={(e) => setQuizData(prev => ({ ...prev, time_limit: e.target.value }))}
                className="w-full border border-gray-300 rounded-md px-3 py-2"
                placeholder="No limit"
                min="1"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Attempts Allowed
              </label>
              <input
                type="number"
                value={quizData.attempts_allowed}
                onChange={(e) => setQuizData(prev => ({ ...prev, attempts_allowed: parseInt(e.target.value) }))}
                className="w-full border border-gray-300 rounded-md px-3 py-2"
                min="1"
                required
              />
            </div>
          </div>

          <div className="mt-4">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Description
            </label>
            <textarea
              value={quizData.description}
              onChange={(e) => setQuizData(prev => ({ ...prev, description: e.target.value }))}
              className="w-full border border-gray-300 rounded-md px-3 py-2"
              rows="3"
              placeholder="Enter quiz description"
            />
          </div>

          <div className="mt-4 space-y-2">
            <div className="flex items-center">
              <input
                type="checkbox"
                id="show_results"
                checked={quizData.show_results}
                onChange={(e) => setQuizData(prev => ({ ...prev, show_results: e.target.checked }))}
                className="mr-2"
              />
              <label htmlFor="show_results" className="text-sm text-gray-700">
                Show results to students after submission
              </label>
            </div>

            <div className="flex items-center">
              <input
                type="checkbox"
                id="randomize_questions"
                checked={quizData.randomize_questions}
                onChange={(e) => setQuizData(prev => ({ ...prev, randomize_questions: e.target.checked }))}
                className="mr-2"
              />
              <label htmlFor="randomize_questions" className="text-sm text-gray-700">
                Randomize question order for each student
              </label>
            </div>
          </div>
        </div>

        {/* Questions */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold">Questions</h2>
            <button
              type="button"
              onClick={addQuestion}
              className="bg-harmony-gold text-white px-4 py-2 rounded-md hover:bg-opacity-90 flex items-center space-x-2"
            >
              <Plus className="h-4 w-4" />
              <span>Add Question</span>
            </button>
          </div>

          {quizData.questions.map((question, qIndex) => (
            <div key={qIndex} className="border border-gray-200 rounded-md p-4 mb-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-lg font-medium">Question {qIndex + 1}</h3>
                {quizData.questions.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeQuestion(qIndex)}
                    className="text-red-600 hover:bg-red-50 p-1 rounded"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>

              <div className="space-y-4">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="block text-sm font-medium text-gray-700">
                      Question Text *
                    </label>
                    <button
                      type="button"
                      onClick={() => setShowPreview(prev => ({ ...prev, [`q${qIndex}`]: !prev[`q${qIndex}`] }))}
                      className="text-sm text-harmony-gold hover:underline flex items-center space-x-1"
                    >
                      {showPreview[`q${qIndex}`] ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      <span>{showPreview[`q${qIndex}`] ? 'Hide Preview' : 'Show Preview'}</span>
                    </button>
                  </div>
                  <textarea
                    value={question.question}
                    onChange={(e) => updateQuestion(qIndex, 'question', e.target.value)}
                    className="w-full border border-gray-300 rounded-md px-3 py-2 font-mono text-sm"
                    rows="3"
                    placeholder="Enter your question (LaTeX supported: $x^2 + y^2 = z^2$, $$\\frac{a}{b} = c$$)"
                    required
                  />
                  <div className="text-xs text-gray-500 mt-1">
                    💡 Use LaTeX for math: $inline math$ or $$display math$$
                  </div>
                  {showPreview[`q${qIndex}`] && question.question && (
                    <div className="mt-3 p-3 bg-blue-50 border border-blue-200 rounded-md">
                      <div className="text-sm font-medium text-blue-800 mb-2">Preview:</div>
                      <div className="text-gray-900">
                        <MathRenderer math={question.question} />
                      </div>
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Question Type
                    </label>
                    <select
                      value={question.type}
                      onChange={(e) => updateQuestion(qIndex, 'type', e.target.value)}
                      className="w-full border border-gray-300 rounded-md px-3 py-2"
                    >
                      <option value="multiple_choice">Multiple Choice</option>
                      <option value="true_false">True/False</option>
                      <option value="short_answer">Short Answer</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Points
                    </label>
                    <input
                      type="number"
                      value={question.points}
                      onChange={(e) => updateQuestion(qIndex, 'points', parseInt(e.target.value))}
                      className="w-full border border-gray-300 rounded-md px-3 py-2"
                      min="1"
                      required
                    />
                  </div>
                </div>

                {/* Options for Multiple Choice */}
                {question.type === 'multiple_choice' && (
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <label className="block text-sm font-medium text-gray-700">
                        Answer Options *
                      </label>
                      <button
                        type="button"
                        onClick={() => addOption(qIndex)}
                        className="text-sm text-harmony-gold hover:underline"
                      >
                        Add Option
                      </button>
                    </div>
                    {question.options.map((option, oIndex) => (
                      <div key={oIndex} className="space-y-2">
                        <div className="flex items-center space-x-2">
                          <span className="text-sm font-medium text-gray-500 min-w-[24px]">
                            {String.fromCharCode(65 + oIndex)}:
                          </span>
                          <input
                            type="text"
                            value={option}
                            onChange={(e) => updateOption(qIndex, oIndex, e.target.value)}
                            className="flex-1 border border-gray-300 rounded-md px-3 py-2 font-mono text-sm"
                            placeholder={`Option ${oIndex + 1} (LaTeX supported: $x^2$)`}
                          />
                          {question.options.length > 2 && (
                            <button
                              type="button"
                              onClick={() => removeOption(qIndex, oIndex)}
                              className="text-red-600 hover:bg-red-50 p-1 rounded"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          )}
                        </div>
                        {option && showPreview[`q${qIndex}o${oIndex}`] && (
                          <div className="ml-8 p-2 bg-gray-50 border border-gray-200 rounded-md">
                            <div className="text-xs text-gray-600 mb-1">Preview:</div>
                            <MathRenderer math={option} inline={true} />
                          </div>
                        )}
                        {option && (
                          <button
                            type="button"
                            onClick={() => setShowPreview(prev => ({ ...prev, [`q${qIndex}o${oIndex}`]: !prev[`q${qIndex}o${oIndex}`] }))}
                            className="ml-8 text-xs text-harmony-gold hover:underline"
                          >
                            {showPreview[`q${qIndex}o${oIndex}`] ? 'Hide Preview' : 'Preview'}
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {/* Correct Answer */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Correct Answer *
                  </label>
                  {question.type === 'multiple_choice' ? (
                    <select
                      value={question.correct_answer}
                      onChange={(e) => updateQuestion(qIndex, 'correct_answer', e.target.value)}
                      className="w-full border border-gray-300 rounded-md px-3 py-2"
                      required
                    >
                      <option value="">Select correct answer</option>
                      {question.options.filter(opt => opt.trim()).map((option, oIndex) => (
                        <option key={oIndex} value={option}>{option}</option>
                      ))}
                    </select>
                  ) : question.type === 'true_false' ? (
                    <select
                      value={question.correct_answer}
                      onChange={(e) => updateQuestion(qIndex, 'correct_answer', e.target.value)}
                      className="w-full border border-gray-300 rounded-md px-3 py-2"
                      required
                    >
                      <option value="">Select correct answer</option>
                      <option value="true">True</option>
                      <option value="false">False</option>
                    </select>
                  ) : (
                    <div className="space-y-3">
                      <textarea
                        value={question.correct_answer}
                        onChange={(e) => updateQuestion(qIndex, 'correct_answer', e.target.value)}
                        className="w-full border border-gray-300 rounded-md px-3 py-2 font-mono text-sm"
                        rows="2"
                        placeholder="Enter the correct answer (LaTeX supported: $x = \\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}$)"
                        required
                      />
                      {question.correct_answer && showPreview[`q${qIndex}ans`] && (
                        <div className="p-3 bg-green-50 border border-green-200 rounded-md">
                          <div className="text-sm font-medium text-green-800 mb-2">Answer Preview:</div>
                          <MathRenderer math={question.correct_answer} />
                        </div>
                      )}
                      {question.correct_answer && (
                        <button
                          type="button"
                          onClick={() => setShowPreview(prev => ({ ...prev, [`q${qIndex}ans`]: !prev[`q${qIndex}ans`] }))}
                          className="text-sm text-harmony-gold hover:underline"
                        >
                          {showPreview[`q${qIndex}ans`] ? 'Hide Preview' : 'Preview Answer'}
                        </button>
                      )}
                    </div>
                  )}
                </div>

                {/* Explanation */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="block text-sm font-medium text-gray-700">
                      Explanation (Optional)
                    </label>
                    {question.explanation && (
                      <button
                        type="button"
                        onClick={() => setShowPreview(prev => ({ ...prev, [`q${qIndex}exp`]: !prev[`q${qIndex}exp`] }))}
                        className="text-sm text-harmony-gold hover:underline"
                      >
                        {showPreview[`q${qIndex}exp`] ? 'Hide Preview' : 'Preview Explanation'}
                      </button>
                    )}
                  </div>
                  <textarea
                    value={question.explanation}
                    onChange={(e) => updateQuestion(qIndex, 'explanation', e.target.value)}
                    className="w-full border border-gray-300 rounded-md px-3 py-2 font-mono text-sm"
                    rows="2"
                    placeholder="Explain why this is the correct answer (LaTeX supported)"
                  />
                  {question.explanation && showPreview[`q${qIndex}exp`] && (
                    <div className="mt-3 p-3 bg-yellow-50 border border-yellow-200 rounded-md">
                      <div className="text-sm font-medium text-yellow-800 mb-2">Explanation Preview:</div>
                      <MathRenderer math={question.explanation} />
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Submit Button */}
        <div className="flex justify-end space-x-3">
          <button
            type="button"
            onClick={onBack}
            className="px-6 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
            disabled={saving}
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className="bg-harmony-gold text-white px-6 py-2 rounded-md hover:bg-opacity-90 flex items-center space-x-2 disabled:opacity-50"
          >
            {saving ? (
              <>
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                <span>Creating...</span>
              </>
            ) : (
              <>
                <Save className="h-4 w-4" />
                <span>Create Quiz</span>
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
};

export default QuizCreator;
