const semver = require('./src/semver');

console.log('=== Bug 1: SemVer caret range test ===\n');

console.log('Testing ^3.1.0:');
console.log('  3.1.0 satisfies ^3.1.0:', semver.satisfies('3.1.0', '^3.1.0'));
console.log('  3.5.0 satisfies ^3.1.0:', semver.satisfies('3.5.0', '^3.1.0'));
console.log('  3.9.0 satisfies ^3.1.0:', semver.satisfies('3.9.0', '^3.1.0'));
console.log('  4.0.0 satisfies ^3.1.0:', semver.satisfies('4.0.0', '^3.1.0'));

console.log('\nExpected: 3.1.0=true, 3.5.0=true, 3.9.0=true, 4.0.0=false');

const parsed = semver.parseRange('^3.1.0');
console.log('\nParsed ^3.1.0:', JSON.stringify(parsed, null, 2));

const upperBound = require('./src/semver').getUpperBound ? 
  require('./src/semver').getUpperBound('^3.1.0') : 'N/A';
console.log('Upper bound of ^3.1.0:', JSON.stringify(upperBound, null, 2));

const lowerBound = require('./src/semver').getLowerBound ?
  require('./src/semver').getLowerBound('^3.1.0') : 'N/A';
console.log('Lower bound of ^3.1.0:', JSON.stringify(lowerBound, null, 2));

console.log('\n=== Testing intersectRanges for ^3.1.0 and ^3.5.0 ===\n');
const intersection = semver.intersectRanges(['^3.1.0', '^3.5.0']);
console.log('Intersection of ^3.1.0 and ^3.5.0:', intersection);

const versions = ['3.0.0', '3.1.0', '3.5.0', '3.9.0', '3.10.0', '4.0.0'];
console.log('\nVersions:', versions);
console.log('Max satisfying ^3.1.0:', semver.maxSatisfying(versions, '^3.1.0'));
console.log('Max satisfying ^3.5.0:', semver.maxSatisfying(versions, '^3.5.0'));

if (intersection) {
  for (const range of intersection) {
    console.log(`Max satisfying ${range}:`, semver.maxSatisfying(versions, range));
  }
}
