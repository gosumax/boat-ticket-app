import fs from 'node:fs/promises';
import path from 'node:path';

const EXCLUDED_DIRS = new Set(['node_modules', '.git', 'orchestrator']);

async function walkFiles(rootDir, currentDir, files) {
  const entries = await fs.readdir(currentDir, { withFileTypes: true });

  for (const entry of entries) {
    const absolutePath = path.join(currentDir, entry.name);
    const relativePath = path.relative(rootDir, absolutePath).split(path.sep).join('/');

    if (entry.isDirectory()) {
      const firstSegment = relativePath.split('/')[0];
      if (EXCLUDED_DIRS.has(firstSegment)) continue;
      await walkFiles(rootDir, absolutePath, files);
      continue;
    }

    if (entry.isFile()) {
      files.push(relativePath);
    }
  }
}

function detectTestCommand(packageJson) {
  const scripts = packageJson?.scripts || {};

  if (typeof scripts.validate === 'string' && scripts.validate.trim()) {
    return 'npm run validate';
  }

  if (typeof scripts['test:all'] === 'string' && scripts['test:all'].trim()) {
    return 'npm run test:all';
  }

  if (typeof scripts.test === 'string' && scripts.test.trim()) {
    return 'npm run test';
  }

  for (const scriptName of Object.keys(scripts)) {
    if (/^test[:\-]/.test(scriptName)) {
      return `npm run ${scriptName}`;
    }
  }

  return 'Not detected';
}

function asBulletList(items) {
  if (!items.length) return '- (none)';
  return items.map((item) => `- ${item}`).join('\n');
}

export async function runResearch(input) {
  const projectRoot = process.cwd();
  const task = String(input?.task || '').trim();
  const reportPath = path.join(projectRoot, 'dev_pipeline', 'research.md');
  const files = [];

  await walkFiles(projectRoot, projectRoot, files);
  files.sort((a, b) => a.localeCompare(b));

  const backendFiles = files.filter((file) => file.startsWith('server/'));
  const frontendFiles = files.filter((file) => file.startsWith('src/'));
  const testFiles = files.filter((file) => file.startsWith('tests/'));
  const packageJsonPath = files.includes('package.json') ? 'package.json' : '(not found)';

  let packageJson = {};
  if (packageJsonPath === 'package.json') {
    const packageJsonContent = await fs.readFile(path.join(projectRoot, 'package.json'), 'utf8');
    packageJson = JSON.parse(packageJsonContent);
  }

  const detectedTestCommand = detectTestCommand(packageJson);
  const timestamp = new Date().toISOString();

  const report = [
    '# Research Report',
    '',
    `## TASK`,
    task || '(empty task)',
    '',
    '## File Map',
    '',
    '### Backend (server/)',
    asBulletList(backendFiles),
    '',
    '### Frontend (src/)',
    asBulletList(frontendFiles),
    '',
    '### Tests (tests/)',
    asBulletList(testFiles),
    '',
    '### package.json',
    `- ${packageJsonPath}`,
    '',
    '## Detected Test Command',
    `- ${detectedTestCommand}`,
    '',
    '## Total File Count',
    `- ${files.length}`,
    '',
    '## Timestamp (server time)',
    `- ${timestamp}`,
    '',
  ].join('\n');

  await fs.mkdir(path.dirname(reportPath), { recursive: true });
  await fs.writeFile(reportPath, report, 'utf8');

  return {
    stage: 'research',
    status: 'ok',
    task,
    totalFiles: files.length,
    backendFiles,
    frontendFiles,
    testFiles,
    packageJsonPath,
    detectedTestCommand,
    reportPath: 'dev_pipeline/research.md',
    timestamp,
  };
}
