# Enhanced Quiz System Documentation

## Overview

The Harmony School Management System now includes a comprehensive quiz feature that allows teachers to create interactive quizzes with multiple question types, automatic grading, and detailed analytics. Students can take quizzes with time limits and multiple attempts, while teachers can track submissions and manually grade open-ended questions.

## Features

### For Teachers
- ✅ Create quizzes with multiple question types
- ✅ Set due dates, time limits, and attempt restrictions
- ✅ Auto-grading for multiple choice and true/false questions
- ✅ Manual grading interface for short answer questions
- ✅ Comprehensive analytics and reporting
- ✅ Track student submissions and identify non-submitters
- ✅ Edit quiz settings (before submissions)
- ✅ Question-level performance analysis

### For Students
- ✅ View assigned quizzes by grade/class
- ✅ Take quizzes with time tracking
- ✅ Multiple attempt support
- ✅ Immediate feedback (if enabled)
- ✅ View quiz history and scores

### For Admins
- ✅ Full access to all quizzes
- ✅ System-wide quiz analytics
- ✅ User management for quiz access

## API Endpoints

### Quiz Management

#### 1. Create Quiz
```http
POST /api/quizzes
Authorization: Bearer <teacher-token>
Content-Type: application/json

{
  "title": "Mathematics Quiz - Algebra Basics",
  "description": "Basic algebraic concepts",
  "due_date": "2025-07-20T23:59:59Z",
  "grade_id": 1,
  "class_id": 1,
  "time_limit": 45,
  "attempts_allowed": 2,
  "show_results": true,
  "randomize_questions": false,
  "questions": [
    {
      "question": "What is 2 + 2?",
      "type": "multiple_choice",
      "options": ["3", "4", "5", "6"],
      "correct_answer": "4",
      "points": 1,
      "explanation": "Basic addition"
    }
  ]
}
```

#### 2. Get All Quizzes
```http
GET /api/quizzes?grade_id=1&class_id=1&status=active
Authorization: Bearer <token>
```

#### 3. Get Quiz Details
```http
GET /api/quizzes/{taskId}
Authorization: Bearer <token>
```

#### 4. Update Quiz
```http
PUT /api/quizzes/{taskId}
Authorization: Bearer <teacher-token>
Content-Type: application/json

{
  "title": "Updated Quiz Title",
  "time_limit": 60,
  "attempts_allowed": 3
}
```

#### 5. Delete Quiz
```http
DELETE /api/quizzes/{taskId}
Authorization: Bearer <teacher-token>
```

### Quiz Taking

#### 6. Submit Quiz Answers
```http
POST /api/quizzes/{taskId}/submit
Authorization: Bearer <student-token>
Content-Type: application/json

{
  "answers": [
    {
      "question_id": 1,
      "answer": "4"
    },
    {
      "question_id": 2,
      "answer": "true"
    }
  ],
  "time_taken": 1800
}
```

### Results and Analytics

#### 7. Get Quiz Results (Teachers)
```http
GET /api/quizzes/{taskId}/results
Authorization: Bearer <teacher-token>
```

#### 8. Get Quiz Analytics
```http
GET /api/quizzes/{taskId}/analytics
Authorization: Bearer <teacher-token>
```

#### 9. Get Pending Manual Grades
```http
GET /api/quizzes/{taskId}/pending-grades
Authorization: Bearer <teacher-token>
```

#### 10. Manual Grading
```http
PUT /api/quizzes/{taskId}/submissions/{submissionId}/grade
Authorization: Bearer <teacher-token>
Content-Type: application/json

{
  "question_grades": [
    {
      "question_id": 3,
      "points_awarded": 2.5,
      "feedback": "Good answer but could be more detailed"
    }
  ],
  "overall_feedback": "Well done overall"
}
```

## Question Types

### 1. Multiple Choice
```json
{
  "question": "What is the capital of France?",
  "type": "multiple_choice",
  "options": ["London", "Berlin", "Paris", "Rome"],
  "correct_answer": "Paris",
  "points": 1,
  "explanation": "Paris is the capital and largest city of France"
}
```

### 2. True/False
```json
{
  "question": "The Earth is flat.",
  "type": "true_false",
  "correct_answer": "false",
  "points": 1,
  "explanation": "The Earth is an oblate spheroid"
}
```

### 3. Short Answer
```json
{
  "question": "Explain photosynthesis in plants.",
  "type": "short_answer",
  "correct_answer": "Process by which plants use sunlight to synthesize foods",
  "points": 5,
  "explanation": "Photosynthesis converts light energy into chemical energy"
}
```

## Database Schema

### Tables

#### quizzes
- `id` - Primary key
- `task_id` - Foreign key to tasks table
- `questions` - JSONB array of questions
- `time_limit` - Time limit in minutes
- `attempts_allowed` - Maximum attempts per student
- `show_results` - Whether to show results immediately
- `randomize_questions` - Whether to randomize question order
- `created_at`, `updated_at` - Timestamps

#### submissions
- `id` - Primary key
- `task_id` - Foreign key to tasks table
- `student_id` - Foreign key to users table
- `quiz_answers` - JSONB array of answers
- `score` - Student's score
- `max_score` - Maximum possible score
- `status` - Submission status
- `attempt_number` - Attempt number
- `time_taken` - Time taken in seconds
- `graded_by` - Teacher who graded (for manual grading)
- `submitted_at`, `graded_at` - Timestamps

