import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const miniAppHtmlSource = readFileSync(new URL('../../telegram-mini-app.html', import.meta.url), 'utf8');
const mainSource = readFileSync(new URL('../../src/main.jsx', import.meta.url), 'utf8');
const appSource = readFileSync(new URL('../../src/App.jsx', import.meta.url), 'utf8');
const miniAppSource = readFileSync(new URL('../../src/telegram/TelegramMiniApp.jsx', import.meta.url), 'utf8');

describe('telegram mini app bootstrap diagnostics contract', () => {
  it('keeps a pre-React buyer fallback shell and deterministic entry diagnostics in telegram-mini-app.html', () => {
    expect(miniAppHtmlSource).toContain('href="/src/index.css"');
    expect(miniAppHtmlSource).toContain('href="/src/telegram/mini-app.css"');
    expect(miniAppHtmlSource).toContain('__TELEGRAM_MINI_APP_BOOTSTRAP__');
    expect(miniAppHtmlSource).toContain('window.onerror');
    expect(miniAppHtmlSource).toMatch(/addEventListener\(\s*'error'/);
    expect(miniAppHtmlSource).toContain('unhandledrejection');
    expect(miniAppHtmlSource).toContain('telegram-mini-app-html-id');
    expect(miniAppHtmlSource).toContain('telegram-mini-app-build-marker');
    expect(miniAppHtmlSource).toContain('__TELEGRAM_MINI_APP_BUILD_MARKER__');
    expect(miniAppHtmlSource).toContain('telegram-mini-app-entry-url');
    expect(miniAppHtmlSource).toContain('readEntryUrlFromMeta');
    expect(miniAppHtmlSource).toContain('entry module loader script evaluated');
    expect(miniAppHtmlSource).toContain('html identity marker discovered');
    expect(miniAppHtmlSource).toContain('build marker discovered');
    expect(miniAppHtmlSource).toContain('stylesheet asset url discovered');
    expect(miniAppHtmlSource).toContain('stylesheet request discovered');
    expect(miniAppHtmlSource).toContain('stylesheet request completed');
    expect(miniAppHtmlSource).toContain('entry import waiting for DOMContentLoaded');
    expect(miniAppHtmlSource).toContain('entry URL discovered');
    expect(miniAppHtmlSource).toContain('import(entryUrl) started');
    expect(miniAppHtmlSource).toContain('import(entryUrl) resolved');
    expect(miniAppHtmlSource).toContain('import(entryUrl) rejected');
    expect(miniAppHtmlSource).toContain('import(entryUrl) timed out');
    expect(miniAppHtmlSource).toContain('HTML identity marker');
    expect(miniAppHtmlSource).toContain('Build marker');
    expect(miniAppHtmlSource).toContain('Stylesheet asset URL(s)');
    expect(miniAppHtmlSource).toContain('Tracked stylesheet request state(s)');
    expect(miniAppHtmlSource).toContain('Entry URL used');
    expect(miniAppHtmlSource).toContain('Exact module responsible');
    expect(miniAppHtmlSource).toContain('Immediate import probe results');
    expect(miniAppHtmlSource).toContain('entry source imports parsed');
    expect(miniAppHtmlSource).toContain('shouldDisplayBootstrapFallback');
    expect(miniAppHtmlSource).toContain("!this.hasCheckpoint('main.jsx before React mount')");
    expect(miniAppHtmlSource).not.toContain('import.meta.glob');
    expect(miniAppHtmlSource).not.toContain('<script type="module"');
  });

  it('keeps exactly one inline buyer bootstrap path ahead of import(entryUrl)', () => {
    const scriptTagMatches = Array.from(miniAppHtmlSource.matchAll(/<script\b([^>]*)>/g));
    const bootstrapInitIndex = miniAppHtmlSource.indexOf(
      'telegram-mini-app.html bootstrap initialized'
    );
    const entryMetaIndex = miniAppHtmlSource.indexOf(
      'name="telegram-mini-app-entry-url"'
    );
    const loaderScriptIndex = scriptTagMatches[1]?.index ?? -1;

    expect(scriptTagMatches).toHaveLength(2);
    expect(scriptTagMatches[0][1]).not.toContain('type="module"');
    expect(scriptTagMatches[1][1]).not.toContain('type="module"');
    expect(bootstrapInitIndex).toBeGreaterThan(-1);
    expect(entryMetaIndex).toBeGreaterThan(bootstrapInitIndex);
    expect(loaderScriptIndex).toBeGreaterThan(entryMetaIndex);
  });

  it('marks the required buyer bootstrap checkpoints through main, App, and TelegramMiniApp', () => {
    expect(mainSource).toContain('main.jsx before React mount');
    expect(appSource).toContain('App.jsx render reached');
    expect(miniAppSource).toContain('TelegramMiniApp module evaluated');
    expect(miniAppSource).toContain('TelegramMiniApp function render entered');
    expect(miniAppSource).toContain('TelegramMiniApp first return JSX reached');
    expect(miniAppSource).toContain('TelegramMiniApp first useEffect entered');
    expect(miniAppSource).toContain('catalog load started');
    expect(miniAppSource).toContain('my-requests load started');
    expect(miniAppSource).toContain('telegram-mini-app-runtime-diagnostics');
    expect(miniAppSource).toContain('Active buyer runtime markers');
    expect(miniAppSource).toContain('Stylesheet URL(s)');
    expect(miniAppSource).toContain('Entry import result');
    expect(miniAppSource).toContain('readMiniAppRuntimeDiagnosticsSnapshot');
  });
});
