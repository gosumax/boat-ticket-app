import fs from 'node:fs/promises';
import path from 'node:path';

const TEXT_EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.sql']);

function toRelative(rootDir, filePath) {
  return path.relative(rootDir, filePath).split(path.sep).join('/');
}

function getLine(content, index) {
  return content.slice(0, index).split('\n').length;
}

function pushViolation(invariantViolations, issue, maxCount = 200) {
  if (invariantViolations.length < maxCount) invariantViolations.push(issue);
}

function severityRank(level) {
  if (level === 'high') return 3;
  if (level === 'medium') return 2;
  return 1;
}

function maxSeverity(invariantViolations) {
  let current = 'low';
  for (const issue of invariantViolations) {
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

function checkRounding(content, relPath, invariantViolations) {
  if (!/(ledger|salary_due|balance|amount|refund|collected|motivation)/i.test(content)) return;
  if (/money-rounding|roundMoney|Math\.round\s*\(/i.test(content)) return;

  const arithmeticMatch = content.match(/\b(collected|refund|amount|salary_due|balance|net)\b[^\n]{0,80}[+\-*/][^\n]{0,80}/i);
  if (!arithmeticMatch || arithmeticMatch.index == null) return;

  pushViolation(invariantViolations, {
    type: 'rounding_missing',
    severity: 'medium',
    file: relPath,
    line: getLine(content, arithmeticMatch.index),
    message: 'Money arithmetic found without explicit rounding helper',
  });
}

function checkNetInvariant(content, relPath, invariantViolations) {
  if (!/\bcollected\b/i.test(content) || !/\brefund\b/i.test(content)) return;
  const hasInvariant = /\bnet\b[^\n=]*=[^\n]*\bcollected\b[^\n]*-\s*\brefund\b/i.test(content);
  if (hasInvariant) return;

  const idx = content.search(/\b(collected|refund)\b/i);
  pushViolation(invariantViolations, {
    type: 'net_invariant_missing',
    severity: 'high',
    file: relPath,
    line: getLine(content, Math.max(0, idx)),
    message: 'Collected/refund usage without explicit net = collected - refund invariant',
  });
}

function checkNegativeBalance(content, relPath, invariantViolations) {
  for (const match of content.matchAll(/\b(balance|salary_due)\b[^\n]{0,50}(?:=|-=)[^\n]{0,80}-[^\n]{0,80}/gi)) {
    const near = content.slice(Math.max(0, (match.index ?? 0) - 120), (match.index ?? 0) + 160);
    if (/Math\.max\s*\(\s*0/i.test(near)) continue;
    pushViolation(invariantViolations, {
      type: 'negative_balance_risk',
      severity: 'high',
      file: relPath,
      line: getLine(content, match.index ?? 0),
      message: 'Potential negative balance/salary_due arithmetic without lower-bound clamp',
    });
  }
}

function checkShiftClose(content, relPath, invariantViolations) {
  if (!/shift/i.test(relPath) && !/shift\s*close|close\s*shift/i.test(content)) return;
  if (/assertShiftOpen|SHIFT_CLOSED|isShiftClosed/i.test(content)) return;

  const idx = content.search(/shift/i);
  pushViolation(invariantViolations, {
    type: 'shift_locking_reference_missing',
    severity: 'medium',
    file: relPath,
    line: getLine(content, Math.max(0, idx)),
    message: 'Shift-related financial flow without visible closed-shift guard',
  });
}

export async function runFinancial(input) {
  const rootDir = process.cwd();
  const files = await listBackendFiles(rootDir);
  const invariantViolations = [];
  const task = String(input?.task || '').trim();

  for (const filePath of files) {
    let content = '';
    try {
      content = await fs.readFile(filePath, 'utf8');
    } catch {
      continue;
    }

    const relPath = toRelative(rootDir, filePath);
    const isFinancialScope =
      /(ledger|finance|salary|motivation|shift|owner|dispatcher)/i.test(relPath) ||
      /(ledger|salary_due|motivation|refund|collected|balance)/i.test(content);

    if (!isFinancialScope) continue;

    checkRounding(content, relPath, invariantViolations);
    checkNetInvariant(content, relPath, invariantViolations);
    checkNegativeBalance(content, relPath, invariantViolations);
    checkShiftClose(content, relPath, invariantViolations);
  }

  const severity = invariantViolations.length ? maxSeverity(invariantViolations) : 'low';
  const status = severity === 'high' ? 'fail' : 'ok';
  const reportPath = path.join(rootDir, 'dev_pipeline', 'financial.md');

  const report = [
    '# Financial Report',
    '',
    '## TASK',
    task || '(empty task)',
    '',
    `## Invariant Violations (${invariantViolations.length})`,
    ...(invariantViolations.length
      ? invariantViolations.map(
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
    stage: 'financial',
    status,
    invariantViolations,
    severity,
  };
}
