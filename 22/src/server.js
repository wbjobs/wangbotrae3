const express = require('express');
const { resolveDependencies, getLastConflictLog, computePackageHash } = require('./resolver');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

app.post('/resolve', (req, res) => {
  try {
    const { name, versionRange } = req.body;
    
    if (!name) {
      return res.status(400).json({
        error: 'Package name is required'
      });
    }
    
    const result = resolveDependencies(name, versionRange || '*');
    const contentHash = computePackageHash(name, versionRange || '*');
    
    res.json({
      ...result,
      contentHash
    });
  } catch (error) {
    res.status(500).json({
      error: error.message
    });
  }
});

app.get('/conflict', (req, res) => {
  const conflictLog = getLastConflictLog();
  
  if (conflictLog) {
    res.json(conflictLog);
  } else {
    res.json({
      message: 'No conflicts recorded',
      timestamp: new Date().toISOString()
    });
  }
});

app.post('/hash', (req, res) => {
  try {
    const { name, versionRange } = req.body;
    
    if (!name) {
      return res.status(400).json({
        error: 'Package name is required'
      });
    }
    
    const hash = computePackageHash(name, versionRange || '*');
    
    res.json({
      name,
      versionRange: versionRange || '*',
      contentHash: hash
    });
  } catch (error) {
    res.status(500).json({
      error: error.message
    });
  }
});

app.listen(PORT, () => {
  console.log(`PKGM API server running on http://localhost:${PORT}`);
  console.log('Endpoints:');
  console.log('  POST /resolve - Resolve package dependencies');
  console.log('  GET  /conflict - Get last conflict log');
  console.log('  POST /hash    - Get content hash for caching');
});

module.exports = app;
