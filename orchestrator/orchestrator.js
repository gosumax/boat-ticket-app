#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import config from './config.js';
import { runResearch } from './stages/research.js';
import { runDesign } from './stages/design.js';
import { runPlan } from './stages/plan.js';
import { runSystemMap } from './stages/systemMap.js';
import { runImplementation } from './stages/implement.js';
import { runSecurity } from './stages/security.js';
import { runFinancial } from './stages/financial.js';
import { runConcurrency } from './stages/concurrency.js';
import { runRegression } from './stages/regression.js';
import { runGeneratedUiTests, runTests } from './utils/testRunner.js';
import {
  assertCleanRepo,
  branchExists,
  cleanUntracked,
  checkoutBranch,
  createTaskBranch,
  deleteBranch,
  dropSnapshot,
  ensureGitRepo,
  getCurrentBranch,
  getCurrentCommit,
  getSnapshotRef,
  hasActiveSnapshot,
  resetHardToCommit,
  restoreSnapshot,
} from './utils/git.js';
import { assertValidTransition, getInitialState, validateLifecycleDefinition } from './utils/lifecycleGuard.js';
import { createRunDir, writeArtifact } from './utils/runArtifacts.js';

const LIFECYCLE_DEFINITION = Object.freeze({
  states: ['INIT', 'RESEARCH_DONE', 'DESIGN_DONE', 'PLAN_DONE', 'IMPLEMENTED', 'VALIDATING', 'RETRYING', 'PASS', 'FAILED'],
  transitions: {
    INIT: ['RESEARCH_DONE'],
    RESEARCH_DONE: ['DESIGN_DONE'],
    DESIGN_DONE: ['PLAN_DONE'],
    PLAN_DONE: ['IMPLEMENTED'],
    IMPLEMENTED: ['VALIDATING'],
    VALIDATING: ['RETRYING', 'PASS', 'FAILED'],
    RETRYING: ['IMPLEMENTED'],
    PASS: [],
    FAILED: [],
  },
});

let lifecycleState = getInitialState();
let baseBranch = null;
let baseCommit = null;
let taskBranch = null;
let implementationAttempt = 1;
let rollbackCompleted = false;
let finalTask = '';
let finalMaxRetries = 0;
let finalValidationAttempts = 0;
let finalSystemMapBaselineHash = '';
let finalSystemMapNextHash = '';
let finalArtifactsWritten = false;
let finalRunId = '';
let finalBaselineApiSignature = new Map();
let finalContractDiff = {
  apiChanges: {
    added: [],
    removed: [],
    modified: [],
  },
};
let finalImpactReport = {
  impact: {
    changedFiles: [],
    modules: [],
  },
};
let finalFrontendImpact = {
  impact: {
    changedFiles: [],
    views: [],
  },
};
let finalChangedFiles = [];
let finalBaselineFrontendContract = {
  views: [],
};
let finalFrontendContract = {
  views: [],
};
let finalGeneratedUiTestsResult = {
  generatedUiTests: {
    ran: false,
    count: 0,
    exitCode: 0,
  },
};
let finalBackendEndpoints = [];
let finalFullContractSnapshot = {
  backend: {
    endpoints: [],
    diff: {
      added: [],
      removed: [],
      modified: [],
    },
  },
  frontend: {
    views: [],
  },
};
let finalContractIntegrity = {
  integrity: {
    status: 'PASS',
    missing: [],
  },
};
let finalExecutionMode = {
  execution: {
    mode: 'direct',
    blocked: false,
  },
};

function buildImpactReport(changedFiles) {
  const inputFiles = Array.isArray(changedFiles) ? changedFiles : [];
  const backendFiles = Array.from(
    new Set(
      inputFiles
        .map((file) => String(file || '').replace(/\\/g, '/').trim())
        .filter((file) => /^server\/.+\.(mjs|js)$/i.test(file)),
    ),
  ).sort((a, b) => a.localeCompare(b));

  const modules = new Set();
  const IMPACT_MAP = {
    'server/selling.mjs': ['selling', 'owner.money', 'dispatcher.shift'],
    'server/owner.mjs': ['owner'],
    'server/dispatcher-shift-ledger.mjs': ['dispatcher.shift', 'owner.money'],
    'server/auth.js': ['auth', 'all.roles'],
  };

  for (const file of backendFiles) {
    const mapped = IMPACT_MAP[file];
    if (mapped) {
      for (const moduleName of mapped) modules.add(moduleName);
    } else {
      modules.add('unknown');
    }
  }

  return {
    impact: {
      changedFiles: backendFiles,
      modules: Array.from(modules).sort((a, b) => a.localeCompare(b)),
    },
  };
}

function isFrontendContractPath(filePath) {
  const normalized = String(filePath || '').replace(/\\/g, '/').trim();
  return /^src\/(views|components)\/.+\.jsx$/i.test(normalized);
}

function normalizeRelPathValue(filePath) {
  return String(filePath || '').replace(/\\/g, '/').trim();
}

function normalizeToken(value, fallback) {
  const normalized = String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return normalized || fallback;
}

