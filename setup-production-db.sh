#!/bin/bash
# Production Database Setup Script

echo "🚀 Setting up Harmony Learning Institute Production Database..."

# Check if required environment variables are set
if [ -z "$DB_HOST" ] || [ -z "$DB_NAME" ] || [ -z "$DB_USER" ] || [ -z "$DB_PASSWORD" ]; then
    echo "❌ Error: Database environment variables not set!"
    echo "Please set DB_HOST, DB_NAME, DB_USER, and DB_PASSWORD"
    exit 1
fi

echo "📋 Database Configuration:"
echo "Host: $DB_HOST"
echo "Database: $DB_NAME"
echo "User: $DB_USER"

# Test database connection
echo "🔌 Testing database connection..."
export PGPASSWORD=$DB_PASSWORD
psql -h $DB_HOST -U $DB_USER -d postgres -c "SELECT version();" > /dev/null 2>&1

if [ $? -eq 0 ]; then
    echo "✅ Database connection successful!"
else
    echo "❌ Database connection failed! Please check your credentials."
    exit 1
fi

# Create database if it doesn't exist
echo "🗄️ Creating database if it doesn't exist..."
psql -h $DB_HOST -U $DB_USER -d postgres -c "CREATE DATABASE $DB_NAME;" 2>/dev/null
echo "✅ Database ready!"

# Run migrations
echo "🔧 Running database migrations..."
node -e "require('./config/database').initialize().then(() => { console.log('✅ Database initialized successfully!'); process.exit(0); }).catch(err => { console.error('❌ Database initialization failed:', err); process.exit(1); });"

echo "🎉 Production database setup complete!"
