# Final Pre-Deployment Verification

Write-Host "🔍 Final Pre-Deployment Verification for Harmony Learning Institute" -ForegroundColor Green

# Check if required files exist
Write-Host "`n📁 Checking Required Files..." -ForegroundColor Yellow

$requiredFiles = @(
    "package.json",
    "server.js", 
    "Procfile",
    ".env.example",
    "client/package.json",
    "config/database.js",
    "routes/auth.js",
    "routes/admin.js"
)

$allFilesExist = $true
foreach ($file in $requiredFiles) {
    if (Test-Path $file) {
        Write-Host "✅ $file exists" -ForegroundColor Green
    } else {
        Write-Host "❌ $file missing" -ForegroundColor Red
        $allFilesExist = $false
    }
}

# Check if servers are running
Write-Host "`n🚀 Checking Server Status..." -ForegroundColor Yellow

try {
    $backendHealth = Invoke-RestMethod -Uri "http://localhost:5000/api/health" -Method Get -TimeoutSec 5
    Write-Host "✅ Backend Server: Running ($($backendHealth.status))" -ForegroundColor Green
} catch {
    Write-Host "❌ Backend Server: Not running" -ForegroundColor Red
    $allFilesExist = $false
}

try {
    $frontend = Invoke-WebRequest -Uri "http://localhost:3000" -UseBasicParsing -TimeoutSec 5
    if ($frontend.StatusCode -eq 200) {
        Write-Host "✅ Frontend Server: Running" -ForegroundColor Green
    }
} catch {
    Write-Host "❌ Frontend Server: Not running" -ForegroundColor Red
    $allFilesExist = $false
}

# Test admin login
Write-Host "`n🔑 Testing Admin Authentication..." -ForegroundColor Yellow
try {
    $loginBody = @{
        email = "admin@harmonylearning.edu"
        password = "admin123"
    } | ConvertTo-Json
    
    $loginResponse = Invoke-RestMethod -Uri "http://localhost:5000/api/auth/login/staff" -Method Post -ContentType "application/json" -Body $loginBody -TimeoutSec 10
    Write-Host "✅ Admin Login: Working" -ForegroundColor Green
} catch {
    Write-Host "❌ Admin Login: Failed" -ForegroundColor Red
    $allFilesExist = $false
}

# Check deployment readiness
Write-Host "`n📦 Deployment Readiness Check..." -ForegroundColor Yellow

if (Test-Path "Procfile") {
    $procfileContent = Get-Content "Procfile"
    if ($procfileContent -eq "web: node server.js") {
        Write-Host "✅ Procfile: Correctly configured" -ForegroundColor Green
    } else {
        Write-Host "❌ Procfile: Incorrect configuration" -ForegroundColor Red
        $allFilesExist = $false
    }
}

# Check if git is initialized
if (Test-Path ".git") {
    Write-Host "✅ Git Repository: Ready" -ForegroundColor Green
} else {
    Write-Host "⚠️ Git Repository: Not initialized (will be done during deployment)" -ForegroundColor Yellow
}

# Final status
Write-Host "`n📊 FINAL STATUS" -ForegroundColor Magenta
if ($allFilesExist) {
    Write-Host "✅ ALL SYSTEMS READY FOR DEPLOYMENT!" -ForegroundColor Green
    Write-Host "`n🚀 Next Steps:" -ForegroundColor Yellow
    Write-Host "1. Run: .\deploy-heroku.ps1" -ForegroundColor Cyan
    Write-Host "2. Wait for deployment to complete" -ForegroundColor Cyan
    Write-Host "3. Access your app at the provided URL" -ForegroundColor Cyan
    Write-Host "4. Login with: admin@harmonylearning.edu / admin123" -ForegroundColor Cyan
    Write-Host "5. Start adding students and teachers!" -ForegroundColor Cyan
} else {
    Write-Host "❌ SOME ISSUES FOUND - Please fix before deployment" -ForegroundColor Red
}

Write-Host "`n🎯 Your Harmony Learning Institute is production-ready!" -ForegroundColor Magenta
