const http = require('http');

// Helper to make HTTP requests
function makeRequest(options, body) {
    return new Promise((resolve, reject) => {
        const req = http.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                try {
                    resolve({
                        status: res.statusCode,
                        body: JSON.parse(data),
                        headers: res.headers
                    });
                } catch {
                    resolve({
                        status: res.statusCode,
                        body: data,
                        headers: res.headers
                    });
                }
            });
        });
        req.on('error', reject);
        if (body) req.write(JSON.stringify(body));
        req.end();
    });
}

async function testSessionRefresh() {
    console.log('\n=== Session Refresh Flow Test ===\n');

    try {
        // Step 1: Register new user
        console.log('1. Registering new user...');
        const registerRes = await makeRequest(
            {
                hostname: 'localhost',
                port: 4000,
                path: '/v1/auth/register',
                method: 'POST',
                headers: { 'Content-Type': 'application/json' }
            },
            {
                email: `test-${Date.now()}@example.com`,
                password: 'testpassword123',
                firstName: 'Test',
                lastName: 'User'
            }
        );

        if (registerRes.status !== 201) {
            console.error('   ✗ Register failed:', registerRes.body);
            process.exit(1);
        }

        console.log('   ✓ Register successful');

        // Step 2: Login
        console.log('\n2. Logging in...');
        const loginRes = await makeRequest(
            {
                hostname: 'localhost',
                port: 4000,
                path: '/v1/auth/login',
                method: 'POST',
                headers: { 'Content-Type': 'application/json' }
            },
            {
                email: registerRes.body.user.email,
                password: 'testpassword123'
            }
        );

        if (loginRes.status !== 200) {
            console.error('   ✗ Login failed:', loginRes.body);
            process.exit(1);
        }

        const { accessToken, refreshToken } = loginRes.body;
        console.log('   ✓ Login successful');
        console.log('   - Access token:', accessToken.substring(0, 20) + '...');
        console.log('   - Refresh token:', refreshToken.substring(0, 20) + '...');

        // Step 3: Test refresh endpoint
        console.log('\n3. Testing refresh endpoint...');
        const refreshRes = await makeRequest(
            {
                hostname: 'localhost',
                port: 4000,
                path: '/v1/auth/refresh',
                method: 'POST',
                headers: { 'Content-Type': 'application/json' }
            },
            { refreshToken }
        );

        if (refreshRes.status !== 200) {
            console.error('   ✗ Refresh failed:', refreshRes.body);
            process.exit(1);
        }

        const newAccessToken = refreshRes.body.accessToken;
        console.log('   ✓ Refresh successful');
        console.log('   - New access token:', newAccessToken.substring(0, 20) + '...');

        // Step 4: Test invalid refresh token
        console.log('\n4. Testing invalid refresh token...');
        const invalidRefreshRes = await makeRequest(
            {
                hostname: 'localhost',
                port: 4000,
                path: '/v1/auth/refresh',
                method: 'POST',
                headers: { 'Content-Type': 'application/json' }
            },
            { refreshToken: 'invalid.token.here' }
        );

        if (invalidRefreshRes.status === 400 || invalidRefreshRes.status === 401) {
            console.log('   ✓ Invalid refresh token correctly rejected (status ' + invalidRefreshRes.status + ')');
        } else {
            console.error('   ✗ Invalid refresh token should have been rejected');
            process.exit(1);
        }

        // Step 5: Test missing refresh token
        console.log('\n5. Testing missing refresh token...');
        const noTokenRes = await makeRequest(
            {
                hostname: 'localhost',
                port: 4000,
                path: '/v1/auth/refresh',
                method: 'POST',
                headers: { 'Content-Type': 'application/json' }
            },
            {}
        );

        if (noTokenRes.status === 400) {
            console.log('   ✓ Missing refresh token correctly rejected');
        } else {
            console.error('   ✗ Missing refresh token should have been rejected, got status:', noTokenRes.status);
            process.exit(1);
        }

        console.log('\n=== All tests passed! ===\n');
        process.exit(0);

    } catch (error) {
        console.error('Test error:', error);
        process.exit(1);
    }
}

testSessionRefresh();
