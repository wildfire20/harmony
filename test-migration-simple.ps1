Write-Host "🔄 Testing database migration endpoint..." -ForegroundColor Yellow

# Use the known Railway URL
$railwayUrl = "https://harmony-production-9ed7.up.railway.app"
Write-Host "Railway URL: $railwayUrl" -ForegroundColor Green

# Test migration endpoint
Write-Host "`n🔧 Testing database migration endpoint..." -ForegroundColor Yellow
$migrationUrl = "$railwayUrl/api/invoices/migrate-database"
Write-Host "Migration URL: $migrationUrl" -ForegroundColor Cyan

try {
    $response = Invoke-WebRequest -Uri $migrationUrl -Method POST -UseBasicParsing
    Write-Host "✅ Migration endpoint accessible" -ForegroundColor Green
    Write-Host "Response Status: $($response.StatusCode)" -ForegroundColor Green
} catch {
    $statusCode = $_.Exception.Response.StatusCode.value__
    if ($statusCode -eq 401) {
        Write-Host "🔐 Migration endpoint requires authentication (expected)" -ForegroundColor Yellow
        Write-Host "✅ Endpoint is accessible and properly secured" -ForegroundColor Green
    } else {
        Write-Host "❌ Migration endpoint error: $($_.Exception.Message)" -ForegroundColor Red
    }
}

# Test basic health check
Write-Host "`n🏥 Testing application health..." -ForegroundColor Yellow
try {
    $healthResponse = Invoke-WebRequest -Uri "$railwayUrl/api" -Method GET -UseBasicParsing
    Write-Host "✅ Application is running" -ForegroundColor Green
} catch {
    Write-Host "❌ Application health check failed: $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host "`n📋 Next Steps:" -ForegroundColor Yellow
Write-Host "1. Log into the application as super_admin" -ForegroundColor White
Write-Host "2. Execute the migration endpoint manually" -ForegroundColor White
Write-Host "3. Test CSV upload functionality after migration" -ForegroundColor White
