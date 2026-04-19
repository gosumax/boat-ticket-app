import express from 'express';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import {
  TELEGRAM_MINI_APP_ASSET_NOT_FOUND_MESSAGE,
  createTelegramMiniAppFrontendRouter,
  TELEGRAM_MINI_APP_HTML_RESPONSE_HEADERS,
  TELEGRAM_MINI_APP_FRONTEND_STALE_ASSET_MESSAGE,
  TELEGRAM_MINI_APP_FRONTEND_UNAVAILABLE_MESSAGE,
} from '../../server/telegram/mini-app-frontend-router.mjs';

const TEMP_PREFIX = 'boat-ticket-telegram-mini-app-frontend-';

function createTempDistDirectory() {
  const directory = mkdtempSync(join(tmpdir(), TEMP_PREFIX));
  return directory;
}

function createFrontendFixture(distDirectory) {
  const assetsDirectory = join(distDirectory, 'assets');
  mkdirSync(assetsDirectory, { recursive: true });
  writeFileSync(
    join(distDirectory, 'telegram-mini-app.html'),
    '<!doctype html><html><body><div id="root"></div><script type="module" src="/assets/mini-app-test.js"></script></body></html>',
    'utf8'
  );
  writeFileSync(
    join(distDirectory, 'index.html'),
    '<!doctype html><html><body><div id="desktop-root"></div></body></html>',
    'utf8'
  );
  writeFileSync(
    join(assetsDirectory, 'mini-app-test.js'),
    'window.__miniAppTestAssetLoaded = true;',
    'utf8'
  );
}

function writeRuntimeEntryFixtureHtml(distDirectory, runtimeEntryUrl) {
  writeFileSync(
    join(distDirectory, 'telegram-mini-app.html'),
    `<!doctype html><html><head><meta name="telegram-mini-app-entry-url" content="${runtimeEntryUrl}"></head><body><div id="root"></div><script>window.__miniAppInlineLoaderReady = true;</script></body></html>`,
    'utf8'
  );
}

