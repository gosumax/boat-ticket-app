import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const viteConfigSource = readFileSync(new URL('../../vite.config.js', import.meta.url), 'utf8');

describe('telegram mini app webkit build target contract', () => {
  it('keeps Vite transforms pinned to an ES2019-compatible target for older WebKit', () => {
    expect(viteConfigSource).toMatch(/const webkitCompatibilityTarget = 'es2019'/);
    expect(viteConfigSource).toMatch(/esbuild:\s*\{\s*target:\s*webkitCompatibilityTarget/s);
    expect(viteConfigSource).toMatch(/build:\s*\{\s*target:\s*webkitCompatibilityTarget/s);
    expect(viteConfigSource).toMatch(/telegram-mini-app\.html/);
    expect(viteConfigSource).toMatch(
      /optimizeDeps:\s*\{\s*esbuildOptions:\s*\{\s*target:\s*webkitCompatibilityTarget/s
    );
  });
});
