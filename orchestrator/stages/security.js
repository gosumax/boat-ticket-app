import fs from 'node:fs/promises';
import path from 'node:path';

const TEXT_EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.sql']);

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

function toRelative(rootDir, filePath) {
  return path.relative(rootDir, filePath).split(path.sep).join('/');
}

function getLine(content, index) {
  return content.slice(0, index).split('\n').length;
}

function pushFinding(findings, finding, maxCount = 200) {
  if (findings.length < maxCount) findings.push(finding);
}

function severityRank(level) {
  if (level === 'high') return 3;
  if (level === 'medium') return 2;
  return 1;
}

function maxSeverity(findings) {
  let current = 'low';
  for (const finding of findings) {
    if (severityRank(finding.severity) > severityRank(current)) {
      current = finding.severity;
    }
  }
  return current;
}

function routeMissingRoleChecks(content, relPath, findings) {
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!/router\.(post|patch|put|delete)\s*\(/.test(line)) continue;
    const block = lines.slice(i, Math.min(lines.length, i + 4)).join(' ');
    if (/(canSell|canDispatch|canOwner|canSellOrDispatch|isAdmin|authenticateToken)/.test(block)) continue;
    pushFinding(findings, {
      type: 'missing_role_check',
      severity: 'high',
      file: relPath,
      line: i + 1,
      message: 'Potential mutating route without explicit role middleware',
    });
  }
}

function checkMoneyArithmetic(content, relPath, findings) {
  if (!/(money|amount|price|ledger|salary)/i.test(content)) return;
  if (/money-rounding/i.test(content) || /Math\.round\s*\(/.test(content)) return;

  const arithmeticMatch = content.match(/\b(amount|price|total|salary|balance)\b[^\n]{0,80}[+\-*/][^\n]{0,80}/i);
  if (!arithmeticMatch || arithmeticMatch.index == null) return;
  pushFinding(findings, {
    type: 'money_arithmetic_without_rounding',
    severity: 'medium',
    file: relPath,
    line: getLine(content, arithmeticMatch.index),
    message: 'Money arithmetic detected without money-rounding util/Math.round',
  });
}

export async function runSecurity(input) {
  const rootDir = process.cwd();
  const files = await listBackendFiles(rootDir);
  const findings = [];

  for (const filePath of files) {
    let content = '';
    try {
      content = await fs.readFile(filePath, 'utf8');
    } catch {
      continue;
    }

    const relPath = toRelative(rootDir, filePath);

    const sqlInterpolation = /db\.(prepare|exec|get|all|run)\s*\(\s*`[\s\S]*?\$\{[\s\S]*?`/g;
    for (const match of content.matchAll(sqlInterpolation)) {
      pushFinding(findings, {
        type: 'sql_interpolation',
        severity: 'high',
        file: relPath,
        line: getLine(content, match.index ?? 0),
        message: 'Template SQL with interpolation detected',
      });
    }

    const catchBlocks = /try\s*\{[\s\S]*?\}\s*catch\s*\(([^)]*)\)\s*\{([\s\S]*?)\}/g;
    for (const match of content.matchAll(catchBlocks)) {
      const catchBody = match[2] || '';
      if (/\bthrow\b/.test(catchBody)) continue;
      pushFinding(findings, {
        type: 'catch_without_rethrow',
        severity: 'medium',
        file: relPath,
        line: getLine(content, match.index ?? 0),
        message: 'try/catch block without rethrow detected',
      });
    }

    for (const match of content.matchAll(/Date\.now\s*\(/g)) {
      pushFinding(findings, {
        type: 'date_now_usage',
        severity: 'medium',
        file: relPath,
        line: getLine(content, match.index ?? 0),
        message: 'Date.now usage detected',
      });
    }

    for (const match of content.matchAll(/new Date\s*\(/g)) {
      pushFinding(findings, {
        type: 'new_date_usage',
        severity: 'low',
        file: relPath,
        line: getLine(content, match.index ?? 0),
        message: 'new Date() usage detected',
      });
    }

    for (const match of content.matchAll(/req\.(body|query|params)(\[['"][^'"]*date[^'"]*['"]\]|\.[A-Za-z0-9_]*date)/gi)) {
      pushFinding(findings, {
        type: 'client_date_usage',
        severity: 'high',
        file: relPath,
        line: getLine(content, match.index ?? 0),
        message: 'Client-provided date usage detected',
      });
    }

    for (const match of content.matchAll(/\|\|/g)) {
      pushFinding(findings, {
        type: 'default_fallback',
        severity: 'low',
        file: relPath,
        line: getLine(content, match.index ?? 0),
        message: 'Default fallback (||) detected',
      });
    }

    routeMissingRoleChecks(content, relPath, findings);
    checkMoneyArithmetic(content, relPath, findings);
  }

  const severity = findings.length ? maxSeverity(findings) : 'low';
  const status = severity === 'high' ? 'fail' : 'ok';
  const reportPath = path.join(rootDir, 'dev_pipeline', 'security.md');
  const task = String(input?.task || '').trim();

  const report = [
    '# Security Report',
    '',
    '## TASK',
    task || '(empty task)',
    '',
    `## Findings (${findings.length})`,
    ...(findings.length
      ? findings.map((f, idx) => `${idx + 1}. [${f.severity}] ${f.type} - ${f.file}:${f.line} - ${f.message}`)
      : ['- none']),
    '',
    `## Overall Severity`,
    `- ${severity}`,
    '',
    `## Status`,
    `- ${status}`,
    '',
  ].join('\n');

  await fs.mkdir(path.dirname(reportPath), { recursive: true });
  await fs.writeFile(reportPath, report, 'utf8');

  return {
    stage: 'security',
    status,
    findings,
    severity,
  };
}
