import fs from 'node:fs/promises';
import path from 'node:path';

function toPattern(stage, issue) {
  const type = String(issue?.type || issue?.kind || 'issue').trim() || 'issue';
  const file = String(issue?.file || issue?.path || '').trim();
  const line = Number.isFinite(Number(issue?.line)) ? Number(issue?.line) : 0;
  const message = String(issue?.message || '').trim();
  const key = [stage, type, file, line || ''].join('|');
  return {
    key,
    stage,
    type,
    file,
    line,
    message,
  };
}

function collectHighPatterns(input) {
  const patterns = [];

  const securityFindings = Array.isArray(input?.security?.findings) ? input.security.findings : [];
  for (const finding of securityFindings) {
    if (finding?.severity === 'high') patterns.push(toPattern('security', finding));
  }

  const financialViolations = Array.isArray(input?.financial?.invariantViolations)
    ? input.financial.invariantViolations
    : [];
  for (const violation of financialViolations) {
    if (violation?.severity === 'high') patterns.push(toPattern('financial', violation));
  }

  const concurrencyRisks = Array.isArray(input?.concurrency?.raceRisks) ? input.concurrency.raceRisks : [];
  for (const risk of concurrencyRisks) {
    if (risk?.severity === 'high') patterns.push(toPattern('concurrency', risk));
  }

  return patterns;
}

export async function runRegression(input) {
  const rootDir = process.cwd();
  const reportPath = path.join(rootDir, 'dev_pipeline', 'regression.md');
  const memoryPath = path.join(rootDir, 'dev_pipeline', 'regression_memory.json');
  const task = String(input?.task || '').trim();
  const now = new Date().toISOString();

  let memory = { patterns: [] };
  try {
    const raw = await fs.readFile(memoryPath, 'utf8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed?.patterns)) {
      memory = parsed;
    }
  } catch {
    memory = { patterns: [] };
  }

  const currentHighPatterns = collectHighPatterns(input);
  const memoryByKey = new Map(memory.patterns.map((item) => [item.key, item]));
  const repeatedIssues = [];
  const addedPatterns = [];

  for (const pattern of currentHighPatterns) {
    const existing = memoryByKey.get(pattern.key);
    if (existing) {
      repeatedIssues.push(pattern);
      existing.lastSeen = now;
      existing.count = Number(existing.count || 0) + 1;
      if (!existing.firstSeen) existing.firstSeen = now;
      continue;
    }

    const next = {
      ...pattern,
      firstSeen: now,
      lastSeen: now,
      count: 1,
    };
    memory.patterns.push(next);
    memoryByKey.set(next.key, next);
    addedPatterns.push(pattern);
  }

  await fs.mkdir(path.dirname(memoryPath), { recursive: true });
  await fs.writeFile(memoryPath, `${JSON.stringify(memory, null, 2)}\n`, 'utf8');

  const status = repeatedIssues.length > 0 ? 'fail' : 'ok';
  const report = [
    '# Regression Report',
    '',
    '## TASK',
    task || '(empty task)',
    '',
    `## Current High Severity Patterns (${currentHighPatterns.length})`,
    ...(currentHighPatterns.length
      ? currentHighPatterns.map((item, idx) => `${idx + 1}. ${item.stage}/${item.type} - ${item.file}:${item.line}`)
      : ['- none']),
    '',
    `## Repeated Issues (${repeatedIssues.length})`,
    ...(repeatedIssues.length
      ? repeatedIssues.map((item, idx) => `${idx + 1}. ${item.stage}/${item.type} - ${item.file}:${item.line}`)
      : ['- none']),
    '',
    `## Newly Memorized Patterns (${addedPatterns.length})`,
    ...(addedPatterns.length
      ? addedPatterns.map((item, idx) => `${idx + 1}. ${item.stage}/${item.type} - ${item.file}:${item.line}`)
      : ['- none']),
    '',
    '## Memory File',
    '- dev_pipeline/regression_memory.json',
    '',
    '## Status',
    `- ${status}`,
    '',
  ].join('\n');

  await fs.writeFile(reportPath, report, 'utf8');

  return {
    stage: 'regression',
    status,
    repeatedIssues,
  };
}
