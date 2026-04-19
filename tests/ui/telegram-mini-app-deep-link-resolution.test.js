import { describe, expect, it } from 'vitest';
import { resolveInitialMiniAppSection } from '../../src/telegram/TelegramMiniApp.jsx';

describe('telegram mini app deep-link section resolution', () => {
  it('maps base mini app paths to catalog section', () => {
    expect(resolveInitialMiniAppSection('/telegram/mini-app')).toBe('catalog');
    expect(resolveInitialMiniAppSection('/telegram/mini-app/')).toBe('catalog');
    expect(resolveInitialMiniAppSection('/telegram/mini-app/index.html')).toBe('catalog');
  });

  it('maps my-requests and my-tickets deep links to guest tickets section', () => {
    expect(resolveInitialMiniAppSection('/telegram/mini-app/my-requests')).toBe(
      'my_tickets'
    );
    expect(resolveInitialMiniAppSection('/telegram/mini-app/my-tickets')).toBe(
      'my_tickets'
    );
  });
});
