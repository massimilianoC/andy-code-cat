const http = require('http');

const options = {
    hostname: 'localhost',
    port: 4000,
    path: '/health',
    method: 'GET'
};

const req = http.request(options, (res) => {
    let data = '';
    res.on('data', (chunk) => { data += chunk; });
    res.on('end', () => {
        console.log('Health check response:', data);
        process.exit(0);
    });
});

req.on('error', (error) => {
    console.error('Health check failed:', error.message);
    process.exit(1);
});

req.end();
