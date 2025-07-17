# 🚀 Railway Production Migration Script

# This script will run the S3 migration on Railway's production database
# Run this after deploying the code to Railway

Write-Host "🔧 RAILWAY PRODUCTION MIGRATION GUIDE" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""

Write-Host "1. Your code has been pushed to GitHub ✅" -ForegroundColor Green
Write-Host "2. Railway should now redeploy automatically 🔄" -ForegroundColor Yellow
Write-Host ""

Write-Host "3. Next steps - Run this migration on Railway:" -ForegroundColor Cyan
Write-Host ""
Write-Host "Option A: Via Railway CLI (Recommended)" -ForegroundColor Yellow
Write-Host "---------------------------------------"
Write-Host "railway login" -ForegroundColor White
Write-Host "railway connect" -ForegroundColor White
Write-Host "railway run node -e \"" -ForegroundColor White -NoNewline
Write-Host "require('dotenv').config();" -ForegroundColor Gray -NoNewline
Write-Host "const db = require('./config/database');" -ForegroundColor Gray -NoNewline
Write-Host "const fs = require('fs');" -ForegroundColor Gray -NoNewline
Write-Host "const sql = fs.readFileSync('./migrations/add_s3_support.sql', 'utf8');" -ForegroundColor Gray -NoNewline
Write-Host "db.query(sql).then(() => console.log('✅ S3 migration completed')).catch(err => console.error('❌ Migration failed:', err));" -ForegroundColor Gray -NoNewline
Write-Host "\"" -ForegroundColor White
Write-Host ""

Write-Host "Option B: Via Railway Dashboard" -ForegroundColor Yellow
Write-Host "-------------------------------"
Write-Host "1. Go to Railway dashboard -> Your project -> PostgreSQL service" -ForegroundColor White
Write-Host "2. Click 'Connect' to open database console" -ForegroundColor White
Write-Host "3. Run the SQL commands from migrations/add_s3_support.sql manually" -ForegroundColor White
Write-Host ""

Write-Host "🔍 WHAT TO CHECK AFTER DEPLOYMENT:" -ForegroundColor Cyan
Write-Host "1. Visit your Railway app URL" -ForegroundColor White
Write-Host "2. Test document upload functionality" -ForegroundColor White
Write-Host "3. Check Railway logs for any errors: railway logs" -ForegroundColor White
Write-Host "4. Verify S3 integration (if configured) or local fallback" -ForegroundColor White
Write-Host ""

Write-Host "🌐 Your Railway app should be available at:" -ForegroundColor Green
Write-Host "https://web-production-618c0.up.railway.app" -ForegroundColor Blue
Write-Host ""

Write-Host "💡 TIP: If document upload fails, run the migration first!" -ForegroundColor Yellow
