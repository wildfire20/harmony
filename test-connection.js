const https = require('https');

function testConnection() {
    console.log('Testing connection to production server...');
    
    const options = {
        hostname: 'content-compassion-production.up.railway.app',
        port: 443,
        path: '/',
        method: 'GET'
    };

    const req = https.request(options, (res) => {
        console.log(`Status: ${res.statusCode}`);
        console.log(`Headers:`, res.headers);
        
        let data = '';
        res.on('data', (chunk) => {
            data += chunk;
        });
        
        res.on('end', () => {
            console.log('Response received');
            console.log('First 200 chars:', data.substring(0, 200));
        });
    });

    req.on('error', (e) => {
        console.error(`Problem with request: ${e.message}`);
    });

    req.setTimeout(10000, () => {
        console.error('Request timeout');
        req.destroy();
    });

    req.end();
}

testConnection();
