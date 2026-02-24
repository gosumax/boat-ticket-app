function failPreflight() {
  throw new Error('PREFLIGHT_VIOLATION');
}

function normalizePath(value) {
  return String(value || '').replace(/\\/g, '/').trim();
}

function assertSafeRepoRelativePath(filePath) {
  const normalized = normalizePath(filePath);
  if (!normalized) failPreflight();
  if (normalized.startsWith('/')) failPreflight();
  if (/^[A-Za-z]:\//.test(normalized)) failPreflight();
  if (normalized === '.' || normalized === '..') failPreflight();
  if (normalized.includes('../') || normalized.includes('/..') || normalized.endsWith('/..')) failPreflight();
}

function isForbiddenTarget(filePath) {
  const normalized = normalizePath(filePath);
  if (normalized === 'package.json') return true;
  if (normalized === 'package-lock.json' || normalized.endsWith('/package-lock.json')) return true;
  if (normalized === '.git' || normalized.startsWith('.git/')) return true;
  if (normalized === 'node_modules' || normalized.startsWith('node_modules/')) return true;
  const segments = normalized.split('/').filter(Boolean);
  if (segments.includes('.env') || segments.some((segment) => segment.startsWith('.env.'))) return true;
  return false;
}

function extractDiffPaths(diffText) {
  const paths = [];
  const lines = String(diffText || '').replace(/\r\n/g, '\n').split('\n');
  for (const line of lines) {
    const match = line.match(/^diff --git a\/(.+) b\/(.+)$/);
    if (!match) continue;
    paths.push(match[1], match[2]);
  }
  return paths;
}

export function validatePlanIntegrity(plan) {
  if (!plan || typeof plan !== 'object') failPreflight();
}

export function validateImpactedFiles(impactedFiles) {
  if (impactedFiles === undefined) failPreflight();
  if (!Array.isArray(impactedFiles)) failPreflight();

  for (const file of impactedFiles) {
    const value = normalizePath(file);
    if (!value) failPreflight();
    if (value.includes('*')) failPreflight();
    assertSafeRepoRelativePath(value);
    if (isForbiddenTarget(value)) failPreflight();
  }
}

export function validateNoForbiddenTargets(diffText) {
  const diff = String(diffText || '');
  if (!diff.trim()) failPreflight();

  const paths = extractDiffPaths(diff);
  if (!paths.length) failPreflight();

  for (const file of paths) {
    assertSafeRepoRelativePath(file);
    if (isForbiddenTarget(file)) failPreflight();
  }
}
