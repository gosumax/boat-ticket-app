#!/usr/bin/env node

import { execSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const RUNS_ROOT = path.join(process.cwd(), 'dev_pipeline', 'runs');
const ORCHESTRATOR_ENTRY = path.join(process.cwd(), 'orchestrator', 'orchestrator.js');
const CONTEXT_THRESHOLD = 50000;
const META_RESUME_INCONSISTENT = 'META_RESUME_INCONSISTENT';
const DEFAULT_MAX_SELF_HEAL_ATTEMPTS = 5;
const DEFAULT_SELF_HEAL_STALL_THRESHOLD = 3;
const DEFAULT_SELF_HEAL_ENABLED = true;
const DEFAULT_VALIDATE_COMMAND = 'npm run validate';
const SELF_HEAL_STALLED = 'SELF_HEAL_STALLED';

function parsePositiveInt(value, fallbackValue) {
  const raw = String(value ?? '').trim();
  if (!raw) return fallbackValue;
  const numeric = Number(raw);
  if (!Number.isInteger(numeric) || numeric <= 0) return fallbackValue;
  return numeric;
}

function parseBooleanFlag(value, fallbackValue) {
  if (value === undefined || value === null) return fallbackValue;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on', 'enabled'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off', 'disabled'].includes(normalized)) return false;
  return fallbackValue;
}

function buildMetaRunId() {
  return `meta-${new Date().toISOString().replace(/:/g, '-')}`;
}

function parseCliOptions(argv) {
  let task = '';
  let resumeMetaRunId = '';
  let selfHealEnabled;
  let maxSelfHealAttempts;
  let selfHealStallThreshold;
  const freeTextTask = [];

  for (let i = 0; i < argv.length; i += 1) {
    const token = String(argv[i] || '');
    if (token === '--resume') {
      resumeMetaRunId = String(argv[i + 1] || '').trim();
      i += 1;
      continue;
    }
    if (token.startsWith('--resume=')) {
      resumeMetaRunId = token.slice('--resume='.length).trim();
      continue;
    }
    if (token === '--task') {
      task = String(argv[i + 1] || '').trim();
      i += 1;
      continue;
    }
    if (token.startsWith('--task=')) {
      task = token.slice('--task='.length).trim();
      continue;
    }
    if (token === '--self-heal') {
      selfHealEnabled = true;
      continue;
    }
    if (token === '--no-self-heal') {
      selfHealEnabled = false;
      continue;
    }
    if (token === '--max-self-heal-attempts') {
      maxSelfHealAttempts = String(argv[i + 1] || '').trim();
      i += 1;
      continue;
    }
    if (token.startsWith('--max-self-heal-attempts=')) {
      maxSelfHealAttempts = token.slice('--max-self-heal-attempts='.length).trim();
      continue;
    }
    if (token === '--self-heal-stall-threshold') {
      selfHealStallThreshold = String(argv[i + 1] || '').trim();
      i += 1;
      continue;
    }
    if (token.startsWith('--self-heal-stall-threshold=')) {
      selfHealStallThreshold = token.slice('--self-heal-stall-threshold='.length).trim();
      continue;
    }
    if (!token.startsWith('--')) freeTextTask.push(token);
  }

  const envSelfHealEnabled = parseBooleanFlag(process.env.META_SELF_HEAL_ENABLED, DEFAULT_SELF_HEAL_ENABLED);
  const envMaxSelfHealAttempts = parsePositiveInt(process.env.META_MAX_SELF_HEAL_ATTEMPTS, DEFAULT_MAX_SELF_HEAL_ATTEMPTS);
  const envSelfHealStallThreshold = parsePositiveInt(process.env.META_SELF_HEAL_STALL_THRESHOLD, DEFAULT_SELF_HEAL_STALL_THRESHOLD);

  return {
    task: task || freeTextTask.join(' ').trim(),
    resumeMetaRunId,
    selfHealEnabled: selfHealEnabled === undefined ? envSelfHealEnabled : Boolean(selfHealEnabled),
    maxSelfHealAttempts: parsePositiveInt(maxSelfHealAttempts, envMaxSelfHealAttempts),
    selfHealStallThreshold: parsePositiveInt(selfHealStallThreshold, envSelfHealStallThreshold),
  };
}

