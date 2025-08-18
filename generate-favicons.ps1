# Favicon Generator Script for Harmony Learning
# Requires ImageMagick to be installed: https://imagemagick.org/script/download.php#windows

param(
    [Parameter(Mandatory=$true)]
    [string]$SourceImage,
    
    [Parameter(Mandatory=$false)]
    [string]$OutputDir = "client\public"
)

Write-Host "🎨 Harmony Learning Favicon Generator" -ForegroundColor Cyan
Write-Host "Source Image: $SourceImage" -ForegroundColor Green
Write-Host "Output Directory: $OutputDir" -ForegroundColor Green
Write-Host ""

# Check if ImageMagick is installed
try {
    $null = magick -version
    Write-Host "✅ ImageMagick detected" -ForegroundColor Green
} catch {
    Write-Host "❌ ImageMagick not found. Please install from: https://imagemagick.org/script/download.php#windows" -ForegroundColor Red
    exit 1
}

# Check if source image exists
if (-not (Test-Path $SourceImage)) {
    Write-Host "❌ Source image not found: $SourceImage" -ForegroundColor Red
    exit 1
}

# Create output directory if it doesn't exist
if (-not (Test-Path $OutputDir)) {
    New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null
    Write-Host "📁 Created output directory: $OutputDir" -ForegroundColor Yellow
}

Write-Host "🔄 Generating favicon files..." -ForegroundColor Yellow

# Standard favicons
$standardSizes = @(16, 32, 48, 64, 96, 128, 192, 256)
foreach ($size in $standardSizes) {
    $outputFile = Join-Path $OutputDir "favicon-${size}x${size}.png"
    magick $SourceImage -resize "${size}x${size}" $outputFile
    Write-Host "  ✓ Generated favicon-${size}x${size}.png" -ForegroundColor Gray
}

# Apple Touch Icons
$appleSizes = @(57, 60, 72, 76, 114, 120, 144, 152, 180)
foreach ($size in $appleSizes) {
    $outputFile = Join-Path $OutputDir "apple-touch-icon-${size}x${size}.png"
    magick $SourceImage -resize "${size}x${size}" $outputFile
    Write-Host "  ✓ Generated apple-touch-icon-${size}x${size}.png" -ForegroundColor Gray
}

# Microsoft Metro Tiles
$msSizes = @(
    @{size=70; name="ms-icon-70x70.png"},
    @{size=144; name="ms-icon-144x144.png"},
    @{size=150; name="ms-icon-150x150.png"},
    @{size=310; name="ms-icon-310x310.png"}
)
foreach ($tile in $msSizes) {
    $outputFile = Join-Path $OutputDir $tile.name
    magick $SourceImage -resize "$($tile.size)x$($tile.size)" $outputFile
    Write-Host "  ✓ Generated $($tile.name)" -ForegroundColor Gray
}

# Microsoft wide tile (310x150)
$outputFile = Join-Path $OutputDir "ms-icon-310x150.png"
magick $SourceImage -resize "310x150" $outputFile
Write-Host "  ✓ Generated ms-icon-310x150.png" -ForegroundColor Gray

# Android Chrome Icons
$androidSizes = @(36, 48, 72, 96, 144, 192, 256, 384, 512)
foreach ($size in $androidSizes) {
    $outputFile = Join-Path $OutputDir "android-chrome-${size}x${size}.png"
    magick $SourceImage -resize "${size}x${size}" $outputFile
    Write-Host "  ✓ Generated android-chrome-${size}x${size}.png" -ForegroundColor Gray
}

# Generate ICO file with multiple sizes
Write-Host "🔄 Generating favicon.ico..." -ForegroundColor Yellow
$ico16 = Join-Path $OutputDir "favicon-16x16.png"
$ico32 = Join-Path $OutputDir "favicon-32x32.png"
$ico48 = Join-Path $OutputDir "favicon-48x48.png"
$icoOutput = Join-Path $OutputDir "favicon.ico"

magick $ico16 $ico32 $ico48 $icoOutput
Write-Host "  ✅ Generated favicon.ico with multiple sizes" -ForegroundColor Green

Write-Host ""
Write-Host "🎉 Favicon generation complete!" -ForegroundColor Green
Write-Host "📁 All files generated in: $OutputDir" -ForegroundColor Cyan
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Yellow
Write-Host "1. Clear your browser cache" -ForegroundColor White
Write-Host "2. Start your development server: npm start" -ForegroundColor White
Write-Host "3. Check favicon appears in browser tab" -ForegroundColor White
Write-Host "4. Test on mobile device (save to home screen)" -ForegroundColor White
Write-Host ""
Write-Host "💡 Tip: Use a 512x512px or larger source image for best results" -ForegroundColor Cyan
