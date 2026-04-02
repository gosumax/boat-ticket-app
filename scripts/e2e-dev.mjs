import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn, spawnSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.join(__dirname, '..');
const e2eDir = path.join(repoRoot, '_testdata');
const e2eDbPath = path.join(e2eDir, 'e2e.sqlite');
const viteBinPath = path.join(repoRoot, 'node_modules', 'vite', 'bin', 'vite.js');

fs.mkdirSync(e2eDir, { recursive: true });
for (const suffix of ['', '-shm', '-wal']) {
  try {
    fs.unlinkSync(`${e2eDbPath}${suffix}`);
  } catch {}
}

const sharedEnv = {
  ...process.env,
  NODE_ENV: 'test',
  DB_FILE: e2eDbPath,
  PORT: process.env.PORT || '3101',
  VITE_API_PROXY_TARGET: process.env.VITE_API_PROXY_TARGET || `http://localhost:${process.env.PORT || '3101'}`,
};

const ensureUsersResult = spawnSync(
  process.execPath,
  [path.join(repoRoot, 'scripts', 'e2e-ensure-users.mjs')],
  {
    cwd: repoRoot,
    env: sharedEnv,
    stdio: 'inherit',
  }
);

if (ensureUsersResult.status !== 0) {
  process.exit(ensureUsersResult.status ?? 1);
}

const children = [];
const spawnChild = (args, extraEnv = {}) => {
  const child = spawn(process.execPath, args, {
    cwd: repoRoot,
    env: { ...sharedEnv, ...extraEnv },
    stdio: 'inherit',
  });
  children.push(child);
  return child;
};

const stopChildren = () => {
  for (const child of children) {
    if (!child.killed) {
      try {
        child.kill();
      } catch {}
    }
  }
};

process.on('SIGINT', () => {
  stopChildren();
  process.exit(130);
});
process.on('SIGTERM', () => {
  stopChildren();
  process.exit(143);
});
process.on('exit', stopChildren);

const backend = spawnChild([path.join(repoRoot, 'server', 'index.js')]);
const frontend = spawnChild([
  viteBinPath,
  '--host',
  'localhost',
  '--port',
  '4173',
  '--strictPort',
]);

backend.on('exit', (code) => {
  stopChildren();
  process.exit(code ?? 1);
});

frontend.on('exit', (code) => {
  stopChildren();
  process.exit(code ?? 1);
});