function tokenizeTask(task) {
  return String(task || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .filter(Boolean);
}

function buildMetaPlan(task) {
  const tokens = new Set(tokenizeTask(task));
  const includeBackend = tokens.has('backend') || tokens.has('api');
  const includeFrontend = tokens.has('frontend') || tokens.has('ui') || tokens.has('view');
  const steps = [];
  let id = 1;

  if (includeBackend) {
    steps.push({
      id: id++,
      type: 'backend',
      description: 'Implement backend changes',
    });
  }

  if (includeFrontend) {
    steps.push({
      id: id++,
      type: 'frontend',
      description: 'Implement frontend integration',
    });
  }

  steps.push({
    id: id++,
    type: 'validation',
    description: 'Run integrity + tests',
  });

  steps.push({
    id,
    type: 'finalize',
    description: 'Full contract verification',
  });

  return { steps };
}

function normalizeStepId(value, fallback) {
  const numeric = Number(value);
  if (Number.isInteger(numeric) && numeric > 0) return numeric;
  return fallback;
}

function normalizeStepType(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeStepDescription(value, fallback) {
  const text = String(value || '').trim();
  return text || fallback;
}

function normalizeMetaPlan(metaPlan) {
  const rawSteps = Array.isArray(metaPlan?.steps) ? metaPlan.steps : [];
  const normalized = rawSteps
    .map((step, index) => {
      const id = normalizeStepId(step?.id, index + 1);
      const type = normalizeStepType(step?.type);
      const description = normalizeStepDescription(step?.description, `Step ${id}`);
      return {
        id,
        type,
        description,
        _order: index,
      };
    })
    .sort((a, b) => (
      a.id - b.id
      || a.type.localeCompare(b.type)
      || a.description.localeCompare(b.description)
      || a._order - b._order
    ));

  const seen = new Set();
  const steps = [];
  for (const step of normalized) {
    if (seen.has(step.id)) continue;
    seen.add(step.id);
    steps.push({
      id: step.id,
      type: step.type,
      description: step.description,
    });
  }
  return { steps };
}

function resolveIntegrityStatus(contractIntegrity) {
  if (!contractIntegrity || typeof contractIntegrity !== 'object') return '';
  const directStatus = String(contractIntegrity.status || '').trim().toUpperCase();
  if (directStatus) return directStatus;
  const nestedStatus = String(contractIntegrity?.integrity?.status || '').trim().toUpperCase();
  if (nestedStatus) return nestedStatus;
  return '';
}

async function readJsonOrNull(filePath) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function readJsonStrict(filePath) {
  const raw = await fs.readFile(filePath, 'utf8');
  return JSON.parse(raw);
}

async function writeJson(filePath, value) {
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function removeFileIfExists(filePath) {
  try {
    await fs.unlink(filePath);
  } catch {}
}

async function getFileSizeOrZero(filePath) {
  try {
    const stat = await fs.stat(filePath);
    return Number.isFinite(stat.size) ? stat.size : 0;
  } catch {
    return 0;
  }
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function resolveLatestStepRunId(stepResults) {
  const input = Array.isArray(stepResults) ? stepResults : [];
  const candidates = input
    .map((step) => String(step?.runId || '').trim())
    .filter(Boolean);
  return candidates.length > 0 ? candidates[candidates.length - 1] : '';
}

function resolveLatestRunIdLex(stepResults) {
  const input = Array.isArray(stepResults) ? stepResults : [];
  const sorted = input
    .map((step) => String(step?.runId || '').trim())
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));
  return sorted.length > 0 ? sorted[sorted.length - 1] : '';
}

function toPassFailed(value) {
  return String(value || '').trim().toUpperCase() === 'PASS' ? 'PASS' : 'FAILED';
}

function assertMetaResumeConsistency(condition) {
  if (!condition) throw new Error(META_RESUME_INCONSISTENT);
}

async function buildContextHealth(metaRunDir, stepResults) {
  const latestStepRunId = resolveLatestStepRunId(stepResults);
  const latestStepRunDir = latestStepRunId ? path.join(RUNS_ROOT, latestStepRunId) : '';
  const stepArtifactSize = async (name) => {
    if (!latestStepRunDir) return 0;
    return getFileSizeOrZero(path.join(latestStepRunDir, name));
  };

  const estimatedSize =
    (await getFileSizeOrZero(path.join(metaRunDir, 'meta_plan.json'))) +
    (await getFileSizeOrZero(path.join(metaRunDir, 'meta_step_results.json'))) +
    (await stepArtifactSize('full_contract_snapshot.json')) +
    (await stepArtifactSize('contract_diff.json')) +
    (await stepArtifactSize('frontend_contract.json'));

  return {
    context: {
      estimatedSize,
      threshold: CONTEXT_THRESHOLD,
      recommendNextChat: estimatedSize > CONTEXT_THRESHOLD,
    },
  };
}

async function writeContextHealthArtifact(metaRunDir, stepResults) {
  const contextHealth = await buildContextHealth(metaRunDir, stepResults);
  await writeJson(path.join(metaRunDir, 'context_health.json'), contextHealth);
  return contextHealth;
}

async function listRunIds() {
  let entries = [];
  try {
    entries = await fs.readdir(RUNS_ROOT, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));
}

function latestRunId(runIds) {
  const sorted = [...runIds].sort((a, b) => a.localeCompare(b));
  return sorted.length > 0 ? sorted[sorted.length - 1] : '';
}

function runValidateCommand(validateCommand = DEFAULT_VALIDATE_COMMAND) {
  const command = String(validateCommand || DEFAULT_VALIDATE_COMMAND).trim() || DEFAULT_VALIDATE_COMMAND;
  const startedAt = new Date().toISOString();
  try {
    const output = execSync(command, {
      cwd: process.cwd(),
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return {
      command,
      startedAt,
      finishedAt: new Date().toISOString(),
      exitCode: 0,
      output: String(output || ''),
    };
  } catch (error) {
    const stdout = error?.stdout ? String(error.stdout) : '';
    const stderr = error?.stderr ? String(error.stderr) : '';
    const message = error?.message ? String(error.message) : '';
    return {
      command,
      startedAt,
      finishedAt: new Date().toISOString(),
      exitCode: Number.isInteger(error?.status) ? error.status : 1,
      output: [stdout, stderr, message].filter(Boolean).join('\n'),
    };
  }
}

function stripAnsi(value) {
  return String(value || '').replace(/\u001b\[[0-9;]*m/g, '');
}

function normalizeFailureText(value) {
  return stripAnsi(String(value || ''))
    .replace(/\r/g, '')
    .replace(/\b\d+ms\b/gi, '<ms>')
    .replace(/:\d+:\d+\b/g, ':L:C')
    .replace(/:\d+\b/g, ':L')
    .trim()
    .slice(0, 4000);
}

function extractFailingTestsFromOutput(output) {
  const text = stripAnsi(String(output || ''));
  const tests = new Set();
  const patterns = [
    /\n\s*(?:x|X|\*)\s+([^\n\r]*\.(?:test|spec)\.[^\s:\n\r]*)/g,
    /\n\s*FAIL(?:\s+|:\s*)([^\n\r]*\.(?:test|spec)\.[^\s:\n\r]*)/g,
    /\n\s*\[[^\]]+\]\s+\S+\s+([^\n\r]*\.(?:test|spec)\.[^\s:\n\r]*)/g,
    /\n\s*\d+\)\s+\[[^\]]+\]\s+\S+\s+([^\n\r]*\.(?:test|spec)\.[^\s:\n\r]*)/g,
  ];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(`\n${text}`)) !== null) {
      const line = String(match[1] || '').trim().replace(/\\/g, '/');
      if (line) tests.add(line);
    }
  }
  return Array.from(tests).sort((a, b) => a.localeCompare(b));
}

