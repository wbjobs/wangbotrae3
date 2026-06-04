const semver = require('./src/semver');

console.log('=== Deep debug of intersectRanges ===\n');

function debugIntersect(range1, range2) {
  console.log(`Intersecting "${range1}" and "${range2}":`);
  
  const getUpperBound = semver.getUpperBound || require('./src/semver');
  
  const lower1 = getLowerBound(range1);
  const upper1 = getUpperBound(range1);
  const lower2 = getLowerBound(range2);
  const upper2 = getUpperBound(range2);
  
  console.log(`  range1: lower=${JSON.stringify(lower1)}, upper=${JSON.stringify(upper1)}`);
  console.log(`  range2: lower=${JSON.stringify(lower2)}, upper=${JSON.stringify(upper2)}`);
  
  const result = semver.intersectRanges([range1, range2]);
  console.log(`  Result: ${JSON.stringify(result)}`);
  console.log();
}

const { getLowerBound, getUpperBound } = require('./src/semver');

console.log('Testing getUpperBound for ^3.1.0:');
const ub = getUpperBound('^3.1.0');
console.log('  Result:', JSON.stringify(ub));

console.log('\nTesting getUpperBound for ^3.5.0:');
const ub2 = getUpperBound('^3.5.0');
console.log('  Result:', JSON.stringify(ub2));

console.log('\n--- Testing intersectTwoRanges directly ---\n');

const { intersectTwoRanges } = require('./src/semver');
const result1 = intersectTwoRanges('^3.1.0', '^3.5.0');
console.log('intersectTwoRanges("^3.1.0", "^3.5.0"):', result1);

console.log('\n--- Testing with exact versions ---\n');
const versions = ['3.0.0', '3.1.0', '3.5.0', '3.9.0', '3.10.0', '4.0.0'];
console.log('Versions:', versions);

const intersected = semver.intersectRanges(['^3.1.0', '^3.5.0']);
console.log('Intersected:', intersected);

for (const v of versions) {
  for (const r of intersected) {
    console.log(`  ${v} satisfies "${r}":`, semver.satisfies(v, r));
  }
}

console.log('\n--- Test bug scenario: ^3.1.0 should include 3.9.0 ---\n');
console.log('3.9.0 satisfies ^3.1.0:', semver.satisfies('3.9.0', '^3.1.0'));

const parsed = semver.parseRange('^3.1.0');
console.log('Parsed ^3.1.0:', JSON.stringify(parsed, null, 2));

if (parsed.type === 'caret') {
  const ver = semver.parseVersion(parsed.version);
  console.log('Parsed version:', ver);
  console.log('Upper limit should be:', `${ver.major + 1}.0.0`);
  console.log('3.9.0 < 4.0.0:', semver.lt('3.9.0', `${ver.major + 1}.0.0`));
}
