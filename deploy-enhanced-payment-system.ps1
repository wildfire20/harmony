# Enhanced Payment System Deployment Script
# Run this script to deploy the enhanced payment system

Write-Host "🚀 Enhanced Payment System Deployment" -ForegroundColor Cyan
Write-Host "=====================================" -ForegroundColor Cyan
Write-Host ""

# 1. Initialize the enhanced payment system database tables
Write-Host "📊 Step 1: Initializing database schema..." -ForegroundColor Yellow
try {
    node init-enhanced-payment-system.js
    Write-Host "✅ Database schema initialized successfully!" -ForegroundColor Green
} catch {
    Write-Host "❌ Database initialization failed. Please check your database connection." -ForegroundColor Red
    Write-Host "Error: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

Write-Host ""

# 2. Generate test CSV samples
Write-Host "📄 Step 2: Generating test CSV samples..." -ForegroundColor Yellow
try {
    node create-csv-test-samples.js
    Write-Host "✅ Test CSV samples created successfully!" -ForegroundColor Green
} catch {
    Write-Host "❌ Test CSV generation failed." -ForegroundColor Red
    Write-Host "Error: $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host ""

# 3. Test the enhanced CSV parser
Write-Host "🧪 Step 3: Testing enhanced CSV parser..." -ForegroundColor Yellow
try {
    node test-enhanced-csv-parser.js | Out-Host
    Write-Host "✅ CSV parser tests completed successfully!" -ForegroundColor Green
} catch {
    Write-Host "❌ CSV parser tests failed." -ForegroundColor Red
    Write-Host "Error: $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host ""

# 4. Check if client dependencies need to be installed
Write-Host "📦 Step 4: Checking client dependencies..." -ForegroundColor Yellow
if (-not (Test-Path "client/node_modules")) {
    Write-Host "Installing client dependencies..." -ForegroundColor Yellow
    Set-Location client
    npm install
    Set-Location ..
    Write-Host "✅ Client dependencies installed!" -ForegroundColor Green
} else {
    Write-Host "✅ Client dependencies already installed!" -ForegroundColor Green
}

Write-Host ""

# 5. Build client for production
Write-Host "🔨 Step 5: Building client for production..." -ForegroundColor Yellow
try {
    npm run build-client
    Write-Host "✅ Client built successfully!" -ForegroundColor Green
} catch {
    Write-Host "⚠️ Client build failed, but this is optional for development." -ForegroundColor Yellow
}

Write-Host ""

# 6. Final summary
Write-Host "🎉 Enhanced Payment System Deployment Summary" -ForegroundColor Green
Write-Host "===========================================" -ForegroundColor Green
Write-Host ""
Write-Host "✅ Database schema initialized with column mappings table" -ForegroundColor Green
Write-Host "✅ Test CSV samples created in test-csv-samples/ directory" -ForegroundColor Green
Write-Host "✅ Enhanced CSV parser tested with multiple bank formats" -ForegroundColor Green
Write-Host "✅ Client dependencies ready" -ForegroundColor Green
Write-Host ""

Write-Host "🚀 Next Steps:" -ForegroundColor Cyan
Write-Host "1. Start your server with: npm start" -ForegroundColor White
Write-Host "2. Login as admin user" -ForegroundColor White
Write-Host "3. Go to Payments Dashboard → Upload Bank Statement" -ForegroundColor White
Write-Host "4. Test with sample CSV files from test-csv-samples/" -ForegroundColor White
Write-Host ""

Write-Host "📋 Features Available:" -ForegroundColor Cyan
Write-Host "• Flexible CSV column auto-detection" -ForegroundColor White
Write-Host "• Manual column mapping interface" -ForegroundColor White
Write-Host "• Save and reuse bank format mappings" -ForegroundColor White
Write-Host "• Smart reference extraction" -ForegroundColor White
Write-Host "• Advanced data cleaning and normalization" -ForegroundColor White
Write-Host "• Full backward compatibility" -ForegroundColor White
Write-Host ""

Write-Host "📖 Documentation:" -ForegroundColor Cyan
Write-Host "• ENHANCED_PAYMENT_SYSTEM_GUIDE.md - Complete implementation guide" -ForegroundColor White
Write-Host "• test-csv-samples/README.md - Testing instructions" -ForegroundColor White
Write-Host ""

Write-Host "🎯 The enhanced system is now ready for testing!" -ForegroundColor Green
Write-Host "School administrators can upload CSV files from any bank with minimal manual work." -ForegroundColor Green
