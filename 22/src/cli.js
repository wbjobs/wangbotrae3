#!/usr/bin/env node

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const API_HOST = 'localhost';
const API_PORT = 3000;
const CACHE_DIR = path.join(process.cwd(), '.pkgm-cache');

function ensureCacheDir() {
  if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
  }
}

function getCacheKey(name, versionRange) {
  const input = `${name}@${versionRange}`;
  return crypto
    .createHash('sha256')
    .update(input)
    .digest('hex')
    .substring(0, 16);
}

function getCachePath(cacheKey) {
  return path.join(CACHE_DIR, `${cacheKey}.json`);
}

function readCache(cacheKey) {
  const cachePath = getCachePath(cacheKey);
  if (fs.existsSync(cachePath)) {
    try {
      return JSON.parse(fs.readFileSync(cachePath, 'utf8'));
    } catch (e) {
      return null;
    }
  }
  return null;
}

function writeCache(cacheKey, data) {
  ensureCacheDir();
  const cachePath = getCachePath(cacheKey);
  const cacheData = {
    cachedAt: new Date().toISOString(),
    ...data
  };
  fs.writeFileSync(cachePath, JSON.stringify(cacheData, null, 2));
}

function parseArgs(args) {
  const [command, ...rest] = args;
  
  if (command === 'install') {
    const packageArg = rest[0];
    if (!packageArg) {
      return { command: 'install', error: 'Package name is required' };
    }
    
    const atIndex = packageArg.lastIndexOf('@');
    if (atIndex > 0) {
      return {
        command: 'install',
        name: packageArg.slice(0, atIndex),
        versionRange: packageArg.slice(atIndex + 1)
      };
    }
    
    return {
      command: 'install',
      name: packageArg,
      versionRange: '*'
    };
  }
  
  if (command === 'conflict') {
    return { command: 'conflict' };
  }
  
  if (command === 'clear-cache') {
    return { command: 'clear-cache' };
  }
  
  return { command, error: `Unknown command: ${command}` };
}

function makeRequest(options, data = null) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(body);
          if (res.statusCode >= 400) {
            reject(new Error(json.error || `HTTP ${res.statusCode}`));
          } else {
            resolve(json);
          }
        } catch (e) {
          reject(new Error(`Invalid JSON response: ${body}`));
        }
      });
    });
    
    req.on('error', reject);
    
    if (data) {
      req.write(JSON.stringify(data));
    }
    
    req.end();
  });
}

function resolvePackage(name, versionRange) {
  const options = {
    host: API_HOST,
    port: API_PORT,
    path: '/resolve',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    }
  };
  
  return makeRequest(options, { name, versionRange });
}

function getPackageHash(name, versionRange) {
  const options = {
    host: API_HOST,
    port: API_PORT,
    path: '/hash',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    }
  };
  
  return makeRequest(options, { name, versionRange });
}

function getConflictLog() {
  const options = {
    host: API_HOST,
    port: API_PORT,
    path: '/conflict',
    method: 'GET'
  };
  
  return makeRequest(options);
}

function clearCache() {
  if (fs.existsSync(CACHE_DIR)) {
    const files = fs.readdirSync(CACHE_DIR);
    for (const file of files) {
      fs.unlinkSync(path.join(CACHE_DIR, file));
    }
    fs.rmdirSync(CACHE_DIR);
    console.log('✅ Cache cleared successfully!');
  } else {
    console.log('ℹ️  No cache directory found.');
  }
}

function generateLockFile(resolved, rootName) {
  const lockData = {
    name: rootName,
    version: resolved[rootName],
    lockfileVersion: 1,
    timestamp: new Date().toISOString(),
    dependencies: {}
  };
  
  for (const [name, version] of Object.entries(resolved)) {
    lockData.dependencies[name] = {
      version
    };
  }
  
  return lockData;
}

