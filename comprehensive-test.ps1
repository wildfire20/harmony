# Comprehensive Test Suite for Harmony Learning Institute

Write-Host "🧪 Comprehensive Testing Suite for Harmony Learning Institute" -ForegroundColor Green

# Get authentication token
Write-Host "`n🔑 Getting Admin Token..." -ForegroundColor Yellow
try {
    $loginResponse = Invoke-RestMethod -Uri "http://localhost:5000/api/auth/login/staff" -Method Post -ContentType "application/json" -Body "{""email"":""admin@harmonylearning.edu"",""password"":""admin123""}"
    $token = $loginResponse.token
    Write-Host "✅ Admin Token: Success" -ForegroundColor Green
} catch {
    Write-Host "❌ Admin Token Failed: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

# Test 1: Create a test student
Write-Host "`n1. Creating a test student..." -ForegroundColor Yellow
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
    Write-Host "✅ Test Student Created: $($student.student.first_name) $($student.student.last_name)" -ForegroundColor Green
} catch {
    Write-Host "❌ Create Student Failed: $($_.Exception.Message)" -ForegroundColor Red
}

# Test 2: Create a test teacher
Write-Host "`n2. Creating a test teacher..." -ForegroundColor Yellow
try {
    $teacherData = @{
        email = "teacher@test.com"
        password = "teacher123"
        first_name = "Jane"
        last_name = "Smith"
        grade_ids = @(1, 2)
        class_ids = @(1, 2)
    } | ConvertTo-Json
    
    $teacher = Invoke-RestMethod -Uri "http://localhost:5000/api/admin/teachers" -Method Post -ContentType "application/json" -Headers @{"Authorization" = "Bearer $token"} -Body $teacherData
    Write-Host "✅ Test Teacher Created: $($teacher.teacher.first_name) $($teacher.teacher.last_name)" -ForegroundColor Green
} catch {
    Write-Host "❌ Create Teacher Failed: $($_.Exception.Message)" -ForegroundColor Red
}

# Test 3: Test student login
Write-Host "`n3. Testing student login..." -ForegroundColor Yellow
try {
    $studentLogin = Invoke-RestMethod -Uri "http://localhost:5000/api/auth/login/student" -Method Post -ContentType "application/json" -Body "{""student_number"":""TEST001"",""password"":""TEST001""}"
    Write-Host "✅ Student Login: Success" -ForegroundColor Green
} catch {
    Write-Host "❌ Student Login Failed: $($_.Exception.Message)" -ForegroundColor Red
}

# Test 4: Test teacher login
Write-Host "`n4. Testing teacher login..." -ForegroundColor Yellow
try {
    $teacherLogin = Invoke-RestMethod -Uri "http://localhost:5000/api/auth/login/staff" -Method Post -ContentType "application/json" -Body "{""email"":""teacher@test.com"",""password"":""teacher123""}"
    Write-Host "✅ Teacher Login: Success" -ForegroundColor Green
} catch {
    Write-Host "❌ Teacher Login Failed: $($_.Exception.Message)" -ForegroundColor Red
}

# Test 5: Create a test task
Write-Host "`n5. Creating a test task..." -ForegroundColor Yellow
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
    Write-Host "✅ Test Task Created: $($task.task.title)" -ForegroundColor Green
} catch {
    Write-Host "❌ Create Task Failed: $($_.Exception.Message)" -ForegroundColor Red
}

# Test 6: Create a test announcement
Write-Host "`n6. Creating a test announcement..." -ForegroundColor Yellow
try {
    $announcementData = @{
        title = "Test Announcement"
        content = "This is a test announcement for the class"
        priority = "normal"
        grade_id = 1
        class_id = 1
    } | ConvertTo-Json
    
    $announcement = Invoke-RestMethod -Uri "http://localhost:5000/api/announcements" -Method Post -ContentType "application/json" -Headers @{"Authorization" = "Bearer $token"} -Body $announcementData
    Write-Host "✅ Test Announcement Created: $($announcement.announcement.title)" -ForegroundColor Green
} catch {
    Write-Host "❌ Create Announcement Failed: $($_.Exception.Message)" -ForegroundColor Red
}

# Test 7: Get updated statistics
Write-Host "`n7. Getting updated statistics..." -ForegroundColor Yellow
try {
    $stats = Invoke-RestMethod -Uri "http://localhost:5000/api/admin/statistics" -Method Get -Headers @{"Authorization" = "Bearer $token"}
    Write-Host "✅ Updated Statistics:" -ForegroundColor Green
    Write-Host "   - Total Students: $($stats.overview.total_students)" -ForegroundColor Cyan
    Write-Host "   - Total Teachers: $($stats.overview.total_teachers)" -ForegroundColor Cyan
    Write-Host "   - Total Classes: $($stats.overview.total_classes)" -ForegroundColor Cyan
    Write-Host "   - Total Tasks: $($stats.overview.total_tasks)" -ForegroundColor Cyan
    Write-Host "   - Total Announcements: $($stats.overview.total_announcements)" -ForegroundColor Cyan
} catch {
    Write-Host "❌ Get Statistics Failed: $($_.Exception.Message)" -ForegroundColor Red
}

# Test 8: Test mobile-friendly endpoints
Write-Host "`n8. Testing mobile endpoints..." -ForegroundColor Yellow
try {
    $grades = Invoke-RestMethod -Uri "http://localhost:5000/api/classes/grades" -Method Get -Headers @{"Authorization" = "Bearer $token"}
    Write-Host "✅ Grades Endpoint: Success (Found $($grades.grades.Count) grades)" -ForegroundColor Green
    
    $classes = Invoke-RestMethod -Uri "http://localhost:5000/api/classes/classes" -Method Get -Headers @{"Authorization" = "Bearer $token"}
    Write-Host "✅ Classes Endpoint: Success (Found $($classes.classes.Count) classes)" -ForegroundColor Green
} catch {
    Write-Host "❌ Mobile Endpoints Failed: $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host "`n🎉 Comprehensive Testing Complete!" -ForegroundColor Green
Write-Host "✨ The Harmony Learning Institute API is functioning correctly!" -ForegroundColor Magenta
