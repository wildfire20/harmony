#!/usr/bin/env node

// Direct CLI command to fix database schema
require('dotenv').config();

const fixDatabaseSchema = require('./fix-database-schema');

console.log('🚀 Starting database schema fix...');
console.log('Environment:', process.env.NODE_ENV || 'development');

fixDatabaseSchema()
  .then(() => {
    console.log('\n🎉 Database schema fix completed successfully!');
    console.log('📋 Next steps:');
    console.log('1. Restart the application');
    console.log('2. Upload a CSV file');
    console.log('3. Invoice statuses should now update correctly');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Database schema fix failed:');
    console.error(error);
    process.exit(1);
  });
