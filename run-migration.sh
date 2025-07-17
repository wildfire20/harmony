#!/bin/bash

# Railway Database Migration Script
# This script should be run once after deployment to add marking columns

echo "🚀 Running Railway Database Migration..."
echo "📅 $(date)"

# Run the migration
node migration-for-railway.js

if [ $? -eq 0 ]; then
    echo "✅ Migration completed successfully!"
    echo "🎉 The document marking system is now ready for teachers to use."
    echo ""
    echo "📋 Next steps:"
    echo "  1. Teachers can now access the marking interface"
    echo "  2. Click 'Mark Document' on any student submission"
    echo "  3. Add scores, comments, and annotations"
    echo "  4. Save markings to return graded work to students"
    echo ""
    echo "📖 See TEACHER_MARKING_GUIDE.md for detailed instructions"
else
    echo "❌ Migration failed!"
    echo "💡 Check the error logs above for details"
    echo "🔧 You may need to run this script manually or contact support"
    exit 1
fi
