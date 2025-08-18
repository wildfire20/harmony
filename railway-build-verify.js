#!/usr/bin/env node
/**
 * Railway Deployment Verification Script
 * Verifies all enhanced payment system components load correctly
 */

console.log('🔍 Verifying Enhanced Payment System components...');

try {
  // Test server-side imports
  console.log('📦 Testing server-side imports...');
  
  // Test EnhancedCSVParser
  const EnhancedCSVParser = require('./utils/enhancedCSVParser');
  console.log('✅ EnhancedCSVParser loaded successfully');
  
  // Test enhanced routes
  const enhancedRoutes = require('./routes/enhanced-invoices');
  console.log('✅ Enhanced invoice routes loaded successfully');
  
  // Test database config
  const db = require('./config/database');
  console.log('✅ Database config loaded successfully');
  
  // Test existing core modules
  const express = require('express');
  const path = require('path');
  const cors = require('cors');
  console.log('✅ Core dependencies loaded successfully');
  
  console.log('🎉 All enhanced payment system components verified!');
  console.log('✅ Ready for Railway deployment');
  
} catch (error) {
  console.error('❌ Verification failed:');
  console.error(error.message);
  console.error(error.stack);
  process.exit(1);
}
