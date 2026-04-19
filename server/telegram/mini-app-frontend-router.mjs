import express from 'express';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import {
  TELEGRAM_MINI_APP_CACHE_BUSTER_QUERY_KEY,
  resolveTelegramMiniAppCacheBuster,
  resolveTelegramMiniAppDistDirectory,
} from './mini-app-cache-buster.mjs';

export const TELEGRAM_MINI_APP_FRONTEND_UNAVAILABLE_MESSAGE =
  'Telegram Mini App frontend build is unavailable.';
export const TELEGRAM_MINI_APP_ASSET_NOT_FOUND_MESSAGE =
  'Telegram Mini App asset was not found.';
export const TELEGRAM_MINI_APP_FRONTEND_STALE_ASSET_MESSAGE =
  'Telegram Mini App frontend HTML references missing build assets.';
export const TELEGRAM_MINI_APP_HTML_ID = 'telegram-mini-app.html';
export const TELEGRAM_MINI_APP_HTML_ID_META_NAME = 'telegram-mini-app-html-id';
export const TELEGRAM_MINI_APP_BUILD_MARKER_META_NAME =
  'telegram-mini-app-build-marker';
export const TELEGRAM_MINI_APP_HTML_CACHE_CONTROL_HEADER_VALUE =
  'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0';
export const TELEGRAM_MINI_APP_HTML_RESPONSE_HEADERS = Object.freeze({
  'cache-control': TELEGRAM_MINI_APP_HTML_CACHE_CONTROL_HEADER_VALUE,
  pragma: 'no-cache',
  expires: '0',
  'surrogate-control': 'no-store',
});
export const TELEGRAM_MINI_APP_ASSET_RESPONSE_HEADERS = Object.freeze({
  'cache-control': TELEGRAM_MINI_APP_HTML_CACHE_CONTROL_HEADER_VALUE,
  pragma: 'no-cache',
  expires: '0',
  'surrogate-control': 'no-store',
});
const TELEGRAM_MINI_APP_ASSET_REFERENCE_PATTERN =
  /(?:src|href|content)="((?:\/assets|\/telegram\/assets|\/telegram\/mini-app\/assets)\/[^"]+)"/g;
const TELEGRAM_MINI_APP_ROUTE_PATTERN = /^\/telegram\/mini-app(?:\/.*)?$/;
const TELEGRAM_MINI_APP_RUNTIME_ENTRY_FILE_PATTERN =
  /^telegramMiniAppRuntimeEntry-[A-Za-z0-9_-]+\.js$/;
const TELEGRAM_MINI_APP_STYLESHEET_FILE_PATTERN = /^index-[A-Za-z0-9_-]+\.css$/;

function normalizeString(value) {
  const normalized = String(value ?? '').trim();
  return normalized || null;
}

function normalizeMiniAppAssetReferencePath(assetPath) {
  const normalizedAssetPath = String(assetPath || '').trim();

  if (normalizedAssetPath.startsWith('/telegram/mini-app/assets/')) {
    return normalizedAssetPath.replace('/telegram/mini-app/assets/', '/assets/');
  }

  if (normalizedAssetPath.startsWith('/telegram/assets/')) {
    return normalizedAssetPath.replace('/telegram/assets/', '/assets/');
  }

  return normalizedAssetPath;
}

function extractAssetFileName(assetPath) {
  const normalizedAssetPath = normalizeMiniAppAssetReferencePath(assetPath);
  if (!normalizedAssetPath.startsWith('/assets/')) {
    return null;
  }

  return normalizeString(normalizedAssetPath.replace('/assets/', ''));
}

function resolveMiniAppAssetFilePath(resolvedDistDirectory, assetPath) {
  const normalizedAssetPath = normalizeMiniAppAssetReferencePath(assetPath);
  if (!normalizedAssetPath.startsWith('/assets/')) {
    return null;
  }

  return join(resolvedDistDirectory, normalizedAssetPath.replace(/^\/+/, ''));
}

function resolveDistDirectory(distDirectory = null) {
  return resolveTelegramMiniAppDistDirectory(distDirectory);
}

