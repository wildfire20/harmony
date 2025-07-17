import("node-fetch").then(({ default: fetch }) => {
  fetch('https://content-compassion-production.up.railway.app/')
    .then(response => {
      console.log('Status:', response.status);
      console.log('Status Text:', response.statusText);
      return response.text();
    })
    .then(data => {
      console.log('Response received, first 200 chars:');
      console.log(data.substring(0, 200));
    })
    .catch(error => {
      console.error('Error:', error.message);
    });
}).catch(err => {
  console.error('Failed to import node-fetch:', err.message);
  
  // Fallback to basic HTTP test
  const https = require('https');
  const req = https.get('https://content-compassion-production.up.railway.app/', (res) => {
    console.log('Status:', res.statusCode);
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
      console.log('Response received, first 200 chars:');
      console.log(data.substring(0, 200));
    });
  });
  
  req.on('error', (err) => {
    console.error('Request error:', err.message);
  });
  
  req.setTimeout(10000, () => {
    console.error('Request timeout');
    req.destroy();
  });
});
