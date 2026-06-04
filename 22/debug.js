const { resolveDependencies, getLastConflictLog } = require('./src/resolver');

console.log('=== Debug package-d ===\n');
const result = resolveDependencies('package-d', '1.0.0');

console.log('Has conflicts:', result.hasConflicts);
console.log('Conflicts:', JSON.stringify(result.conflicts, null, 2));

const conflictLog = getLastConflictLog();
console.log('\nConflict log:');
console.log(JSON.stringify(conflictLog, null, 2));
