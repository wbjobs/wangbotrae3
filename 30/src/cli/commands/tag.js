const Table = require('cli-table3');
const chalk = require('chalk');

async function tagCommand(apiClient, options) {
  const { list, set, id, category } = options;

  const isRunning = await apiClient.checkDaemon();
  if (!isRunning) {
    console.log(chalk.red('错误: 守护服务未运行，请先启动守护服务'));
    process.exit(1);
  }

  if (list) {
    const response = await fetch(`${apiClient.baseUrl}/api/categories`);
    const data = await response.json();
    const categories = data.categories || [];

    if (categories.length === 0) {
      console.log(chalk.yellow('暂无标签'));
      return;
    }

    console.log(chalk.blue('\n可用标签:'));
    categories.forEach((cat, index) => {
      console.log(`  ${index + 1}. ${chalk.magenta(cat)}`);
    });
    console.log(chalk.gray(`\n共 ${categories.length} 个标签\n`));
    return;
  }

  if (set && id !== undefined) {
    const response = await fetch(`${apiClient.baseUrl}/api/history/${id}/category`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ category: category || null }),
    });

    if (response.ok) {
      if (category) {
        console.log(chalk.green(`✓ 已为记录 ${id} 设置标签: ${chalk.magenta(category)}`));
      } else {
        console.log(chalk.green(`✓ 已清除记录 ${id} 的标签`));
      }
    } else {
      const error = await response.json();
      console.error(chalk.red('错误:'), error.error || '设置失败');
      process.exit(1);
    }
  }
}

module.exports = tagCommand;
