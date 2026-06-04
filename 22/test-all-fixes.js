const { resolveDependencies } = require('./src/resolver');

console.log('=== Testing All Fixes ===\n');

console.log('1. Testing deep dependency tree (6 levels):');
try {
  const result1 = resolveDependencies('deep-level-1', '1.0.0');
  console.log('   Success! No stack overflow.');
  console.log('   Has conflicts:', result1.hasConflicts);
  console.log('   Resolved:', result1.resolved);
} catch (e) {
  console.log('   Error:', e.message);
}

console.log('\n2. Testing merge scenario (dep-a needs ^3.1.0 + dep-b needs ^3.5.0):');
try {
  const result2 = resolveDependencies('merge-test', '1.0.0');
  console.log('   Success!');
  console.log('   Has conflicts:', result2.hasConflicts);
  console.log('   Resolved:', result2.resolved);
  console.log('   lodash version:', result2.resolved.lodash);
  console.log('   Expected: 3.10.0');
} catch (e) {
  console.log('   Error:', e.message);
}

console.log('\n3. Testing ^3.1.0 with 3.9.0:');
const semver = require('./src/semver');
console.log('   3.9.0 satisfies ^3.1.0:', semver.satisfies('3.9.0', '^3.1.0'));
console.log('   3.10.0 satisfies ^3.1.0:', semver.satisfies('3.10.0', '^3.1.0'));
console.log('   4.0.0 satisfies ^3.1.0:', semver.satisfies('4.0.0', '^3.1.0'));

console.log('\n4. Testing intersectRanges for ^3.1.0 and ^3.5.0:');
const intersected = semver.intersectRanges(['^3.1.0', '^3.5.0']);
console.log('   Intersected:', intersected);
const versions = ['3.0.0', '3.1.0', '3.5.0', '3.9.0', '3.10.0', '4.0.0'];
console.log('   Max satisfying:', semver.maxSatisfying(versions, intersected[0]));
