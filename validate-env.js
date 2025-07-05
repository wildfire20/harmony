// Production Environment Validation
const validateProductionEnvironment = () => {
  const requiredEnvVars = [
    'NODE_ENV',
    'JWT_SECRET',
    'DB_HOST',
    'DB_NAME',
    'DB_USER',
    'DB_PASSWORD'
  ];

  const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);
  
  if (missingVars.length > 0) {
    console.error('❌ Missing required environment variables:');
    missingVars.forEach(varName => {
      console.error(`   - ${varName}`);
    });
    console.error('\n📋 Please set these variables before starting the server.');
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