describe('telegram mini app frontend router', () => {
  const tempDirectories = [];

  afterEach(() => {
    while (tempDirectories.length > 0) {
      const directory = tempDirectories.pop();
      if (directory) {
        rmSync(directory, { recursive: true, force: true });
      }
    }
  });

  it('serves Mini App HTML at /telegram/mini-app and deep mini-app paths, with static assets from /assets', async () => {
    const distDirectory = createTempDistDirectory();
    tempDirectories.push(distDirectory);
    createFrontendFixture(distDirectory);

    const app = express();
    app.use(createTelegramMiniAppFrontendRouter({ distDirectory }));

    const miniApp = await request(app).get('/telegram/mini-app').query({
      telegram_user_id: '777000111',
    });
    expect(miniApp.status).toBe(200);
    expect(miniApp.text).toContain('<div id="root"></div>');
    expect(miniApp.text).toContain('/assets/mini-app-test.js');
    expect(miniApp.headers['cache-control']).toBe(
      TELEGRAM_MINI_APP_HTML_RESPONSE_HEADERS['cache-control']
    );
    expect(miniApp.headers.pragma).toBe(
      TELEGRAM_MINI_APP_HTML_RESPONSE_HEADERS.pragma
    );
    expect(miniApp.headers.expires).toBe(
      TELEGRAM_MINI_APP_HTML_RESPONSE_HEADERS.expires
    );
    expect(miniApp.headers['surrogate-control']).toBe(
      TELEGRAM_MINI_APP_HTML_RESPONSE_HEADERS['surrogate-control']
    );
    expect(miniApp.headers['x-telegram-mini-app-cache-buster']).toMatch(
      /^[a-z0-9]{12}$/
    );
    expect(miniApp.headers['x-telegram-mini-app-html-id']).toBe(
      'telegram-mini-app.html'
    );

    const miniAppDeepLink = await request(app)
      .get('/telegram/mini-app/my-requests')
      .query({
        tgWebAppData: encodeURIComponent(
          'query_id=qa&user=%7B%22id%22%3A777000111%7D&auth_date=1775815200&hash=test'
        ),
      });
    expect(miniAppDeepLink.status).toBe(200);
    expect(miniAppDeepLink.text).toContain('<div id="root"></div>');

    const miniAppTrailingSlash = await request(app).get('/telegram/mini-app/');
    expect(miniAppTrailingSlash.status).toBe(200);
    expect(miniAppTrailingSlash.text).toContain('<div id="root"></div>');

    const miniAppIndexFilePath = await request(app).get('/telegram/mini-app/index.html');
    expect(miniAppIndexFilePath.status).toBe(200);
    expect(miniAppIndexFilePath.text).toContain('<div id="root"></div>');

    const asset = await request(app).get('/assets/mini-app-test.js');
    expect(asset.status).toBe(200);
    expect(asset.headers['content-type']).toMatch(/text\/javascript/);
    expect(asset.text).toContain('__miniAppTestAssetLoaded');

    const nestedAssetAlias = await request(app).get(
      '/telegram/mini-app/assets/mini-app-test.js'
    );
    expect(nestedAssetAlias.status).toBe(200);
    expect(nestedAssetAlias.headers['content-type']).toMatch(/text\/javascript/);
    expect(nestedAssetAlias.text).toContain('__miniAppTestAssetLoaded');

    const telegramAssetAlias = await request(app).get('/telegram/assets/mini-app-test.js');
    expect(telegramAssetAlias.status).toBe(200);
    expect(telegramAssetAlias.headers['content-type']).toMatch(/text\/javascript/);
    expect(telegramAssetAlias.text).toContain('__miniAppTestAssetLoaded');
  });

  it('returns a terminal non-HTML 404 when a Mini App asset is missing', async () => {
    const distDirectory = createTempDistDirectory();
    tempDirectories.push(distDirectory);
    createFrontendFixture(distDirectory);

    const app = express();
    app.use(createTelegramMiniAppFrontendRouter({ distDirectory }));

    const missingRootAsset = await request(app).get('/assets/missing-mini-app-test.js');
    expect(missingRootAsset.status).toBe(404);
    expect(missingRootAsset.headers['content-type']).toMatch(/text\/plain/);
    expect(missingRootAsset.text).toContain(TELEGRAM_MINI_APP_ASSET_NOT_FOUND_MESSAGE);

    const missingNestedAlias = await request(app).get(
      '/telegram/mini-app/assets/missing-mini-app-test.js'
    );
    expect(missingNestedAlias.status).toBe(404);
    expect(missingNestedAlias.headers['content-type']).toMatch(/text\/plain/);
    expect(missingNestedAlias.text).toContain(
      TELEGRAM_MINI_APP_ASSET_NOT_FOUND_MESSAGE
    );
    expect(missingNestedAlias.text).not.toContain('<!doctype html>');
  });

  it('refuses to serve buyer HTML when it points to a missing asset', async () => {
    const distDirectory = createTempDistDirectory();
    tempDirectories.push(distDirectory);
    createFrontendFixture(distDirectory);
    rmSync(join(distDirectory, 'assets', 'mini-app-test.js'));

    const app = express();
    app.use(createTelegramMiniAppFrontendRouter({ distDirectory }));

    const response = await request(app).get('/telegram/mini-app');
    expect(response.status).toBe(503);
    expect(response.headers['content-type']).toMatch(/text\/plain/);
    expect(response.text).toContain(TELEGRAM_MINI_APP_FRONTEND_STALE_ASSET_MESSAGE);
    expect(response.text).toContain('/assets/mini-app-test.js');
  });

  it('refuses to serve buyer HTML when the inline loader meta points to a missing asset', async () => {
    const distDirectory = createTempDistDirectory();
    tempDirectories.push(distDirectory);
    createFrontendFixture(distDirectory);
    writeRuntimeEntryFixtureHtml(
      distDirectory,
      '/telegram/assets/telegramMiniAppRuntimeEntry-missing.js'
    );
    rmSync(join(distDirectory, 'assets', 'mini-app-test.js'));

    const app = express();
    app.use(createTelegramMiniAppFrontendRouter({ distDirectory }));

    const response = await request(app).get('/telegram/mini-app');
    expect(response.status).toBe(503);
    expect(response.headers['content-type']).toMatch(/text\/plain/);
    expect(response.text).toContain(TELEGRAM_MINI_APP_FRONTEND_STALE_ASSET_MESSAGE);
    expect(response.text).toContain(
      '/telegram/assets/telegramMiniAppRuntimeEntry-missing.js'
    );
  });

  it('serves runtime entry assets as JavaScript for both root and telegram asset aliases', async () => {
    const distDirectory = createTempDistDirectory();
    tempDirectories.push(distDirectory);
    createFrontendFixture(distDirectory);
    writeRuntimeEntryFixtureHtml(
      distDirectory,
      '/telegram/assets/telegramMiniAppRuntimeEntry-test.js'
    );
    writeFileSync(
      join(distDirectory, 'assets', 'telegramMiniAppRuntimeEntry-test.js'),
      'console.log("mini-app-runtime-entry-loaded");',
      'utf8'
    );

    const app = express();
    app.use(createTelegramMiniAppFrontendRouter({ distDirectory }));

    const aliasAsset = await request(app).get(
      '/telegram/assets/telegramMiniAppRuntimeEntry-test.js'
    );
    expect(aliasAsset.status).toBe(200);
    expect(aliasAsset.headers['content-type']).toMatch(/text\/javascript/);
    expect(aliasAsset.text.startsWith('<!doctype html>')).toBe(false);
    expect(aliasAsset.text).toContain('mini-app-runtime-entry-loaded');

    const rootAsset = await request(app).get(
      '/assets/telegramMiniAppRuntimeEntry-test.js'
    );
    expect(rootAsset.status).toBe(200);
    expect(rootAsset.headers['content-type']).toMatch(/text\/javascript/);
    expect(rootAsset.text.startsWith('<!doctype html>')).toBe(false);
    expect(rootAsset.text).toContain('mini-app-runtime-entry-loaded');
  });

  it('returns terminal 404 text for missing runtime entry asset aliases instead of HTML', async () => {
    const distDirectory = createTempDistDirectory();
    tempDirectories.push(distDirectory);
    createFrontendFixture(distDirectory);

    const app = express();
    app.use(createTelegramMiniAppFrontendRouter({ distDirectory }));

    const missingAliasAsset = await request(app).get(
      '/telegram/assets/telegramMiniAppRuntimeEntry-missing.js'
    );
    expect(missingAliasAsset.status).toBe(404);
    expect(missingAliasAsset.headers['content-type']).toMatch(/text\/plain/);
    expect(missingAliasAsset.text).toContain(TELEGRAM_MINI_APP_ASSET_NOT_FOUND_MESSAGE);
    expect(missingAliasAsset.text.startsWith('<!doctype html>')).toBe(false);
  });

  it('rewrites stale runtime-entry asset aliases to the current runtime entry file', async () => {
    const distDirectory = createTempDistDirectory();
    tempDirectories.push(distDirectory);
    createFrontendFixture(distDirectory);
    writeRuntimeEntryFixtureHtml(
      distDirectory,
      '/telegram/assets/telegramMiniAppRuntimeEntry-current.js'
    );
    writeFileSync(
      join(distDirectory, 'assets', 'telegramMiniAppRuntimeEntry-current.js'),
      'window.__miniAppRuntimeCurrent = true;',
      'utf8'
    );
    writeFileSync(
      join(distDirectory, 'assets', 'telegramMiniAppRuntimeEntry-stale.js'),
      'window.__miniAppRuntimeStale = true;',
      'utf8'
    );

    const app = express();
    app.use(createTelegramMiniAppFrontendRouter({ distDirectory }));

    const staleAlias = await request(app).get(
      '/telegram/assets/telegramMiniAppRuntimeEntry-stale.js'
    );
    expect(staleAlias.status).toBe(200);
    expect(staleAlias.text).toContain('__miniAppRuntimeCurrent');
    expect(staleAlias.text).not.toContain('__miniAppRuntimeStale');
    expect(staleAlias.headers['x-telegram-mini-app-asset-canonical']).toBe(
      '/telegramMiniAppRuntimeEntry-current.js'
    );
  });

  it('rewrites stale mini-app stylesheet requests from mini-app context to the current stylesheet asset', async () => {
    const distDirectory = createTempDistDirectory();
    tempDirectories.push(distDirectory);
    createFrontendFixture(distDirectory);
    writeFileSync(
      join(distDirectory, 'telegram-mini-app.html'),
      '<!doctype html><html><head><link rel="stylesheet" href="/telegram/assets/index-current.css"></head><body><div id="root"></div><script type="module" src="/assets/mini-app-test.js"></script></body></html>',
      'utf8'
    );
    writeFileSync(
      join(distDirectory, 'assets', 'index-current.css'),
      'body{background:#010203;}',
      'utf8'
    );
    writeFileSync(
      join(distDirectory, 'assets', 'index-stale.css'),
      'body{background:#ffffff;}',
      'utf8'
    );

    const app = express();
    app.use(createTelegramMiniAppFrontendRouter({ distDirectory }));

    const staleStylesheet = await request(app)
      .get('/assets/index-stale.css')
      .set('referer', 'https://example.test/telegram/mini-app?mini_app_v=stale');
    expect(staleStylesheet.status).toBe(200);
    expect(staleStylesheet.text).toContain('#010203');
    expect(staleStylesheet.text).not.toContain('#ffffff');
    expect(staleStylesheet.headers['x-telegram-mini-app-asset-canonical']).toBe(
      '/index-current.css'
    );
  });

  it('redirects legacy telegram-mini-app.html requests to the canonical mini-app route', async () => {
    const distDirectory = createTempDistDirectory();
    tempDirectories.push(distDirectory);
    createFrontendFixture(distDirectory);

    const app = express();
    app.use(createTelegramMiniAppFrontendRouter({ distDirectory }));

    const response = await request(app)
      .get('/telegram-mini-app.html?telegram_user_id=777000111')
      .redirects(0);
    expect(response.status).toBe(302);
    expect(response.headers.location).toContain('/telegram/mini-app?');
    expect(response.headers.location).toContain('telegram_user_id=777000111');
    expect(response.headers.location).toContain('mini_app_v=');
  });

  it('redirects stale mini_app_v query values to the current cache-buster value', async () => {
    const distDirectory = createTempDistDirectory();
    tempDirectories.push(distDirectory);
    createFrontendFixture(distDirectory);

    const app = express();
    app.use(createTelegramMiniAppFrontendRouter({ distDirectory }));

    const initial = await request(app).get('/telegram/mini-app');
    const currentCacheBuster = initial.headers['x-telegram-mini-app-cache-buster'];
    expect(currentCacheBuster).toMatch(/^[a-z0-9]{12}$/);

    const redirected = await request(app)
      .get('/telegram/mini-app')
      .query({
        mini_app_v: 'stale-cache-buster',
        telegram_user_id: '777000111',
      })
      .redirects(0);
    expect(redirected.status).toBe(302);
    expect(redirected.headers.location).toContain(
      `mini_app_v=${currentCacheBuster}`
    );
    expect(redirected.headers.location).toContain('telegram_user_id=777000111');
  });

  it('serves the current buyer build output after dist files change without restarting the router', async () => {
    const distDirectory = createTempDistDirectory();
    tempDirectories.push(distDirectory);
    createFrontendFixture(distDirectory);

    const app = express();
    app.use(createTelegramMiniAppFrontendRouter({ distDirectory }));

    const initialHtml = await request(app).get('/telegram/mini-app');
    expect(initialHtml.status).toBe(200);
    expect(initialHtml.text).toContain('/assets/mini-app-test.js');

    rmSync(join(distDirectory, 'assets', 'mini-app-test.js'));
    writeFileSync(
      join(distDirectory, 'telegram-mini-app.html'),
      '<!doctype html><html><body><div id="root"></div><script type="module" src="/assets/mini-app-next.js"></script></body></html>',
      'utf8'
    );
    writeFileSync(
      join(distDirectory, 'assets', 'mini-app-next.js'),
      'window.__miniAppNextAssetLoaded = true;',
      'utf8'
    );

    const updatedHtml = await request(app).get('/telegram/mini-app');
    expect(updatedHtml.status).toBe(200);
    expect(updatedHtml.text).toContain('/assets/mini-app-next.js');
    expect(updatedHtml.text).not.toContain('/assets/mini-app-test.js');

    const updatedAsset = await request(app).get('/assets/mini-app-next.js');
    expect(updatedAsset.status).toBe(200);
    expect(updatedAsset.headers['content-type']).toMatch(/text\/javascript/);
    expect(updatedAsset.text).toContain('__miniAppNextAssetLoaded');

    const removedAsset = await request(app).get('/assets/mini-app-test.js');
    expect(removedAsset.status).toBe(404);
    expect(removedAsset.headers['content-type']).toMatch(/text\/plain/);
    expect(removedAsset.text).toContain(TELEGRAM_MINI_APP_ASSET_NOT_FOUND_MESSAGE);
  });

  it('returns an explicit 503 when Mini App frontend build is unavailable', async () => {
    const distDirectory = createTempDistDirectory();
    tempDirectories.push(distDirectory);

    const app = express();
    app.use(createTelegramMiniAppFrontendRouter({ distDirectory }));

    const response = await request(app).get('/telegram/mini-app');
    expect(response.status).toBe(503);
    expect(response.text).toContain(TELEGRAM_MINI_APP_FRONTEND_UNAVAILABLE_MESSAGE);
  });
});