function extractFirstFailureBlock(output) {
  const text = stripAnsi(String(output || ''));
  if (!text) return '';
  const markers = [
    'Failed Tests',
    'FAIL ',
    'AssertionError',
    'Error:',
    'TypeError:',
  ];
  let index = -1;
  for (const marker of markers) {
    const markerIndex = text.indexOf(marker);
    if (markerIndex >= 0 && (index < 0 || markerIndex < index)) index = markerIndex;
  }
  const slice = index >= 0 ? text.slice(index) : text;
  return normalizeFailureText(slice);
}

function buildFailureSignature({
  failingTests,
  firstFailure,
  validateExitCode,
  lifecycleState,
  contractIntegrityStatus,
}) {
  const payload = {
    failingTests: Array.isArray(failingTests)
      ? failingTests.map((item) => String(item || '').replace(/\\/g, '/').trim().toLowerCase()).filter(Boolean)
      : [],
    firstFailure: normalizeFailureText(firstFailure),
    validateExitCode: Number.isInteger(validateExitCode) ? validateExitCode : -1,
    lifecycleState: String(lifecycleState || '').trim().toUpperCase(),
    contractIntegrityStatus: String(contractIntegrityStatus || '').trim().toUpperCase(),
  };
  return createHash('sha256').update(JSON.stringify(payload), 'utf8').digest('hex');
}

function summarizeRemediationHistory(remediationHistory) {
  const history = Array.isArray(remediationHistory) ? remediationHistory : [];
  const attempted = history.filter((item) => Number.isInteger(item?.attempt)).length;
  const succeeded = history.filter((item) => String(item?.status || '').toUpperCase() === 'PASS').length;
  const stalled = history.some((item) => String(item?.status || '').toUpperCase() === SELF_HEAL_STALLED);
  return { attempted, succeeded, stalled };
}

function runOrchestrator(task) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [ORCHESTRATOR_ENTRY, '--task', task], {
      cwd: process.cwd(),
      stdio: 'ignore',
      env: {
        ...process.env,
        META_MODE: 'true',
      },
    });

    child.on('error', () => resolve(1));
    child.on('close', (code) => resolve(Number.isInteger(code) ? code : 1));
  });
}

async function evaluateStepRun(stepRunId) {
  if (!stepRunId) {
    return {
      lifecycleState: '',
      contractIntegrityStatus: '',
      pass: false,
    };
  }

  const stepRunDir = path.join(RUNS_ROOT, stepRunId);
  const runManifest = await readJsonOrNull(path.join(stepRunDir, 'run_manifest.json'));
  const contractIntegrity = await readJsonOrNull(path.join(stepRunDir, 'contract_integrity.json'));
  const lifecycleState = String(runManifest?.lifecycleState || '').trim().toUpperCase();
  const contractIntegrityStatus = resolveIntegrityStatus(contractIntegrity);
  const pass = lifecycleState === 'PASS' && contractIntegrityStatus === 'PASS';

  return {
    lifecycleState,
    contractIntegrityStatus,
    pass,
  };
}

async function writeMetaIntegrity(metaRunDir, status, reason) {
  const metaIntegrity = {
    metaIntegrity: {
      status: String(status || '').trim().toUpperCase() === 'PASS' ? 'PASS' : 'FAILED',
      reason: String(reason || '').trim() ? String(reason || '').trim() : null,
    },
  };
  await writeJson(path.join(metaRunDir, 'meta_integrity.json'), metaIntegrity);
}

async function readMetaManifestReason(metaRunDir) {
  const manifest = await readJsonOrNull(path.join(metaRunDir, 'meta_run_manifest.json'));
  return String(manifest?.reason || '').trim() || null;
}

function resolveStepResultsMap(stepResults, orderedSteps) {
  const validStepIds = new Set(orderedSteps.map((step) => step.id));
  const map = new Map();
  const input = Array.isArray(stepResults) ? stepResults : [];
  const planById = new Map(orderedSteps.map((step) => [step.id, step]));
  for (const item of input) {
    const stepId = normalizeStepId(item?.stepId ?? item?.id, -1);
    if (!validStepIds.has(stepId)) continue;
    const planStep = planById.get(stepId);
    map.set(stepId, {
      stepId,
      type: normalizeStepType(item?.type ?? planStep?.type),
      description: normalizeStepDescription(item?.description, planStep?.description || `Step ${stepId}`),
      runId: String(item?.runId || '').trim(),
      lifecycleState: String(item?.lifecycleState || '').trim().toUpperCase(),
      contractIntegrityStatus: String(item?.contractIntegrityStatus || '').trim().toUpperCase(),
      validateExitCode: Number.isInteger(item?.validateExitCode) ? item.validateExitCode : (toPassFailed(item?.status) === 'PASS' ? 0 : 1),
      status: toPassFailed(item?.status),
    });
  }
  return map;
}

