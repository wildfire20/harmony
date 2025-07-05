# 🚀 One-Click Railway Deployment
# This script helps deploy to Railway platform

Write-Host "🚀 Harmony Learning Institute - Railway Deployment Helper"
Write-Host "================================================="

# Check if git is initialized
if (-not (Test-Path ".git")) {
    Write-Host "❌ Git repository not found. Initializing..."
    git init
    git add .
    git commit -m "Initial commit for deployment"
}

# Check if changes need to be committed
$gitStatus = git status --porcelain
if ($gitStatus) {
    Write-Host "📝 Committing latest changes..."
    git add .
    git commit -m "Production deployment updates"
}

Write-Host ""
Write-Host "✅ Repository ready for deployment!"
Write-Host ""
Write-Host "🔥 NEXT STEPS FOR RAILWAY DEPLOYMENT:"
Write-Host "1. Go to https://railway.app"
Write-Host "2. Sign up/Login with GitHub"
Write-Host "3. Click 'Deploy from GitHub repo'"
Write-Host "4. Select this repository: harmony-learning-institute"
Write-Host "5. Add PostgreSQL database service"
Write-Host "6. Set these environment variables:"
Write-Host "   NODE_ENV=production"
Write-Host "   JWT_SECRET=[generate a strong 64-character secret]"
Write-Host "   FRONTEND_URL=[your railway domain]"
Write-Host "7. Deploy!"
Write-Host ""
Write-Host "🌐 Your app will be live at: https://[random-name].railway.app"
Write-Host ""
Write-Host "💡 Pro tip: Railway automatically handles database setup and SSL certificates!"

# Pause to let user read
Read-Host "Press Enter to continue..."