### Views

#### quiz_overview
Comprehensive view of all quizzes with statistics:
```sql
SELECT * FROM quiz_overview WHERE grade_id = 1;
```

#### student_quiz_status
Individual student status for each quiz:
```sql
SELECT * FROM student_quiz_status WHERE student_id = 123;
```

## Usage Examples

### Creating a Basic Quiz

```javascript
const quizData = {
  title: "Weekly Math Quiz",
  description: "Basic arithmetic operations",
  due_date: "2025-07-15T23:59:59Z",
  grade_id: 1,
  class_id: 1,
  time_limit: 30,
  attempts_allowed: 2,
  questions: [
    {
      question: "What is 5 + 3?",
      type: "multiple_choice",
      options: ["6", "7", "8", "9"],
      correct_answer: "8",
      points: 1
    },
    {
      question: "Is 10 > 5?",
      type: "true_false",
      correct_answer: "true",
      points: 1
    }
  ]
};

// Create quiz
const response = await fetch('/api/quizzes', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer ' + teacherToken,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify(quizData)
});
```

### Taking a Quiz

```javascript
const answers = [
  { question_id: 1, answer: "8" },
  { question_id: 2, answer: "true" }
];

const submission = await fetch(`/api/quizzes/${taskId}/submit`, {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer ' + studentToken,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    answers: answers,
    time_taken: 900 // 15 minutes
  })
});
```

### Checking Results

```javascript
// Teacher gets all results
const results = await fetch(`/api/quizzes/${taskId}/results`, {
  headers: { 'Authorization': 'Bearer ' + teacherToken }
});

// Student gets their results
const myResults = await fetch(`/api/quizzes/${taskId}/results`, {
  headers: { 'Authorization': 'Bearer ' + studentToken }
});
```

## Best Practices

### For Teachers
1. **Clear Instructions**: Provide clear quiz descriptions and question text
2. **Appropriate Time Limits**: Set realistic time limits based on question complexity
3. **Balanced Point Distribution**: Assign points based on question difficulty
4. **Timely Grading**: Grade short answer questions promptly
5. **Use Analytics**: Review question performance to improve future quizzes

### For Students
1. **Time Management**: Monitor remaining time during quizzes
2. **Read Carefully**: Read questions and all options before answering
3. **Save Progress**: Submit answers as you go in case of technical issues
4. **Review Feedback**: Learn from explanations and teacher feedback

### For System Administrators
1. **Regular Backups**: Backup quiz data and submissions
2. **Monitor Performance**: Watch for slow queries on large datasets
3. **Archive Old Data**: Use the `archive_old_quizzes()` function for cleanup
4. **Security**: Ensure proper authentication and authorization

## Error Handling

### Common Error Responses

```json
// Validation Error
{
  "errors": [
    {
      "msg": "Question text is required",
      "param": "questions.0.question"
    }
  ]
}

// Access Denied
{
  "message": "Access denied to this grade/class"
}

// Quiz Not Found
{
  "message": "Quiz not found"
}

// Maximum Attempts Reached
{
  "message": "Maximum attempts reached",
  "attempts_used": 2,
  "max_attempts": 2
}
```

## Performance Considerations

1. **Indexing**: Proper indexes are created for common queries
2. **JSONB**: Questions and answers are stored efficiently in JSONB format
3. **Pagination**: Large result sets should be paginated
4. **Caching**: Consider caching frequently accessed quiz data
5. **Archival**: Old quizzes are automatically archived after 6 months

## Security Features

1. **JWT Authentication**: All endpoints require valid tokens
2. **Role-based Access**: Students can only access their quizzes
3. **Teacher Verification**: Teachers can only manage their assigned classes
4. **Input Validation**: All inputs are validated and sanitized
5. **SQL Injection Protection**: Parameterized queries prevent SQL injection

## Troubleshooting

### Common Issues

1. **Quiz Not Visible to Students**
   - Check grade_id and class_id match student's assignment
   - Verify due_date hasn't passed
   - Ensure task is active

2. **Submission Failed**
   - Check if maximum attempts reached
   - Verify quiz is still within deadline
   - Validate answer format

3. **Grading Issues**
   - For auto-grading: Check exact match of correct_answer
   - For manual grading: Ensure proper permissions
   - Verify points don't exceed maximum

### Monitoring Queries

```sql
-- Check quiz performance
SELECT 
    t.title,
    COUNT(s.id) as submissions,
    AVG(s.score) as avg_score
FROM tasks t
JOIN submissions s ON t.id = s.task_id
WHERE t.task_type = 'quiz'
GROUP BY t.id, t.title;

-- Find quizzes needing manual grading
SELECT 
    t.title,
    COUNT(*) as pending_count
FROM tasks t
JOIN submissions s ON t.id = s.task_id
WHERE s.status = 'pending_review'
GROUP BY t.id, t.title;
```

## Future Enhancements

- Question banks and templates
- Plagiarism detection for short answers
- Real-time quiz taking with live updates
- Advanced analytics with machine learning insights
- Integration with external assessment tools
- Mobile app optimization
- Offline quiz taking capability

For additional support or feature requests, please contact the development team.
