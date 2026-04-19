const MINI_APP_BASE_PATH = '/telegram/mini-app';

function getRuntime() {
  if (typeof window === 'undefined') {
    return null;
  }
  return window.__TELEGRAM_MINI_APP_BOOTSTRAP__ || null;
}

function normalizeError(error) {
  if (!error) {
    return null;
  }
  if (typeof error === 'string') {
    return { message: error };
  }
  return {
    name: typeof error.name === 'string' ? error.name : null,
    message: typeof error.message === 'string' ? error.message : String(error),
    stack: typeof error.stack === 'string' ? error.stack : null,
  };
}

export function captureModuleLoadError(moduleName, error) {
  if (typeof window === 'undefined') {
    return;
  }
  const runtime = getRuntime();
  if (!runtime || typeof runtime.fail !== 'function') {
    return;
  }
  const errorInfo = normalizeError(error);
  runtime.fail(`module evaluation error: ${moduleName}`, errorInfo);
  console.error(`[MODULE_ERROR] ${moduleName}:`, errorInfo);
}

export function isTelegramMiniAppPath(pathname = null) {
  if (pathname === null) {
    if (typeof window === 'undefined') {
      return false;
    }
    pathname = window.location?.pathname || '';
  }
  return String(pathname || '').startsWith(MINI_APP_BASE_PATH);
}

export function markMiniAppBootstrapCheckpoint(stage, detail = null) {
  const runtime = getRuntime();
  if (!runtime || typeof runtime.mark !== 'function') {
    return;
  }
  runtime.mark(stage, detail);
}

export function markMiniAppBootstrapCheckpointOnce(stage, detail = null) {
  const runtime = getRuntime();
  if (!runtime || typeof runtime.markOnce !== 'function') {
    markMiniAppBootstrapCheckpoint(stage, detail);
    return;
  }
  runtime.markOnce(stage, detail);
}

export function completeMiniAppBootstrap() {
  const runtime = getRuntime();
  if (!runtime || typeof runtime.complete !== 'function') {
    return;
  }
  runtime.complete();
}

export function reportMiniAppBootstrapFailure(stage, error) {
  const runtime = getRuntime();
  if (!runtime || typeof runtime.fail !== 'function') {
    return;
  }
  runtime.fail(stage, normalizeError(error));
}

export function setupModuleLoadDiagnostics() {
  if (typeof window === 'undefined') {
    return;
  }
  
  window.addEventListener('error', (event) => {
    const target = event.target;
    if (target && target.tagName === 'SCRIPT' && target.src) {
      const runtime = getRuntime();
      if (runtime && typeof runtime.fail === 'function') {
        runtime.fail(`script error: ${target.src}`, {
          message: event.message || 'Script load error',
          src: target.src,
        });
      }
    }
  }, true);

  window.addEventListener('unhandledrejection', (event) => {
    const runtime = getRuntime();
    if (runtime && typeof runtime.fail === 'function') {
      const reason = event.reason;
      runtime.fail('unhandled rejection during module load', {
        message: reason?.message || String(reason || 'Unknown rejection'),
      });
    }
  }, true);

  console.log('[DIAGNOSTICS] Module load diagnostics installed');
}