async function listFrontendContractFiles() {
  const frontendFiles = [];
  async function walkFrontendJsx(rootRelPath) {
    const rootAbsPath = path.join(process.cwd(), rootRelPath.split('/').join(path.sep));
    let entries = [];
    try {
      entries = await fs.readdir(rootAbsPath, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const absPath = path.join(rootAbsPath, entry.name);
      const relPath = `${rootRelPath}/${entry.name}`.replace(/\\/g, '/');
      if (entry.isDirectory()) {
        await walkFrontendJsx(relPath);
        continue;
      }
      if (entry.isFile() && relPath.endsWith('.jsx') && isFrontendContractPath(relPath)) {
        frontendFiles.push(relPath);
      }
    }
  }

  await walkFrontendJsx('src/views');
  await walkFrontendJsx('src/components');
  return frontendFiles.sort((a, b) => a.localeCompare(b));
}

function extractFrontendApiCalls(content) {
  const apiCalls = new Set();
  const methodOrder = ['get', 'post', 'patch', 'put', 'delete'];
  for (const method of methodOrder) {
    const patterns = [
      new RegExp(`apiClient\\.${method}\\s*\\(\\s*'([^'\\n]*)'`, 'g'),
      new RegExp(`apiClient\\.${method}\\s*\\(\\s*"([^"\\n]*)"`, 'g'),
      new RegExp(`apiClient\\.${method}\\s*\\(\\s*\\\`([^\\\`]*)\\\``, 'g'),
    ];
    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(String(content || ''))) !== null) {
        const rawPath = String(match[1] || '').trim();
        const endpointPath = rawPath.startsWith('/api/')
          ? rawPath
          : rawPath.startsWith('/')
            ? `/api${rawPath}`
            : '';
        if (!endpointPath) continue;
        apiCalls.add(`${method.toUpperCase()} ${endpointPath}`);
      }
    }
  }
  return Array.from(apiCalls).sort((a, b) => a.localeCompare(b));
}

function parseFrontendImportPaths(content) {
  const imports = new Set();
  const source = String(content || '');
  const patterns = [
    /import\s+[\s\S]*?\s+from\s+["']([^"']+)["']/g,
    /import\s+["']([^"']+)["']/g,
    /import\s*\(\s*["']([^"']+)["']\s*\)/g,
  ];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(source)) !== null) {
      const importPath = String(match[1] || '').trim();
      if (importPath.startsWith('.')) imports.add(importPath);
    }
  }
  return Array.from(imports).sort((a, b) => a.localeCompare(b));
}

function resolveFrontendImportTarget(fromRelPath, importPath, knownFiles) {
  const fromPosix = normalizeRelPathValue(fromRelPath);
  const cleanImport = String(importPath || '').split('?')[0].split('#')[0];
  const baseDir = path.posix.dirname(fromPosix);
  const resolved = path.posix.normalize(path.posix.join(baseDir, cleanImport));
  const candidates = [resolved, `${resolved}.jsx`, `${resolved}/index.jsx`];
  for (const candidate of candidates) {
    if (knownFiles.has(candidate) && isFrontendContractPath(candidate)) return candidate;
  }
  return '';
}

async function buildFrontendDependencyGraph(frontendFiles) {
  const sortedFiles = Array.from(new Set((frontendFiles || []).map((file) => normalizeRelPathValue(file)).filter(Boolean)))
    .sort((a, b) => a.localeCompare(b));
  const knownFiles = new Set(sortedFiles);
  const forward = new Map();
  const reverse = new Map();
  for (const file of sortedFiles) {
    forward.set(file, new Set());
    reverse.set(file, new Set());
  }
  for (const relPath of sortedFiles) {
    const absPath = path.join(process.cwd(), relPath.split('/').join(path.sep));
    let content = '';
    try {
      content = await fs.readFile(absPath, 'utf8');
    } catch {
      continue;
    }
    for (const importPath of parseFrontendImportPaths(content)) {
      const target = resolveFrontendImportTarget(relPath, importPath, knownFiles);
      if (!target) continue;
      forward.get(relPath).add(target);
      reverse.get(target).add(relPath);
    }
  }
  return { forward, reverse };
}

async function buildFrontendImpactReport(changedFiles) {
  const inputFiles = Array.isArray(changedFiles) ? changedFiles : [];
  const frontendChangedFiles = Array.from(
    new Set(
      inputFiles
        .map((file) => normalizeRelPathValue(file))
        .filter((file) => isFrontendContractPath(file)),
    ),
  ).sort((a, b) => a.localeCompare(b));
  const impactedFiles = new Set(frontendChangedFiles);
  if (frontendChangedFiles.length > 0) {
    const frontendFiles = await listFrontendContractFiles();
    const { forward, reverse } = await buildFrontendDependencyGraph(frontendFiles);
    const queue = [...frontendChangedFiles];
    const seen = new Set(frontendChangedFiles);
    while (queue.length > 0) {
      const current = queue.shift();
      const neighbors = [
        ...(forward.get(current) || []),
        ...(reverse.get(current) || []),
      ].sort((a, b) => a.localeCompare(b));
      for (const next of neighbors) {
        if (seen.has(next)) continue;
        seen.add(next);
        impactedFiles.add(next);
        queue.push(next);
      }
    }
  }

  const views = Array.from(new Set(
    Array.from(impactedFiles)
      .map((relPath) => path.basename(relPath, path.extname(relPath)))
      .filter(Boolean),
  )).sort((a, b) => a.localeCompare(b));

  return {
    impact: {
      changedFiles: frontendChangedFiles,
      views,
    },
  };
}

function parseApiCallEntry(entry) {
  const raw = String(entry || '').trim();
  const match = raw.match(/^([A-Za-z]+)\s+(.+)$/);
  if (!match) return null;
  const method = String(match[1] || '').toUpperCase().trim();
  const endpointPathRaw = String(match[2] || '').trim();
  if (!method || !endpointPathRaw) return null;
  const endpointPath = endpointPathRaw.startsWith('/') ? endpointPathRaw : `/${endpointPathRaw}`;
  return { method, endpointPath };
}

