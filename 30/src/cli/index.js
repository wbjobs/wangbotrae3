#!/usr/bin/env node

const yargs = require('yargs/yargs');
const { hideBin } = require('yargs/helpers');
const chalk = require('chalk');

const APIClient = require('./apiClient');
const histCommand = require('./commands/hist');
const searchCommand = require('./commands/search');
const replayCommand = require('./commands/replay');
const statsCommand = require('./commands/stats');
const tagCommand = require('./commands/tag');

const apiClient = new APIClient();

yargs(hideBin(process.argv))
  .scriptName('clip')
  .usage(chalk.blue.bold('剪贴板历史中心 CLI\n\n') + chalk.gray('用法: $0 <command> [options]'))

  .command(
    'hist [limit]',
    '列出最近的剪贴板历史记录',
    (yargs) => {
      yargs.positional('limit', {
        describe: '显示的记录数量',
        type: 'number',
        default: 20,
      });
    },
    async (argv) => {
      try {
        await histCommand(apiClient, argv.limit);
      } catch (err) {
        console.error(chalk.red('错误:'), err.message);
        process.exit(1);
      }
    }
  )

  .command(
    'search <keyword>',
    '全文搜索文本历史记录',
    (yargs) => {
      yargs.positional('keyword', {
        describe: '搜索关键词',
        type: 'string',
        demand: true,
      });
    },
    async (argv) => {
      try {
        await searchCommand(apiClient, argv.keyword);
      } catch (err) {
        console.error(chalk.red('错误:'), err.message);
        process.exit(1);
      }
    }
  )

  .command(
    'replay <id>',
    '将指定的历史记录重新复制到剪贴板',
    (yargs) => {
      yargs.positional('id', {
        describe: '记录ID',
        type: 'number',
        demand: true,
      });
    },
    async (argv) => {
      try {
        await replayCommand(apiClient, argv.id);
      } catch (err) {
        console.error(chalk.red('错误:'), err.message);
        process.exit(1);
      }
    }
  )

  .command(
    'stats [days]',
    '显示每日复制量统计柱状图',
    (yargs) => {
      yargs.positional('days', {
        describe: '统计天数',
        type: 'number',
        default: 7,
      });
    },
    async (argv) => {
      try {
        await statsCommand(apiClient, argv.days);
      } catch (err) {
        console.error(chalk.red('错误:'), err.message);
        process.exit(1);
      }
    }
  )

  .command(
    'tag',
    '管理标签',
    (yargs) => {
      yargs
        .option('list', {
          alias: 'l',
          describe: '列出所有标签',
          type: 'boolean',
        })
        .option('set', {
          alias: 's',
          describe: '为指定记录设置标签',
          type: 'boolean',
        })
        .option('id', {
          describe: '记录ID',
          type: 'number',
        })
        .option('category', {
          alias: 'c',
          describe: '标签名称',
          type: 'string',
        });
    },
    async (argv) => {
      try {
        await tagCommand(apiClient, argv);
      } catch (err) {
        console.error(chalk.red('错误:'), err.message);
        process.exit(1);
      }
    }
  )

  .command(
    'start',
    '启动守护服务',
    () => {},
    () => {
      const { spawn } = require('child_process');
      console.log(chalk.blue('正在启动守护服务...'));
      const daemon = spawn('node', [require.resolve('../daemon/index.js')], {
        detached: true,
        stdio: 'ignore',
      });
      daemon.unref();
      setTimeout(() => {
        console.log(chalk.green('✓ 守护服务已在后台启动'));
        console.log(chalk.gray('API: http://localhost:8765'));
        process.exit(0);
      }, 1500);
    }
  )

  .example('$0 hist', '显示最近20条记录')
  .example('$0 hist 50', '显示最近50条记录')
  .example('$0 search "hello"', '搜索包含"hello"的记录')
  .example('$0 replay 123', '将ID为123的记录复制到剪贴板')
  .example('$0 stats', '显示最近7天的统计')
  .example('$0 stats 30', '显示最近30天的统计')
  .example('$0 start', '启动后台守护服务')

  .demandCommand(1, chalk.red('请指定一个命令'))
  .strict()
  .help('h')
  .alias('h', 'help')
  .version()
  .epilog(chalk.gray('\n剪贴板历史中心 © 2024'))
  .argv;