function sortStepResultsByPlan(orderedSteps, stepResultsMap) {
  return orderedSteps
    .map((step) => stepResultsMap.get(step.id))
    .filter(Boolean);
}

function stepsPassedCount(stepResults) {
  return (Array.isArray(stepResults) ? stepResults : []).filter((step) => String(step?.status || '').toUpperCase() === 'PASS').length;
}

function buildManifest(metaRunId, orderedSteps, stepResults, statusOverride, options = {}) {
  const stepsTotal = orderedSteps.length;
  const stepsPassed = stepsPassedCount(stepResults);
  const resolvedStatus = String(statusOverride || '').trim().toUpperCase() || (stepsPassed === stepsTotal ? 'PASS' : 'IN_PROGRESS');
  const remediationSummary = summarizeRemediationHistory(options.remediationHistory);
  return {
    metaRunId,
    stepsTotal,
    stepsPassed,
    status: resolvedStatus,
    reason: String(options.reason || '').trim() || null,
    selfHeal: {
      enabled: Boolean(options.selfHeal?.enabled),
      maxSelfHealAttempts: Number(options.selfHeal?.maxSelfHealAttempts || 0),
      stallThreshold: Number(options.selfHeal?.stallThreshold || 0),
      attemptsUsed: remediationSummary.attempted,
      successfulFixes: remediationSummary.succeeded,
      stalled: remediationSummary.stalled,
    },
  };
}

function resolveFirstUnfinishedStepIndex(orderedSteps, stepResultsMap) {
  for (let i = 0; i < orderedSteps.length; i += 1) {
    const step = orderedSteps[i];
    const result = stepResultsMap.get(step.id);
    if (!result || String(result.status || '').toUpperCase() !== 'PASS') return i;
  }
  return orderedSteps.length;
}

async function resolveLastIntegrityStatus(stepResults) {
  const lastRunId = resolveLatestRunIdLex(stepResults);
  if (!lastRunId) return 'FAILED';
  const contractIntegrity = await readJsonOrNull(path.join(RUNS_ROOT, lastRunId, 'contract_integrity.json'));
  return toPassFailed(resolveIntegrityStatus(contractIntegrity));
}

function normalizeRemediationHistory(remediationHistory) {
  if (!Array.isArray(remediationHistory)) return [];
  return remediationHistory.map((item, index) => ({
    id: String(item?.id || `regression_fix_${index + 1}`),
    type: normalizeStepType(item?.type || 'regression_fix'),
    attempt: Number.isInteger(item?.attempt) ? item.attempt : index + 1,
    sourceStepId: normalizeStepId(item?.sourceStepId, -1),
    sourceStepType: normalizeStepType(item?.sourceStepType || 'validation'),
    sourceRunId: String(item?.sourceRunId || '').trim(),
    fixRunId: String(item?.fixRunId || '').trim(),
    status: String(item?.status || 'FAILED').trim().toUpperCase(),
    reason: String(item?.reason || '').trim() || null,
    validateExitCode: Number.isInteger(item?.validateExitCode) ? item.validateExitCode : 1,
    failingTests: Array.isArray(item?.failingTests) ? item.failingTests.map((v) => String(v || '').trim()).filter(Boolean) : [],
    failureSignature: String(item?.failureSignature || '').trim(),
    firstFailure: String(item?.firstFailure || '').trim(),
    timestamp: String(item?.timestamp || '').trim() || new Date().toISOString(),
    fixTask: String(item?.fixTask || '').trim(),
  }));
}

