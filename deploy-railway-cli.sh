#!/bin/bash

# Railway CLI Deployment Script with Enhanced Logging
echo "🚀 Starting Railway deployment with enhanced debugging..."

# Check if Railway CLI is installed
if ! command -v railway &> /dev/null; then
    echo "❌ Railway CLI not found. Installing..."
    npm install -g @railway/cli
fi

# Login to Railway (if not already logged in)
echo "🔐 Checking Railway authentication..."
railway auth

# Link to the project
echo "🔗 Linking to Railway project..."
railway link

# Deploy with verbose logging
echo "📦 Deploying to Railway with verbose output..."
railway up --verbose

# Get deployment logs
echo "📋 Fetching deployment logs..."
railway logs --tail 100

# Show service status
echo "📊 Checking service status..."
railway status

echo "✅ Deployment complete! Check the logs above for any issues."
