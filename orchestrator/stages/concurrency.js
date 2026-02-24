import fs from 'node:fs/promises';
import path from 'node:path';

const TEXT_EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.sql']);

function toRelative(rootDir, filePath) {
  return path.relative(rootDir, filePath).split(path.sep).join('/');
}

function getLine(content, index) {
  return content.slice(0, index).split('\n').length;
}

function pushRisk(raceRisks, issue, maxCount = 200) {
  if (raceRisks.length < maxCount) raceRisks.push(issue);
}

function severityRank(level) {
  if (level === 'high') return 3;
  if (level === 'medium') return 2;
  return 1;
}

function maxSeverity(raceRisks) {
  let current = 'low';
  for (const issue of raceRisks) {
    if (severityRank(issue.severity) > severityRank(current)) {
      current = issue.severity;
    }
  }
  return current;
}

async function listBackendFiles(rootDir) {
  const serverDir = path.join(rootDir, 'server');
  const files = [];

  async function walk(currentDir) {
    let entries = [];
    try {
      entries = await fs.readdir(currentDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
        continue;
      }
      if (!entry.isFile()) continue;
      const ext = path.extname(entry.name).toLowerCase();
      if (!TEXT_EXTENSIONS.has(ext)) continue;
      files.push(fullPath);
    }
  }

  await walk(serverDir);
  return files;
}

function checkMissingTransaction(content, relPath, raceRisks) {
  const mutationCalls = content.match(/db\.(run|exec|prepare)\s*\(/g) || [];
  if (mutationCalls.length < 2) return;
  if (!/\b(insert|update|delete)\b/i.test(content)) return;
  if (/db\.transaction\s*\(/.test(content)) return;

  pushRisk(raceRisks, {
    type: 'missing_transaction_wrapper',
    severity: 'medium',
    file: relPath,
    line: 1,
    message: 'Multiple mutating DB operations without explicit transaction wrapper',
  });
}

function checkIdempotency(content, relPath, raceRisks) {
  const mutatingRoute = /router\.(post|patch|put|delete)\s*\(/.test(content);
  if (!mutatingRoute) return;
  if (/idempot|on conflict|upsert|if-match|etag/i.test(content)) return;

  const idx = content.search(/router\.(post|patch|put|delete)\s*\(/);
  pushRisk(raceRisks, {
    type: 'idempotency_pattern_missing',
    severity: 'low',
    file: relPath,
    line: getLine(content, Math.max(0, idx)),
    message: 'Mutating route found without obvious idempotency pattern',
  });
}

function checkShiftLocking(content, relPath, raceRisks) {
  if (!/shift/i.test(relPath) && !/shift/i.test(content)) return;
  if (!/router\.(post|patch|put|delete)\s*\(/.test(content) && !/\b(update|insert|delete)\b/i.test(content)) return;
  if (/assertShiftOpen|SHIFT_CLOSED|lockShift|isShiftClosed/i.test(content)) return;

  const idx = content.search(/shift/i);
  pushRisk(raceRisks, {
    type: 'shift_locking_enforcement_missing',
    severity: 'high',
    file: relPath,
    line: getLine(content, Math.max(0, idx)),
    message: 'Shift-sensitive write flow without visible shift lock enforcement',
  });
}

function checkRaceSensitiveWrites(content, relPath, raceRisks) {
  if (!/(ledger|shift|selling|dispatcher|owner)/i.test(relPath)) return;
  if (!/\b(update|insert|delete)\b/i.test(content)) return;
  if (/db\.transaction\s*\(|BEGIN IMMEDIATE|BEGIN TRANSACTION/i.test(content)) return;

  pushRisk(raceRisks, {
    type: 'race_sensitive_file',
    severity: 'medium',
    file: relPath,
    line: 1,
    message: 'Race-sensitive module mutates data without clear transaction/lock boundary',
  });
}

export async function runConcurrency(input) {
  const rootDir = process.cwd();
  const files = await listBackendFiles(rootDir);
  const raceRisks = [];
  const task = String(input?.task || '').trim();

  for (const filePath of files) {
    let content = '';
    try {
      content = await fs.readFile(filePath, 'utf8');
    } catch {
      continue;
    }

    const relPath = toRelative(rootDir, filePath);
    checkMissingTransaction(content, relPath, raceRisks);
    checkIdempotency(content, relPath, raceRisks);
    checkShiftLocking(content, relPath, raceRisks);
    checkRaceSensitiveWrites(content, relPath, raceRisks);
  }

  const severity = raceRisks.length ? maxSeverity(raceRisks) : 'low';
  const status = severity === 'high' ? 'fail' : 'ok';
  const reportPath = path.join(rootDir, 'dev_pipeline', 'concurrency.md');

  const report = [
    '# Concurrency Report',
    '',
    '## TASK',
    task || '(empty task)',
    '',
    `## Race Risks (${raceRisks.length})`,
    ...(raceRisks.length
      ? raceRisks.map(
          (issue, idx) =>
            `${idx + 1}. [${issue.severity}] ${issue.type} - ${issue.file}:${issue.line} - ${issue.message}`,
        )
      : ['- none']),
    '',
    '## Overall Severity',
    `- ${severity}`,
    '',
    '## Status',
    `- ${status}`,
    '',
  ].join('\n');

  await fs.mkdir(path.dirname(reportPath), { recursive: true });
  await fs.writeFile(reportPath, report, 'utf8');

  return {
    stage: 'concurrency',
    status,
    raceRisks,
    severity,
  };
}