async function assertResumeConsistency(metaRunId, metaRunDir) {
  const planPath = path.join(metaRunDir, 'meta_plan.json');
  const stepResultsPath = path.join(metaRunDir, 'meta_step_results.json');
  const contextHealthPath = path.join(metaRunDir, 'context_health.json');
  const manifestPath = path.join(metaRunDir, 'meta_run_manifest.json');
  const continuationBundlePath = path.join(metaRunDir, 'continuation_bundle.json');

  const requiredPaths = [planPath, stepResultsPath, contextHealthPath];
  for (const requiredPath of requiredPaths) {
    const exists = await pathExists(requiredPath);
    assertMetaResumeConsistency(exists);
  }

  let metaPlan;
  let stepResultsPayload;
  let contextHealth;
  let manifest;
  let continuationBundle = null;

  try {
    [metaPlan, stepResultsPayload, contextHealth] = await Promise.all([
      readJsonStrict(planPath),
      readJsonStrict(stepResultsPath),
      readJsonStrict(contextHealthPath),
    ]);
    manifest = await readJsonStrict(manifestPath);
    if (await pathExists(continuationBundlePath)) {
      continuationBundle = await readJsonStrict(continuationBundlePath);
    }
  } catch {
    throw new Error(META_RESUME_INCONSISTENT);
  }

  const normalizedPlan = normalizeMetaPlan(metaPlan);
  const orderedSteps = normalizedPlan.steps;
  const stepsTotal = orderedSteps.length;
  const stepResults = Array.isArray(stepResultsPayload?.steps) ? stepResultsPayload.steps : [];
  const remediationHistory = normalizeRemediationHistory(stepResultsPayload?.remediationHistory);
  const stepResultsMap = resolveStepResultsMap(stepResults, orderedSteps);
  const completedDerived = sortStepResultsByPlan(orderedSteps, stepResultsMap)
    .filter((step) => step.status === 'PASS')
    .length;
  const remainingDerived = stepsTotal - completedDerived;
  const planMetaRunId = String(metaPlan?.metaRunId || '').trim();
  const stepResultsMetaRunId = String(stepResultsPayload?.metaRunId || '').trim();
  const manifestMetaRunId = String(manifest?.metaRunId || '').trim();

  assertMetaResumeConsistency(orderedSteps.length > 0);
  assertMetaResumeConsistency(Array.isArray(metaPlan?.steps));
  assertMetaResumeConsistency(Array.isArray(stepResultsPayload?.steps));
  assertMetaResumeConsistency(typeof contextHealth === 'object' && contextHealth !== null);
  assertMetaResumeConsistency(manifestMetaRunId === metaRunId);
  assertMetaResumeConsistency(Number(manifest?.stepsTotal) === stepsTotal);
  assertMetaResumeConsistency(planMetaRunId ? planMetaRunId === metaRunId : true);
  assertMetaResumeConsistency(stepResultsMetaRunId ? stepResultsMetaRunId === metaRunId : true);
  assertMetaResumeConsistency(completedDerived + remainingDerived === stepsTotal);
  assertMetaResumeConsistency(Array.isArray(remediationHistory));

  if (continuationBundle) {
    const bundleMetaRunId = String(continuationBundle?.metaRunId || '').trim();
    const bundleStepsTotal = Number(continuationBundle?.stepsTotal);
    const completedSteps = Array.isArray(continuationBundle?.completedSteps)
      ? continuationBundle.completedSteps.length
      : -1;
    const remainingSteps = Array.isArray(continuationBundle?.remainingSteps)
      ? continuationBundle.remainingSteps.length
      : -1;
    assertMetaResumeConsistency(bundleMetaRunId === metaRunId);
    assertMetaResumeConsistency(bundleStepsTotal === stepsTotal);
    assertMetaResumeConsistency(completedSteps >= 0 && remainingSteps >= 0);
    assertMetaResumeConsistency(completedSteps + remainingSteps === bundleStepsTotal);
  }

  return {
    orderedSteps,
    initialStepResults: stepResults,
    remediationHistory,
  };
}

async function validateFinalMetaPass(orderedSteps, stepResults) {
  const stepResultsMap = resolveStepResultsMap(stepResults, orderedSteps);
  for (const step of orderedSteps) {
    const result = stepResultsMap.get(step.id);
    if (!result) return false;
    if (result.status !== 'PASS') return false;
    if (String(result.lifecycleState || '').toUpperCase() !== 'PASS') return false;
  }

  if (orderedSteps.length === 0) return false;
  const lastStep = orderedSteps[orderedSteps.length - 1];
  const lastStepResult = stepResultsMap.get(lastStep.id);
  const lastRunId = String(lastStepResult?.runId || '').trim();
  if (!lastRunId) return false;
  if (Number(lastStepResult?.validateExitCode) !== 0) return false;

  const runManifest = await readJsonOrNull(path.join(RUNS_ROOT, lastRunId, 'run_manifest.json'));
  const contractIntegrity = await readJsonOrNull(path.join(RUNS_ROOT, lastRunId, 'contract_integrity.json'));
  const runLifecycle = String(runManifest?.lifecycleState || '').trim().toUpperCase();
  const integrityStatus = resolveIntegrityStatus(contractIntegrity);
  return runLifecycle === 'PASS' && integrityStatus === 'PASS';
}

function buildContinuationBundle(metaRunId, orderedSteps, stepResults, integrityStatus) {
  const stepResultsMap = resolveStepResultsMap(stepResults, orderedSteps);
  const completedSteps = [];
  const remainingSteps = [];
  for (const step of orderedSteps) {
    const result = stepResultsMap.get(step.id);
    if (result && result.status === 'PASS') {
      completedSteps.push({
        id: step.id,
        type: step.type,
        status: 'PASS',
      });
      continue;
    }
    remainingSteps.push({
      id: step.id,
      type: step.type,
    });
  }

  const currentStepIndex = resolveFirstUnfinishedStepIndex(orderedSteps, stepResultsMap);
  const stepsTotal = orderedSteps.length;
  const lastRunId = resolveLatestRunIdLex(stepResults);

  return {
    metaRunId,
    currentStepIndex,
    stepsTotal,
    completedSteps,
    remainingSteps,
    lastRunId,
    integrityStatus: toPassFailed(integrityStatus),
    resumeCommand: `node meta-orchestrator.js --resume ${metaRunId}`,
  };
}

function buildContinuationPrompt(metaRunId, bundle) {
  const completedCount = Array.isArray(bundle?.completedSteps) ? bundle.completedSteps.length : 0;
  const stepsTotal = Number.isInteger(bundle?.stepsTotal) ? bundle.stepsTotal : 0;
  const nextStep = Array.isArray(bundle?.remainingSteps) && bundle.remainingSteps.length > 0
    ? bundle.remainingSteps[0]
    : null;
  const nextStepText = nextStep ? `${nextStep.id}:${nextStep.type}` : 'none';
  return [
    'META CONTINUATION TRANSFER',
    `metaRunId: ${metaRunId}`,
    `Completed: ${completedCount}/${stepsTotal}`,
    `Next step: ${nextStepText}`,
    'Resume:',
    `node meta-orchestrator.js --resume ${metaRunId}`,
    '',
  ].join('\n');
}

