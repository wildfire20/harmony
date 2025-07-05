# Harmony Learning Institute API Test Script

Write-Host "🧪 Testing Harmony Learning Institute API" -ForegroundColor Green

# Test 1: Health Check
Write-Host "`n1. Testing Health Check..." -ForegroundColor Yellow
try {
    $health = Invoke-RestMethod -Uri "http://localhost:5000/api/health" -Method Get
    Write-Host "✅ Health Check: $($health.status)" -ForegroundColor Green
} catch {
    Write-Host "❌ Health Check Failed: $($_.Exception.Message)" -ForegroundColor Red
}

# Test 2: Staff Login
Write-Host "`n2. Testing Staff Login..." -ForegroundColor Yellow
try {
    $loginResponse = Invoke-RestMethod -Uri "http://localhost:5000/api/auth/login/staff" -Method Post -ContentType "application/json" -Body '{"email":"admin@harmonylearning.edu","password":"admin123"}'
    $token = $loginResponse.token
    Write-Host "✅ Staff Login: Success" -ForegroundColor Green
} catch {
    Write-Host "❌ Staff Login Failed: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

# Test 3: Admin Statistics
Write-Host "`n3. Testing Admin Statistics..." -ForegroundColor Yellow
try {
    $stats = Invoke-RestMethod -Uri "http://localhost:5000/api/admin/statistics" -Method Get -Headers @{"Authorization" = "Bearer $token"}
    Write-Host "✅ Admin Statistics: Success" -ForegroundColor Green
    Write-Host "   - Total Students: $($stats.overview.total_students)" -ForegroundColor Cyan
    Write-Host "   - Total Teachers: $($stats.overview.total_teachers)" -ForegroundColor Cyan
    Write-Host "   - Total Classes: $($stats.overview.total_classes)" -ForegroundColor Cyan
    Write-Host "   - Total Tasks: $($stats.overview.total_tasks)" -ForegroundColor Cyan
} catch {
    Write-Host "❌ Admin Statistics Failed: $($_.Exception.Message)" -ForegroundColor Red
}

# Test 4: Get Classes
Write-Host "`n4. Testing Get Classes..." -ForegroundColor Yellow
try {
    $classes = Invoke-RestMethod -Uri "http://localhost:5000/api/classes/classes" -Method Get -Headers @{"Authorization" = "Bearer $token"}
    Write-Host "✅ Get Classes: Success (Found $($classes.classes.Count) classes)" -ForegroundColor Green
} catch {
    Write-Host "❌ Get Classes Failed: $($_.Exception.Message)" -ForegroundColor Red
}

# Test 5: Get Announcements
Write-Host "`n5. Testing Get Announcements..." -ForegroundColor Yellow
try {
    $announcements = Invoke-RestMethod -Uri "http://localhost:5000/api/announcements" -Method Get -Headers @{"Authorization" = "Bearer $token"}
    Write-Host "✅ Get Announcements: Success (Found $($announcements.Count) announcements)" -ForegroundColor Green
} catch {
    Write-Host "❌ Get Announcements Failed: $($_.Exception.Message)" -ForegroundColor Red
}

# Test 6: Get Tasks
Write-Host "`n6. Testing Get Tasks..." -ForegroundColor Yellow
try {
    $tasks = Invoke-RestMethod -Uri "http://localhost:5000/api/tasks" -Method Get -Headers @{"Authorization" = "Bearer $token"}
    Write-Host "✅ Get Tasks: Success (Found $($tasks.Count) tasks)" -ForegroundColor Green
} catch {
    Write-Host "❌ Get Tasks Failed: $($_.Exception.Message)" -ForegroundColor Red
}

# Test 7: Frontend Accessibility
Write-Host "`n7. Testing Frontend Accessibility..." -ForegroundColor Yellow
try {
    $frontend = Invoke-WebRequest -Uri "http://localhost:3000" -UseBasicParsing
    if ($frontend.StatusCode -eq 200) {
        Write-Host "✅ Frontend: Accessible" -ForegroundColor Green
    } else {
        Write-Host "❌ Frontend: Status Code $($frontend.StatusCode)" -ForegroundColor Red
    }
} catch {
    Write-Host "❌ Frontend Failed: $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host "`n🎉 API Testing Complete!" -ForegroundColor Green
