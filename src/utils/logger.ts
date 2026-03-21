import chalk from 'chalk';

export const log = {
  info: (msg: string) => console.log(chalk.blue('ℹ'), msg),
  success: (msg: string) => console.log(chalk.green('✓'), msg),
  warn: (msg: string) => console.log(chalk.yellow('⚠'), msg),
  error: (msg: string) => console.error(chalk.red('✗'), msg),
  debug: (msg: string) => {
    if (process.env.LOBSTER_DEBUG) console.log(chalk.gray('⋯'), msg);
  },
  step: (n: number, msg: string) => console.log(chalk.cyan(`[${n}]`), msg),
  dim: (msg: string) => console.log(chalk.dim(msg)),
};