async function syncContinuationArtifacts(metaRunDir, metaRunId, orderedSteps, stepResults, contextHealth) {
  const bundlePath = path.join(metaRunDir, 'continuation_bundle.json');
  const promptPath = path.join(metaRunDir, 'continuation_prompt.txt');
  if (!contextHealth?.context?.recommendNextChat) {
    await removeFileIfExists(bundlePath);
    await removeFileIfExists(promptPath);
    return;
  }

  const integrityStatus = await resolveLastIntegrityStatus(stepResults);
  const bundle = buildContinuationBundle(metaRunId, orderedSteps, stepResults, integrityStatus);
  await writeJson(bundlePath, bundle);
  const prompt = buildContinuationPrompt(metaRunId, bundle);
  await fs.writeFile(promptPath, prompt, 'utf8');
}

async function persistMetaState(metaRunDir, metaRunId, orderedSteps, stepResults, statusOverride, options = {}) {
  const remediationHistory = normalizeRemediationHistory(options.remediationHistory);
  const manifest = buildManifest(metaRunId, orderedSteps, stepResults, statusOverride, {
    remediationHistory,
    selfHeal: options.selfHeal,
    reason: options.reason,
  });
  await writeJson(path.join(metaRunDir, 'meta_step_results.json'), {
    metaRunId,
    steps: stepResults,
    remediationHistory,
    selfHeal: {
      enabled: Boolean(options.selfHeal?.enabled),
      maxSelfHealAttempts: Number(options.selfHeal?.maxSelfHealAttempts || 0),
      stallThreshold: Number(options.selfHeal?.stallThreshold || 0),
    },
  });
  await writeJson(path.join(metaRunDir, 'meta_run_manifest.json'), manifest);
  const contextHealth = await writeContextHealthArtifact(metaRunDir, stepResults);
  await syncContinuationArtifacts(metaRunDir, metaRunId, orderedSteps, stepResults, contextHealth);
}

function buildRegressionFixTask(step, attempt, maxAttempts, failingTests, firstFailure) {
  const normalizedTests = Array.isArray(failingTests) ? failingTests : [];
  const testsSnippet = normalizedTests.length > 0
    ? normalizedTests.slice(0, 8).map((name) => `- ${name}`).join('; ')
    : '- failing test not resolved from output';
  const firstFailureSnippet = String(firstFailure || '').trim().slice(0, 500) || 'No stack captured';
  return [
    `regression_fix attempt ${attempt}/${maxAttempts}`,
    `for meta step ${step.id} (${step.type})`,
    'Fix validation failures and keep API contracts unchanged.',
    `Failing tests: ${testsSnippet}`,
    `First failure: ${firstFailureSnippet}`,
  ].join(' | ');
}

function printSelfHealReport(remediationHistory) {
  const history = Array.isArray(remediationHistory) ? remediationHistory : [];
  if (history.length === 0) return;
  console.log('[META][SELF_HEAL] Applied auto-fixes:');
  for (const item of history) {
    const attempt = Number(item?.attempt || 0);
    const status = String(item?.status || '').toUpperCase();
    const runId = String(item?.fixRunId || '').trim() || '(missing runId)';
    const sourceStepId = Number(item?.sourceStepId || 0);
    const firstFailingTest = Array.isArray(item?.failingTests) && item.failingTests.length > 0
      ? item.failingTests[0]
      : '(no failing test captured)';
    console.log(`[META][SELF_HEAL] #${attempt} step=${sourceStepId} status=${status} run=${runId} firstFailingTest=${firstFailingTest}`);
  }
}

async function runMetaStep(stepDescription, metaRunId) {
  const beforeRunIds = await listRunIds();
  const beforeSet = new Set(beforeRunIds);
  const exitCode = await runOrchestrator(stepDescription);
  const afterRunIds = await listRunIds();
  const newRunIds = afterRunIds.filter((runId) => !beforeSet.has(runId) && runId !== metaRunId);
  const stepRunId = latestRunId(newRunIds);
  const stepEvaluation = await evaluateStepRun(stepRunId);
  const stepPassed = exitCode === 0 && stepEvaluation.pass;
  return { exitCode, stepRunId, stepEvaluation, stepPassed };
}

function toStepResult(step, execution, validateExitCode) {
  return {
    stepId: step.id,
    type: step.type,
    description: step.description,
    runId: String(execution?.stepRunId || '').trim(),
    lifecycleState: String(execution?.stepEvaluation?.lifecycleState || '').trim().toUpperCase(),
    contractIntegrityStatus: String(execution?.stepEvaluation?.contractIntegrityStatus || '').trim().toUpperCase(),
    validateExitCode: Number.isInteger(validateExitCode) ? validateExitCode : 1,
    status: execution?.stepPassed ? 'PASS' : 'FAILED',
  };
}

