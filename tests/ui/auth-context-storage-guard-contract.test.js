import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const authContextSource = readFileSync(
  new URL('../../src/contexts/AuthContext.jsx', import.meta.url),
  'utf8'
);

describe('auth context storage guard contract', () => {
  it('uses guarded token probe instead of direct localStorage access in bootstrap', () => {
    expect(authContextSource).toMatch(/const token = readStoredTokenSafe\(\);/);
    expect(authContextSource).not.toMatch(/const token = localStorage\.getItem\('token'\);/);
  });
});
