const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const semver = require('./semver');

const PACKAGES_FILE = path.join(__dirname, '..', 'packages.json');

let lastConflictLog = null;

function computeHash(data) {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(data, Object.keys(data).sort()))
    .digest('hex')
    .substring(0, 16);
}

function loadPackages() {
  const data = fs.readFileSync(PACKAGES_FILE, 'utf8');
  return JSON.parse(data);
}

function getPackageVersions(packages, name) {
  const pkg = packages[name];
  if (!pkg) return [];
  return Object.keys(pkg);
}

function getPackageInfo(packages, name, version) {
  const pkg = packages[name];
  if (!pkg || !pkg[version]) return null;
  return pkg[version];
}

function buildDependencyTree(packages, name, versionRange) {
  const stack = [];
  
  stack.push({
    name,
    versionRange,
    requiredBy: [],
    parentNode: null,
    depName: null,
    processed: false,
    node: null
  });
  
  let rootNode = null;
  
  while (stack.length > 0) {
    const frame = stack.pop();
    
    if (!frame.processed) {
      const versions = getPackageVersions(packages, frame.name);
      
      let node;
      
      if (versions.length === 0) {
        node = {
          name: frame.name,
          versionRange: frame.versionRange,
          requiredBy: frame.requiredBy.length > 0 ? frame.requiredBy : undefined,
          error: `Package "${frame.name}" not found in repository`,
          dependencies: {}
        };
      } else {
        const selectedVersion = semver.maxSatisfying(versions, frame.versionRange);
        
        if (!selectedVersion) {
          node = {
            name: frame.name,
            versionRange: frame.versionRange,
            requiredBy: frame.requiredBy.length > 0 ? frame.requiredBy : undefined,
            error: `No matching version found for ${frame.name}@${frame.versionRange}`,
            availableVersions: versions,
            dependencies: {}
          };
        } else {
          const pkgInfo = getPackageInfo(packages, frame.name, selectedVersion);
          
          node = {
            name: frame.name,
            version: selectedVersion,
            versionRange: frame.versionRange,
            requiredBy: frame.requiredBy.length > 0 ? frame.requiredBy : undefined,
            dependencies: {}
          };
          
          const deps = pkgInfo.dependencies || {};
          const depEntries = Object.entries(deps);
          
          frame.processed = true;
          frame.node = node;
          stack.push(frame);
          
          for (let i = depEntries.length - 1; i >= 0; i--) {
            const [depName, depRange] = depEntries[i];
            const depRequiredBy = [
              ...frame.requiredBy,
              { name: frame.name, version: selectedVersion, range: depRange }
            ];
            
            stack.push({
              name: depName,
              versionRange: depRange,
              requiredBy: depRequiredBy,
              parentNode: node,
              depName: depName,
              processed: false,
              node: null
            });
          }
          
          continue;
        }
      }
      
      if (frame.parentNode && frame.depName) {
        frame.parentNode.dependencies[frame.depName] = node;
      } else {
        rootNode = node;
      }
    } else {
      if (frame.parentNode && frame.depName) {
        frame.parentNode.dependencies[frame.depName] = frame.node;
      } else {
        rootNode = frame.node;
      }
    }
  }
  
  return rootNode;
}

function collectVersionConstraints(tree, constraints = {}) {
  if (!tree) return constraints;
  
  const name = tree.name;
  const versionRange = tree.versionRange;
  
  if (!constraints[name]) {
    constraints[name] = { ranges: [], sources: [] };
  }
  
  if (versionRange) {
    constraints[name].ranges.push(versionRange);
    constraints[name].sources.push({
      range: versionRange,
      requiredBy: tree.requiredBy || []
    });
  }
  
  if (tree.dependencies) {
    for (const dep of Object.values(tree.dependencies)) {
      collectVersionConstraints(dep, constraints);
    }
  }
  
  return constraints;
}

