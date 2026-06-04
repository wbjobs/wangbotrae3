const Table = require('cli-table3');
const chalk = require('chalk');
const { format } = require('date-fns');

async function searchCommand(apiClient, keyword) {
  if (!keyword) {
    console.log(chalk.red('错误: 请提供搜索关键词'));
    process.exit(1);
  }

  const isRunning = await apiClient.checkDaemon();
  if (!isRunning) {
    console.log(chalk.red('错误: 守护服务未运行，请先启动守护服务'));
    process.exit(1);
  }

  const data = await apiClient.search(keyword);
  const { items } = data;

  if (items.length === 0) {
    console.log(chalk.yellow(`未找到包含 "${keyword}" 的记录`));
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
    ],
    colWidths: [6, 8, 10, 40, 12, 20],
    wordWrap: true,
  });

  items.forEach((item) => {
    const contentPreview = item.type === 'text'
      ? item.content.replace(/\n/g, ' ').substring(0, 80)
      : `[图片] ${item.ocr_text ? item.ocr_text.substring(0, 60) : '无OCR文字'}`;

    const highlighted = contentPreview.replace(
      new RegExp(keyword, 'gi'),
      (match) => chalk.bgYellow.black(match)
    );

    const typeIcon = item.type === 'text' 
      ? chalk.blue('📝 文本') 
      : chalk.green('🖼️ 图片');

    const categoryTag = item.category 
      ? chalk.magenta(item.category) 
      : chalk.gray('-');

    const timeStr = format(new Date(item.timestamp), 'yyyy-MM-dd HH:mm:ss');

    table.push([
      item.id,
      typeIcon,
      categoryTag,
      highlighted,
      item.sourceApp || '未知',
      timeStr,
    ]);
  });

  console.log(chalk.blue(`\n搜索结果: "${keyword}"`));
  console.log(table.toString());
  console.log(chalk.gray(`\n找到 ${items.length} 条匹配记录`));
}

module.exports = searchCommand;
