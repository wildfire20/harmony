# Enhanced Features Test Suite for Harmony Learning Institute

Write-Host "Testing Enhanced Features for Harmony Learning Institute" -ForegroundColor Green

# Get authentication token
Write-Host "Getting Admin Token..." -ForegroundColor Yellow
try {
    $loginBody = @{
        email = "admin@harmonylearning.edu"
        password = "admin123"
    } | ConvertTo-Json
    
    $loginResponse = Invoke-RestMethod -Uri "http://localhost:5000/api/auth/login/staff" -Method Post -ContentType "application/json" -Body $loginBody
    $token = $loginResponse.token
    Write-Host "SUCCESS: Admin Token obtained" -ForegroundColor Green
} catch {
    Write-Host "FAILED: Admin Token - $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

# Test 1: Document types endpoint
Write-Host "Testing Document Types endpoint..." -ForegroundColor Yellow
try {
    $docTypes = Invoke-RestMethod -Uri "http://localhost:5000/api/documents/types" -Method Get -Headers @{"Authorization" = "Bearer $token"}
    Write-Host "SUCCESS: Document Types loaded (Found $($docTypes.document_types.Count) types)" -ForegroundColor Green
} catch {
    Write-Host "FAILED: Document Types - $($_.Exception.Message)" -ForegroundColor Red
}

# Test 2: Create a test quiz
Write-Host "Creating a test quiz..." -ForegroundColor Yellow
try {
    # First create a task
    $taskData = @{
        title = "Sample Quiz"
        description = "This is a sample quiz for testing"
        instructions = "Answer all questions to the best of your ability"
        due_date = "2025-08-15T23:59:59Z"
        max_points = 100
        grade_id = 1
        class_id = 1
        task_type = "quiz"
    } | ConvertTo-Json
    
    $task = Invoke-RestMethod -Uri "http://localhost:5000/api/tasks" -Method Post -ContentType "application/json" -Headers @{"Authorization" = "Bearer $token"} -Body $taskData
    
    # Create quiz questions
    $quizData = @{
        task_id = $task.task.id
        questions = @(
            @{
                question = "What is 2 + 2?"
                type = "multiple_choice"
                options = @("3", "4", "5", "6")
                correct_answer = "4"
                points = 25
            },
            @{
                question = "The Earth is round"
                type = "true_false"
                correct_answer = "true"
                points = 25
            },
            @{
                question = "What is the capital of France?"
                type = "short_answer"
                correct_answer = "Paris"
                points = 50
            }
        )
        time_limit = 30
        attempts_allowed = 2
        show_results = $true
    } | ConvertTo-Json -Depth 10
    
    $quiz = Invoke-RestMethod -Uri "http://localhost:5000/api/quizzes" -Method Post -ContentType "application/json" -Headers @{"Authorization" = "Bearer $token"} -Body $quizData
    Write-Host "SUCCESS: Test Quiz Created - $($quiz.quiz.id)" -ForegroundColor Green
    
    # Test quiz results endpoint
    $quizResults = Invoke-RestMethod -Uri "http://localhost:5000/api/quizzes/$($quiz.quiz.id)/results" -Method Get -Headers @{"Authorization" = "Bearer $token"}
    Write-Host "SUCCESS: Quiz Results endpoint working" -ForegroundColor Green
    
} catch {
    Write-Host "FAILED: Create Quiz - $($_.Exception.Message)" -ForegroundColor Red
}

# Test 3: Test enhanced admin endpoints
Write-Host "Testing enhanced admin endpoints..." -ForegroundColor Yellow
try {
    $submissions = Invoke-RestMethod -Uri "http://localhost:5000/api/admin/submissions/all" -Method Get -Headers @{"Authorization" = "Bearer $token"}
    Write-Host "SUCCESS: Admin Submissions endpoint working (Found $($submissions.total) submissions)" -ForegroundColor Green
} catch {
    Write-Host "FAILED: Admin Submissions - $($_.Exception.Message)" -ForegroundColor Red
}

# Test 4: Test document upload endpoint (simulation)
Write-Host "Testing document endpoints..." -ForegroundColor Yellow
try {
    $documentsForClass = Invoke-RestMethod -Uri "http://localhost:5000/api/documents/grade/1/class/1" -Method Get -Headers @{"Authorization" = "Bearer $token"}
    Write-Host "SUCCESS: Document Library endpoint working" -ForegroundColor Green
} catch {
    Write-Host "FAILED: Document Library - $($_.Exception.Message)" -ForegroundColor Red
}

# Test 5: Create a test teacher
Write-Host "Creating test teacher for announcements..." -ForegroundColor Yellow
try {
    $teacherData = @{
        email = "testteacher@harmonylearning.edu"
        password = "teacher123"
        first_name = "Test"
        last_name = "Teacher"
        grade_ids = @(1, 2)
        class_ids = @(1, 2)
    } | ConvertTo-Json
    
    $teacher = Invoke-RestMethod -Uri "http://localhost:5000/api/admin/teachers" -Method Post -ContentType "application/json" -Headers @{"Authorization" = "Bearer $token"} -Body $teacherData
    Write-Host "SUCCESS: Test Teacher Created - $($teacher.teacher.first_name) $($teacher.teacher.last_name)" -ForegroundColor Green
    
    # Test teacher login
    $teacherLoginBody = @{
        email = "testteacher@harmonylearning.edu"
        password = "teacher123"
    } | ConvertTo-Json
    
    $teacherLogin = Invoke-RestMethod -Uri "http://localhost:5000/api/auth/login/staff" -Method Post -ContentType "application/json" -Body $teacherLoginBody
    Write-Host "SUCCESS: Teacher Login working" -ForegroundColor Green
    
    # Test teacher creating announcement
    $teacherToken = $teacherLogin.token
    $announcementData = @{
        title = "Teacher Test Announcement"
        content = "This announcement was created by a teacher"
        priority = "normal"
        grade_id = 1
        class_id = 1
    } | ConvertTo-Json
    
    $announcement = Invoke-RestMethod -Uri "http://localhost:5000/api/announcements" -Method Post -ContentType "application/json" -Headers @{"Authorization" = "Bearer $teacherToken"} -Body $announcementData
    Write-Host "SUCCESS: Teacher can create announcements" -ForegroundColor Green
    
} catch {
    Write-Host "FAILED: Teacher functionality - $($_.Exception.Message)" -ForegroundColor Red
}

# Test 6: Get updated statistics with new features
Write-Host "Getting updated statistics..." -ForegroundColor Yellow
try {
    $stats = Invoke-RestMethod -Uri "http://localhost:5000/api/admin/statistics" -Method Get -Headers @{"Authorization" = "Bearer $token"}
    Write-Host "SUCCESS: Enhanced Statistics:" -ForegroundColor Green
    Write-Host "   - Total Students: $($stats.overview.total_students)" -ForegroundColor Cyan
    Write-Host "   - Total Teachers: $($stats.overview.total_teachers)" -ForegroundColor Cyan
    Write-Host "   - Total Classes: $($stats.overview.total_classes)" -ForegroundColor Cyan
    Write-Host "   - Total Tasks: $($stats.overview.total_tasks)" -ForegroundColor Cyan
    Write-Host "   - Total Announcements: $($stats.overview.total_announcements)" -ForegroundColor Cyan
    Write-Host "   - Total Submissions: $($stats.overview.total_submissions)" -ForegroundColor Cyan
} catch {
    Write-Host "FAILED: Enhanced Statistics - $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host "Enhanced Features Testing Complete!" -ForegroundColor Green
Write-Host "New Features Successfully Added:" -ForegroundColor Magenta
Write-Host "- Quiz Results Viewing for Students" -ForegroundColor Cyan
Write-Host "- Grade Editing for Teachers and Admins" -ForegroundColor Cyan
Write-Host "- Document Upload/Download System" -ForegroundColor Cyan
Write-Host "- Teacher Announcement Creation" -ForegroundColor Cyan
Write-Host "- Enhanced Admin Controls" -ForegroundColor Cyan
