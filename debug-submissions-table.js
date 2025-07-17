const db = require('./config/database');

async function checkSubmissionsTable() {
    try {
        console.log('🔍 Checking submissions table structure...');
        
        // Check if table exists
        const tableExists = await db.query(`
            SELECT EXISTS (
                SELECT FROM information_schema.tables 
                WHERE table_name = 'submissions'
            );
        `);
        
        console.log('Table exists:', tableExists.rows[0].exists);
        
        if (tableExists.rows[0].exists) {
            // Get table structure
            const columns = await db.query(`
                SELECT column_name, data_type, is_nullable, column_default
                FROM information_schema.columns 
                WHERE table_name = 'submissions'
                ORDER BY ordinal_position;
            `);
            
            console.log('\n📋 Submissions table columns:');
            columns.rows.forEach(col => {
                console.log(`  ${col.column_name}: ${col.data_type} (nullable: ${col.is_nullable})`);
            });
            
            // Test a simple insert to see what fails
            console.log('\n🧪 Testing simple insert...');
            try {
                const testResult = await db.query(`
                    INSERT INTO submissions (
                        task_id, student_id, quiz_answers, score, max_score, 
                        status, attempt_number, time_taken
                    )
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                    RETURNING id, score, max_score, submitted_at, status
                `, [
                    1, // task_id
                    1, // student_id  
                    JSON.stringify([]), // quiz_answers
                    0, // score
                    10, // max_score
                    'graded', // status
                    1, // attempt_number
                    60 // time_taken
                ]);
                
                console.log('✅ Test insert successful:', testResult.rows[0]);
                
                // Clean up test record
                await db.query('DELETE FROM submissions WHERE id = $1', [testResult.rows[0].id]);
                console.log('🧹 Test record cleaned up');
                
            } catch (insertError) {
                console.error('❌ Test insert failed:', insertError.message);
                console.error('Error code:', insertError.code);
                console.error('Error detail:', insertError.detail);
            }
        } else {
            console.log('❌ Submissions table does not exist! Creating it...');
            
            // Create the submissions table
            await db.query(`
                CREATE TABLE IF NOT EXISTS submissions (
                    id SERIAL PRIMARY KEY,
                    task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
                    student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    quiz_answers JSONB,
                    score DECIMAL(5,2) DEFAULT 0,
                    max_score DECIMAL(5,2) NOT NULL,
                    status VARCHAR(50) DEFAULT 'pending',
                    attempt_number INTEGER DEFAULT 1,
                    time_taken INTEGER,
                    submitted_at TIMESTAMP DEFAULT NOW(),
                    graded_at TIMESTAMP,
                    graded_by INTEGER REFERENCES users(id),
                    feedback TEXT,
                    created_at TIMESTAMP DEFAULT NOW(),
                    updated_at TIMESTAMP DEFAULT NOW()
                );
            `);
            
            console.log('✅ Submissions table created successfully!');
        }
        
    } catch (error) {
        console.error('❌ Error checking submissions table:', error);
    } finally {
        process.exit(0);
    }
}

checkSubmissionsTable();
