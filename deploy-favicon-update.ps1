# 🚀 Favicon Update Deployment Script
# Deploy Harmony Learning with new favicon to Railway

Write-Host "🎨 Deploying Harmony Learning with Updated Favicon" -ForegroundColor Cyan
Write-Host "=================================================" -ForegroundColor Cyan
Write-Host ""

# 1. Check favicon files are in place
Write-Host "📁 Checking favicon files..." -ForegroundColor Yellow
$faviconFiles = @(
    "client\public\favicon.ico",
    "client\public\favicon-96x96.png",
    "client\public\apple-touch-icon.png",
    "client\public\favicon.svg",
    "client\public\site.webmanifest"
)

$allFilesPresent = $true
foreach ($file in $faviconFiles) {
    if (Test-Path $file) {
        Write-Host "  ✅ $file" -ForegroundColor Green
    } else {
        Write-Host "  ❌ $file (missing)" -ForegroundColor Red
        $allFilesPresent = $false
    }
}

if (-not $allFilesPresent) {
    Write-Host ""
    Write-Host "❌ Some favicon files are missing. Please ensure all files are copied to client\public\" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "✅ All favicon files present!" -ForegroundColor Green
Write-Host ""

# 2. Check Railway CLI
Write-Host "🚊 Checking Railway CLI..." -ForegroundColor Yellow
if (-not (Get-Command railway -ErrorAction SilentlyContinue)) {
    Write-Host "❌ Railway CLI not found. Installing..." -ForegroundColor Yellow
    npm install -g @railway/cli
    if ($LASTEXITCODE -ne 0) {
        Write-Host "❌ Failed to install Railway CLI" -ForegroundColor Red
        exit 1
    }
}
Write-Host "✅ Railway CLI ready" -ForegroundColor Green
Write-Host ""

# 3. Check authentication
Write-Host "🔐 Checking Railway authentication..." -ForegroundColor Yellow
railway whoami
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Please login to Railway first: railway login" -ForegroundColor Red
    exit 1
}
Write-Host ""

# 4. Show current project status
Write-Host "📊 Current project status..." -ForegroundColor Yellow
railway status
Write-Host ""

# 5. Deploy
Write-Host "🚀 Starting deployment..." -ForegroundColor Green
Write-Host "This will deploy your updated website with the new favicon" -ForegroundColor Cyan
Write-Host ""

railway up

if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "🎉 Deployment Successful!" -ForegroundColor Green
    Write-Host "=================================================" -ForegroundColor Green
    Write-Host ""
    Write-Host "✅ Your website has been updated with:" -ForegroundColor Cyan
    Write-Host "  • New favicon in browser tabs" -ForegroundColor White
    Write-Host "  • Apple Touch Icons for iOS" -ForegroundColor White
    Write-Host "  • Enhanced PWA manifest" -ForegroundColor White
    Write-Host "  • Cross-platform compatibility" -ForegroundColor White
    Write-Host ""
    Write-Host "🌐 Visit your website to see the new favicon!" -ForegroundColor Yellow
    Write-Host "💡 You may need to clear browser cache (Ctrl+F5) to see changes" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "📊 Check logs: railway logs" -ForegroundColor Gray
    Write-Host "📊 Check status: railway status" -ForegroundColor Gray
    Write-Host ""
} else {
    Write-Host ""
    Write-Host "❌ Deployment failed!" -ForegroundColor Red
    Write-Host "Showing recent logs..." -ForegroundColor Yellow
    railway logs --tail 50
}

Write-Host "🎯 Deployment process completed!" -ForegroundColor Cyan
