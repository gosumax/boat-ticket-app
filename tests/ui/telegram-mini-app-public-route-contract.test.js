import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const desktopAppSource = readFileSync(new URL('../../src/DesktopApp.jsx', import.meta.url), 'utf8');

describe('telegram mini app public route contract', () => {
  it('keeps guest mini app mounted on wildcard mini-app path to avoid auth fallback redirects', () => {
    expect(desktopAppSource).toMatch(/path="\/telegram\/mini-app\/\*"/);
    expect(desktopAppSource).not.toMatch(/path="\/telegram\/mini-app"\s+element=\{<TelegramMiniApp/);
  });

  it('keeps role-home wildcard redirect route for non-telegram paths only', () => {
    expect(desktopAppSource).toMatch(/path="\*"\s+element=\{<RoleHomeRedirect \/>/);
  });

  it('keeps telegram launch hint guard before role-based fallback redirects', () => {
    expect(desktopAppSource).toMatch(/hasTelegramMiniAppLaunchHint\(\)/);
    expect(desktopAppSource).toMatch(/resolveTelegramMiniAppLaunchTarget\(\)/);
  });
});
