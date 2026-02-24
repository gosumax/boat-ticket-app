import fs from 'node:fs/promises';
import path from 'node:path';

function extractTotalFiles(researchContent) {
  const match = researchContent.match(/## Total File Count\s*-\s*(\d+)/m);
  return match ? Number(match[1]) : 0;
}

function extractDetectedTestCommand(researchContent) {
  const match = researchContent.match(/## Detected Test Command\s*-\s*(.+)/m);
  return match ? match[1].trim() : 'Not detected';
}

function extractFilesByPrefix(researchContent, prefix) {
  const escapedPrefix = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`^- (${escapedPrefix}.+)$`, 'gm');
  return Array.from(researchContent.matchAll(regex), (match) => match[1].trim());
}

function detectRiskZones(allFiles) {
  const zones = [];
  const has = (pattern) => allFiles.some((file) => pattern.test(file));

  if (has(/^server\/.*(finance|ledger)/i)) zones.push('server-finance-ledger');
  if (has(/^server\/.*shift/i) || has(/^src\/.*shift/i)) zones.push('shift-modules');
  if (has(/^server\/.*motivation/i) || has(/^src\/.*motivation/i)) zones.push('motivation-modules');
  if (has(/^server\/.*owner.*settings/i) || has(/^src\/.*owner.*settings/i)) zones.push('owner-settings-modules');
  if (has(/^server\/dispatcher-shift/i) || has(/^src\/.*dispatcher.*shift/i)) zones.push('dispatcher-shift-modules');

  return zones;
}

export async function runDesign(input) {
  const projectRoot = process.cwd();
  const researchPath = path.join(projectRoot, 'dev_pipeline', 'research.md');
  const designPath = path.join(projectRoot, 'dev_pipeline', 'design.md');
  const task = String(input?.task || '').trim();

  const researchContent = await fs.readFile(researchPath, 'utf8');

  const totalFiles = extractTotalFiles(researchContent);
  const testCommand = extractDetectedTestCommand(researchContent);
  const backendFiles = extractFilesByPrefix(researchContent, 'server/');
  const frontendFiles = extractFilesByPrefix(researchContent, 'src/');
  const testFiles = extractFilesByPrefix(researchContent, 'tests/');
  const allFiles = [...backendFiles, ...frontendFiles, ...testFiles];
  const riskZonesDetected = detectRiskZones(allFiles);

  const report = [
    '# Design Report',
    '',
    '## TASK',
    task || '(empty task)',
    '',
    '## System Context',
    `- Total files: ${totalFiles}`,
    `- Backend presence (yes/no): ${backendFiles.length > 0 ? 'yes' : 'no'}`,
    `- Frontend presence (yes/no): ${frontendFiles.length > 0 ? 'yes' : 'no'}`,
    `- Tests detected (yes/no): ${testFiles.length > 0 ? 'yes' : 'no'}`,
    `- Test command: ${testCommand}`,
    '',
    '## Risk Zones (на основе структуры)',
    ...(riskZonesDetected.length > 0
      ? riskZonesDetected.map((zone) => `- ${zone}`)
      : ['- none-detected']),
    '',
    '## Guard Requirements (статический шаблон)',
    '- No silent fallback',
    '- No client time',
    '- Uniform error structure',
    '- Preserve API contracts',
    '- Preserve roles',
    '',
    '## Implementation Strategy (generic, без AI)',
    '- Minimal diff',
    '- Phase-based change',
    '- Test-before-exit rule',
    '',
  ].join('\n');

  await fs.mkdir(path.dirname(designPath), { recursive: true });
  await fs.writeFile(designPath, report, 'utf8');

  return {
    stage: 'design',
    status: 'ok',
    reportPath: 'dev_pipeline/design.md',
    riskZonesDetected,
  };
}
