import React from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from 'react-query';
import { quizzesAPI } from '../../services/api';
import LoadingSpinner from '../common/LoadingSpinner';

const QuizPlayer = () => {
  const { taskId } = useParams();
  
  const { data: quizData, isLoading } = useQuery(
    ['quiz', taskId],
    () => quizzesAPI.getQuiz(taskId),
    { enabled: !!taskId }
  );

  const quiz = quizData?.data?.quiz;

  if (isLoading) {
    return <LoadingSpinner />;
  }

  if (!quiz) {
    return <div>Quiz not found</div>;
  }

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <h1 className="text-3xl font-bold text-gray-900 mb-4">{quiz.title}</h1>
        <p className="text-gray-600 mb-6">{quiz.description}</p>
        
        <div className="space-y-6">
          {quiz.questions?.map((question, index) => (
            <div key={question.id} className="border-l-4 border-blue-400 pl-4">
              <h3 className="text-lg font-medium text-gray-900 mb-3">
                {index + 1}. {question.question}
              </h3>
              {question.type === 'multiple_choice' && (
                <div className="space-y-2">
                  {question.options?.map((option, optIndex) => (
                    <label key={optIndex} className="flex items-center">
                      <input
                        type="radio"
                        name={`question-${question.id}`}
                        value={option}
                        className="mr-2"
                      />
                      {option}
                    </label>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
        
        <div className="mt-8">
          <button className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500">
            Submit Quiz
          </button>
        </div>
      </div>
    </div>
  );
};

export default QuizPlayer;
