# Test the database migration endpoint
Write-Host "🔄 Testing database migration endpoint..." -ForegroundColor Yellow

# Get the Railway app URL
try {
    $railwayUrl = railway domain | Out-String
    $railwayUrl = $railwayUrl.Trim()
    if (-not $railwayUrl.StartsWith("https://")) {
        $railwayUrl = "https://$railwayUrl"
    }
    Write-Host "Railway URL: $railwayUrl" -ForegroundColor Green
} catch {
    Write-Host "❌ Failed to get Railway URL. Using fallback..." -ForegroundColor Red
    $railwayUrl = "https://harmony-production-9ed7.up.railway.app"
}

# Test migration endpoint
Write-Host "`n🔧 Executing database migration..." -ForegroundColor Yellow

$migrationUrl = "$railwayUrl/api/invoices/migrate-database"
Write-Host "Migration URL: $migrationUrl" -ForegroundColor Cyan

try {
    # Note: This requires super_admin authentication
    # For now, just test if the endpoint is accessible
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
        Write-Host "Status Code: $statusCode" -ForegroundColor Red
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
Write-Host "2. Execute POST $railwayUrl/api/invoices/migrate-database" -ForegroundColor White
Write-Host "3. Test CSV upload functionality after migration" -ForegroundColor White
Write-Host "`nFor manual testing, you can use:" -ForegroundColor Cyan
Write-Host "curl -X POST $railwayUrl/api/invoices/migrate-database -H 'Authorization: Bearer YOUR_TOKEN'" -ForegroundColor Gray
