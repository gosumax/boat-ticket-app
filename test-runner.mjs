// Test runner for dispatcher tests - bypasses PowerShell encoding issues
// Run with: node test-runner.mjs

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const env = {
  ...process.env,
  NODE_ENV: 'test',
  DB_FILE: ':memory:',
};

const vitest = spawn('npx', ['vitest', 'run', 'tests/dispatcher', '--reporter=verbose'], {
  cwd: __dirname,
  env,
  shell: true,
  stdio: 'inherit',
});

vitest.on('close', (code) => {
  process.exit(code);
});