async function executeMetaRun(metaRunDir, metaRunId, orderedSteps, initialStepResults, options = {}) {
  const selfHeal = {
    enabled: parseBooleanFlag(options?.selfHeal?.enabled, DEFAULT_SELF_HEAL_ENABLED),
    maxSelfHealAttempts: parsePositiveInt(options?.selfHeal?.maxSelfHealAttempts, DEFAULT_MAX_SELF_HEAL_ATTEMPTS),
    stallThreshold: parsePositiveInt(options?.selfHeal?.stallThreshold, DEFAULT_SELF_HEAL_STALL_THRESHOLD),
  };
  const validateCommand = String(options?.validateCommand || DEFAULT_VALIDATE_COMMAND).trim() || DEFAULT_VALIDATE_COMMAND;
  let remediationHistory = normalizeRemediationHistory(options?.remediationHistory);
  let finalReason = null;

  let stepResultsMap = resolveStepResultsMap(initialStepResults, orderedSteps);
  let stepResults = sortStepResultsByPlan(orderedSteps, stepResultsMap);
  const startIndex = resolveFirstUnfinishedStepIndex(orderedSteps, stepResultsMap);

  if (startIndex >= orderedSteps.length) {
    const metaPass = await validateFinalMetaPass(orderedSteps, stepResults);
    await persistMetaState(metaRunDir, metaRunId, orderedSteps, stepResults, metaPass ? 'PASS' : 'FAILED', {
      selfHeal,
      remediationHistory,
      reason: metaPass ? null : 'FINAL_VALIDATION_FAILED',
    });
    if (metaPass) printSelfHealReport(remediationHistory);
    return metaPass ? 0 : 1;
  }

  await persistMetaState(metaRunDir, metaRunId, orderedSteps, stepResults, 'IN_PROGRESS', {
    selfHeal,
    remediationHistory,
    reason: null,
  });

  for (let i = startIndex; i < orderedSteps.length; i += 1) {
    const step = orderedSteps[i];
    const initialExecution = await runMetaStep(step.description, metaRunId);
    let validateExitCode = 0;
    let failingTests = [];
    let firstFailure = '';
    let failureSignature = '';

    if (!initialExecution.stepPassed) {
      const diagnostics = runValidateCommand(validateCommand);
      validateExitCode = diagnostics.exitCode;
      failingTests = extractFailingTestsFromOutput(diagnostics.output);
      firstFailure = extractFirstFailureBlock(diagnostics.output);
      failureSignature = buildFailureSignature({
        failingTests,
        firstFailure,
        validateExitCode,
        lifecycleState: initialExecution.stepEvaluation.lifecycleState,
        contractIntegrityStatus: initialExecution.stepEvaluation.contractIntegrityStatus,
      });
    }

    stepResultsMap.set(step.id, toStepResult(step, initialExecution, validateExitCode));
    stepResults = sortStepResultsByPlan(orderedSteps, stepResultsMap);

    if (!initialExecution.stepPassed) {
      if (!selfHeal.enabled) {
        finalReason = 'VALIDATE_FAILED';
        await persistMetaState(metaRunDir, metaRunId, orderedSteps, stepResults, 'FAILED', {
          selfHeal,
          remediationHistory,
          reason: finalReason,
        });
        return 1;
      }

      let repeatedFailureCount = failureSignature ? 1 : 0;
      let latestFailureSignature = failureSignature;
      let currentFailingTests = failingTests;
      let currentFirstFailure = firstFailure;

      let healed = false;
      for (let attempt = 1; attempt <= selfHeal.maxSelfHealAttempts; attempt += 1) {
        const fixTask = buildRegressionFixTask(
          step,
          attempt,
          selfHeal.maxSelfHealAttempts,
          currentFailingTests,
          currentFirstFailure,
        );
        const fixExecution = await runMetaStep(fixTask, metaRunId);
        let fixValidateExitCode = 0;
        let fixFailingTests = [];
        let fixFirstFailure = '';
        let fixFailureSignature = '';

        if (!fixExecution.stepPassed) {
          const diagnostics = runValidateCommand(validateCommand);
          fixValidateExitCode = diagnostics.exitCode;
          fixFailingTests = extractFailingTestsFromOutput(diagnostics.output);
          fixFirstFailure = extractFirstFailureBlock(diagnostics.output);
          fixFailureSignature = buildFailureSignature({
            failingTests: fixFailingTests,
            firstFailure: fixFirstFailure,
            validateExitCode: fixValidateExitCode,
            lifecycleState: fixExecution.stepEvaluation.lifecycleState,
            contractIntegrityStatus: fixExecution.stepEvaluation.contractIntegrityStatus,
          });
        }

        stepResultsMap.set(step.id, toStepResult(step, fixExecution, fixValidateExitCode));
        stepResults = sortStepResultsByPlan(orderedSteps, stepResultsMap);

        let remediationStatus = fixExecution.stepPassed ? 'PASS' : 'FAILED';
        let remediationReason = null;
        if (!fixExecution.stepPassed) {
          if (fixFailureSignature && fixFailureSignature === latestFailureSignature) {
            repeatedFailureCount += 1;
          } else {
            repeatedFailureCount = 1;
            latestFailureSignature = fixFailureSignature;
          }

          const stalled = Boolean(fixFailureSignature) && repeatedFailureCount >= selfHeal.stallThreshold;
          if (stalled) {
            remediationStatus = SELF_HEAL_STALLED;
            remediationReason = SELF_HEAL_STALLED;
          } else if (attempt >= selfHeal.maxSelfHealAttempts) {
            remediationStatus = 'MAX_SELF_HEAL_ATTEMPTS_REACHED';
            remediationReason = 'MAX_SELF_HEAL_ATTEMPTS_REACHED';
          }
        }

        remediationHistory.push({
          id: `regression_fix_${Date.now()}_${attempt}`,
          type: 'regression_fix',
          attempt,
          sourceStepId: step.id,
          sourceStepType: step.type,
          sourceRunId: String(initialExecution.stepRunId || '').trim(),
          fixRunId: String(fixExecution.stepRunId || '').trim(),
          status: remediationStatus,
          reason: remediationReason,
          validateExitCode: Number.isInteger(fixValidateExitCode) ? fixValidateExitCode : 1,
          failingTests: fixFailingTests,
          failureSignature: fixFailureSignature,
          firstFailure: fixFirstFailure,
          timestamp: new Date().toISOString(),
          fixTask,
        });

        if (fixExecution.stepPassed) {
          healed = true;
          await persistMetaState(metaRunDir, metaRunId, orderedSteps, stepResults, 'IN_PROGRESS', {
            selfHeal,
            remediationHistory,
            reason: null,
          });
          break;
        }

        if (remediationStatus === SELF_HEAL_STALLED) {
          finalReason = SELF_HEAL_STALLED;
          await persistMetaState(metaRunDir, metaRunId, orderedSteps, stepResults, 'FAILED', {
            selfHeal,
            remediationHistory,
            reason: finalReason,
          });
          return 1;
        }

        if (remediationStatus === 'MAX_SELF_HEAL_ATTEMPTS_REACHED') {
          finalReason = 'MAX_SELF_HEAL_ATTEMPTS_REACHED';
          await persistMetaState(metaRunDir, metaRunId, orderedSteps, stepResults, 'FAILED', {
            selfHeal,
            remediationHistory,
            reason: finalReason,
          });
          return 1;
        }

        currentFailingTests = fixFailingTests;
        currentFirstFailure = fixFirstFailure;
        await persistMetaState(metaRunDir, metaRunId, orderedSteps, stepResults, 'IN_PROGRESS', {
          selfHeal,
          remediationHistory,
          reason: null,
        });
      }

      if (!healed) {
        finalReason = 'MAX_SELF_HEAL_ATTEMPTS_REACHED';
        await persistMetaState(metaRunDir, metaRunId, orderedSteps, stepResults, 'FAILED', {
          selfHeal,
          remediationHistory,
          reason: finalReason,
        });
        return 1;
      }
    }

    const allPassed = stepsPassedCount(stepResults) === orderedSteps.length;
    if (allPassed) {
      const metaPass = await validateFinalMetaPass(orderedSteps, stepResults);
      await persistMetaState(metaRunDir, metaRunId, orderedSteps, stepResults, metaPass ? 'PASS' : 'FAILED', {
        selfHeal,
        remediationHistory,
        reason: metaPass ? null : 'FINAL_VALIDATION_FAILED',
      });
      if (!metaPass) return 1;
      printSelfHealReport(remediationHistory);
      continue;
    }

    await persistMetaState(metaRunDir, metaRunId, orderedSteps, stepResults, 'IN_PROGRESS', {
      selfHeal,
      remediationHistory,
      reason: null,
    });
  }

  return 0;
}

