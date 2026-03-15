import { execSync } from 'child_process';
import { select } from '@inquirer/prompts';
import chalk from 'chalk';

const log = message =>
  console.log(chalk.bgGreen(`\n ******** ${message} ******** \n`));

const logError = message =>
  console.error(chalk.bgRed(`\n ******** Error: ${message} ******** \n`));

const execute = command => {
  execSync(command, { stdio: 'inherit' });
};

const run = async () => {
  // check if git is clean

  const gitStatus = execSync(`git status --porcelain`).toString();

  if (gitStatus) {
    logError('Git is not clean. Please commit your changes.');
    process.exit(1);
  }

  log('Type checking code...');
  execute(`bun run type-check`);

  log('Linting code...');
  execute(`bun run lint`);

  log('Formatting code...');
  execute(`bun run format:write`);

  // if you have tests eventually, uncomment this to run them as part of the publish process
  log('Testing code...');
  execute(`bun run test`);

  log('Building code...');
  execute(`bun run build`);

  log('All checks passed and build completed ✅');

  const answer = await select({
    message: 'Select a version update type:',
    choices: [
      {
        name: 'patch',
        value: 'patch',
      },
      {
        name: 'minor',
        value: 'minor',
      },
      {
        name: 'major',
        value: 'major',
      },
    ],
  });

  log('Updating version...');
  execute(`npm version ${answer}`);

  // Fetch updated version
  const { default: pkg } = await import('./package.json', {
    assert: { type: 'json' },
  });
  const version = pkg.version;

  log('Building code again after version update...');
  execute(`bun run build`);

  // then publish the code
  log('Publishing code...');
  execute(`npm publish`);

  log(`🚀 Published version: ${version} ✅`);
};

run().catch(error => {
  // log the error
  logError(error.message);
  process.exit(1);
});

import.meta.url;
