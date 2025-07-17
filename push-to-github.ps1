# 🚀 GitHub Push Script for Harmony Learning Institute
# Run this script after creating your GitHub repository

Write-Host "🎓 Harmony Learning Institute - GitHub Deployment Script" -ForegroundColor Cyan
Write-Host "=================================================" -ForegroundColor Cyan
Write-Host ""

# Get GitHub username
$githubUsername = Read-Host "Enter your GitHub username"

if (-not $githubUsername) {
    Write-Host "❌ GitHub username is required!" -ForegroundColor Red
    exit 1
}

$repoUrl = "https://github.com/$githubUsername/harmony.git"

Write-Host "📂 Repository URL: $repoUrl" -ForegroundColor Yellow
Write-Host ""

# Check if remote already exists
$existingRemote = git remote get-url origin 2>$null
if ($existingRemote) {
    Write-Host "📡 Remote 'origin' already exists: $existingRemote" -ForegroundColor Yellow
    $confirm = Read-Host "Do you want to update it? (y/n)"
    if ($confirm -eq 'y' -or $confirm -eq 'Y') {
        git remote set-url origin $repoUrl
        Write-Host "✅ Remote updated!" -ForegroundColor Green
    }
} else {
    # Add remote
    Write-Host "📡 Adding GitHub remote..." -ForegroundColor Blue
    git remote add origin $repoUrl
    Write-Host "✅ Remote added!" -ForegroundColor Green
}

# Set branch to main
Write-Host "🌿 Setting main branch..." -ForegroundColor Blue
git branch -M main

# Push to GitHub
Write-Host "🚀 Pushing to GitHub..." -ForegroundColor Blue
try {
    git push -u origin main
    Write-Host ""
    Write-Host "🎉 SUCCESS! Your code is now on GitHub!" -ForegroundColor Green
    Write-Host "📍 Repository: https://github.com/$githubUsername/harmony" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "🚀 NEXT STEPS:" -ForegroundColor Yellow
    Write-Host "1. Go to https://railway.app" -ForegroundColor White
    Write-Host "2. Sign up with GitHub" -ForegroundColor White
    Write-Host "3. Deploy from GitHub repo: harmony" -ForegroundColor White
    Write-Host "4. Add PostgreSQL database" -ForegroundColor White
    Write-Host "5. Set environment variables" -ForegroundColor White
    Write-Host ""
    Write-Host "📖 Full guide: GITHUB_RAILWAY_DEPLOYMENT.md" -ForegroundColor Cyan
}
catch {
    Write-Host ""
    Write-Host "❌ Push failed. This might be because:" -ForegroundColor Red
    Write-Host "1. Repository doesn't exist on GitHub yet" -ForegroundColor Yellow
    Write-Host "2. You don't have push permissions" -ForegroundColor Yellow
    Write-Host "3. Authentication issues" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "Please create the repository on GitHub first:" -ForegroundColor Cyan
    Write-Host "https://github.com/new" -ForegroundColor Blue
    Write-Host "Repository name: harmony" -ForegroundColor Blue
}

Write-Host ""
Read-Host "Press Enter to continue..."
