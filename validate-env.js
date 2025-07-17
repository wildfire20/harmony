// Production Environment Validation
const validateProductionEnvironment = () => {
  const requiredEnvVars = [
    'NODE_ENV',
    'JWT_SECRET'
  ];

  // Database variables - Railway uses PG*, others use DB*
  const hasRailwayDB = process.env.PGHOST && process.env.PGDATABASE && process.env.PGUSER && process.env.PGPASSWORD;
  const hasStandardDB = process.env.DB_HOST && process.env.DB_NAME && process.env.DB_USER && process.env.DB_PASSWORD;
  
  if (!hasRailwayDB && !hasStandardDB) {
    requiredEnvVars.push('PGHOST or DB_HOST', 'PGDATABASE or DB_NAME', 'PGUSER or DB_USER', 'PGPASSWORD or DB_PASSWORD');
  }

  const missingVars = requiredEnvVars.filter(varName => {
    // Skip the database variables we already checked
    if (varName.includes('or')) return false;
    return !process.env[varName];
  });
  
  if (missingVars.length > 0 || (!hasRailwayDB && !hasStandardDB)) {
    console.error('❌ Missing required environment variables:');
    missingVars.forEach(varName => {
      console.error(`   - ${varName}`);
    });
    if (!hasRailwayDB && !hasStandardDB) {
      console.error('   - Database variables (either PG* or DB* format)');
    }
    console.error('\n📋 Please set these variables before starting the server.');
    console.error('💡 For Railway: Use PGHOST, PGDATABASE, PGUSER, PGPASSWORD');
    console.error('💡 For other platforms: Use DB_HOST, DB_NAME, DB_USER, DB_PASSWORD');
    process.exit(1);
  }

  // Validate JWT secret strength
  if (process.env.JWT_SECRET && process.env.JWT_SECRET.length < 32) {
    console.warn('⚠️  JWT_SECRET should be at least 32 characters long for production');
  }

  // Validate database configuration
  if (process.env.NODE_ENV === 'production') {
    if (!process.env.DB_HOST || process.env.DB_HOST.includes('localhost')) {
      console.warn('⚠️  Using localhost database in production mode');
    }
  }

  console.log('✅ Environment validation passed');
};

// Run validation if this file is executed directly
if (require.main === module) {
  require('dotenv').config();
  validateProductionEnvironment();
}

module.exports = { validateProductionEnvironment };
