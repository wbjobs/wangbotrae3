const chalk = require('chalk');

async function replayCommand(apiClient, id) {
  if (!id) {
    console.log(chalk.red('错误: 请提供记录ID'));
    process.exit(1);
  }

  const isRunning = await apiClient.checkDaemon();
  if (!isRunning) {
    console.log(chalk.red('错误: 守护服务未运行，请先启动守护服务'));
    process.exit(1);
  }

  try {
    const result = await apiClient.replay(id);
    if (result.success) {
      console.log(chalk.green(`✓ 已将记录 #${id} (${result.item.type}) 复制到剪贴板`));
    } else {
      console.log(chalk.red('✗ 复制失败'));
    }
  } catch (err) {
    if (err.response && err.response.status === 404) {
      console.log(chalk.red(`错误: 未找到ID为 ${id} 的记录`));
    } else {
      console.log(chalk.red(`错误: ${err.message}`));
    }
    process.exit(1);
  }
}

module.exports = replayCommand;
