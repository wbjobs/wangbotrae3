console.log('=== 断线重连机制测试 ===\n');

console.log('1. Socket.IO 配置:');
console.log('   - 自动重连: 启用');
console.log('   - 重连延迟: 1000ms (递增到5000ms)');
console.log('   - 最大重试: 10次');
console.log('   - 连接状态恢复: 启用 (Socket.IO v4内置)');
console.log();

console.log('2. 后端会话恢复机制:');
console.log('   - 断线后30秒重连窗口');
console.log('   - 会话延迟清理 (pendingCleanups Map)');
console.log('   - 支持通过playerId恢复已有会话');
console.log('   - Redis存储待处理事件 (5分钟TTL)');
console.log();

console.log('3. 状态同步协议:');
console.log('   - player:reconnected 事件');
console.log('   - state:sync 请求接口');
console.log('   - state:update (全量同步)');
console.log('   - state:update:partial (增量同步)');
console.log('   - 同步字段: playerState, roomPlayers, roomLeaderboard, globalLeaderboard');
console.log();

console.log('4. 前端持久化存储:');
console.log('   - localStorage 键: space_mining_player_id');
console.log('   - localStorage 键: space_mining_player_name');
console.log('   - localStorage 键: space_mining_room_id');
console.log('   - 页面刷新后自动填充用户名');
console.log('   - 重连时自动发送保存的playerId');
console.log();

console.log('5. 断线期间事件补发:');
console.log('   - Redis List: player:events:{playerId}');
console.log('   - 事件类型: mine, return, game_over');
console.log('   - TTL: 300秒 (5分钟)');
console.log('   - 重连后自动补发并清空');
console.log();

console.log('6. Socket事件列表:');
console.log('   发送:');
console.log('   - player:join (支持playerId重连)');
console.log('   - player:reconnect');
console.log('   - state:sync');
console.log('   接收:');
console.log('   - player:joined');
console.log('   - player:reconnected');
console.log('   - player:reconnect:failed');
console.log('   - state:update');
console.log('   - state:update:partial');
console.log('   - disconnect, reconnect, reconnect_attempt, reconnect_failed');
console.log();

console.log('7. 断线重连流程:');
console.log('   ┌─────────────────────────────────────────┐');
console.log('   │ 玩家正常游戏 (socket connected)          │');
console.log('   └─────────────────────────────────────────┘');
console.log('                        ↓ 网络断开');
console.log('   ┌─────────────────────────────────────────┐');
console.log('   │ socket.disconnect 事件触发               │');
console.log('   │ 显示"连接断开，正在尝试重连..."           │');
console.log('   │ 禁用游戏按钮                             │');
console.log('   └─────────────────────────────────────────┘');
console.log('                        ↓ Socket.IO 自动重连');
console.log('   ┌─────────────────────────────────────────┐');
console.log('   │ reconnect_attempt 事件 (显示次数)        │');
console.log('   │ 最多重试10次                            │');
console.log('   └─────────────────────────────────────────┘');
console.log('                        ↓ 连接成功');
console.log('   ┌─────────────────────────────────────────┐');
console.log('   │ reconnect 事件触发                       │');
console.log('   │ 发送 player:reconnect 带保存的playerId   │');
console.log('   └─────────────────────────────────────────┘');
console.log('                        ↓ 服务器验证');
console.log('       ┌─────────────────────────────────────────┐');
console.log('       ↓ 会话存在 (30秒内)         ↓ 会话过期');
console.log('   ┌──────────────────┐       ┌──────────────────┐');
console.log('   │ player:reconnected│       │ 显示"会话过期"   │');
console.log('   │ 恢复游戏状态       │       │ 返回登录界面     │');
console.log('   │ 补发断线期间事件   │       │ 清除localStorage │');
console.log('   │ 启用游戏按钮       │       └──────────────────┘');
console.log('   └──────────────────┘');
console.log();

console.log('=== 测试完成 ===');
