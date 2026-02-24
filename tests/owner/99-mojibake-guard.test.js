import { describe, it, expect } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SRC_DIR = path.resolve(__dirname, '../../src');
const MOJIBAKE_TOKENS = [
  'вЂ',
  'в†',
  '\uFFFD',
  '�',
  'РќР',
  'РЎР',
  'РџС',
  'РІР‚',
  'РІвЂ ',
  'Р СњР ',
  'Р РЋР ',
];

async function collectFiles(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(fullPath)));
      continue;
    }
    files.push(fullPath);
  }
  return files.sort();
}

function findFirstMojibakeHit(content) {
  let first = null;

  for (const token of MOJIBAKE_TOKENS) {
    const index = content.indexOf(token);
    if (index < 0) continue;
    if (!first || index < first.index) {
      first = { token, index };
    }
  }

  if (!first) return null;

  const line = content.slice(0, first.index).split('\n').length;
  const lineStart = content.lastIndexOf('\n', first.index - 1) + 1;
  const lineEnd = content.indexOf('\n', first.index);
  const rawLine = content.slice(lineStart, lineEnd === -1 ? content.length : lineEnd);
  const fragment = rawLine.trim().slice(0, 180);

  return {
    token: first.token,
    line,
    fragment,
  };
}

describe('Mojibake guard for src (consolidated)', () => {
  it('has no forbidden mojibake tokens in src files', async () => {
    const files = await collectFiles(SRC_DIR);
    const violations = [];

    for (const filePath of files) {
      const content = await fs.readFile(filePath, 'utf8');
      const relativePath = path.relative(SRC_DIR, filePath).replaceAll('\\', '/');
      const hit = findFirstMojibakeHit(content);
      if (!hit) continue;

      const token = JSON.stringify(hit.token);
      const fragment = JSON.stringify(hit.fragment);
      violations.push(`${relativePath}:${hit.line} token=${token} fragment=${fragment}`);
    }

    expect(
      violations,
      `Mojibake tokens detected in src files:\n${violations.join('\n')}`
    ).toEqual([]);
  });
});
