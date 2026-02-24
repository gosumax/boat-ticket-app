import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, execSync } from 'node:child_process';

let lastSnapshotRef = null;

function runGit(command) {
  return execSync(command, {
    cwd: process.cwd(),
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

function runGitArgs(args) {
  return execFileSync('git', args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

function sanitizeTaskSlug(task) {
  const normalized = String(task || '')
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[\u0300-\u036f]/g, '');

  const slug = normalized
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');

  return slug || 'task';
}

function formatBranchTimestamp(date = new Date()) {
  const pad2 = (value) => String(value).padStart(2, '0');
  return [
    String(date.getFullYear()),
    pad2(date.getMonth() + 1),
    pad2(date.getDate()),
  ].join('') + `-${pad2(date.getHours())}${pad2(date.getMinutes())}${pad2(date.getSeconds())}`;
}

export function ensureGitRepo() {
  const gitPath = path.join(process.cwd(), '.git');
  if (!fs.existsSync(gitPath)) {
    throw new Error('Not a git repository');
  }
}

export function getCurrentBranch() {
  ensureGitRepo();
  return String(runGitArgs(['rev-parse', '--abbrev-ref', 'HEAD']) || '').trim();
}

export function getCurrentCommit() {
  ensureGitRepo();
  return String(runGitArgs(['rev-parse', 'HEAD']) || '').trim();
}

export function createTaskBranch(task) {
  ensureGitRepo();
  const slug = sanitizeTaskSlug(task);
  const branchName = `task/${slug}-${formatBranchTimestamp()}`;
  runGitArgs(['checkout', '-b', branchName]);
  return branchName;
}

export function checkoutBranch(name) {
  ensureGitRepo();
  const branchName = String(name || '').trim();
  if (!branchName) throw new Error('INVALID_BRANCH_NAME');
  runGitArgs(['checkout', branchName]);
}

export function deleteBranch(name) {
  ensureGitRepo();
  const branchName = String(name || '').trim();
  if (!branchName) throw new Error('INVALID_BRANCH_NAME');
  runGitArgs(['branch', '-D', branchName]);
}

export function branchExists(name) {
  ensureGitRepo();
  const branchName = String(name || '').trim();
  if (!branchName) return false;
  try {
    runGitArgs(['show-ref', '--verify', '--quiet', `refs/heads/${branchName}`]);
    return true;
  } catch {
    return false;
  }
}

export function resetHardToCommit(commit) {
  ensureGitRepo();
  const value = String(commit || '').trim();
  if (!value) throw new Error('INVALID_COMMIT');
  runGitArgs(['reset', '--hard', value]);
}

export function cleanUntracked() {
  ensureGitRepo();
  runGitArgs(['clean', '-fd']);
}

export function assertCleanRepo() {
  ensureGitRepo();
  const status = runGit('git status --porcelain').trim();
  if (status) {
    throw new Error('DIRTY_REPO');
  }
}

export function createSnapshot(label) {
  ensureGitRepo();
  const safeLabel = String(label ?? '').trim() || 'snapshot';
  const message = `orch-${safeLabel}`;

  runGit(`git stash push -u -m "${message.replace(/"/g, '\\"')}"`);

  const ref = getSnapshotRef(safeLabel);
  lastSnapshotRef = ref;
  return ref;
}

export function getSnapshotRef(label) {
  const safeLabel = String(label ?? '').trim();
  if (!safeLabel) return null;

  const needle = `orch-${safeLabel}`;
  const stashList = runGit('git stash list --format="%gd\t%s"').trim();
  if (!stashList) return null;

  const lines = stashList.split(/\r?\n/).filter(Boolean);
  const match = lines.find((line) => line.includes(`\t${needle}`) || line.endsWith(needle));
  if (!match) return null;

  const [ref] = match.split('\t');
  return ref || null;
}

export function hasActiveSnapshot(label) {
  const ref = getSnapshotRef(label);
  lastSnapshotRef = ref;
  return Boolean(ref);
}

export function dropSnapshot(ref) {
  ensureGitRepo();
  const value = String(ref || '').trim();
  if (!value) return;
  runGit(`git stash drop ${value}`);
}

export function restoreSnapshot() {
  ensureGitRepo();
  runGit('git reset --hard');

  const stashList = runGit('git stash list --format="%gd\t%s"').trim();
  if (!stashList) {
    lastSnapshotRef = null;
    return;
  }

  const lines = stashList.split(/\r?\n/).filter(Boolean);
  const preferred = lastSnapshotRef
    ? lines.find((line) => line.startsWith(`${lastSnapshotRef}\t`))
    : null;
  const fallback = lines.find((line) => line.includes('\torch-'));
  const target = preferred || fallback;
  if (!target) {
    lastSnapshotRef = null;
    return;
  }

  const [ref] = target.split('\t');
  runGit(`git stash pop ${ref}`);
  lastSnapshotRef = null;
}
