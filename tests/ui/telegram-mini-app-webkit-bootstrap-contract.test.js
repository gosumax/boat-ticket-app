import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const desktopAppSource = readFileSync(new URL('../../src/DesktopApp.jsx', import.meta.url), 'utf8');

describe('telegram mini app webkit bootstrap contract', () => {
  it('keeps owner screens lazy-loaded so buyer mini app bootstrap does not eagerly parse owner bundle', () => {
    expect(desktopAppSource).toMatch(/const OwnerView = lazy\(\(\) => import\('\.\/views\/OwnerView'\)\);/);
    expect(desktopAppSource).toMatch(
      /const OwnerMoneyView = lazy\(\(\) => import\('\.\/views\/OwnerMoneyView'\)\);/
    );
    expect(desktopAppSource).not.toMatch(/import OwnerView from '\.\/views\/OwnerView';/);
    expect(desktopAppSource).not.toMatch(/import OwnerMoneyView from '\.\/views\/OwnerMoneyView';/);
  });

  it('wraps owner routes with Suspense fallback to keep route behavior deterministic', () => {
    expect(desktopAppSource).toMatch(/path="\/owner-ui"/);
    expect(desktopAppSource).toMatch(/path="\/owner-ui\/money"/);
    expect(desktopAppSource).toMatch(/<Suspense fallback=\{null\}>/);
    expect(desktopAppSource).toMatch(/<OwnerView \/>/);
    expect(desktopAppSource).toMatch(/<OwnerMoneyView \/>/);
  });
});
