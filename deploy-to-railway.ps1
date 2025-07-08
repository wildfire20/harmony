# 🚊 Railway Deployment Script for Harmony Learning Institute

Write-Host "🚀 Starting Railway Deployment Process..." -ForegroundColor Green

# Check if Railway CLI is installed
if (-not (Get-Command railway -ErrorAction SilentlyContinue)) {
    Write-Host "❌ Railway CLI not found. Installing..." -ForegroundColor Yellow
    npm install -g @railway/cli
    if ($LASTEXITCODE -ne 0) {
        Write-Host "❌ Failed to install Railway CLI" -ForegroundColor Red
        exit 1
    }
    Write-Host "✅ Railway CLI installed successfully" -ForegroundColor Green
}

# Check if we're logged in to Railway
Write-Host "🔐 Checking Railway authentication..." -ForegroundColor Cyan
railway whoami
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Not logged in to Railway. Please login..." -ForegroundColor Yellow
    railway login
    if ($LASTEXITCODE -ne 0) {
        Write-Host "❌ Failed to login to Railway" -ForegroundColor Red
        exit 1
    }
}

# Try to link to existing project or create new one
Write-Host "🔗 Linking to Railway project..." -ForegroundColor Cyan
railway link

# Deploy the application
Write-Host "🚀 Deploying to Railway..." -ForegroundColor Green
railway up

if ($LASTEXITCODE -eq 0) {
    Write-Host "✅ Deployment successful!" -ForegroundColor Green
    Write-Host "🌐 Your application should be available at your Railway domain" -ForegroundColor Cyan
    Write-Host "📊 Check deployment status: railway status" -ForegroundColor Yellow
    Write-Host "📝 View logs: railway logs" -ForegroundColor Yellow
} else {
    Write-Host "❌ Deployment failed. Check the logs for details." -ForegroundColor Red
    railway logs
}

Write-Host "🎉 Railway deployment process completed!" -ForegroundColor Green