function printConflictReport(conflictLog) {
  console.log('\n❌ Dependency Conflicts Detected!\n');
  console.log('='.repeat(60));
  
  for (const conflict of conflictLog.conflicts) {
    console.log(`\n📦 Package: ${conflict.package}`);
    console.log(`   Error: ${conflict.error}`);
    console.log(`   Required Ranges: ${conflict.requiredRanges.join(', ')}`);
    console.log('\n   Sources:');
    
    for (const detail of conflict.details) {
      const sourceChain = detail.requiredBy.length > 0 
        ? detail.requiredBy.join(' -> ')
        : 'root';
      console.log(`     - ${detail.range} (from ${sourceChain})`);
    }
  }
  
  console.log('\n' + '='.repeat(60));
  console.log('\n💡 Try running "pkgm conflict" for more details.');
}

async function installWithCache(parsed) {
  const cacheKey = getCacheKey(parsed.name, parsed.versionRange);
  const cached = readCache(cacheKey);
  
  if (cached) {
    console.log(`📦 Checking cache for ${parsed.name}@${parsed.versionRange}...`);
    
    try {
      const remoteHash = await getPackageHash(parsed.name, parsed.versionRange);
      
      if (remoteHash.contentHash === cached.contentHash) {
        console.log('✅ Cache hit! Using cached resolution result.');
        console.log(`   Cached at: ${cached.cachedAt}`);
        
        if (cached.hasConflicts) {
          const conflictLog = await getConflictLog();
          printConflictReport(conflictLog);
          process.exit(1);
        }
        
        console.log('');
        console.log('Resolved packages:');
        
        for (const [name, version] of Object.entries(cached.resolved)) {
          console.log(`  - ${name}@${version}`);
        }
        
        const lockData = generateLockFile(cached.resolved, parsed.name);
        const lockPath = path.join(process.cwd(), 'lock.json');
        
        fs.writeFileSync(lockPath, JSON.stringify(lockData, null, 2));
        
        console.log('');
        console.log(`📄 lock.json generated at ${lockPath}`);
        return;
      } else {
        console.log('🔄 Cache outdated, fetching fresh resolution...');
      }
    } catch (e) {
      console.log('⚠️  Could not verify cache, using cached result anyway...');
    }
  }
  
  console.log(`🔍 Resolving ${parsed.name}@${parsed.versionRange}...`);
  
  const result = await resolvePackage(parsed.name, parsed.versionRange);
  
  writeCache(cacheKey, result);
  
  if (result.hasConflicts) {
    const conflictLog = await getConflictLog();
    printConflictReport(conflictLog);
    process.exit(1);
  }
  
  console.log('✅ Dependencies resolved successfully!');
  console.log('');
  console.log('Resolved packages:');
  
  for (const [name, version] of Object.entries(result.resolved)) {
    console.log(`  - ${name}@${version}`);
  }
  
  const lockData = generateLockFile(result.resolved, parsed.name);
  const lockPath = path.join(process.cwd(), 'lock.json');
  
  fs.writeFileSync(lockPath, JSON.stringify(lockData, null, 2));
  
  console.log('');
  console.log(`📄 lock.json generated at ${lockPath}`);
  console.log(`💾 Cached result saved to .pkgm-cache/`);
}

async function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.log('Usage: pkgm <command> [options]');
    console.log('');
    console.log('Commands:');
    console.log('  install <package>[@version]   Install a package and resolve dependencies');
    console.log('  conflict                      Show last conflict log');
    console.log('  clear-cache                   Clear local cache');
    process.exit(1);
  }
  
  const parsed = parseArgs(args);
  
  if (parsed.error) {
    console.error(`Error: ${parsed.error}`);
    process.exit(1);
  }
  
  try {
    if (parsed.command === 'install') {
      await installWithCache(parsed);
      
    } else if (parsed.command === 'conflict') {
      const conflictLog = await getConflictLog();
      
      if (conflictLog.message === 'No conflicts recorded') {
        console.log('✅ No conflicts recorded yet.');
      } else {
        printConflictReport(conflictLog);
      }
    } else if (parsed.command === 'clear-cache') {
      clearCache();
    }
  } catch (error) {
    console.error(`\n❌ Error: ${error.message}`);
    
    if (error.message.includes('connect') || error.message.includes('ECONNREFUSED')) {
      console.log('\n💡 Make sure the API server is running:');
      console.log('   npm start');
    }
    
    process.exit(1);
  }
}

main();