function escapeRegExp(source) {
  return source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractMetaMarkerFromHtml(htmlSource, markerName) {
  const normalizedMarkerName = normalizeString(markerName);
  if (!normalizedMarkerName) {
    return null;
  }

  const markerPattern = new RegExp(
    `<meta\\s+name="${escapeRegExp(normalizedMarkerName)}"\\s+content="([^"]*)"`,
    'i'
  );
  const markerMatch = String(htmlSource || '').match(markerPattern);
  return normalizeString(markerMatch?.[1]);
}

function parseMiniAppAssetReferences(indexHtml = '') {
  const assetReferences = [];
  const seenAssetReferences = new Set();

  for (const match of String(indexHtml || '').matchAll(
    TELEGRAM_MINI_APP_ASSET_REFERENCE_PATTERN
  )) {
    const assetPath = String(match[1] || '').trim();
    if (!assetPath || seenAssetReferences.has(assetPath)) {
      continue;
    }
    seenAssetReferences.add(assetPath);
    assetReferences.push(assetPath);
  }

  return assetReferences;
}

function buildMiniAppCanonicalUrlWithCacheBuster(requestUrl, miniAppCacheBuster) {
  const normalizedRequestUrl = normalizeString(requestUrl) || '/telegram/mini-app';
  const [pathAndQuery] = normalizedRequestUrl.split('#', 1);
  const [pathnameRaw, queryRaw = ''] = pathAndQuery.split('?', 2);
  const pathname = normalizeString(pathnameRaw) || '/telegram/mini-app';
  const searchParams = new URLSearchParams(queryRaw);

  if (miniAppCacheBuster) {
    searchParams.set(TELEGRAM_MINI_APP_CACHE_BUSTER_QUERY_KEY, miniAppCacheBuster);
  }

  const query = searchParams.toString();
  return query ? `${pathname}?${query}` : pathname;
}

function applyResponseHeaders(res, responseHeaders = {}) {
  for (const [headerName, headerValue] of Object.entries(responseHeaders)) {
    res.setHeader(headerName, headerValue);
  }
}

function readMiniAppCacheBusterFromRequest(req) {
  const queryValue =
    req?.query?.[TELEGRAM_MINI_APP_CACHE_BUSTER_QUERY_KEY] ?? null;
  if (Array.isArray(queryValue)) {
    for (const candidate of queryValue) {
      const normalized = normalizeString(candidate);
      if (normalized) {
        return normalized;
      }
    }
    return null;
  }
  return normalizeString(queryValue);
}

function requestLooksLikeMiniAppContext(req) {
  const referer =
    normalizeString(req?.headers?.referer) ||
    normalizeString(req?.headers?.referrer);
  if (!referer) {
    return false;
  }

  try {
    const parsedReferer = new URL(referer);
    return TELEGRAM_MINI_APP_ROUTE_PATTERN.test(parsedReferer.pathname);
  } catch {
    return referer.includes('/telegram/mini-app');
  }
}

function resolveMiniAppFrontendState(resolvedDistDirectory) {
  const indexFilePath = join(resolvedDistDirectory, TELEGRAM_MINI_APP_HTML_ID);
  const indexFileExists = existsSync(indexFilePath);
  const miniAppCacheBuster = resolveTelegramMiniAppCacheBuster({
    distDirectory: resolvedDistDirectory,
  });
  const assetReferences = [];
  const missingAssetReferences = [];
  const stylesheetAssetFiles = [];
  const stylesheetAssetFileSet = new Set();
  let runtimeEntryAssetFile = null;
  let htmlIdentity = TELEGRAM_MINI_APP_HTML_ID;
  let buildMarker = normalizeString(miniAppCacheBuster);

  if (indexFileExists) {
    try {
      const indexHtml = readFileSync(indexFilePath, 'utf8');
      htmlIdentity =
        extractMetaMarkerFromHtml(indexHtml, TELEGRAM_MINI_APP_HTML_ID_META_NAME) ||
        TELEGRAM_MINI_APP_HTML_ID;
      buildMarker =
        extractMetaMarkerFromHtml(indexHtml, TELEGRAM_MINI_APP_BUILD_MARKER_META_NAME) ||
        buildMarker;

      for (const assetPath of parseMiniAppAssetReferences(indexHtml)) {
        assetReferences.push(assetPath);
        const assetFilePath = resolveMiniAppAssetFilePath(
          resolvedDistDirectory,
          assetPath
        );
        if (!assetFilePath || !existsSync(assetFilePath)) {
          missingAssetReferences.push(assetPath);
        }

        const assetFileName = extractAssetFileName(assetPath);
        if (!assetFileName) {
          continue;
        }
        if (
          !runtimeEntryAssetFile &&
          TELEGRAM_MINI_APP_RUNTIME_ENTRY_FILE_PATTERN.test(assetFileName)
        ) {
          runtimeEntryAssetFile = assetFileName;
        }
        if (
          TELEGRAM_MINI_APP_STYLESHEET_FILE_PATTERN.test(assetFileName) &&
          !stylesheetAssetFileSet.has(assetFileName)
        ) {
          stylesheetAssetFileSet.add(assetFileName);
          stylesheetAssetFiles.push(assetFileName);
        }
      }
    } catch {
      // Keep HTML serving resilient; sendFile remains the source of truth.
    }
  }

  return {
    indexFilePath,
    indexFileExists,
    htmlIdentity,
    buildMarker,
    miniAppCacheBuster,
    assetReferences,
    missingAssetReferences,
    runtimeEntryAssetFile,
    stylesheetAssetFiles,
  };
}

function resolveCanonicalMiniAppAssetRequestPath(
  req,
  frontendState,
  { assetContext = 'generic' } = {}
) {
  const requestedAssetFile = normalizeString(
    String(req?.path || '').replace(/^\/+/, '')
  );
  if (!requestedAssetFile) {
    return null;
  }

  if (
    TELEGRAM_MINI_APP_RUNTIME_ENTRY_FILE_PATTERN.test(requestedAssetFile) &&
    frontendState.runtimeEntryAssetFile &&
    frontendState.runtimeEntryAssetFile !== requestedAssetFile
  ) {
    return `/${frontendState.runtimeEntryAssetFile}`;
  }

  if (
    TELEGRAM_MINI_APP_STYLESHEET_FILE_PATTERN.test(requestedAssetFile) &&
    Array.isArray(frontendState.stylesheetAssetFiles) &&
    frontendState.stylesheetAssetFiles.length > 0
  ) {
    const requestedStylesheetIsCanonical =
      frontendState.stylesheetAssetFiles.includes(requestedAssetFile);
    const shouldForceCanonicalStylesheet =
      assetContext === 'telegram_alias' || requestLooksLikeMiniAppContext(req);
    if (!requestedStylesheetIsCanonical && shouldForceCanonicalStylesheet) {
      return `/${frontendState.stylesheetAssetFiles[0]}`;
    }
  }

  return null;
}

function createTerminalMiniAppAssetMiddleware(
  assetsDirectory,
  { resolvedDistDirectory, assetContext = 'generic' } = {}
) {
  const staticMiddleware = express.static(assetsDirectory, {
    fallthrough: false,
    index: false,
    redirect: false,
    setHeaders: (res, filePath) => {
      applyResponseHeaders(res, TELEGRAM_MINI_APP_ASSET_RESPONSE_HEADERS);
      if (filePath.endsWith('.js') || filePath.endsWith('.mjs')) {
        res.type('text/javascript');
        return;
      }
      if (filePath.endsWith('.css')) {
        res.type('text/css');
      }
    },
  });

  return (req, res, next) => {
    const frontendState = resolveMiniAppFrontendState(resolvedDistDirectory);
    const canonicalAssetPath = resolveCanonicalMiniAppAssetRequestPath(
      req,
      frontendState,
      { assetContext }
    );
    if (canonicalAssetPath) {
      const queryIndex = String(req.url || '').indexOf('?');
      const querySuffix =
        queryIndex >= 0 ? String(req.url || '').slice(queryIndex) : '';
      req.url = `${canonicalAssetPath}${querySuffix}`;
      res.setHeader('x-telegram-mini-app-asset-canonical', canonicalAssetPath);
    }

    staticMiddleware(req, res, (error) => {
      if (error?.status === 404) {
        return res
          .status(404)
          .type('text/plain')
          .send(`${TELEGRAM_MINI_APP_ASSET_NOT_FOUND_MESSAGE} Requested path: ${req.path}`);
      }
      if (error) {
        return next(error);
      }
      return next();
    });
  };
}

export function createTelegramMiniAppFrontendRouter({ distDirectory = null } = {}) {
  const router = express.Router();
  const resolvedDistDirectory = resolveDistDirectory(distDirectory);
  const assetsDirectory = join(resolvedDistDirectory, 'assets');
  const rootAssetMiddleware = createTerminalMiniAppAssetMiddleware(assetsDirectory, {
    resolvedDistDirectory,
    assetContext: 'generic',
  });
  const telegramAssetMiddleware = createTerminalMiniAppAssetMiddleware(
    assetsDirectory,
    {
      resolvedDistDirectory,
      assetContext: 'telegram_alias',
    }
  );

  const redirectLegacyMiniAppHtmlPath = (req, res) => {
    const { miniAppCacheBuster } = resolveMiniAppFrontendState(resolvedDistDirectory);
    const targetUrl = buildMiniAppCanonicalUrlWithCacheBuster(
      String(req?.originalUrl || '/telegram-mini-app.html').replace(
        '/telegram-mini-app.html',
        '/telegram/mini-app'
      ),
      miniAppCacheBuster
    );
    applyResponseHeaders(res, TELEGRAM_MINI_APP_HTML_RESPONSE_HEADERS);
    if (miniAppCacheBuster) {
      res.setHeader('x-telegram-mini-app-cache-buster', miniAppCacheBuster);
    }
    return res.redirect(302, targetUrl);
  };

  router.get('/telegram-mini-app.html', redirectLegacyMiniAppHtmlPath);
  router.use('/assets', rootAssetMiddleware);
  router.use('/telegram/mini-app/assets', telegramAssetMiddleware);
  router.use('/telegram/assets', telegramAssetMiddleware);

  const sendMiniAppIndex = (req, res) => {
    const {
      indexFilePath,
      indexFileExists,
      htmlIdentity,
      buildMarker,
      miniAppCacheBuster,
      runtimeEntryAssetFile,
      stylesheetAssetFiles,
      missingAssetReferences,
    } = resolveMiniAppFrontendState(resolvedDistDirectory);

    if (!indexFileExists) {
      return res.status(503).type('text/plain').send(
        `${TELEGRAM_MINI_APP_FRONTEND_UNAVAILABLE_MESSAGE} Expected file: ${indexFilePath}`
      );
    }
    if (missingAssetReferences.length > 0) {
      return res.status(503).type('text/plain').send(
        `${TELEGRAM_MINI_APP_FRONTEND_STALE_ASSET_MESSAGE} Missing assets: ${missingAssetReferences.join(
          ', '
        )}`
      );
    }

    const requestedMiniAppCacheBuster = readMiniAppCacheBusterFromRequest(req);

    applyResponseHeaders(res, TELEGRAM_MINI_APP_HTML_RESPONSE_HEADERS);
    res.setHeader('x-telegram-mini-app-html-id', htmlIdentity);
    if (buildMarker) {
      res.setHeader('x-telegram-mini-app-build-marker', buildMarker);
    }
    if (miniAppCacheBuster) {
      res.setHeader('x-telegram-mini-app-cache-buster', miniAppCacheBuster);
    }
    if (
      requestedMiniAppCacheBuster &&
      miniAppCacheBuster &&
      requestedMiniAppCacheBuster !== miniAppCacheBuster
    ) {
      res.setHeader(
        'x-telegram-mini-app-requested-cache-buster',
        requestedMiniAppCacheBuster
      );
    }
    if (runtimeEntryAssetFile) {
      res.setHeader(
        'x-telegram-mini-app-runtime-entry',
        `/telegram/assets/${runtimeEntryAssetFile}`
      );
    }
    if (stylesheetAssetFiles.length > 0) {
      res.setHeader(
        'x-telegram-mini-app-stylesheets',
        stylesheetAssetFiles.map((value) => `/telegram/assets/${value}`).join(', ')
      );
    }
    return res.sendFile(indexFilePath);
  };

  router.get(TELEGRAM_MINI_APP_ROUTE_PATTERN, sendMiniAppIndex);
  return router;
}
