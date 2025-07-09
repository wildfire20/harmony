#!/bin/bash

# Harmony Learning Institute - S3 Integration Deployment Script

echo "🚀 Deploying Harmony Learning Institute with S3 Integration..."

# Check if AWS environment variables are set
if [ -z "$AWS_ACCESS_KEY_ID" ] || [ -z "$AWS_SECRET_ACCESS_KEY" ] || [ -z "$AWS_S3_BUCKET_NAME" ]; then
    echo "⚠️  WARNING: AWS environment variables not set!"
    echo "   Please set the following in Railway:"
    echo "   - AWS_ACCESS_KEY_ID"
    echo "   - AWS_SECRET_ACCESS_KEY" 
    echo "   - AWS_REGION (optional, defaults to us-east-1)"
    echo "   - AWS_S3_BUCKET_NAME"
    echo ""
    echo "   See AWS_S3_SETUP_GUIDE.md for detailed instructions"
    echo ""
fi

# Build the client
echo "📦 Building client..."
cd client && npm install --legacy-peer-deps && npm run build
cd ..

echo "✅ Build complete!"

# Reminder about database migration
echo ""
echo "📋 IMPORTANT: Remember to run the database migration!"
echo "   Execute the SQL in migrations/add_s3_support.sql on your Railway PostgreSQL database"
echo ""

echo "🎉 Deployment ready!"
echo ""
echo "Next steps:"
echo "1. Set up AWS S3 bucket (see AWS_S3_SETUP_GUIDE.md)"
echo "2. Configure environment variables in Railway"
echo "3. Run database migration"
echo "4. Deploy to Railway"
