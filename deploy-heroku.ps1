# Harmony Learning Institute - Heroku Deployment Script

Write-Host "🚀 Deploying Harmony Learning Institute to Heroku" -ForegroundColor Green

# Step 1: Install Heroku CLI if not already installed
Write-Host "`n1. Checking Heroku CLI..." -ForegroundColor Yellow
try {
    $herokuVersion = heroku --version
    Write-Host "✅ Heroku CLI is installed: $herokuVersion" -ForegroundColor Green
} catch {
    Write-Host "❌ Heroku CLI not found. Please install it from: https://devcenter.heroku.com/articles/heroku-cli" -ForegroundColor Red
    Write-Host "After installation, run this script again." -ForegroundColor Red
    exit 1
}

# Step 2: Login to Heroku
Write-Host "`n2. Logging in to Heroku..." -ForegroundColor Yellow
Write-Host "Please login when prompted..." -ForegroundColor Cyan
heroku login

# Step 3: Initialize git repository if not exists
Write-Host "`n3. Initializing Git repository..." -ForegroundColor Yellow
if (!(Test-Path ".git")) {
    git init
    Write-Host "✅ Git repository initialized" -ForegroundColor Green
} else {
    Write-Host "✅ Git repository already exists" -ForegroundColor Green
}

# Step 4: Create Heroku app
Write-Host "`n4. Creating Heroku app..." -ForegroundColor Yellow
$appName = "harmony-learning-institute-$(Get-Random -Minimum 1000 -Maximum 9999)"
Write-Host "App name will be: $appName" -ForegroundColor Cyan

try {
    heroku create $appName
    Write-Host "✅ Heroku app created successfully" -ForegroundColor Green
} catch {
    Write-Host "❌ Failed to create Heroku app. Trying with different name..." -ForegroundColor Red
    $appName = "harmony-school-$(Get-Random -Minimum 1000 -Maximum 9999)"
    heroku create $appName
}

# Step 5: Add PostgreSQL addon
Write-Host "`n5. Adding PostgreSQL database..." -ForegroundColor Yellow
heroku addons:create heroku-postgresql:essential-0 --app $appName
Write-Host "✅ PostgreSQL database added" -ForegroundColor Green

# Step 6: Set environment variables
Write-Host "`n6. Setting environment variables..." -ForegroundColor Yellow
heroku config:set NODE_ENV=production --app $appName
heroku config:set JWT_SECRET="HarmonyLearning2025SecretKey!@#$%^&*()" --app $appName
heroku config:set JWT_EXPIRE="7d" --app $appName
heroku config:set BCRYPT_ROUNDS=12 --app $appName
heroku config:set FRONTEND_URL="https://$appName.herokuapp.com" --app $appName
Write-Host "✅ Environment variables set" -ForegroundColor Green

# Step 7: Prepare files for deployment
Write-Host "`n7. Preparing files for deployment..." -ForegroundColor Yellow

# Add files to git
git add .
git commit -m "Initial deployment to Heroku"
Write-Host "✅ Files committed to git" -ForegroundColor Green

# Step 8: Deploy to Heroku
Write-Host "`n8. Deploying to Heroku..." -ForegroundColor Yellow
Write-Host "This may take a few minutes..." -ForegroundColor Cyan
git push heroku main

# Step 9: Open the app
Write-Host "`n9. Opening your deployed app..." -ForegroundColor Yellow
heroku open --app $appName

Write-Host "`n🎉 Deployment Complete!" -ForegroundColor Green
Write-Host "Your Harmony Learning Institute is now live at: https://$appName.herokuapp.com" -ForegroundColor Magenta
Write-Host "`n📋 Next Steps:" -ForegroundColor Yellow
Write-Host "1. Test the application in your browser" -ForegroundColor Cyan
Write-Host "2. Login with admin credentials: admin@harmonylearning.edu / admin123" -ForegroundColor Cyan
Write-Host "3. Create test users and share the URL with others" -ForegroundColor Cyan
Write-Host "4. Monitor the app with: heroku logs --tail --app $appName" -ForegroundColor Cyan

Write-Host "`n🔧 Useful Heroku Commands:" -ForegroundColor Yellow
Write-Host "- View logs: heroku logs --tail --app $appName" -ForegroundColor Cyan
Write-Host "- View app info: heroku info --app $appName" -ForegroundColor Cyan
Write-Host "- Restart app: heroku restart --app $appName" -ForegroundColor Cyan
Write-Host "- Open app: heroku open --app $appName" -ForegroundColor Cyan
