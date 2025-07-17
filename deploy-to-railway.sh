#!/bin/bash

echo "🚀 Deploying Harmony Learning Institute to Railway..."

# Add build files to git (Railway needs them committed)
echo "📦 Adding build files..."
git add client/build -f
git add .

# Commit build
echo "💾 Committing build files..."
git commit -m "Add production build files for Railway deployment with document marking system"

# Push to trigger Railway deployment
echo "🚢 Pushing to Railway..."
git push origin master

echo "✅ Deployment triggered! Check Railway dashboard for status."
