const http = require('http');

function makeRequest(options, data = null) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch (e) {
          reject(new Error(`Invalid JSON: ${body}`));
        }
      });
    });
    req.on('error', reject);
    if (data) req.write(JSON.stringify(data));
    req.end();
  });
}

async function testConflict() {
  console.log('=== Testing Conflict Detection ===\n');
  
  const packages = require('./packages.json');
  
  packages['conflict-test'] = {
    '1.0.0': {
      version: '1.0.0',
      dependencies: {
        'package-a': '^1.0.0',
        'package-b': '^1.0.0'
      }
    }
  };
  
  const fs = require('fs');
  fs.writeFileSync('./packages.json', JSON.stringify(packages, null, 2));
  
  console.log('1. Resolving conflict-test package...');
  
  const result = await makeRequest({
    host: 'localhost',
    port: 3000,
    path: '/resolve',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, { name: 'conflict-test', versionRange: '1.0.0' });
  
  console.log('   Has conflicts:', result.hasConflicts);
  
  if (result.hasConflicts) {
    console.log('   Conflicts:', JSON.stringify(result.conflicts, null, 2));
  }
  
  console.log('\n2. Getting conflict log via /conflict endpoint...');
  
  const conflictLog = await makeRequest({
    host: 'localhost',
    port: 3000,
    path: '/conflict',
    method: 'GET',
    headers: { 'Content-Type': 'application/json' }
  });
  
  console.log('   Conflict log:', JSON.stringify(conflictLog, null, 2));
  
  console.log('\n3. Testing CLI conflict command...');
  console.log('   Run: node src/cli.js conflict');
}

testConflict().catch(console.error);
