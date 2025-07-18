#!/bin/bash

# Deploy to Railway
echo "🚀 Deploying to Railway..."

# Check if railway CLI is installed
if ! command -v railway &> /dev/null; then
    echo "❌ Railway CLI not found. Installing..."
    npm install -g @railway/cli
fi

# Login check
railway whoami || railway login

# Deploy the application
railway up --detach

echo "✅ Deployment initiated!"
echo "📝 Check your Railway dashboard for deployment status"
