# Deployment script for announcements feature

Write-Host "🚀 Deploying Announcements Feature to Railway..." -ForegroundColor Green

# Check if we're in the right directory
if (!(Test-Path "server.js")) {
    Write-Host "❌ Error: server.js not found. Please run this script from the project root directory." -ForegroundColor Red
    exit 1
}

# Check if git is available
try {
    git --version | Out-Null
    Write-Host "✅ Git is available" -ForegroundColor Green
} catch {
    Write-Host "❌ Error: Git is not installed or not in PATH" -ForegroundColor Red
    exit 1
}

# Add all changes
Write-Host "📁 Adding files to git..." -ForegroundColor Yellow
git add .

# Commit changes
$commitMessage = "feat: implement announcements with role-based permissions"
Write-Host "💾 Committing changes: $commitMessage" -ForegroundColor Yellow
git commit -m $commitMessage

# Check if Railway CLI is available
try {
    railway --version | Out-Null
    Write-Host "✅ Railway CLI is available" -ForegroundColor Green
    
    # Deploy to Railway
    Write-Host "🚀 Deploying to Railway..." -ForegroundColor Yellow
    railway up
    
} catch {
    Write-Host "⚠️  Railway CLI not found. Pushing to git instead..." -ForegroundColor Yellow
    
    # Push to git (Railway will auto-deploy if connected)
    Write-Host "📤 Pushing to git repository..." -ForegroundColor Yellow
    git push origin main
}

Write-Host "✅ Deployment complete!" -ForegroundColor Green
Write-Host "🌐 Check your app at: https://web-production-618c0.up.railway.app/announcements" -ForegroundColor Cyan
