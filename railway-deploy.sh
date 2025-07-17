#!/bin/bash
# Railway deployment script for Harmony Learning System with Quiz Features

echo "🚀 Starting Railway deployment for Harmony Learning System..."
echo "📋 Enhanced with comprehensive quiz system"

# Set environment
export NODE_ENV=production

# Run database setup for quiz system
echo "🗄️  Setting up enhanced database schema with quiz system..."
node setup-database.js

# Start the application
echo "🌐 Starting Harmony server with quiz features..."
npm start
