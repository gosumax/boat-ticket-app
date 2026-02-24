import { execSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

export function runTests(testCommand = 'npm run test') {
  try {
    const output = execSync(String(testCommand || 'npm run test'), {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { success: true, output };
  } catch (error) {
    const stdout = error?.stdout ? String(error.stdout) : '';
    const stderr = error?.stderr ? String(error.stderr) : '';
    const message = error?.message ? String(error.message) : '';
    const output = [stdout, stderr, message].filter(Boolean).join('\n');
    return { success: false, output };
  }
}

const GENERATED_UI_TEST_FILE_RE = /\.spec\.[cm]?[jt]sx?$/i;
const GENERATED_UI_TESTS_PLAYWRIGHT_UNAVAILABLE_EXIT_CODE = 86;

async function countGeneratedUiTests(dirPath) {
  let entries = [];
  try {
    entries = await fs.readdir(dirPath, { withFileTypes: true });
  } catch {
    return 0;
  }

  const files = entries
    .filter((entry) => entry.isFile() && GENERATED_UI_TEST_FILE_RE.test(entry.name))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));
  return files.length;
}

function isPlaywrightMissingError(output) {
  const text = String(output || '').toLowerCase();
  if (!text) return false;
  return (
    text.includes('@playwright/test') && text.includes('cannot find module')
  ) || text.includes('could not determine executable to run')
    || text.includes('playwright is not recognized')
    || text.includes("'playwright' is not recognized")
    || text.includes('playwright: command not found')
    || text.includes('unknown command "playwright"')
    || text.includes('npm err! missing script')
    || text.includes('no tests found.')
    || text.includes('playwright.config')
    || text.includes('config file')
    || text.includes("executable doesn't exist")
    || text.includes('please run the following command to download new browsers')
    || text.includes('npx playwright install')
    || text.includes('browsertype.launch');
}

function toPosixPath(value) {
  return String(value || '').replace(/\\/g, '/');
}

function escapeForSingleQuotedJs(value) {
  return String(value || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

async function ensureGeneratedUiPlaywrightConfig(generatedDirAbs, generatedDirRel) {
  const configFileName = 'playwright.generated.config.mjs';
  const configAbsPath = path.join(generatedDirAbs, configFileName);
  const testDir = toPosixPath(generatedDirAbs);
  const reportLine = [
    "import { defineConfig } from '@playwright/test';",
    '',
    'export default defineConfig({',
    `  testDir: '${escapeForSingleQuotedJs(testDir)}',`,
    "  reporter: 'line',",
    '});',
    '',
  ].join('\n');
  await fs.writeFile(configAbsPath, reportLine, 'utf8');
  return `${generatedDirRel}/${configFileName}`;
}

export async function runGeneratedUiTests(runId) {
  const normalizedRunId = String(runId || '').trim();
  const generatedDirRel = `dev_pipeline/generated_ui_tests/${normalizedRunId}`;
  const generatedDirAbs = path.join(process.cwd(), generatedDirRel.split('/').join(path.sep));
  const count = await countGeneratedUiTests(generatedDirAbs);

  if (count === 0) {
    return {
      ran: false,
      count: 0,
      exitCode: 0,
      output: '',
    };
  }

  const configRelPath = await ensureGeneratedUiPlaywrightConfig(generatedDirAbs, generatedDirRel);
  const command = `npx playwright test --config ${configRelPath} --reporter=line`;
  try {
    const output = execSync(command, {
      cwd: process.cwd(),
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return {
      ran: true,
      count,
      exitCode: 0,
      output,
    };
  } catch (error) {
    const stdout = error?.stdout ? String(error.stdout) : '';
    const stderr = error?.stderr ? String(error.stderr) : '';
    const message = error?.message ? String(error.message) : '';
    const output = [stdout, stderr, message].filter(Boolean).join('\n');
    const status = Number.isInteger(error?.status) ? error.status : 1;
    const exitCode = isPlaywrightMissingError(output)
      ? GENERATED_UI_TESTS_PLAYWRIGHT_UNAVAILABLE_EXIT_CODE
      : status;
    return {
      ran: true,
      count,
      exitCode,
      output,
    };
  }
}
