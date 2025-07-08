# Simple Test Suite for Harmony Learning Institute API

Write-Host "Testing Harmony Learning Institute API" -ForegroundColor Green

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

# Test 1: Create a test student
Write-Host "Creating a test student..." -ForegroundColor Yellow
try {
    $studentData = @{
        student_number = "TEST001"
        first_name = "John"
        last_name = "Doe"
        grade_id = 1
        class_id = 1
        email = "john.doe@test.com"
    } | ConvertTo-Json
    
    $student = Invoke-RestMethod -Uri "http://localhost:5000/api/admin/students" -Method Post -ContentType "application/json" -Headers @{"Authorization" = "Bearer $token"} -Body $studentData
    Write-Host "SUCCESS: Test Student Created - $($student.student.first_name) $($student.student.last_name)" -ForegroundColor Green
} catch {
    Write-Host "FAILED: Create Student - $($_.Exception.Message)" -ForegroundColor Red
}

# Test 2: Test student login
Write-Host "Testing student login..." -ForegroundColor Yellow
try {
    $studentLoginBody = @{
        student_number = "TEST001"
        password = "TEST001"
    } | ConvertTo-Json
    
    $studentLogin = Invoke-RestMethod -Uri "http://localhost:5000/api/auth/login/student" -Method Post -ContentType "application/json" -Body $studentLoginBody
    Write-Host "SUCCESS: Student Login works" -ForegroundColor Green
} catch {
    Write-Host "FAILED: Student Login - $($_.Exception.Message)" -ForegroundColor Red
}

# Test 3: Create a test task
Write-Host "Creating a test task..." -ForegroundColor Yellow
try {
    $taskData = @{
        title = "Test Assignment"
        description = "This is a test assignment"
        instructions = "Complete this test assignment"
        due_date = "2025-08-01T23:59:59Z"
        max_points = 100
        grade_id = 1
        class_id = 1
        task_type = "assignment"
    } | ConvertTo-Json
    
    $task = Invoke-RestMethod -Uri "http://localhost:5000/api/tasks" -Method Post -ContentType "application/json" -Headers @{"Authorization" = "Bearer $token"} -Body $taskData
    Write-Host "SUCCESS: Test Task Created - $($task.task.title)" -ForegroundColor Green
} catch {
    Write-Host "FAILED: Create Task - $($_.Exception.Message)" -ForegroundColor Red
}

# Test 4: Create a test announcement
Write-Host "Creating a test announcement..." -ForegroundColor Yellow
try {
    $announcementData = @{
        title = "Test Announcement"
        content = "This is a test announcement for the class"
        priority = "normal"
        grade_id = 1
        class_id = 1
    } | ConvertTo-Json
    
    $announcement = Invoke-RestMethod -Uri "http://localhost:5000/api/announcements" -Method Post -ContentType "application/json" -Headers @{"Authorization" = "Bearer $token"} -Body $announcementData
    Write-Host "SUCCESS: Test Announcement Created - $($announcement.announcement.title)" -ForegroundColor Green
} catch {
    Write-Host "FAILED: Create Announcement - $($_.Exception.Message)" -ForegroundColor Red
}

# Test 5: Get updated statistics
Write-Host "Getting updated statistics..." -ForegroundColor Yellow
try {
    $stats = Invoke-RestMethod -Uri "http://localhost:5000/api/admin/statistics" -Method Get -Headers @{"Authorization" = "Bearer $token"}
    Write-Host "SUCCESS: Updated Statistics:" -ForegroundColor Green
    Write-Host "   - Total Students: $($stats.overview.total_students)" -ForegroundColor Cyan
    Write-Host "   - Total Teachers: $($stats.overview.total_teachers)" -ForegroundColor Cyan
    Write-Host "   - Total Classes: $($stats.overview.total_classes)" -ForegroundColor Cyan
    Write-Host "   - Total Tasks: $($stats.overview.total_tasks)" -ForegroundColor Cyan
    Write-Host "   - Total Announcements: $($stats.overview.total_announcements)" -ForegroundColor Cyan
} catch {
    Write-Host "FAILED: Get Statistics - $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host "API Testing Complete!" -ForegroundColor Green