function resolveConstraints(packages, constraints) {
  const resolved = {};
  const conflicts = [];
  
  for (const [name, constraint] of Object.entries(constraints)) {
    const versions = getPackageVersions(packages, name);
    
    if (versions.length === 0) {
      conflicts.push({
        package: name,
        error: 'Package not found in repository',
        sources: constraint.sources
      });
      continue;
    }
    
    const intersected = semver.intersectRanges(constraint.ranges);
    
    if (!intersected || intersected.length === 0) {
      conflicts.push({
        package: name,
        error: 'Version conflict',
        requiredRanges: constraint.ranges,
        sources: constraint.sources
      });
      continue;
    }
    
    let bestVersion = null;
    for (const range of intersected) {
      const version = semver.maxSatisfying(versions, range);
      if (version) {
        if (!bestVersion || semver.gt(version, bestVersion)) {
          bestVersion = version;
        }
      }
    }
    
    if (!bestVersion) {
      conflicts.push({
        package: name,
        error: 'No matching version found',
        requiredRanges: constraint.ranges,
        intersectedRange: intersected,
        availableVersions: versions,
        sources: constraint.sources
      });
      continue;
    }
    
    resolved[name] = bestVersion;
  }
  
  return { resolved, conflicts };
}

function formatConflictReport(conflicts) {
  if (conflicts.length === 0) return null;
  
  const report = {
    timestamp: new Date().toISOString(),
    conflicts: conflicts.map(conflict => ({
      package: conflict.package,
      error: conflict.error,
      requiredRanges: conflict.requiredRanges || [],
      details: conflict.sources.map(source => ({
        range: source.range,
        requiredBy: source.requiredBy.map(r => `${r.name}@${r.version}`)
      }))
    }))
  };
  
  return report;
}

function resolveDependencies(name, versionRange = '*') {
  const packages = loadPackages();
  
  const tree = buildDependencyTree(packages, name, versionRange);
  
  const constraints = collectVersionConstraints(tree);
  
  const { resolved, conflicts } = resolveConstraints(packages, constraints);
  
  const hasConflicts = conflicts.length > 0;
  
  lastConflictLog = hasConflicts ? formatConflictReport(conflicts) : null;
  
  const result = {
    root: {
      name,
      versionRange,
      resolved: hasConflicts ? null : resolved[name]
    },
    dependencyTree: tree,
    resolved: hasConflicts ? {} : resolved,
    hasConflicts,
    conflicts: hasConflicts ? conflicts.map(c => ({
      package: c.package,
      error: c.error,
      requiredRanges: c.requiredRanges
    })) : []
  };
  
  return result;
}

function getLastConflictLog() {
  return lastConflictLog;
}

function computePackageHash(name, versionRange = '*') {
  const packages = loadPackages();
  
  const visited = new Set();
  const stack = [{ name, versionRange }];
  const contentParts = [];
  
  while (stack.length > 0) {
    const { name: pkgName, versionRange: pkgRange } = stack.pop();
    const key = `${pkgName}@${pkgRange}`;
    
    if (visited.has(key)) continue;
    visited.add(key);
    
    const versions = getPackageVersions(packages, pkgName);
    const selectedVersion = semver.maxSatisfying(versions, pkgRange);
    
    if (selectedVersion) {
      const pkgInfo = getPackageInfo(packages, pkgName, selectedVersion);
      
      contentParts.push(`${pkgName}@${selectedVersion}`);
      contentParts.push(JSON.stringify(pkgInfo.dependencies || {}));
      
      const deps = pkgInfo.dependencies || {};
      for (const [depName, depRange] of Object.entries(deps)) {
        stack.push({ name: depName, versionRange: depRange });
      }
    }
  }
  
  return computeHash(contentParts.join('|'));
}

module.exports = {
  resolveDependencies,
  getLastConflictLog,
  buildDependencyTree,
  collectVersionConstraints,
  resolveConstraints,
  computePackageHash
};
