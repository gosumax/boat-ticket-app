import fs from 'node:fs/promises';
import path from 'node:path';

function extractRiskZones(designContent) {
  const lines = designContent.split(/\r?\n/);
  const zones = [];
  let inSection = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (!inSection) {
      if (line.startsWith('## Risk Zones')) {
        inSection = true;
      }
      continue;
    }

    if (line.startsWith('## ')) {
      break;
    }

    if (line.startsWith('- ')) {
      const zone = line.slice(2).trim();
      if (zone && zone !== 'none-detected') zones.push(zone);
    }
  }

  return zones;
}

function extractServerFiles(researchContent) {
  const regex = /^- (server\/.+)$/gm;
  return Array.from(researchContent.matchAll(regex), (match) => match[1].trim());
}

function collectImpactedFiles(serverFiles, riskZones) {
  const impacted = new Set();
  const zones = riskZones.map((z) => z.toLowerCase());

  if (zones.some((z) => z.includes('shift'))) {
    for (const file of serverFiles) {
      if (/shift/i.test(file)) impacted.add(file);
    }
  }

  if (zones.some((z) => z.includes('motivation'))) {
    for (const file of serverFiles) {
      if (/motivation/i.test(file)) impacted.add(file);
    }
  }

  if (zones.some((z) => z.includes('owner-settings') || z.includes('owner settings'))) {
    for (const file of serverFiles) {
      if (/owner.*settings|owner-settings/i.test(file)) impacted.add(file);
    }
  }

  if (zones.some((z) => z.includes('ledger'))) {
    for (const file of serverFiles) {
      if (/ledger/i.test(file)) impacted.add(file);
    }
  }

  if (zones.some((z) => z.includes('finance'))) {
    for (const file of serverFiles) {
      if (/finance|ledger/i.test(file)) impacted.add(file);
    }
  }

  if (zones.some((z) => z.includes('dispatcher-shift') || z.includes('dispatcher shift'))) {
    for (const file of serverFiles) {
      if (/dispatcher.*shift/i.test(file)) impacted.add(file);
    }
  }

  return Array.from(impacted).sort((a, b) => a.localeCompare(b));
}

function toBulletList(items) {
  if (!items.length) return '- (none)';
  return items.map((item) => `- ${item}`).join('\n');
}

export async function runPlan(input) {
  const projectRoot = process.cwd();
  const researchPath = path.join(projectRoot, 'dev_pipeline', 'research.md');
  const designPath = path.join(projectRoot, 'dev_pipeline', 'design.md');
  const planPath = path.join(projectRoot, 'dev_pipeline', 'plan.md');
  const task = String(input?.task || '').trim();
  const validationCommand = String(input?.config?.testCommand || 'npm run test').trim() || 'npm run test';

  const researchContent = await fs.readFile(researchPath, 'utf8');
  const designContent = await fs.readFile(designPath, 'utf8');

  const riskZonesDetected = extractRiskZones(designContent);
  const serverFiles = extractServerFiles(researchContent);
  const impactedFiles = collectImpactedFiles(serverFiles, riskZonesDetected);

  const report = [
    '# Plan Report',
    '',
    '## TASK',
    task || '(empty task)',
    '',
    '## Phases',
    '',
    '### Phase 1 — Impact Analysis',
    '- Files potentially affected (по risk zones):',
    toBulletList(impactedFiles),
    '- Definition of Done:',
    '- Identified impacted files are explicit and bounded.',
    '- Risks are documented per detected risk zone.',
    '- Tests to run:',
    `- ${validationCommand}`,
    '- Risks:',
    '- Hidden coupling in money/ledger and shift paths.',
    '- Contract drift if guard formatting differs across routes.',
    '',
    '### Phase 2 — Controlled Implementation',
    '- Change type: minimal diff',
    '- Guard enforcement',
    '- Role safety check',
    '',
    '### Phase 3 — Validation',
    '- Run tests',
    '- Invariant check',
    '- No regression verification',
    '',
    '## Definition of Global PASS',
    '- All tests PASS',
    '- No API contract break',
    '- No silent fallback',
    '- No client time usage',
    '- Roles preserved',
    '',
  ].join('\n');

  await fs.mkdir(path.dirname(planPath), { recursive: true });
  await fs.writeFile(planPath, report, 'utf8');

  return {
    stage: 'plan',
    status: 'ok',
    reportPath: 'dev_pipeline/plan.md',
    impactedFiles,
  };
}
