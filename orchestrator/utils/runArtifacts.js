import fs from 'node:fs/promises';
import path from 'node:path';

let activeRunDir = null;

function getRunsRootDir() {
  return path.join(process.cwd(), 'dev_pipeline', 'runs');
}

function buildRunId() {
  return new Date().toISOString().replace(/:/g, '-');
}

function assertArtifactName(name) {
  const fileName = String(name || '').trim();
  if (!fileName || fileName.includes('/') || fileName.includes('\\') || fileName.includes('..')) {
    throw new Error('Invalid artifact name');
  }
  return fileName;
}

export async function createRunDir() {
  if (activeRunDir) return activeRunDir;

  const runId = buildRunId();
  const runDir = path.join(getRunsRootDir(), runId);
  await fs.mkdir(runDir, { recursive: true });
  activeRunDir = runDir;
  return activeRunDir;
}

export function getRunDir() {
  return activeRunDir;
}

export async function writeArtifact(name, content) {
  const fileName = assertArtifactName(name);
  const runDir = await createRunDir();
  const artifactPath = path.join(runDir, fileName);
  await fs.writeFile(artifactPath, String(content ?? ''), 'utf8');
  return artifactPath;
}