async function runTaskMode(task, options = {}) {
  await fs.mkdir(RUNS_ROOT, { recursive: true });
  const metaRunId = buildMetaRunId();
  const metaRunDir = path.join(RUNS_ROOT, metaRunId);
  await fs.mkdir(metaRunDir, { recursive: true });

  let exitCode = 1;
  let reason = null;
  try {
    const metaPlan = normalizeMetaPlan(buildMetaPlan(task));
    await writeJson(path.join(metaRunDir, 'meta_plan.json'), metaPlan);
    exitCode = await executeMetaRun(metaRunDir, metaRunId, metaPlan.steps, [], {
      selfHeal: options?.selfHeal,
      validateCommand: options?.validateCommand,
      remediationHistory: [],
    });
    reason = await readMetaManifestReason(metaRunDir);
    return exitCode;
  } finally {
    await writeMetaIntegrity(metaRunDir, exitCode === 0 ? 'PASS' : 'FAILED', reason);
  }
}

async function runResumeMode(metaRunId, options = {}) {
  await fs.mkdir(RUNS_ROOT, { recursive: true });
  const cleanMetaRunId = String(metaRunId || '').trim();
  if (!cleanMetaRunId) return 1;
  const metaRunDir = path.join(RUNS_ROOT, cleanMetaRunId);
  await fs.mkdir(metaRunDir, { recursive: true });
  let exitCode = 1;
  let reason = null;
  try {
    const resumeContext = await assertResumeConsistency(cleanMetaRunId, metaRunDir);
    exitCode = await executeMetaRun(
      metaRunDir,
      cleanMetaRunId,
      resumeContext.orderedSteps,
      resumeContext.initialStepResults,
      {
        selfHeal: options?.selfHeal,
        validateCommand: options?.validateCommand,
        remediationHistory: resumeContext.remediationHistory,
      },
    );
    reason = await readMetaManifestReason(metaRunDir);
  } catch (error) {
    if (String(error?.message || '') === META_RESUME_INCONSISTENT) {
      reason = META_RESUME_INCONSISTENT;
      throw new Error(META_RESUME_INCONSISTENT);
    }
    throw error;
  } finally {
    await writeMetaIntegrity(metaRunDir, exitCode === 0 ? 'PASS' : 'FAILED', reason);
  }
  return exitCode;
}

async function main() {
  const cli = parseCliOptions(process.argv.slice(2));
  const runtimeOptions = {
    selfHeal: {
      enabled: cli.selfHealEnabled,
      maxSelfHealAttempts: cli.maxSelfHealAttempts,
      stallThreshold: cli.selfHealStallThreshold,
    },
    validateCommand: DEFAULT_VALIDATE_COMMAND,
  };
  let exitCode = 1;
  if (cli.resumeMetaRunId) {
    exitCode = await runResumeMode(cli.resumeMetaRunId, runtimeOptions);
  } else if (cli.task) {
    exitCode = await runTaskMode(cli.task, runtimeOptions);
  }
  if (exitCode !== 0) process.exitCode = 1;
}

main().catch(() => {
  process.exitCode = 1;
});
