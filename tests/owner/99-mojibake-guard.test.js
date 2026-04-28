import { describe, it, expect } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SRC_DIR = path.resolve(__dirname, '../../src');
const MOJIBAKE_TOKENS = [
  'РІР‚',
  'РІвЂ ',
  '\uFFFD',
  'пїЅ',
  'Р СњР ',
  'Р РЋР ',
  'Р СџРЎ',
  'Р Р†Р вЂљ',
  'Р Р†РІР‚В ',
  'Р В РЎСљР В ',
  'Р В Р Р‹Р В ',
];

const CP1251_DECODER = new TextDecoder('windows-1251');
const UTF8_FATAL_DECODER = new TextDecoder('utf-8', { fatal: true });
const CP1251_CHAR_TO_BYTE = new Map();

for (let byte = 0; byte < 256; byte += 1) {
  const char = CP1251_DECODER.decode(Uint8Array.of(byte));
  if (!CP1251_CHAR_TO_BYTE.has(char)) {
    CP1251_CHAR_TO_BYTE.set(char, byte);
  }
}

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

function buildLineHit(content, index, token, decodedFragment = null) {
  const line = content.slice(0, index).split('\n').length;
  const lineStart = content.lastIndexOf('\n', index - 1) + 1;
  const lineEnd = content.indexOf('\n', index);
  const rawLine = content.slice(lineStart, lineEnd === -1 ? content.length : lineEnd);
  const fragment = rawLine.trim().slice(0, 180);

  return {
    token,
    line,
    fragment,
    decodedFragment,
  };
}

function findFirstMojibakeTokenHit(content) {
  let first = null;

  for (const token of MOJIBAKE_TOKENS) {
    const index = content.indexOf(token);
    if (index < 0) continue;
    if (!first || index < first.index) {
      first = { token, index };
    }
  }

  if (!first) return null;
  return buildLineHit(content, first.index, first.token);
}

function isLikelyBinaryBuffer(buffer) {
  const sample = buffer.subarray(0, Math.min(buffer.length, 8000));
  return sample.includes(0);
}

function decodeCp1251RunAsUtf8(run) {
  const bytes = [];
  for (const char of run) {
    const byte = CP1251_CHAR_TO_BYTE.get(char);
    if (byte === undefined) {
      return null;
    }
    bytes.push(byte);
  }

  try {
    return UTF8_FATAL_DECODER.decode(Uint8Array.from(bytes));
  } catch {
    return null;
  }
}

function findFirstReversibleCp1251Utf8Hit(content) {
  const runPattern = /[^\x00-\x7F]{3,}/g;
  let match;

  while ((match = runPattern.exec(content)) !== null) {
    const sourceRun = match[0];
    const decodedRun = decodeCp1251RunAsUtf8(sourceRun);
    if (!decodedRun || decodedRun === sourceRun) {
      continue;
    }

    const sourceLooksMojibake =
      /[\u0420\u0421\u0432\u0440\u043F\u040E\u0406\u0407\u0403\u0453]/u.test(sourceRun)
      || /[\u201A\u201E\u2020\u2021\u20AC\u2030\u2122]/u.test(sourceRun);
    if (!sourceLooksMojibake) {
      continue;
    }

    const decodedLooksLikeHumanText =
      /[А-Яа-яЁё]/u.test(decodedRun)
      || /[₽№•—«»▲▼👤🟠]/u.test(decodedRun);
    if (!decodedLooksLikeHumanText) {
      continue;
    }

    return buildLineHit(
      content,
      match.index,
      'reversible_cp1251_utf8',
      decodedRun.slice(0, 120)
    );
  }

  return null;
}

describe('Mojibake guard for src (consolidated)', () => {
  it('has no forbidden mojibake tokens in src files', async () => {
    const files = await collectFiles(SRC_DIR);
    const violations = [];

    for (const filePath of files) {
      const fileBuffer = await fs.readFile(filePath);
      if (isLikelyBinaryBuffer(fileBuffer)) continue;

      const content = fileBuffer.toString('utf8');
      const relativePath = path.relative(SRC_DIR, filePath).replaceAll('\\', '/');
      const hit =
        findFirstMojibakeTokenHit(content) || findFirstReversibleCp1251Utf8Hit(content);
      if (!hit) continue;

      const token = JSON.stringify(hit.token);
      const fragment = JSON.stringify(hit.fragment);
      const decoded = hit.decodedFragment
        ? ` decoded=${JSON.stringify(hit.decodedFragment)}`
        : '';
      violations.push(`${relativePath}:${hit.line} token=${token} fragment=${fragment}${decoded}`);
    }

    expect(
      violations,
      `Mojibake tokens detected in src files:\n${violations.join('\n')}`
    ).toEqual([]);
  });

  it('detects reversible cp1251-utf8 mojibake runs for Russian UI text', () => {
    const source = "const label = 'РЎРІСЏР·СЊ';";
    const hit = findFirstReversibleCp1251Utf8Hit(source);

    expect(hit).not.toBeNull();
    expect(hit?.token).toBe('reversible_cp1251_utf8');
    expect(hit?.decodedFragment).toContain('Связь');
  });
});
