// copy-and-run.mjs — Copy test files to temp dir and run vitest
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TEMP_DIR = 'C:\\temp\\boat-tests';

// Create directories
['tests/owner', 'tests/_helpers', 'tests/_testdata'].forEach(dir => {
  fs.mkdirSync(path.join(TEMP_DIR, dir), { recursive: true });
});

// Copy files
const filesToCopy = [
  // Owner tests
  ['tests/owner/20-owner-settings-contract.test.js', 'tests/owner/'],
  ['tests/owner/21-motivation-day-snapshot.test.js', 'tests/owner/'],
  ['tests/owner/22-motivation-mode-points-gating.test.js', 'tests/owner/'],
  ['tests/owner/23-adaptive-recalc-parameters.test.js', 'tests/owner/'],
  ['tests/owner/24-streak-calibration.test.js', 'tests/owner/'],
  // Helpers
  ['tests/_helpers/dbReset.js', 'tests/_helpers/'],
  ['tests/_helpers/makeApp.js', 'tests/_helpers/'],
  ['tests/_helpers/seedBasic.js', 'tests/_helpers/'],
  ['tests/_helpers/testDates.js', 'tests/_helpers/'],
  ['tests/_helpers/schema_prod.sql', 'tests/_helpers/'],
  ['tests/_helpers/authTokens.js', 'tests/_helpers/'],
  // Root
  ['tests/setup-env.js', 'tests/'],
  ['vitest.config.js', ''],
  ['package.json', ''],
];

filesToCopy.forEach(([src, destDir]) => {
  const srcPath = path.join(__dirname, src);
  const destPath = path.join(TEMP_DIR, destDir, path.basename(src));
  try {
    fs.copyFileSync(srcPath, destPath);
    console.log(`Copied: ${src} -> ${destPath}`);
  } catch (e) {
    console.error(`Failed to copy ${src}: ${e.message}`);
  }
});

console.log('\nRunning tests from:', TEMP_DIR);

const vitest = spawn('npx', [
  'vitest', 'run',
  'tests/owner/20-owner-settings-contract.test.js',
  'tests/owner/21-motivation-day-snapshot.test.js',
  'tests/owner/22-motivation-mode-points-gating.test.js',
  'tests/owner/23-adaptive-recalc-parameters.test.js',
  'tests/owner/24-streak-calibration.test.js',
  '--reporter=verbose'
], {
  cwd: TEMP_DIR,
  stdio: 'inherit',
  shell: true,
  env: { ...process.env, NODE_ENV: 'test' }
});

vitest.on('close', (code) => {
  console.log('\nVitest exited with code:', code);
  process.exit(code);
});
