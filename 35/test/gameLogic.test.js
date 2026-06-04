const {
  createPlayerState,
  generateOreValue,
  isMiningSuccess,
  MAX_FUEL,
  MINING_SUCCESS_RATE
} = require('../server/game/gameLogic');

console.log('=== 太空挖矿赌局 - 游戏逻辑测试 ===\n');

console.log('1. 常量配置:');
console.log(`   - 最大燃料: ${MAX_FUEL}`);
console.log(`   - 挖矿成功率: ${MINING_SUCCESS_RATE * 100}%`);
console.log();

console.log('2. 创建玩家状态测试:');
const playerState = createPlayerState('test-player-1', '测试矿工', 'test-room-1');
console.log('   玩家状态:', JSON.stringify({
  playerId: playerState.playerId,
  playerName: playerState.playerName,
  roomId: playerState.roomId,
  fuel: playerState.fuel,
  totalOreValue: playerState.totalOreValue,
  gameStatus: playerState.gameStatus
}, null, 2));
console.log();

console.log('3. 矿石价值生成测试 (10次):');
const values = [];
for (let i = 0; i < 10; i++) {
  values.push(generateOreValue());
}
console.log(`   生成的矿石价值: [${values.join(', ')}]`);
console.log(`   最小值: ${Math.min(...values)}, 最大值: ${Math.max(...values)}`);
console.log(`   平均值: ${(values.reduce((a, b) => a + b, 0) / values.length).toFixed(1)}`);
console.log();

console.log('4. 挖矿成功率测试 (1000次):');
let successCount = 0;
const iterations = 1000;
for (let i = 0; i < iterations; i++) {
  if (isMiningSuccess()) successCount++;
}
const actualRate = (successCount / iterations) * 100;
console.log(`   成功次数: ${successCount}/${iterations}`);
console.log(`   实际成功率: ${actualRate.toFixed(1)}%`);
console.log(`   理论成功率: ${MINING_SUCCESS_RATE * 100}%`);
console.log(`   偏差: ${Math.abs(actualRate - MINING_SUCCESS_RATE * 100).toFixed(2)}%`);
console.log();

console.log('5. 模拟完整游戏流程:');
let simPlayer = createPlayerState('sim-player', '模拟矿工', 'sim-room');
console.log(`   初始状态: 燃料=${simPlayer.fuel}, 矿石价值=${simPlayer.totalOreValue}`);

let round = 0;
while (simPlayer.fuel > 0 && simPlayer.gameStatus === 'playing') {
  round++;
  simPlayer.miningCount++;
  
  if (isMiningSuccess()) {
    const oreValue = generateOreValue();
    simPlayer.totalOreValue += oreValue;
    simPlayer.successCount++;
    console.log(`   回合 ${round}: 挖矿成功! +${oreValue} (总计: ${simPlayer.totalOreValue})`);
  } else {
    simPlayer.fuel -= 1;
    simPlayer.blastCount++;
    console.log(`   回合 ${round}: 空爆! 燃料-1 (剩余: ${simPlayer.fuel})`);
  }

  if (simPlayer.totalOreValue >= 200 && Math.random() > 0.5) {
    simPlayer.gameStatus = 'completed';
    console.log(`   回合 ${round}: 选择返航! 最终收益: ${simPlayer.totalOreValue}`);
    break;
  }

  if (simPlayer.fuel <= 0) {
    simPlayer.gameStatus = 'crashed';
    console.log(`   回合 ${round}: 燃料耗尽! 任务失败! 收益: ${simPlayer.totalOreValue}`);
  }
}

console.log();
console.log('6. 最终统计:');
const successRate = simPlayer.miningCount > 0 
  ? ((simPlayer.successCount / simPlayer.miningCount) * 100).toFixed(1) 
  : 0;
console.log(`   - 游戏状态: ${simPlayer.gameStatus}`);
console.log(`   - 挖矿次数: ${simPlayer.miningCount}`);
console.log(`   - 成功次数: ${simPlayer.successCount}`);
console.log(`   - 空爆次数: ${simPlayer.blastCount}`);
console.log(`   - 成功率: ${successRate}%`);
console.log(`   - 最终收益: ${simPlayer.totalOreValue}`);
console.log(`   - 剩余燃料: ${simPlayer.fuel}`);
console.log();

console.log('=== 测试完成 ===');