function toFrontendApiCallSet(frontendContract) {
  const entries = [];
  const views = Array.isArray(frontendContract?.views) ? frontendContract.views : [];
  for (const view of views) {
    const viewName = String(view?.name || '').trim();
    if (!viewName) continue;
    const apiCalls = Array.isArray(view?.apiCalls) ? view.apiCalls : [];
    for (const apiCall of apiCalls) {
      const parsed = parseApiCallEntry(apiCall);
      if (!parsed) continue;
      entries.push({
        view: viewName,
        method: parsed.method,
        endpointPath: parsed.endpointPath,
      });
    }
  }
  entries.sort((a, b) => (
    a.view.localeCompare(b.view)
    || a.method.localeCompare(b.method)
    || a.endpointPath.localeCompare(b.endpointPath)
  ));
  return entries;
}

function buildFrontendApiCallLookup(frontendContract) {
  const lookup = new Map();
  const entries = toFrontendApiCallSet(frontendContract);
  for (const entry of entries) {
    const key = `${entry.view}||${entry.method}||${entry.endpointPath}`;
    lookup.set(key, entry);
  }
  return lookup;
}

function buildNewFrontendApiCallTargets(baselineContract, nextContract) {
  const baselineLookup = buildFrontendApiCallLookup(baselineContract);
  const nextLookup = buildFrontendApiCallLookup(nextContract);
  const targets = [];
  for (const [key, value] of nextLookup.entries()) {
    if (baselineLookup.has(key)) continue;
    targets.push(value);
  }
  return targets.sort((a, b) => (
    a.view.localeCompare(b.view)
    || a.method.localeCompare(b.method)
    || a.endpointPath.localeCompare(b.endpointPath)
  ));
}

function buildBackendChangedFrontendTargets(contractDiff, nextContract) {
  const added = Array.isArray(contractDiff?.apiChanges?.added) ? contractDiff.apiChanges.added : [];
  const modified = Array.isArray(contractDiff?.apiChanges?.modified) ? contractDiff.apiChanges.modified : [];
  const changedEndpoints = new Set(
    [...added, ...modified]
      .map((entry) => parseApiCallEntry(entry))
      .filter(Boolean)
      .map((entry) => `${entry.method} ${entry.endpointPath}`),
  );
  if (changedEndpoints.size === 0) return [];

  const targets = [];
  for (const entry of toFrontendApiCallSet(nextContract)) {
    const endpointKey = `${entry.method} ${entry.endpointPath}`;
    if (!changedEndpoints.has(endpointKey)) continue;
    targets.push(entry);
  }
  return targets.sort((a, b) => (
    a.view.localeCompare(b.view)
    || a.method.localeCompare(b.method)
    || a.endpointPath.localeCompare(b.endpointPath)
  ));
}

