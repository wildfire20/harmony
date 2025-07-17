const express = require('express');
const { Pool } = require('pg');

// Create a simple migration endpoint
const createMigrationEndpoint = (app) => {
  app.get('/run-migration-once', async (req, res) => {
    // Add a simple auth check
    const authKey = req.query.key;
    if (authKey !== 'migrate-marking-system-2025') {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const databaseUrl = process.env.DATABASE_URL;
    
    if (!databaseUrl) {
      return res.status(500).json({ error: 'DATABASE_URL not found' });
    }

    const db = new Pool({
      connectionString: databaseUrl,
      ssl: { rejectUnauthorized: false }
    });

    try {
      console.log('🔄 Starting database migration via HTTP endpoint...');

      // Check current table structure
      const columns = await db.query(`
        SELECT column_name, data_type, is_nullable
        FROM information_schema.columns 
        WHERE table_name = 'submissions'
        ORDER BY ordinal_position
      `);
      
      console.log('📋 Current submissions table columns:');
      columns.rows.forEach(col => {
        console.log(`  • ${col.column_name}: ${col.data_type}`);
      });

      // Check if marking columns exist
      const hasTeacherComments = columns.rows.some(col => col.column_name === 'teacher_comments');
      const hasAnnotations = columns.rows.some(col => col.column_name === 'annotations');

      let results = {
        teacher_comments: hasTeacherComments ? 'EXISTS' : 'MISSING',
        annotations: hasAnnotations ? 'EXISTS' : 'MISSING',
        actions: []
      };

      // Add missing columns
      if (!hasTeacherComments) {
        console.log('\n🔧 Adding teacher_comments column...');
        await db.query(`ALTER TABLE submissions ADD COLUMN teacher_comments TEXT`);
        results.actions.push('Added teacher_comments column');
        console.log('✅ teacher_comments column added');
      }

      if (!hasAnnotations) {
        console.log('\n🔧 Adding annotations column...');
        await db.query(`ALTER TABLE submissions ADD COLUMN annotations JSONB DEFAULT '[]'::jsonb`);
        results.actions.push('Added annotations column');
        console.log('✅ annotations column added');
      }

      // Test the columns
      const testResult = await db.query(`
        SELECT COUNT(*) as total_submissions,
               COUNT(teacher_comments) as with_comments,
               COUNT(annotations) as with_annotations
        FROM submissions
      `);
      
      results.statistics = testResult.rows[0];
      results.success = true;
      results.message = 'Migration completed successfully!';

      console.log('🎉 Migration completed successfully!');
      
      await db.end();
      
      res.json(results);

    } catch (error) {
      console.error('❌ Migration failed:', error);
      await db.end();
      res.status(500).json({ 
        error: 'Migration failed', 
        details: error.message 
      });
    }
  });
};

module.exports = { createMigrationEndpoint };
