# PowerShell script for Railway deployment preparation
Write-Host "🚀 Building Harmony Learning Institute for Railway deployment..." -ForegroundColor Cyan

# Build the client
Write-Host "📦 Building React client..." -ForegroundColor Yellow
Set-Location client
npm ci
npm run build
Set-Location ..

Write-Host "✅ Client built successfully!" -ForegroundColor Green
Write-Host "📁 Build files created in client/build/" -ForegroundColor Blue

# Update .gitignore to include the build for Railway
Write-Host "📝 Updating .gitignore to include build files..." -ForegroundColor Yellow

# Commit the build
Write-Host "📤 Committing build files for Railway..." -ForegroundColor Yellow
git add client/build
git add .
git commit -m "Add production build files for Railway deployment"
git push

Write-Host ""
Write-Host "🎉 Ready for Railway deployment!" -ForegroundColor Green
Write-Host "   Now redeploy on Railway - it should work!" -ForegroundColor Cyan
