const chalk = require('chalk');
const { format, subDays } = require('date-fns');
const { zhCN } = require('date-fns/locale');

async function statsCommand(apiClient, days = 7) {
  const isRunning = await apiClient.checkDaemon();
  if (!isRunning) {
    console.log(chalk.red('错误: 守护服务未运行，请先启动守护服务'));
    process.exit(1);
  }

  const data = await apiClient.getStats(days);
  const { stats, total } = data;

  console.log(chalk.blue.bold(`\n📊 剪贴板统计 (最近 ${days} 天)`));
  console.log(chalk.gray(`总记录数: ${total}\n`));

  const statsMap = new Map();
  stats.forEach(s => statsMap.set(s.date, s));

  const dates = [];
  for (let i = days - 1; i >= 0; i--) {
    const date = format(subDays(new Date(), i), 'yyyy-MM-dd');
    dates.push(date);
  }

  const counts = dates.map(date => {
    const s = statsMap.get(date);
    return s ? s.count : 0;
  });

  if (counts.length === 0 || counts.every(c => c === 0)) {
    console.log(chalk.yellow('暂无统计数据'));
    return;
  }

  const maxCount = Math.max(...counts, 1);
  const barWidth = 30;

  console.log(chalk.cyan('每日复制量柱状图:'));
  console.log(chalk.cyan('─'.repeat(60)));

  dates.forEach((date, index) => {
    const count = counts[index];
    const s = statsMap.get(date);
    const textCount = s ? s.text_count : 0;
    const imageCount = s ? s.image_count : 0;

    const filledBars = Math.round((count / maxCount) * barWidth);
    const bar = '█'.repeat(filledBars) + '░'.repeat(barWidth - filledBars);

    const dayLabel = format(new Date(date + 'T00:00:00'), 'MM/dd EEE', { locale: zhCN });

    console.log(
      `${chalk.white(dayLabel)} │ ${chalk.green(bar)} ${chalk.yellow(String(count).padStart(4))}  ` +
      `${chalk.blue(`文本:${textCount}`)} ${chalk.magenta(`图片:${imageCount}`)}`
    );
  });

  console.log(chalk.cyan('─'.repeat(60)));

  const totalPeriod = counts.reduce((a, b) => a + b, 0);
  const avg = Math.round(totalPeriod / days * 10) / 10;
  const max = Math.max(...counts);

  console.log(`\n${chalk.white('总计:')} ${chalk.yellow(totalPeriod)} 次复制`);
  console.log(`${chalk.white('日均:')} ${chalk.yellow(avg)} 次`);
  console.log(`${chalk.white('峰值:')} ${chalk.yellow(max)} 次`);
  console.log();
}

module.exports = statsCommand;
