const semver = require('./src/semver');

console.log('=== Bug 1: Testing ^3.1.0 with 3.9.0 ===\n');

console.log('Direct satisfies check:');
console.log('  3.9.0 satisfies ^3.1.0:', semver.satisfies('3.9.0', '^3.1.0'));
console.log('  Expected: true');

console.log('\nBounds check:');
const lb = semver.getLowerBound('^3.1.0');
const ub = semver.getUpperBound('^3.1.0');
console.log('  Lower bound:', JSON.stringify(lb));
console.log('  Upper bound:', JSON.stringify(ub));
console.log('  Expected upper: 4.0.0');

console.log('\nTesting intersectRanges with single ^3.1.0:');
const result1 = semver.intersectRanges(['^3.1.0']);
console.log('  Result:', result1);

console.log('\nTesting maxSatisfying with ^3.1.0:');
const versions = ['3.0.0', '3.1.0', '3.5.0', '3.9.0', '3.10.0', '4.0.0'];
console.log('  Versions:', versions);
console.log('  Max satisfying ^3.1.0:', semver.maxSatisfying(versions, '^3.1.0'));

console.log('\nTesting intersectRanges with ^3.1.0 and ^3.5.0:');
const result2 = semver.intersectRanges(['^3.1.0', '^3.5.0']);
console.log('  Result:', result2);

console.log('\nTesting bounds of intersected range:');
for (const r of result2) {
  const lb2 = semver.getLowerBound(r);
  const ub2 = semver.getUpperBound(r);
  console.log(`  Range "${r}":`);
  console.log(`    Lower bound:`, JSON.stringify(lb2));
  console.log(`    Upper bound:`, JSON.stringify(ub2));
  console.log(`    Max satisfying:`, semver.maxSatisfying(versions, r));
}

console.log('\n=== Simulating the exact bug scenario ===\n');
console.log('Scenario: A depends on lodash@^3.1.0, B depends on lodash@^3.5.0');
console.log('Ranges: ["^3.1.0", "^3.5.0"]');

const intersected = semver.intersectRanges(['^3.1.0', '^3.5.0']);
console.log('Intersected:', intersected);

for (const range of intersected) {
  console.log(`\nRange: ${range}`);
  console.log('  3.1.0 satisfies:', semver.satisfies('3.1.0', range));
  console.log('  3.5.0 satisfies:', semver.satisfies('3.5.0', range));
  console.log('  3.9.0 satisfies:', semver.satisfies('3.9.0', range));
  console.log('  3.10.0 satisfies:', semver.satisfies('3.10.0', range));
  console.log('  4.0.0 satisfies:', semver.satisfies('4.0.0', range));
}

console.log('\nMax satisfying version:', semver.maxSatisfying(versions, intersected[0]));
console.log('Expected: 3.10.0');
