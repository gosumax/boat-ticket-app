import fs from 'node:fs/promises';
import path from 'node:path';
import { callModel } from '../utils/openai.js';
import { assertCleanRepo, createSnapshot, ensureGitRepo, getSnapshotRef, hasActiveSnapshot, restoreSnapshot } from '../utils/git.js';
import { validateImpactedFiles, validateNoForbiddenTargets, validatePlanIntegrity } from '../utils/preflightGuard.js';
import { writeArtifact } from '../utils/runArtifacts.js';

const MAX_DIFF_BYTES = 200_000;

function parseImpactedFiles(planContent) {
  const lines = planContent.split(/\r?\n/);
  const files = [];
  let inSection = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (!inSection) {
      if (line.toLowerCase().startsWith('- files potentially affected')) {
        inSection = true;
      }
      continue;
    }

    if (line.startsWith('- Definition of Done')) break;
    if (line.startsWith('- ') && line !== '- (none)') {
      files.push(line.slice(2).trim());
    }
  }

  return files;
}

function stringifyFeedback(feedback) {
  if (!feedback) return '(none)';
  try {
    return JSON.stringify(feedback, null, 2);
  } catch {
    return String(feedback);
  }
}

function buildPrompt({ task, impactedFiles, feedback, researchContent, designContent, planContent }) {
  const impactedList = impactedFiles.length ? impactedFiles.map((file) => `- ${file}`).join('\n') : '- (none)';

  return [
    'You are Codex implementing a minimal, safe patch for an existing repository.',
    'Return only a unified git diff. No prose, no explanations, no markdown fences.',
    '',
    'Hard constraints:',
    '- Minimal diff',
    '- Preserve API contracts',
    '- No refactor',
    '- No formatting changes',
    '- No unrelated edits',
    '- No console.logs',
    '- No comments explaining',
    '- Edit only impacted files when possible',
    '',
    'TASK:',
    task || '(empty task)',
    '',
    'Impacted files:',
    impactedList,
    '',
    'Feedback from validation loop:',
    stringifyFeedback(feedback),
    '',
    'Research report:',
    researchContent,
    '',
    'Design report:',
    designContent,
    '',
    'Plan report:',
    planContent,
    '',
    'Output format requirement:',
    '- Must start with: diff --git',
    '- Must be valid unified diff applicable to current repo',
  ].join('\n');
}

function normalizeDiffText(rawText) {
  const text = String(rawText || '').trim();
  if (!text) return '';

  if (text.startsWith('```')) {
    const cleaned = text
      .replace(/^```(?:diff)?\s*/i, '')
      .replace(/\s*```$/, '')
      .trim();
    return cleaned;
  }

  return text;
}

function parseHunkHeader(headerLine) {
  const match = headerLine.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
  if (!match) throw new Error(`Invalid hunk header: ${headerLine}`);

  return {
    oldStart: Number(match[1]),
    oldCount: match[2] ? Number(match[2]) : 1,
    newStart: Number(match[3]),
    newCount: match[4] ? Number(match[4]) : 1,
  };
}

function parseFilePatch(lines, startIndex) {
  let i = startIndex;
  const diffHeader = lines[i];
  const diffMatch = diffHeader.match(/^diff --git a\/(.+) b\/(.+)$/);
  if (!diffMatch) throw new Error(`Invalid diff header: ${diffHeader}`);

  const patch = {
    oldPath: diffMatch[1],
    newPath: diffMatch[2],
    oldMarker: null,
    newMarker: null,
    newFileMode: false,
    deletedFileMode: false,
    hunks: [],
  };

  i += 1;
  while (i < lines.length) {
    const line = lines[i];
    if (line.startsWith('diff --git ')) break;
    if (line.startsWith('new file mode ')) {
      patch.newFileMode = true;
      i += 1;
      continue;
    }
    if (line.startsWith('deleted file mode ')) {
      patch.deletedFileMode = true;
      i += 1;
      continue;
    }
    if (line.startsWith('rename from ') || line.startsWith('rename to ')) {
      throw new Error('Unsupported diff operation: rename');
    }
    if (line.startsWith('--- ')) {
      patch.oldMarker = line.slice(4).trim();
      i += 1;
      continue;
    }
    if (line.startsWith('+++ ')) {
      patch.newMarker = line.slice(4).trim();
      i += 1;
      continue;
    }
    if (line.startsWith('@@ ')) {
      const header = parseHunkHeader(line);
      const hunkLines = [];
      i += 1;
      while (i < lines.length) {
        const hunkLine = lines[i];
        if (hunkLine.startsWith('diff --git ') || hunkLine.startsWith('@@ ')) break;
        if (hunkLine.startsWith('\\ No newline at end of file')) {
          i += 1;
          continue;
        }
        const prefix = hunkLine[0];
        if (prefix !== ' ' && prefix !== '+' && prefix !== '-') {
          throw new Error(`Invalid hunk line: ${hunkLine}`);
        }
        hunkLines.push(hunkLine);
        i += 1;
      }
      patch.hunks.push({ ...header, lines: hunkLines });
      continue;
    }
    i += 1;
  }

  return { patch, nextIndex: i };
}

