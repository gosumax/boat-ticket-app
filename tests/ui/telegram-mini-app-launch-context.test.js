import { afterEach, describe, expect, it } from 'vitest';
import {
  hasTelegramMiniAppLaunchHint,
  readTelegramMiniAppInitDataRaw,
  readTelegramMiniAppUserId,
  resolveTelegramMiniAppLaunchTarget,
} from '../../src/telegram/mini-app-identity.js';

const originalWindow = global.window;

afterEach(() => {
  global.window = originalWindow;
});

describe('telegram mini app launch context detection', () => {
  it('detects launch hints from Telegram hash payloads', () => {
    global.window = {
      location: {
        pathname: '/',
        search: '',
        hash: '#tgWebAppData=encoded-init-data&tgWebAppPlatform=ios',
      },
    };

    expect(hasTelegramMiniAppLaunchHint()).toBe(true);
  });

  it('detects launch hints from Telegram runtime webapp context', () => {
    global.window = {
      location: {
        pathname: '/',
        search: '',
        hash: '',
      },
      Telegram: {
        WebApp: {
          initData: 'query_id=qa&user=%7B%22id%22%3A777%7D&hash=test',
        },
      },
    };

    expect(hasTelegramMiniAppLaunchHint()).toBe(true);
  });

  it('resolves hash deep-link launch target into a canonical mini-app path', () => {
    global.window = {
      location: {
        pathname: '/',
        search: '',
        hash: '#/telegram/mini-app/my-requests?tgWebAppData=encoded-init-data&tgWebAppVersion=8.0',
      },
    };

    expect(resolveTelegramMiniAppLaunchTarget()).toBe(
      '/telegram/mini-app/my-requests#tgWebAppData=encoded-init-data&tgWebAppVersion=8.0'
    );
  });

  it('resolves root launch into mini-app base path while preserving query/hash payload', () => {
    global.window = {
      location: {
        pathname: '/',
        search: '?telegram_user_id=777000111',
        hash: '#tgWebAppPlatform=android',
      },
    };

    expect(resolveTelegramMiniAppLaunchTarget()).toBe(
      '/telegram/mini-app?telegram_user_id=777000111#tgWebAppPlatform=android'
    );
  });

  it('does not mark unrelated routes as mini-app launches', () => {
    global.window = {
      location: {
        pathname: '/admin',
        search: '',
        hash: '',
      },
    };

    expect(hasTelegramMiniAppLaunchHint()).toBe(false);
  });

  it('keeps identity resolution alive when sessionStorage is blocked in constrained iOS webviews', () => {
    const rawInitData = 'query_id=test&user=%7B%22id%22%3A777123%7D&hash=signature';

    global.window = {
      location: {
        pathname: '/telegram/mini-app',
        search: `?tgWebAppData=${encodeURIComponent(rawInitData)}`,
        hash: '',
      },
      get sessionStorage() {
        throw new Error('SecurityError');
      },
    };

    expect(readTelegramMiniAppInitDataRaw()).toBe(rawInitData);
    expect(readTelegramMiniAppUserId()).toBe('777123');
  });
});
