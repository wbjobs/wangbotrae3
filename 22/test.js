const semver = require('./src/semver');
const { resolveDependencies, getLastConflictLog } = require('./src/resolver');

console.log('=== SemVer Module Tests ===\n');

console.log('1. Version comparison:');
console.log('   1.2.3 < 2.0.0:', semver.lt('1.2.3', '2.0.0'));
console.log('   1.10.3 > 1.9.0:', semver.gt('1.10.3', '1.9.0'));
console.log('   1.0.0 == 1.0.0:', semver.eq('1.0.0', '1.0.0'));

console.log('\n2. Range satisfaction:');
console.log('   1.5.0 satisfies ^1.0.0:', semver.satisfies('1.5.0', '^1.0.0'));
console.log('   2.0.0 satisfies ^1.0.0:', semver.satisfies('2.0.0', '^1.0.0'));
console.log('   1.2.3 satisfies ~1.2.0:', semver.satisfies('1.2.3', '~1.2.0'));
console.log('   1.3.0 satisfies ~1.2.0:', semver.satisfies('1.3.0', '~1.2.0'));

console.log('\n3. Max satisfying:');
const versions = ['1.0.0', '1.5.0', '2.0.0', '2.1.0'];
console.log('   Versions:', versions);
console.log('   Max satisfying ^1.0.0:', semver.maxSatisfying(versions, '^1.0.0'));
console.log('   Max satisfying ~1.0.0:', semver.maxSatisfying(versions, '~1.0.0'));

console.log('\n=== Dependency Resolution Tests ===\n');

console.log('4. Resolve package-c (lodash ^3.0.0, axios ~1.2.0):');
const result1 = resolveDependencies('package-c', '1.0.0');
console.log('   Has conflicts:', result1.hasConflicts);
console.log('   Resolved:', result1.resolved);

console.log('\n5. Resolve package-d (react + prop-types, should work):');
const result2 = resolveDependencies('package-d', '1.0.0');
console.log('   Has conflicts:', result2.hasConflicts);
console.log('   Resolved:', result2.resolved);

console.log('\n6. Test conflict scenario (package-a + package-b requiring different lodash):');

const packages = require('./packages.json');
const { collectVersionConstraints, resolveConstraints } = require('./src/resolver');

const treeA = require('./src/resolver').buildDependencyTree(packages, 'package-a', '1.0.0');
const treeB = require('./src/resolver').buildDependencyTree(packages, 'package-b', '1.0.0');

const constraintsA = collectVersionConstraints(treeA);
const constraintsB = collectVersionConstraints(treeB);

const combinedConstraints = {};
for (const [name, data] of Object.entries(constraintsA)) {
  combinedConstraints[name] = { ...data };
}
for (const [name, data] of Object.entries(constraintsB)) {
  if (!combinedConstraints[name]) {
    combinedConstraints[name] = { ranges: [], sources: [] };
  }
  combinedConstraints[name].ranges.push(...data.ranges);
  combinedConstraints[name].sources.push(...data.sources);
}

const { resolved, conflicts } = resolveConstraints(packages, combinedConstraints);
console.log('   Combined lodash ranges:', combinedConstraints.lodash.ranges);
console.log('   Has conflicts:', conflicts.length > 0);
if (conflicts.length > 0) {
  console.log('   Conflict package:', conflicts[0].package);
  console.log('   Conflict error:', conflicts[0].error);
}

console.log('\n7. Conflict log:');
const conflictLog = getLastConflictLog();
console.log('   Log available:', conflictLog !== null);

console.log('\n=== All tests completed! ===');