function parseDiffPatches(diffText) {
  const normalized = String(diffText || '').replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');
  const patches = [];

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line) {
      i += 1;
      continue;
    }
    if (!line.startsWith('diff --git ')) {
      throw new Error(`Invalid diff format near line ${i + 1}`);
    }
    const parsed = parseFilePatch(lines, i);
    patches.push(parsed.patch);
    i = parsed.nextIndex;
  }

  if (!patches.length) throw new Error('Empty diff payload');
  return patches;
}

function resolveRepoPath(rootDir, markerPath, fallbackPath) {
  const source = markerPath || fallbackPath;
  if (!source) return null;
  if (source === '/dev/null') return null;

  let rel = source;
  if (rel.startsWith('a/')) rel = rel.slice(2);
  if (rel.startsWith('b/')) rel = rel.slice(2);
  rel = rel.replace(/\\/g, '/').trim();
  if (!rel || rel.startsWith('/') || /^[A-Za-z]:\//.test(rel) || rel.includes('..')) {
    throw new Error(`Unsafe diff path: ${source}`);
  }

  return path.join(rootDir, rel.split('/').join(path.sep));
}

function applyHunksToContent(originalContent, hunks) {
  const sourceLines = originalContent === '' ? [] : originalContent.split('\n');
  const lines = [...sourceLines];
  let offset = 0;

  for (const hunk of hunks) {
    const baseIndex = hunk.oldStart === 0 ? 0 : hunk.oldStart - 1;
    const startIndex = baseIndex + offset;
    if (startIndex < 0 || startIndex > lines.length) {
      throw new Error(`Hunk start out of bounds at -${hunk.oldStart},+${hunk.newStart}`);
    }

    let cursor = startIndex;
    const replacement = [];

    for (const hunkLine of hunk.lines) {
      const symbol = hunkLine[0];
      const text = hunkLine.slice(1);

      if (symbol === ' ') {
        if (lines[cursor] !== text) throw new Error(`Hunk context mismatch at line ${cursor + 1}`);
        replacement.push(text);
        cursor += 1;
        continue;
      }

      if (symbol === '-') {
        if (lines[cursor] !== text) throw new Error(`Hunk removal mismatch at line ${cursor + 1}`);
        cursor += 1;
        continue;
      }

      if (symbol === '+') {
        replacement.push(text);
        continue;
      }
    }

    const removeCount = cursor - startIndex;
    lines.splice(startIndex, removeCount, ...replacement);
    offset += replacement.length - removeCount;
  }

  return lines.join('\n');
}

async function applyUnifiedDiff(diffText) {
  const rootDir = process.cwd();
  const patches = parseDiffPatches(diffText);
  const changedFiles = new Set();

  for (const patch of patches) {
    const oldAbsPath = resolveRepoPath(rootDir, patch.oldMarker, `a/${patch.oldPath}`);
    const newAbsPath = resolveRepoPath(rootDir, patch.newMarker, `b/${patch.newPath}`);
    const isDelete = patch.deletedFileMode || patch.newMarker === '/dev/null' || !newAbsPath;
    const targetPath = isDelete ? oldAbsPath : newAbsPath;
    if (!targetPath) throw new Error('Unable to resolve target path from diff');
    changedFiles.add(normalizeRelPath(path.relative(rootDir, targetPath)));

    let originalContent = '';
    try {
      originalContent = await fs.readFile(isDelete ? oldAbsPath : targetPath, 'utf8');
    } catch (error) {
      if (patch.newFileMode || patch.oldMarker === '/dev/null') {
        originalContent = '';
      } else if (error?.code === 'ENOENT' && !isDelete) {
        originalContent = '';
      } else if (error?.code === 'ENOENT' && isDelete) {
        originalContent = '';
      } else {
        throw error;
      }
    }

    const nextContent = applyHunksToContent(originalContent, patch.hunks);

    if (isDelete) {
      try {
        await fs.unlink(targetPath);
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
      }
      continue;
    }

    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.writeFile(targetPath, nextContent, 'utf8');
  }

  return Array.from(changedFiles);
}

function normalizeRelPath(filePath) {
  return String(filePath || '').replace(/\\/g, '/').trim();
}

function isAlwaysAllowedPath(filePath) {
  return filePath.startsWith('orchestrator/') || filePath.startsWith('dev_pipeline/');
}

function ensureAllowedChangedFiles(changedFiles, impactedFiles) {
  const allowedImpacted = new Set((impactedFiles || []).map((file) => normalizeRelPath(file)));
  const hasImpactedFiles = allowedImpacted.size > 0;
  const outside = changedFiles.filter((file) => {
    const normalized = normalizeRelPath(file);
    if (isAlwaysAllowedPath(normalized)) return false;
    if (!hasImpactedFiles) return true;
    return !allowedImpacted.has(normalized);
  });

  if (outside.length > 0) {
    throw new Error(`Diff changed files outside allowed scope: ${outside.join(', ')}`);
  }
}

