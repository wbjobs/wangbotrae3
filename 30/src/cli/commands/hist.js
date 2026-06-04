const Table = require('cli-table3');
const chalk = require('chalk');
const { format } = require('date-fns');

async function histCommand(apiClient, limit = 20) {
  const isRunning = await apiClient.checkDaemon();
  if (!isRunning) {
    console.log(chalk.red('错误: 守护服务未运行，请先启动守护服务'));
    process.exit(1);
  }

  const data = await apiClient.getHistory(limit);
  const { items } = data;

  if (items.length === 0) {
    console.log(chalk.yellow('暂无剪贴板历史记录'));
    return;
  }

  const table = new Table({
    head: [
      chalk.cyan('ID'),
      chalk.cyan('类型'),
      chalk.cyan('标签'),
      chalk.cyan('内容预览'),
      chalk.cyan('来源'),
      chalk.cyan('时间'),
      chalk.cyan('固定'),
    ],
    colWidths: [6, 8, 10, 30, 12, 20, 6],
    wordWrap: true,
  });

  items.forEach((item) => {
    const contentPreview = item.type === 'text'
      ? item.content.replace(/\n/g, ' ').substring(0, 60)
      : '[图片数据]';

    const typeIcon = item.type === 'text' 
      ? chalk.blue('📝 文本') 
      : chalk.green('🖼️ 图片');

    const categoryTag = item.category 
      ? chalk.magenta(item.category) 
      : chalk.gray('-');

    const timeStr = format(new Date(item.timestamp), 'yyyy-MM-dd HH:mm:ss');
    const pinned = item.isPinned ? chalk.yellow('⭐') : '';

    table.push([
      item.id,
      typeIcon,
      categoryTag,
      contentPreview,
      item.sourceApp || '未知',
      timeStr,
      pinned,
    ]);
  });

  console.log(table.toString());
  console.log(chalk.gray(`\n共 ${items.length} 条记录`));
}

module.exports = histCommand;