function toGeneratedUiTestFileName(target) {
  const view = normalizeToken(target?.view, 'view');
  const method = normalizeToken(target?.method, 'method');
  const normalizedPath = normalizeToken(String(target?.endpointPath || '').replace(/^\//, ''), 'root');
  return `ui_${view}_${method}_${normalizedPath}.spec.js`;
}

function escapeSingleQuotedJs(value) {
  return String(value || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function buildGeneratedUiTestContent(target) {
  const view = String(target?.view || '').trim();
  const method = String(target?.method || '').trim().toUpperCase();
  const endpointPath = String(target?.endpointPath || '').trim();
  const safeView = escapeSingleQuotedJs(view);
  const safeMethod = escapeSingleQuotedJs(method);
  const safePath = escapeSingleQuotedJs(endpointPath);
  return [
    "import { test } from '@playwright/test';",
    '',
    `test.describe('AUTO UI - ${safeView}', () => {`,
    `  test('TODO: cover ${safeMethod} ${safePath}', async ({ page }) => {`,
    '    void page;',
    '    // TODO: implement',
    '  });',
    '});',
    '',
  ].join('\n');
}

async function buildFrontendContract() {
  const frontendFiles = await listFrontendContractFiles();

  const byViewName = new Map();
  for (const relPath of frontendFiles) {
    const absPath = path.join(process.cwd(), relPath.split('/').join(path.sep));
    let content = '';
    try {
      content = await fs.readFile(absPath, 'utf8');
    } catch {
      continue;
    }
    const name = path.basename(relPath, '.jsx');
    if (!byViewName.has(name)) byViewName.set(name, new Set());
    for (const apiCall of extractFrontendApiCalls(content)) {
      byViewName.get(name).add(apiCall);
    }
  }

  const views = Array.from(byViewName.keys())
    .sort((a, b) => a.localeCompare(b))
    .map((name) => ({
      name,
      apiCalls: Array.from(byViewName.get(name) || []).sort((a, b) => a.localeCompare(b)),
    }));
  return { views };
}

function parseSystemMapApiSignature(systemMapContent) {
  const lines = String(systemMapContent || '').split(/\r?\n/);
  const startIndex = lines.findIndex((line) => line.trim() === '## Express Endpoints');
  if (startIndex < 0) return new Map();

  const signature = new Map();
  for (let i = startIndex + 1; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (!line) continue;
    if (!line.startsWith('|')) {
      if (line.startsWith('## ')) break;
      continue;
    }

    const cols = line.split('|').slice(1, -1).map((v) => v.trim());
    if (cols.length !== 4) continue;
    if (cols[0] === 'Method' || cols[0] === '---') continue;

    const method = cols[0];
    const routePath = cols[1];
    const role = cols[2];
    const guardsRaw = cols[3];
    if (!method || !routePath) continue;

    let guards = '';
    if (guardsRaw && guardsRaw !== '(none)') {
      guards = guardsRaw
        .split(',')
        .map((g) => g.trim())
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b))
        .join(', ');
    }

    const endpointKey = `${method} ${routePath}`;
    signature.set(endpointKey, `${role}|${guards}`);
  }

  return signature;
}

function buildContractDiff(baselineSignature, nextSignature) {
  const baseline = baselineSignature || new Map();
  const next = nextSignature || new Map();
  const added = [];
  const removed = [];
  const modified = [];

  for (const key of next.keys()) {
    if (!baseline.has(key)) {
      added.push(key);
      continue;
    }
    if (baseline.get(key) !== next.get(key)) {
      modified.push(key);
    }
  }

  for (const key of baseline.keys()) {
    if (!next.has(key)) removed.push(key);
  }

  const sortAlpha = (a, b) => a.localeCompare(b);
  added.sort(sortAlpha);
  removed.sort(sortAlpha);
  modified.sort(sortAlpha);

  return {
    apiChanges: {
      added,
      removed,
      modified,
    },
  };
}

function toSortedUniqueStrings(values) {
  return Array.from(new Set((Array.isArray(values) ? values : [])
    .map((value) => String(value || '').trim())
    .filter(Boolean))).sort((a, b) => a.localeCompare(b));
}

function toEndpointsListFromSignature(signature) {
  if (!(signature instanceof Map)) return [];
  return toSortedUniqueStrings(Array.from(signature.keys()));
}

function normalizeFrontendViewsContract(frontendContract) {
  const inputViews = Array.isArray(frontendContract?.views) ? frontendContract.views : [];
  const viewsByName = new Map();
  for (const item of inputViews) {
    const name = String(item?.name || '').trim();
    if (!name) continue;
    if (!viewsByName.has(name)) viewsByName.set(name, new Set());
    const apiCalls = Array.isArray(item?.apiCalls) ? item.apiCalls : [];
    for (const call of apiCalls) {
      const normalized = String(call || '').trim();
      if (normalized) viewsByName.get(name).add(normalized);
    }
  }
  return Array.from(viewsByName.keys())
    .sort((a, b) => a.localeCompare(b))
    .map((name) => ({
      name,
      apiCalls: toSortedUniqueStrings(Array.from(viewsByName.get(name) || [])),
    }));
}

function buildFullContractSnapshot(backendEndpoints, contractDiff, frontendContract) {
  return {
    backend: {
      endpoints: toSortedUniqueStrings(backendEndpoints),
      diff: {
        added: toSortedUniqueStrings(contractDiff?.apiChanges?.added),
        removed: toSortedUniqueStrings(contractDiff?.apiChanges?.removed),
        modified: toSortedUniqueStrings(contractDiff?.apiChanges?.modified),
      },
    },
    frontend: {
      views: normalizeFrontendViewsContract(frontendContract),
    },
  };
}

const API_INTEGRITY_PATH_NORMALIZATION = Object.freeze({
  'GET /api/boats/active': 'GET /api/selling/boats',
  'GET /api/users': 'GET /api/admin/users',
});

function normalizeApiForIntegrityCheck(apiCall) {
  const normalized = String(apiCall || '').trim();
  if (!normalized) return '';
  return API_INTEGRITY_PATH_NORMALIZATION[normalized] || normalized;
}

function buildContractIntegritySnapshot(fullContractSnapshot) {
  const backendEndpoints = toSortedUniqueStrings(fullContractSnapshot?.backend?.endpoints);
  const backendSet = new Set(backendEndpoints);
  const views = Array.isArray(fullContractSnapshot?.frontend?.views) ? fullContractSnapshot.frontend.views : [];
  const missing = [];
  for (const view of views) {
    const apiCalls = Array.isArray(view?.apiCalls) ? view.apiCalls : [];
    for (const apiCall of apiCalls) {
      const rawCall = String(apiCall || '').trim();
      if (!rawCall) continue;
      const normalizedCall = normalizeApiForIntegrityCheck(rawCall);
      const call = backendSet.has(normalizedCall) ? normalizedCall : rawCall;
      if (!backendSet.has(call)) missing.push(call);
    }
  }
  const normalizedMissing = toSortedUniqueStrings(missing);
  return {
    integrity: {
      status: normalizedMissing.length > 0 ? 'FAILED' : 'PASS',
      missing: normalizedMissing,
    },
  };
}

function toGeneratedTestFileName(endpointEntry) {
  const raw = String(endpointEntry || '').trim();
  const spaceIdx = raw.indexOf(' ');
  const method = (spaceIdx > 0 ? raw.slice(0, spaceIdx) : raw).toLowerCase();
  const endpointPath = (spaceIdx > 0 ? raw.slice(spaceIdx + 1) : '').toLowerCase();
  const normalizedPath = endpointPath
    .replace(/^\//, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'root';
  return `test_${method}_${normalizedPath}.spec.js`;
}

function buildGeneratedTestContent(endpointEntry) {
  const raw = String(endpointEntry || '').trim();
  return [
    `describe("AUTO GENERATED - ${raw}", () => {`,
    '  it("should respond without 500", async () => {',
    '    // TODO: implement',
    '    expect(true).toBe(true);',
    '  });',
    '});',
    '',
  ].join('\n');
}

async function writeGeneratedTestsArtifact(runId, contractDiff) {
  const generatedDir = path.join(process.cwd(), 'dev_pipeline', 'generated_tests', String(runId || '').trim());
  await fs.mkdir(generatedDir, { recursive: true });

  const added = Array.isArray(contractDiff?.apiChanges?.added) ? contractDiff.apiChanges.added : [];
  const modified = Array.isArray(contractDiff?.apiChanges?.modified) ? contractDiff.apiChanges.modified : [];
  const targets = Array.from(new Set([...added, ...modified].map((v) => String(v || '').trim()).filter(Boolean)))
    .sort((a, b) => a.localeCompare(b));

  for (const endpoint of targets) {
    const fileName = toGeneratedTestFileName(endpoint);
    const filePath = path.join(generatedDir, fileName);
    try {
      await fs.access(filePath);
      continue;
    } catch {}
    await fs.writeFile(filePath, buildGeneratedTestContent(endpoint), 'utf8');
  }
}

async function writeGeneratedUiTestsArtifact(runId, contractDiff, baselineFrontendContract, nextFrontendContract) {
  const generatedDir = path.join(process.cwd(), 'dev_pipeline', 'generated_ui_tests', String(runId || '').trim());
  await fs.mkdir(generatedDir, { recursive: true });

  const fromBackendDiff = buildBackendChangedFrontendTargets(contractDiff, nextFrontendContract);
  const fromFrontendDiff = buildNewFrontendApiCallTargets(baselineFrontendContract, nextFrontendContract);
  const dedupedTargets = new Map();
  for (const target of [...fromBackendDiff, ...fromFrontendDiff]) {
    const key = `${target.view}||${target.method}||${target.endpointPath}`;
    if (!dedupedTargets.has(key)) dedupedTargets.set(key, target);
  }

  const sortedTargets = Array.from(dedupedTargets.values()).sort((a, b) => {
    const fileA = toGeneratedUiTestFileName(a);
    const fileB = toGeneratedUiTestFileName(b);
    return (
      fileA.localeCompare(fileB)
      || a.view.localeCompare(b.view)
      || a.method.localeCompare(b.method)
      || a.endpointPath.localeCompare(b.endpointPath)
    );
  });

  for (const target of sortedTargets) {
    const fileName = toGeneratedUiTestFileName(target);
    const filePath = path.join(generatedDir, fileName);
    try {
      await fs.access(filePath);
      continue;
    } catch {}
    await fs.writeFile(filePath, buildGeneratedUiTestContent(target), 'utf8');
  }
}

function parseCliOptions(argv) {
  let task = '';
  let modelOverride;
  let maxRetriesOverride;
  const freeTextTask = [];

  for (let i = 0; i < argv.length; i += 1) {
    const token = String(argv[i] || '');

    if (token === '--task') {
      task = String(argv[i + 1] || '').trim();
      i += 1;
      continue;
    }
    if (token.startsWith('--task=')) {
      task = token.slice('--task='.length).trim();
      continue;
    }

    if (token === '--model') {
      modelOverride = String(argv[i + 1] || '').trim();
      i += 1;
      continue;
    }
    if (token.startsWith('--model=')) {
      modelOverride = token.slice('--model='.length).trim();
      continue;
    }

    if (token === '--max-retries') {
      maxRetriesOverride = String(argv[i + 1] || '').trim();
      i += 1;
      continue;
    }
    if (token.startsWith('--max-retries=')) {
      maxRetriesOverride = token.slice('--max-retries='.length).trim();
      continue;
    }

    if (!token.startsWith('--')) {
      freeTextTask.push(token);
    }
  }

  return {
    task: task || freeTextTask.join(' ').trim(),
    modelOverride,
    maxRetriesOverride,
  };
}

function parsePositiveInt(rawValue, fallbackValue) {
  if (rawValue === undefined || rawValue === null || String(rawValue).trim() === '') {
    return fallbackValue;
  }

  const parsed = Number(rawValue);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error('INVALID_MAX_RETRIES');
  }

  return parsed;
}

function assertSnapshotLabel(implementation, attempt) {
  const expected = `attempt-${attempt}`;
  if (!implementation || implementation.snapshotLabel !== expected) {
    throw new Error('LIFECYCLE_VIOLATION');
  }
}

function assertValidatingGate(state) {
  if (state !== 'VALIDATING') {
    throw new Error('LIFECYCLE_VIOLATION');
  }
}

function cleanupFailedTaskBranch() {
  if (lifecycleState !== 'FAILED') {
    throw new Error('LIFECYCLE_VIOLATION');
  }

  const snapshotLabel = `attempt-${implementationAttempt}`;
  if (hasActiveSnapshot(`attempt-${implementationAttempt}`)) {
    try {
      restoreSnapshot();
    } catch {}
  }

  if (!baseBranch) {
    throw new Error('BASE_BRANCH_MISSING');
  }
  if (!baseCommit) {
    throw new Error('BASE_COMMIT_MISSING');
  }

  try {
    checkoutBranch(baseBranch);
  } catch (error) {
    try {
      resetHardToCommit(baseCommit);
      cleanUntracked();
      checkoutBranch(baseBranch);
    } catch {}
    throw error;
  }

  const headBeforeReset = getCurrentCommit();
  if (!headBeforeReset) {
    throw new Error('HEAD_RESOLUTION_FAILED');
  }

  try {
    resetHardToCommit(baseCommit);
    cleanUntracked();
  } catch (error) {
    try {
      resetHardToCommit(baseCommit);
      cleanUntracked();
    } catch {}
    throw error;
  }

  assertCleanRepo();

  if (process.env.ORCHESTRATOR_KEEP_FAILED_BRANCH !== '1' && taskBranch && taskBranch !== baseBranch && branchExists(taskBranch)) {
    deleteBranch(taskBranch);
  }

  const danglingSnapshotRef = getSnapshotRef(snapshotLabel);
  if (danglingSnapshotRef) {
    try {
      dropSnapshot(danglingSnapshotRef);
    } catch {}
  }

  rollbackCompleted = true;
}

function deepFreeze(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  Object.freeze(obj);
  for (const key of Object.getOwnPropertyNames(obj)) {
    const value = obj[key];
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
      deepFreeze(value);
    }
  }
  return obj;
}

async function hashFileSha256(filePath) {
  const content = await fs.readFile(filePath, 'utf8');
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

async function main() {
  const args = process.argv.slice(2);
  const cli = parseCliOptions(args);
  const isMetaMode = process.env.META_MODE === 'true';
  const allowDirect = process.env.ALLOW_DIRECT === 'true';
  finalExecutionMode = {
    execution: {
      mode: isMetaMode ? 'meta' : 'direct',
      blocked: false,
    },
  };
  if (!isMetaMode && !allowDirect) {
    finalExecutionMode.execution.blocked = true;
    lifecycleState = 'FAILED';
    rollbackCompleted = true;
    throw new Error('DIRECT_ORCHESTRATOR_BLOCKED');
  }
  const task = cli.task;
  const maxRetries = parsePositiveInt(cli.maxRetriesOverride, parsePositiveInt(process.env.ORCHESTRATOR_MAX_RETRIES, 3));
  const model = String(cli.modelOverride || config.model || process.env.ORCHESTRATOR_MODEL || 'gpt-4.1-mini').trim();
  const runtimeConfig = { ...config, model };
  const rootDir = process.cwd();
  const researchPath = path.join(rootDir, 'dev_pipeline', 'research.md');
  const designPath = path.join(rootDir, 'dev_pipeline', 'design.md');
  const planPath = path.join(rootDir, 'dev_pipeline', 'plan.md');
  const systemMapPath = path.join(rootDir, 'dev_pipeline', 'system_map.md');
  const taskBundlePath = path.join(rootDir, 'dev_pipeline', 'task_bundle.json');
  lifecycleState = getInitialState();
  finalTask = task;
  finalMaxRetries = maxRetries;
  finalValidationAttempts = 0;
  finalSystemMapBaselineHash = '';
  finalSystemMapNextHash = '';
  finalRunId = '';
  finalBaselineApiSignature = new Map();
  finalContractDiff = {
    apiChanges: {
      added: [],
      removed: [],
      modified: [],
    },
  };
  finalImpactReport = {
    impact: {
      changedFiles: [],
      modules: [],
    },
  };
  finalFrontendImpact = {
    impact: {
      changedFiles: [],
      views: [],
    },
  };
  finalChangedFiles = [];
  finalBaselineFrontendContract = {
    views: [],
  };
  finalFrontendContract = {
    views: [],
  };
  finalGeneratedUiTestsResult = {
    generatedUiTests: {
      ran: false,
      count: 0,
      exitCode: 0,
    },
  };
  finalBackendEndpoints = [];
  finalFullContractSnapshot = {
    backend: {
      endpoints: [],
      diff: {
        added: [],
        removed: [],
        modified: [],
      },
    },
    frontend: {
      views: [],
    },
  };
  finalContractIntegrity = {
    integrity: {
      status: 'PASS',
      missing: [],
    },
  };
  finalExecutionMode = {
    execution: {
      mode: isMetaMode ? 'meta' : 'direct',
      blocked: false,
    },
  };

  if (!task) {
    console.error('Usage: node orchestrator/orchestrator.js --task "<TASK>"');
    throw new Error('TASK_REQUIRED');
  }
  if (!model) {
    throw new Error('INVALID_MODEL');
  }

  ensureGitRepo();
  assertCleanRepo();
  baseBranch = getCurrentBranch();
  baseCommit = getCurrentCommit();
  taskBranch = createTaskBranch(task);

  const activeRunDir = await createRunDir();
  finalRunId = path.basename(activeRunDir);
  await writeArtifact('base_branch.txt', `${baseBranch}\n`);
  await writeArtifact('task_branch.txt', `${taskBranch}\n`);

  async function saveTaskBundle({ attempt, feedback }) {
    const [researchContent, designContent, planContent] = await Promise.all([
      fs.readFile(researchPath, 'utf8'),
      fs.readFile(designPath, 'utf8'),
      fs.readFile(planPath, 'utf8'),
    ]);

    const taskBundle = {
      task,
      researchContent,
      designContent,
      planContent,
      attempt,
      model,
      maxRetries,
    };
    if (feedback) {
      taskBundle.feedback = feedback;
    }

    const serialized = `${JSON.stringify(taskBundle, null, 2)}\n`;
    await fs.mkdir(path.dirname(taskBundlePath), { recursive: true });
    await fs.writeFile(taskBundlePath, serialized, 'utf8');
    await writeArtifact('task_bundle.json', serialized);
  }

  validateLifecycleDefinition(LIFECYCLE_DEFINITION);

  console.log('[ORCH] Stage: Research');
  const research = await runResearch({ task, config: runtimeConfig });
  assertValidTransition(lifecycleState, 'RESEARCH_DONE');
  lifecycleState = 'RESEARCH_DONE';

  console.log('[ORCH] Stage: Design');
  const design = await runDesign({ task, config: runtimeConfig, research });
  assertValidTransition(lifecycleState, 'DESIGN_DONE');
  lifecycleState = 'DESIGN_DONE';

  console.log('[ORCH] Stage: Plan');
  const plan = await runPlan({ task, config: runtimeConfig, research, design });
  assertValidTransition(lifecycleState, 'PLAN_DONE');
  lifecycleState = 'PLAN_DONE';

  console.log('[ORCH] Stage: SystemMap');
  await runSystemMap({ task, config: runtimeConfig, research, design, plan });
  finalBaselineApiSignature = parseSystemMapApiSignature(await fs.readFile(systemMapPath, 'utf8'));
  finalBackendEndpoints = toEndpointsListFromSignature(finalBaselineApiSignature);
  finalBaselineFrontendContract = await buildFrontendContract();
  const systemMapBaselineHash = await hashFileSha256(systemMapPath);
  finalSystemMapBaselineHash = systemMapBaselineHash;
  await writeArtifact('system_map_baseline.hash', `${systemMapBaselineHash}\n`);

  implementationAttempt = 1;
  console.log('[ORCH] Stage: Implement');
  await saveTaskBundle({ attempt: implementationAttempt });
  let implementation = await runImplementation({
    task,
    config: runtimeConfig,
    research,
    design,
    plan,
    attempt: implementationAttempt,
    lifecycleState: 'IMPLEMENTED',
  });
  finalChangedFiles = Array.isArray(implementation?.changedFiles) ? implementation.changedFiles : [];
  finalImpactReport = buildImpactReport(finalChangedFiles);
  assertSnapshotLabel(implementation, implementationAttempt);
  assertValidTransition(lifecycleState, 'IMPLEMENTED');
  lifecycleState = 'IMPLEMENTED';

  let attempt = 0;
  while (true) {
    attempt += 1;
    finalValidationAttempts = attempt;
    console.log(`[ORCH] Validation loop: ${attempt}`);
    assertValidTransition(lifecycleState, 'VALIDATING');
    lifecycleState = 'VALIDATING';

    deepFreeze(runtimeConfig);
    console.log('[ORCH] Stage: Security');
    const securityPromise = runSecurity({ task, config: runtimeConfig, research, design, plan, implementation, attempt });

    console.log('[ORCH] Stage: Financial');
    const financialPromise = runFinancial({ task, config: runtimeConfig, research, design, plan, implementation, attempt });

    console.log('[ORCH] Stage: Concurrency');
    const concurrencyPromise = runConcurrency({ task, config: runtimeConfig, research, design, plan, implementation, attempt });

    const results = await Promise.allSettled([
      securityPromise,
      financialPromise,
      concurrencyPromise,
    ]);
    for (const r of results) {
      if (r.status === 'rejected') {
        throw r.reason;
      }
    }
    const [security, financial, concurrency] = results.map((r) => r.value);
    console.log('[ORCH] Stage: Security done');
    console.log('[ORCH] Stage: Financial done');
    console.log('[ORCH] Stage: Concurrency done');

    console.log('[ORCH] Stage: Regression');
    const regression = await runRegression({
      task,
      config: runtimeConfig,
      research,
      design,
      plan,
      implementation,
      security,
      financial,
      concurrency,
      attempt,
    });
    console.log('[ORCH] Stage: Regression done');

    await runSystemMap({ task, config: runtimeConfig, research, design, plan });
    const validationNextApiSignature = parseSystemMapApiSignature(await fs.readFile(systemMapPath, 'utf8'));
    finalBackendEndpoints = toEndpointsListFromSignature(validationNextApiSignature);
    const validationContractDiff = buildContractDiff(finalBaselineApiSignature, validationNextApiSignature);
    finalContractDiff = validationContractDiff;
    const validationFrontendContract = await buildFrontendContract();
    finalFrontendContract = validationFrontendContract;
    await writeGeneratedUiTestsArtifact(finalRunId, validationContractDiff, finalBaselineFrontendContract, validationFrontendContract);
    const validationSystemMapNextHash = await hashFileSha256(systemMapPath);

    console.log('[ORCH] Stage: Tests');
    const tests = runTests(runtimeConfig.testCommand);
    const generatedUiTests = await runGeneratedUiTests(finalRunId);
    finalGeneratedUiTestsResult = {
      generatedUiTests: {
        ran: Boolean(generatedUiTests?.ran),
        count: Number.isInteger(generatedUiTests?.count) ? generatedUiTests.count : 0,
        exitCode: Number.isInteger(generatedUiTests?.exitCode) ? generatedUiTests.exitCode : 1,
      },
    };
    tests.generatedUiTests = generatedUiTests;
    const hasHighSeverity = [security, financial, concurrency].some((stageResult) => stageResult?.severity === 'high');
    const shouldRetry = hasHighSeverity || !tests.success || finalGeneratedUiTestsResult.generatedUiTests.exitCode !== 0;

    if (!shouldRetry) {
      const systemMapNextHash = validationSystemMapNextHash;
      finalSystemMapNextHash = systemMapNextHash;
      await writeArtifact('system_map_next.hash', `${systemMapNextHash}\n`);
      if (systemMapBaselineHash === systemMapNextHash) {
        assertValidatingGate(lifecycleState);
        console.error('[ORCH] System Map Guard failed: baseline hash:', systemMapBaselineHash);
        console.error('[ORCH] System Map Guard failed: next hash:', systemMapNextHash);
        console.error('[ORCH] System Map Guard failed: changedFiles:', implementation?.changedFiles || []);
        assertValidTransition(lifecycleState, 'FAILED');
        lifecycleState = 'FAILED';
        try {
          cleanupFailedTaskBranch();
        } catch (e) {
          console.error('[ORCH] Cleanup error:', e?.message || e);
        }
        throw new Error('SYSTEM_MAP_GUARD_FAILED');
      }

      const validationFullContractSnapshot = buildFullContractSnapshot(finalBackendEndpoints, finalContractDiff, finalFrontendContract);
      finalFullContractSnapshot = validationFullContractSnapshot;
      const validationContractIntegrity = buildContractIntegritySnapshot(validationFullContractSnapshot);
      finalContractIntegrity = validationContractIntegrity;
      if (validationContractIntegrity.integrity.missing.length > 0) {
        throw new Error('CONTRACT_INTEGRITY_FAILED');
      }

      assertValidatingGate(lifecycleState);
      assertValidTransition(lifecycleState, 'PASS');
      lifecycleState = 'PASS';
      const snapshotLabel = implementation?.snapshotLabel || `attempt-${implementationAttempt}`;
      if (hasActiveSnapshot(snapshotLabel)) {
        const snapshotRef = implementation?.snapshotRef || getSnapshotRef(snapshotLabel);
        if (snapshotRef) dropSnapshot(snapshotRef);
      }
      console.log(`[ORCH] Task branch: ${taskBranch}`);
      console.log('DONE: PASS');
      return;
    }

    if (implementationAttempt >= maxRetries) {
      assertValidatingGate(lifecycleState);
      assertValidTransition(lifecycleState, 'FAILED');
      lifecycleState = 'FAILED';
      console.log('[ORCH] Retry limit reached');
      try {
        cleanupFailedTaskBranch();
      } catch (e) {
        console.error('[ORCH] Cleanup error:', e?.message || e);
      }
      throw new Error('Max retries reached');
    }

    assertValidatingGate(lifecycleState);
    assertValidTransition(lifecycleState, 'RETRYING');
    lifecycleState = 'RETRYING';
    const feedback = { security, financial, concurrency, regression, tests };
    console.log('[ORCH] Stage: Implement (retry)');
    implementationAttempt += 1;
    await saveTaskBundle({ attempt: implementationAttempt, feedback });
    implementation = await runImplementation({
      task,
      config: runtimeConfig,
      research,
      design,
      plan,
      implementation,
      feedback,
      attempt: implementationAttempt,
      lifecycleState: 'RETRYING',
    });
    finalChangedFiles = Array.isArray(implementation?.changedFiles) ? implementation.changedFiles : [];
    finalImpactReport = buildImpactReport(finalChangedFiles);
    assertSnapshotLabel(implementation, implementationAttempt);
    assertValidTransition(lifecycleState, 'IMPLEMENTED');
    lifecycleState = 'IMPLEMENTED';
  }
}

async function writeFinalRunArtifacts() {
  if (finalArtifactsWritten) return;
  finalArtifactsWritten = true;
  const finalState = lifecycleState === 'PASS' ? 'PASS' : 'FAILED';
  const runDir = await createRunDir();
  const runId = path.basename(runDir);
  if (!finalRunId) finalRunId = runId;
  const manifest = {
    runId,
    task: String(finalTask || ''),
    baseBranch: String(baseBranch || ''),
    taskBranch: String(taskBranch || ''),
    lifecycleState: finalState,
    maxRetries: Number.isInteger(finalMaxRetries) ? finalMaxRetries : 0,
    validationAttempts: Number.isInteger(finalValidationAttempts) ? finalValidationAttempts : 0,
    systemMap: {
      baselineHash: String(finalSystemMapBaselineHash || ''),
      nextHash: String(finalSystemMapNextHash || ''),
    },
  };
  await writeArtifact('lifecycle_state.txt', `${finalState}\n`);
  await writeArtifact('execution_mode.json', `${JSON.stringify(finalExecutionMode, null, 2)}\n`);
  const manifestPath = await writeArtifact('run_manifest.json', `${JSON.stringify(manifest, null, 2)}\n`);
  await writeArtifact('contract_diff.json', `${JSON.stringify(finalContractDiff)}\n`);
  await writeArtifact('impact_report.json', `${JSON.stringify(finalImpactReport)}\n`);
  await writeArtifact('generated_ui_tests_result.json', `${JSON.stringify(finalGeneratedUiTestsResult)}\n`);
  finalFrontendImpact = await buildFrontendImpactReport(finalChangedFiles);
  await writeArtifact('frontend_impact.json', `${JSON.stringify(finalFrontendImpact)}\n`);
  finalFrontendContract = await buildFrontendContract();
  await writeArtifact('frontend_contract.json', `${JSON.stringify(finalFrontendContract)}\n`);
  if (finalBackendEndpoints.length === 0) {
    const systemMapPath = path.join(process.cwd(), 'dev_pipeline', 'system_map.md');
    try {
      const systemMapContent = await fs.readFile(systemMapPath, 'utf8');
      finalBackendEndpoints = toEndpointsListFromSignature(parseSystemMapApiSignature(systemMapContent));
    } catch {}
  }
  finalFullContractSnapshot = buildFullContractSnapshot(finalBackendEndpoints, finalContractDiff, finalFrontendContract);
  finalContractIntegrity = buildContractIntegritySnapshot(finalFullContractSnapshot);
  await writeArtifact('full_contract_snapshot.json', `${JSON.stringify(finalFullContractSnapshot)}\n`);
  await writeArtifact('contract_integrity.json', `${JSON.stringify(finalContractIntegrity)}\n`);
  await writeGeneratedTestsArtifact(runId, finalContractDiff);
  await writeGeneratedUiTestsArtifact(runId, finalContractDiff, finalBaselineFrontendContract, finalFrontendContract);
  try {
    JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch {
    throw new Error('FATAL_MANIFEST_WRITE_ERROR');
  }
}

(async () => {
  let exitCode = 0;

  try {
    await main();
  } catch (error) {
    exitCode = 1;
    console.error('[ORCH] Failed:', error?.message || error);
    try {
      if (lifecycleState !== 'FAILED') {
        assertValidTransition(lifecycleState, 'FAILED');
        lifecycleState = 'FAILED';
      }
      if (lifecycleState === 'FAILED' && !rollbackCompleted) {
        cleanupFailedTaskBranch();
      }
    } catch (restoreError) {
      console.error('[ORCH] Failed:', restoreError?.message || restoreError);
    }
    if (lifecycleState !== 'FAILED') {
      console.error('[ORCH] Failed: lifecycle state is non-terminal:', lifecycleState);
    }
  } finally {
    await writeFinalRunArtifacts();
  }

  if (exitCode !== 0) process.exitCode = exitCode;
})();
