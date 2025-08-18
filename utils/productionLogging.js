/**
 * Production Logging Optimizer
 * Reduces excessive console logging in production environment
 */

const originalConsoleLog = console.log;
const originalConsoleError = console.error;

// Only log errors and critical information in production
const isProduction = process.env.NODE_ENV === 'production';
const isRailway = process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_PROJECT_ID;

if (isProduction || isRailway) {
  // Override console.log to be more selective in production
  console.log = function(...args) {
    // Only log if it's important (contains specific keywords)
    const message = args.join(' ');
    const isImportant = message.includes('ERROR') || 
                       message.includes('FAILED') || 
                       message.includes('SUCCESS') ||
                       message.includes('PROCESSING RESULTS SUMMARY') ||
                       message.includes('Enhanced Payment System') ||
                       message.includes('Database setup');
    
    if (isImportant) {
      originalConsoleLog.apply(console, args);
    }
  };
  
  // Keep error logging but limit frequency
  let lastErrorTime = 0;
  console.error = function(...args) {
    const now = Date.now();
    if (now - lastErrorTime > 5000) { // Only log errors every 5 seconds max
      originalConsoleError.apply(console, args);
      lastErrorTime = now;
    }
  };
  
  console.info = console.log; // Redirect info to filtered log
  console.warn = console.log; // Redirect warn to filtered log
}

module.exports = {
  originalConsoleLog,
  originalConsoleError
};
