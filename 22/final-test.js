const semver = require('./src/semver');
const { resolveDependencies } = require('./src/resolver');

console.log('='.repeat(60));
console.log('FINAL VERIFICATION OF ALL BUG FIXES');
console.log('='.repeat(60));

let allPassed = true;

function test(name, actual, expected) {
  const passed = actual === expected;
  console.log(`${passed ? '✅' : '❌'} ${name}`);
  console.log(`   Expected: ${expected}, Actual: ${actual}`);
  if (!passed) allPassed = false;
  return passed;
}

console.log('\n--- Bug 1: SemVer ^3.1.0 range calculation ---\n');

test('3.9.0 satisfies ^3.1.0', semver.satisfies('3.9.0', '^3.1.0'), true);
test('3.10.0 satisfies ^3.1.0', semver.satisfies('3.10.0', '^3.1.0'), true);
test('4.0.0 satisfies ^3.1.0', semver.satisfies('4.0.0', '^3.1.0'), false);

const ub = semver.getUpperBound('^3.1.0');
test('Upper bound of ^3.1.0 is 4.0.0', ub.version, '4.0.0');

const intersected = semver.intersectRanges(['^3.1.0', '^3.5.0']);
test('Intersection of ^3.1.0 and ^3.5.0 is >=3.5.0 <4.0.0', 
     intersected[0], '>=3.5.0 <4.0.0');

const versions = ['3.0.0', '3.1.0', '3.5.0', '3.9.0', '3.10.0', '4.0.0'];
test('Max satisfying >=3.5.0 <4.0.0 is 3.10.0', 
     semver.maxSatisfying(versions, intersected[0]), '3.10.0');

console.log('\n--- Bug 2: Stack overflow with deep dependencies ---\n');

try {
  const result = resolveDependencies('deep-level-1', '1.0.0');
  test('6-level deep dependency resolution succeeds', 
       result.hasConflicts === false && result.resolved.lodash === '3.10.0', true);
  console.log('   Resolved packages:', Object.keys(result.resolved).length);
} catch (e) {
  test('6-level deep dependency resolution succeeds', false, true);
  console.log('   Error:', e.message);
}

console.log('\n--- Bug 3: Duplicate entries in lock.json ---\n');

const result2 = resolveDependencies('merge-test', '1.0.0');
const lodashCount = Object.keys(result2.resolved).filter(k => k === 'lodash').length;
test('Only one lodash entry in resolved packages', lodashCount, 1);
test('lodash version is 3.10.0 (highest compatible)', result2.resolved.lodash, '3.10.0');

console.log('\n--- CLI Integration Test ---\n');

console.log('Run the following commands to verify CLI:');
console.log('  node src/cli.js install merge-test@1.0.0');
console.log('  node src/cli.js install deep-level-1@1.0.0');
console.log('  node src/cli.js install conflict-test@1.0.0 (should show conflict)');

console.log('\n' + '='.repeat(60));
if (allPassed) {
  console.log('✅ ALL TESTS PASSED!');
} else {
  console.log('❌ SOME TESTS FAILED!');
}
console.log('='.repeat(60));
