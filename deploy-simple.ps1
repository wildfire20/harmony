# Railway CLI Deployment Script - Simple Version
Write-Host "Starting Railway deployment..." -ForegroundColor Green

# Check if Railway CLI is installed
$railwayExists = Get-Command railway -ErrorAction SilentlyContinue
if (-not $railwayExists) {
    Write-Host "Railway CLI not found. Installing..." -ForegroundColor Red
    npm install -g @railway/cli
}

# Login to Railway (if not already logged in)
Write-Host "Checking Railway authentication..." -ForegroundColor Yellow
railway auth

# Link to the project
Write-Host "Linking to Railway project..." -ForegroundColor Yellow
railway link

# Deploy with verbose logging
Write-Host "Deploying to Railway..." -ForegroundColor Green
railway up --verbose

# Get deployment logs
Write-Host "Fetching deployment logs..." -ForegroundColor Yellow
railway logs --tail 100

# Show service status
Write-Host "Checking service status..." -ForegroundColor Yellow
railway status

Write-Host "Deployment complete!" -ForegroundColor Green
