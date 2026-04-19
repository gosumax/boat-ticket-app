import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const desktopAppSource = readFileSync(new URL('../../src/DesktopApp.jsx', import.meta.url), 'utf8');
const ownerViewSource = readFileSync(new URL('../../src/views/OwnerView.jsx', import.meta.url), 'utf8');

describe('owner telegram access seam', () => {
  it('does not expose owner-ui telegram manual fallback route in App router', () => {
    expect(desktopAppSource).not.toMatch(/path="\/owner-ui\/telegram-manual-fallback"/);
    expect(desktopAppSource).not.toMatch(/OwnerTelegramManualFallbackView/);
  });

  it('does not render manual fallback quick-link button in owner view', () => {
    expect(ownerViewSource).not.toMatch(/owner-open-telegram-manual-fallback/);
    expect(ownerViewSource).not.toMatch(/\/owner-ui\/telegram-manual-fallback/);
    expect(ownerViewSource).not.toMatch(/Telegram queue/);
  });

  it('keeps Telegram operator tooling in admin route space', () => {
    expect(desktopAppSource).toMatch(/path="\/admin\/telegram-analytics"/);
    expect(desktopAppSource).toMatch(/path="\/admin\/telegram-content"/);
    expect(desktopAppSource).toMatch(/path="\/admin\/telegram-sources"/);
  });
});