function isImpactedPath(filePath, impactedFiles) {
  const normalized = normalizeRelPath(filePath);
  return (impactedFiles || []).some((item) => normalizeRelPath(item) === normalized);
}

async function loadOriginalContent(filePath, patch, isDelete) {
  try {
    return await fs.readFile(isDelete ? filePath : filePath, 'utf8');
  } catch (error) {
    if (patch.newFileMode || patch.oldMarker === '/dev/null') return '';
    if (error?.code === 'ENOENT') return '';
    throw error;
  }
}

async function simulateUnifiedDiff(diffText, impactedFiles) {
  const rootDir = process.cwd();
  const patches = parseDiffPatches(diffText);
  const changedFiles = [];

  for (const patch of patches) {
    const oldAbsPath = resolveRepoPath(rootDir, patch.oldMarker, `a/${patch.oldPath}`);
    const newAbsPath = resolveRepoPath(rootDir, patch.newMarker, `b/${patch.newPath}`);
    const isDelete = patch.deletedFileMode || patch.newMarker === '/dev/null' || !newAbsPath;
    const targetPath = isDelete ? oldAbsPath : newAbsPath;
    if (!targetPath) throw new Error('Invalid target path');

    const relPath = normalizeRelPath(path.relative(rootDir, targetPath));
    changedFiles.push(relPath);

    if (isDelete && !isImpactedPath(relPath, impactedFiles)) {
      throw new Error('Delete outside impacted');
    }

    const originalContent = await loadOriginalContent(targetPath, patch, isDelete);
    applyHunksToContent(originalContent, patch.hunks);
  }

  ensureAllowedChangedFiles(changedFiles, impactedFiles);
  return changedFiles;
}

function assertRestoreLifecycleState(lifecycleState) {
  if (lifecycleState !== 'IMPLEMENTED' && lifecycleState !== 'RETRYING') {
    throw new Error('LIFECYCLE_VIOLATION');
  }
}

export async function runImplementation(input) {
  const rootDir = process.cwd();
  const task = String(input?.task || '').trim();
  const attempt = Number(input?.attempt || 1);
  const model = String(input?.config?.model || process.env.ORCHESTRATOR_MODEL || 'gpt-4.1-mini').trim();

  const researchPath = path.join(rootDir, 'dev_pipeline', 'research.md');
  const designPath = path.join(rootDir, 'dev_pipeline', 'design.md');
  const planPath = path.join(rootDir, 'dev_pipeline', 'plan.md');

  const [researchContent, designContent, planContent] = await Promise.all([
    fs.readFile(researchPath, 'utf8'),
    fs.readFile(designPath, 'utf8'),
    fs.readFile(planPath, 'utf8'),
  ]);

  validatePlanIntegrity(input?.plan);
  const impactedFiles = Array.isArray(input?.plan?.impactedFiles) && input.plan.impactedFiles.length
    ? input.plan.impactedFiles
    : parseImpactedFiles(planContent);
  validateImpactedFiles(impactedFiles);
  const prompt = buildPrompt({
    task,
    impactedFiles,
    feedback: input?.feedback,
    researchContent,
    designContent,
    planContent,
  });

  ensureGitRepo();
  assertCleanRepo();
  const snapshotLabel = `attempt-${attempt}`;
  if (!hasActiveSnapshot(snapshotLabel)) {
    createSnapshot(snapshotLabel);
  }
  const snapshotRef = getSnapshotRef(snapshotLabel);

  let response;
  try {
    response = await callModel(model, prompt);
  } catch (error) {
    restoreSnapshot();
    throw error;
  }

  const rawDiffText = String(response?.text || '');
  const diffText = normalizeDiffText(rawDiffText);
  if (Buffer.byteLength(diffText, 'utf8') > MAX_DIFF_BYTES) {
    throw new Error('DIFF_TOO_LARGE');
  }

  if (!diffText.startsWith('diff --git')) {
    throw new Error('Invalid diff from model');
  }
  validateNoForbiddenTargets(diffText);
  await writeArtifact(`diff_attempt-${attempt}.patch`, diffText);

  try {
    try {
      await simulateUnifiedDiff(diffText, impactedFiles);
    } catch {
      await writeArtifact(`rejected_diff_attempt-${attempt}.txt`, rawDiffText);
      throw new Error('DRY_RUN_FAILED');
    }

    const changedFiles = await applyUnifiedDiff(diffText);
    ensureAllowedChangedFiles(changedFiles, impactedFiles);
    if (!input?.lifecycleState) {
      throw new Error('LIFECYCLE_SYNC_ERROR');
    }

    return {
      stage: 'implement',
      status: 'ok',
      diffApplied: true,
      attempt,
      changedFiles,
      snapshotLabel,
      snapshotRef,
    };
  } catch (error) {
    assertRestoreLifecycleState(input?.lifecycleState);
    restoreSnapshot();
    throw error;
  }
}
