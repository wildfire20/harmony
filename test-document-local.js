/**
 * Local Test Script for Document Functionality (Without Cloud Storage)
 * This script tests the document upload and download functionality using local storage
 */

const fs = require('fs');
const path = require('path');
const FormData = require('form-data');
const axios = require('axios');

// Configuration
const BASE_URL = 'http://localhost:5000'; // Change this to your local server URL
const TEST_FILE_PATH = path.join(__dirname, 'test-files');

// Ensure test files directory exists
if (!fs.existsSync(TEST_FILE_PATH)) {
    fs.mkdirSync(TEST_FILE_PATH, { recursive: true });
}

// Create a test PDF file for uploading
function createTestFile() {
    const testContent = `%PDF-1.4
1 0 obj
<<
/Type /Catalog
/Pages 2 0 R
>>
endobj

2 0 obj
<<
/Type /Pages
/Kids [3 0 R]
/Count 1
>>
endobj

3 0 obj
<<
/Type /Page
/Parent 2 0 R
/MediaBox [0 0 612 792]
/Contents 4 0 R
>>
endobj

4 0 obj
<<
/Length 44
>>
stream
BT
/F1 12 Tf
100 700 Td
(Hello World - Test Document) Tj
ET
endstream
endobj

xref
0 5
0000000000 65535 f 
0000000009 00000 n 
0000000074 00000 n 
0000000120 00000 n 
0000000179 00000 n 
trailer
<<
/Size 5
/Root 1 0 R
>>
startxref
274
%%EOF`;

    const testFilePath = path.join(TEST_FILE_PATH, 'test-document.pdf');
    fs.writeFileSync(testFilePath, testContent);
    return testFilePath;
}

// Test authentication - Get a token for testing
async function authenticateUser() {
    try {
        console.log('🔐 Authenticating user...');
        
        // You'll need to replace these with actual test credentials
        const response = await axios.post(`${BASE_URL}/api/auth/login/staff`, {
            email: 'admin@harmonylearning.edu', // Default admin user
            password: 'admin123'                // Default admin password
        });

        if (response.data.token) {
            console.log('✅ Authentication successful');
            return response.data.token;
        } else {
            throw new Error('No token received');
        }
    } catch (error) {
        console.error('❌ Authentication failed:', error.response?.data || error.message);
        console.log('💡 Please create a test user first or update the credentials in this script');
        return null;
    }
}

// Test document upload
async function testDocumentUpload(token) {
    try {
        console.log('📤 Testing document upload...');
        
        const testFilePath = createTestFile();
        console.log('Test file created:', testFilePath);

        const form = new FormData();
        form.append('document', fs.createReadStream(testFilePath));
        form.append('title', 'Test Document Upload');
        form.append('description', 'This is a test document for local testing');
        form.append('document_type', 'other');
        form.append('target_audience', 'everyone'); // Required for admin uploads

        const response = await axios.post(`${BASE_URL}/api/documents/upload`, form, {
            headers: {
                ...form.getHeaders(),
                'Authorization': `Bearer ${token}`
            }
        });

        console.log('✅ Document upload successful!');
        console.log('Response:', JSON.stringify(response.data, null, 2));
        return response.data.document.id;

    } catch (error) {
        console.error('❌ Document upload failed:');
        console.error('Status:', error.response?.status);
        console.error('Error:', error.response?.data || error.message);
        return null;
    }
}

// Test document download
async function testDocumentDownload(token, documentId) {
    try {
        console.log('📥 Testing document download...');
        
        const response = await axios.get(`${BASE_URL}/api/documents/download/${documentId}`, {
            headers: {
                'Authorization': `Bearer ${token}`
            },
            responseType: 'stream'
        });

        console.log('✅ Document download successful!');
        console.log('Content-Type:', response.headers['content-type']);
        console.log('Content-Length:', response.headers['content-length']);

        // Save downloaded file for verification
        const downloadPath = path.join(TEST_FILE_PATH, 'downloaded-document.pdf');
        const writer = fs.createWriteStream(downloadPath);
        response.data.pipe(writer);

        return new Promise((resolve, reject) => {
            writer.on('finish', () => {
                console.log('Downloaded file saved to:', downloadPath);
                resolve(true);
            });
            writer.on('error', reject);
        });

    } catch (error) {
        console.error('❌ Document download failed:');
        console.error('Status:', error.response?.status);
        console.error('Error:', error.response?.data || error.message);
        return false;
    }
}

// Test document listing
async function testDocumentListing(token) {
    try {
        console.log('📋 Testing document listing...');
        
        // Test getting documents for a specific grade/class
        const response = await axios.get(`${BASE_URL}/api/documents/grade/1/class/1`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        console.log('✅ Document listing successful!');
        console.log('Documents found:', response.data.total || 0);
        if (response.data.documents) {
            console.log('Sample document:', JSON.stringify(response.data.documents, null, 2));
        }
        return true;

    } catch (error) {
        console.error('❌ Document listing failed:');
        console.error('Status:', error.response?.status);
        console.error('Error:', error.response?.data || error.message);
        return false;
    }
}

// Main test function
async function runTests() {
    console.log('🧪 Starting Document Functionality Tests (Local Storage Mode)');
    console.log('='.repeat(60));

    // Step 1: Authenticate
    const token = await authenticateUser();
    if (!token) {
        console.log('❌ Cannot proceed without authentication token');
        return;
    }

    // Step 2: Test document upload
    const documentId = await testDocumentUpload(token);
    if (!documentId) {
        console.log('❌ Cannot test download without successful upload');
        return;
    }

    // Step 3: Test document listing
    await testDocumentListing(token);

    // Step 4: Test document download
    await testDocumentDownload(token, documentId);

    console.log('='.repeat(60));
    console.log('🎉 Testing complete! Check the results above.');
    console.log('');
    console.log('💡 Tips:');
    console.log('- If upload works but shows S3 errors, that\'s normal - local storage fallback is working');
    console.log('- Check the uploads/ directory for uploaded files');
    console.log('- Check test-files/ directory for the test files created');
}

// Handle command line execution
if (require.main === module) {
    runTests().catch(console.error);
}

module.exports = {
    runTests,
    testDocumentUpload,
    testDocumentDownload,
    testDocumentListing,
    authenticateUser
};
