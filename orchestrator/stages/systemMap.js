import fs from 'node:fs/promises';
import path from 'node:path';

const SERVER_DIR = 'server';
const VIEWS_DIR = 'src/views';
const API_CLIENT_PATH = 'src/utils/apiClient.js';
const APP_PATH = 'src/App.jsx';
const OUTPUT_PATH = 'dev_pipeline/system_map.md';

const METHOD_ORDER = Object.freeze({
  GET: 1,
  POST: 2,
  PUT: 3,
  PATCH: 4,
  DELETE: 5,
});

const GUARD_NAME_RE = /^(authenticateToken|can[A-Z][A-Za-z0-9_]*|require[A-Z][A-Za-z0-9_]*|is[A-Z][A-Za-z0-9_]*|assert[A-Z][A-Za-z0-9_]*|[A-Za-z0-9_]*Guard[A-Za-z0-9_]*)$/;
const TABLE_RE = /create\s+table(?:\s+if\s+not\s+exists)?\s+([`"'[]?)([A-Za-z_][A-Za-z0-9_]*)\1/gi;
const MONEY_TYPE_RE = /['"`]([A-Z][A-Z0-9_]{2,})['"`]/g;
const MONEY_TYPE_KEYWORDS = Object.freeze([
  'MONEY',
  'SALE',
  'DEPOSIT',
  'SALARY',
  'REFUND',
  'PAYMENT',
  'CASH',
  'CARD',
  'MIXED',
  'LEDGER',
  'EXPECT',
]);

function normalizeRel(filePath) {
  return String(filePath || '').split(path.sep).join('/');
}

function isIdentifier(value) {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(value);
}

function cleanToken(token) {
  return String(token || '')
    .replace(/\/\/.*$/g, '')
    .replace(/\/\*.*?\*\//g, '')
    .trim();
}

function toApiPath(routePath) {
  const raw = String(routePath || '').trim();
  if (!raw) return raw;
  if (raw.startsWith('/api/')) return raw;
  if (raw.startsWith('/')) return `/api${raw}`;
  return raw;
}

function joinRoute(prefix, subPath) {
  const left = String(prefix || '').trim().replace(/\/+$/g, '');
  const rightRaw = String(subPath || '').trim();
  if (!rightRaw || rightRaw === '/') return left || '/';
  const right = rightRaw.startsWith('/') ? rightRaw : `/${rightRaw}`;
  const joined = `${left}${right}`;
  return joined.replace(/\/{2,}/g, '/');
}

function uniqueSorted(values) {
  return Array.from(new Set(values)).sort((a, b) => a.localeCompare(b));
}

function inferRole(guards) {
  const set = new Set(guards || []);
  const roles = new Set();

  if (set.has('requireAdminRole') || set.has('isAdmin')) {
    roles.add('admin');
  }
  if (set.has('canOwnerAccess') || set.has('canOwnerOrAdmin')) {
    roles.add('owner');
    roles.add('admin');
  }
  if (set.has('canDispatchManageSlots')) {
    roles.add('dispatcher');
    roles.add('owner');
    roles.add('admin');
  }
  if (set.has('canSellOrDispatch')) {
    roles.add('seller');
    roles.add('dispatcher');
  }
  if (set.has('canSell')) {
    roles.add('seller');
    roles.add('dispatcher');
  }

  if (roles.size === 0) {
    return set.has('authenticateToken') ? 'authenticated' : 'public';
  }

  const order = ['admin', 'owner', 'dispatcher', 'seller'];
  return order.filter((role) => roles.has(role)).join('|');
}

function extractGuardNames(rawArgTail) {
  const names = [];
  const matches = String(rawArgTail || '').match(/\b[A-Za-z_$][A-Za-z0-9_$]*\b/g) || [];
  for (const token of matches) {
    if (GUARD_NAME_RE.test(token)) names.push(token);
  }
  return uniqueSorted(names);
}

async function walkFiles(absDir, outList) {
  const entries = await fs.readdir(absDir, { withFileTypes: true });
  for (const entry of entries) {
    const absPath = path.join(absDir, entry.name);
    if (entry.isDirectory()) {
      await walkFiles(absPath, outList);
      continue;
    }
    if (entry.isFile()) {
      outList.push(absPath);
    }
  }
}

function parseRouterImports(indexContent, indexAbsPath) {
  const map = new Map();
  const re = /^\s*import\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*(?:,\s*\{[^}]*\})?\s+from\s+['"](\.\/[^'"]+)['"];?/gm;
  for (const match of indexContent.matchAll(re)) {
    const variableName = match[1];
    const source = match[2];
    const absPath = path.resolve(path.dirname(indexAbsPath), source);
    map.set(variableName, absPath);
  }
  return map;
}

function parseMounts(indexContent) {
  const mounts = [];
  const lines = indexContent.split(/\r?\n/);
  const lineRe = /^\s*app\.use\(\s*(['"`])([^'"`]+)\1\s*,\s*(.+?)\)\s*;.*$/;

  for (const line of lines) {
    const match = line.match(lineRe);
    if (!match) continue;
    const prefix = match[2];
    const args = match[3];
    const parts = args.split(',').map(cleanToken).filter(Boolean);
    if (parts.length === 0) continue;
    const routerVar = parts[parts.length - 1];
    const guards = parts.slice(0, -1).filter(isIdentifier);
    mounts.push({
      prefix,
      routerVar,
      guards: uniqueSorted(guards),
    });
  }

  return mounts;
}

function parseRouteLines(fileContent) {
  const routes = [];
  const lines = fileContent.split(/\r?\n/);
  const routeLineRe = /^\s*router\.(get|post|put|patch|delete)\s*\(\s*(['"`])([^'"`]+)\2\s*,\s*(.+)$/;

  for (const line of lines) {
    const match = line.match(routeLineRe);
    if (!match) continue;
    const method = match[1].toUpperCase();
    const routePath = match[3];
    const guardNames = extractGuardNames(match[4]);
    routes.push({ method, routePath, guards: guardNames });
  }

  return routes;
}

async function collectEndpoints(projectRoot) {
  const indexAbsPath = path.join(projectRoot, SERVER_DIR, 'index.js');
  const indexContent = await fs.readFile(indexAbsPath, 'utf8');
  const routerMap = parseRouterImports(indexContent, indexAbsPath);
  const mounts = parseMounts(indexContent);
  const routeCache = new Map();
  const endpoints = [];

  for (const mount of mounts) {
    const routerAbsPath = routerMap.get(mount.routerVar);
    if (!routerAbsPath) continue;

    if (!routeCache.has(routerAbsPath)) {
      const content = await fs.readFile(routerAbsPath, 'utf8');
      routeCache.set(routerAbsPath, parseRouteLines(content));
    }
    const localRoutes = routeCache.get(routerAbsPath) || [];

    for (const localRoute of localRoutes) {
      const fullPath = joinRoute(mount.prefix, localRoute.routePath);
      const guards = uniqueSorted([...(mount.guards || []), ...(localRoute.guards || [])]);
      const role = inferRole(guards);
      endpoints.push({
        method: localRoute.method,
        path: fullPath,
        role,
        guards,
      });
    }
  }

  const deduped = new Map();
  for (const endpoint of endpoints) {
    const key = [
      endpoint.method,
      endpoint.path,
      endpoint.role,
      endpoint.guards.join(','),
    ].join('|');
    deduped.set(key, endpoint);
  }

  return Array.from(deduped.values()).sort((a, b) => {
    const pathCmp = a.path.localeCompare(b.path);
    if (pathCmp !== 0) return pathCmp;
    const methodCmp = (METHOD_ORDER[a.method] || 999) - (METHOD_ORDER[b.method] || 999);
    if (methodCmp !== 0) return methodCmp;
    const roleCmp = a.role.localeCompare(b.role);
    if (roleCmp !== 0) return roleCmp;
    return a.guards.join(',').localeCompare(b.guards.join(','));
  });
}

async function collectDbTables(projectRoot) {
  const absServerDir = path.join(projectRoot, SERVER_DIR);
  const allFiles = [];
  await walkFiles(absServerDir, allFiles);
  const targetFiles = allFiles
    .filter((file) => /\.(js|mjs|sql)$/i.test(file))
    .sort((a, b) => normalizeRel(path.relative(projectRoot, a)).localeCompare(normalizeRel(path.relative(projectRoot, b))));

  const tables = new Set();

  for (const abs of targetFiles) {
    const content = await fs.readFile(abs, 'utf8');
    let match;
    TABLE_RE.lastIndex = 0;
    while ((match = TABLE_RE.exec(content)) !== null) {
      tables.add(match[2]);
    }
  }

  return Array.from(tables).sort((a, b) => a.localeCompare(b));
}

async function collectMoneyTypes(projectRoot) {
  const absServerDir = path.join(projectRoot, SERVER_DIR);
  const allFiles = [];
  await walkFiles(absServerDir, allFiles);
  const targetFiles = allFiles
    .filter((file) => /\.(js|mjs)$/i.test(file))
    .sort((a, b) => normalizeRel(path.relative(projectRoot, a)).localeCompare(normalizeRel(path.relative(projectRoot, b))));

  const types = new Set();

  for (const abs of targetFiles) {
    const content = await fs.readFile(abs, 'utf8');
    let match;
    MONEY_TYPE_RE.lastIndex = 0;
    while ((match = MONEY_TYPE_RE.exec(content)) !== null) {
      const token = match[1];
      if (MONEY_TYPE_KEYWORDS.some((keyword) => token.includes(keyword))) {
        types.add(token);
      }
    }
  }

  return Array.from(types).sort((a, b) => a.localeCompare(b));
}

function parseApiClientMethodMap(apiClientContent) {
  const lines = apiClientContent.split(/\r?\n/);
  const methodStarts = [];
  const methodStartRe = /^\s{2}(?:async\s+)?([A-Za-z_$][A-Za-z0-9_$]*)\s*\([^)]*\)\s*\{\s*$/;

  for (let i = 0; i < lines.length; i += 1) {
    const match = lines[i].match(methodStartRe);
    if (!match) continue;
    methodStarts.push({ name: match[1], line: i });
  }

  const map = new Map();

  for (let i = 0; i < methodStarts.length; i += 1) {
    const current = methodStarts[i];
    const next = methodStarts[i + 1];
    const start = current.line;
    const end = next ? next.line : lines.length;
    const body = lines.slice(start, end).join('\n');
    const entries = new Set();

    const callRe = /this\.request\(\s*([`'"])(.*?)\1\s*(?:,\s*\{([\s\S]*?)\})?\s*\)/g;
    let match;
    while ((match = callRe.exec(body)) !== null) {
      const rawPath = String(match[2] || '').trim();
      if (!rawPath) continue;
      const options = String(match[3] || '');
      const methodMatch = options.match(/method\s*:\s*['"`]([A-Za-z]+)['"`]/i);
      const method = methodMatch ? methodMatch[1].toUpperCase() : 'GET';
      entries.add(`${method} ${toApiPath(rawPath)}`);
    }

    map.set(current.name, Array.from(entries).sort((a, b) => a.localeCompare(b)));
  }

  return map;
}

async function collectMainViews(projectRoot) {
  const appContent = await fs.readFile(path.join(projectRoot, APP_PATH), 'utf8');
  const importedViews = new Set();
  const importRe = /import\s+[A-Za-z_$][A-Za-z0-9_$]*\s+from\s+['"]\.\/views\/([^'"]+)['"]/g;
  const candidateExts = ['.jsx', '.js', '.tsx', '.ts', '.mjs'];

  for (const match of appContent.matchAll(importRe)) {
    const base = `src/views/${match[1]}`;
    const normalized = normalizeRel(base);
    const hasExt = /\.[A-Za-z0-9]+$/.test(normalized);
    if (hasExt) {
      importedViews.add(normalized);
      continue;
    }

    let resolved = null;
    for (const ext of candidateExts) {
      const rel = `${normalized}${ext}`;
      const abs = path.join(projectRoot, rel.split('/').join(path.sep));
      try {
        const stat = await fs.stat(abs);
        if (stat.isFile()) {
          resolved = rel;
          break;
        }
      } catch {}
    }

    importedViews.add(resolved || normalized);
  }

  if (importedViews.size > 0) {
    return Array.from(importedViews).sort((a, b) => a.localeCompare(b));
  }

  const absViewsDir = path.join(projectRoot, VIEWS_DIR);
  const allFiles = [];
  await walkFiles(absViewsDir, allFiles);
  return allFiles
    .map(normalizeRel)
    .filter((file) => /\.(js|jsx|mjs|ts|tsx)$/i.test(file))
    .sort((a, b) => a.localeCompare(b));
}

function collectApisFromViewContent(content, apiMethodMap) {
  const apis = new Set();

  const methodCallRe = /apiClient\.([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/g;
  for (const match of content.matchAll(methodCallRe)) {
    const methodName = match[1];
    if (methodName === 'request') continue;
    const mapped = apiMethodMap.get(methodName) || [];
    if (mapped.length > 0) {
      for (const item of mapped) apis.add(item);
    } else {
      apis.add(`CALL apiClient.${methodName}(...)`);
    }
  }

  const requestPathRe = /apiClient\.request\(\s*([`'"])(.*?)\1/g;
  for (const match of content.matchAll(requestPathRe)) {
    const rawPath = String(match[2] || '').trim();
    if (!rawPath) continue;
    apis.add(`ANY ${toApiPath(rawPath)}`);
  }

  const fetchRe = /fetch\(\s*([`'"])(.*?)\1/g;
  for (const match of content.matchAll(fetchRe)) {
    const rawPath = String(match[2] || '').trim();
    if (!rawPath.includes('/api/')) continue;
    apis.add(`ANY ${rawPath}`);
  }

  const directApiStringRe = /([`'"])(\/(?:api\/)?(?:owner|auth|admin|selling|dispatcher)\/[^`'"]*)\1/g;
  for (const match of content.matchAll(directApiStringRe)) {
    apis.add(`ANY ${toApiPath(match[2])}`);
  }

  return Array.from(apis).sort((a, b) => a.localeCompare(b));
}

async function collectViewsWithApi(projectRoot) {
  const apiClientContent = await fs.readFile(path.join(projectRoot, API_CLIENT_PATH), 'utf8');
  const apiMethodMap = parseApiClientMethodMap(apiClientContent);
  const viewPaths = await collectMainViews(projectRoot);
  const result = [];

  for (const relPath of viewPaths) {
    const absPath = path.join(projectRoot, relPath.split('/').join(path.sep));
    const content = await fs.readFile(absPath, 'utf8');
    const apis = collectApisFromViewContent(content, apiMethodMap);
    result.push({ view: normalizeRel(relPath), apis });
  }

  return result.sort((a, b) => a.view.localeCompare(b.view));
}

function toBulletList(items) {
  if (!items.length) return '- (none)';
  return items.map((item) => `- ${item}`).join('\n');
}

function renderEndpointTable(endpoints) {
  if (!endpoints.length) {
    return [
      '| Method | Path | Role | Guards |',
      '| --- | --- | --- | --- |',
      '| (none) | (none) | (none) | (none) |',
    ].join('\n');
  }

  const lines = [
    '| Method | Path | Role | Guards |',
    '| --- | --- | --- | --- |',
  ];
  for (const endpoint of endpoints) {
    lines.push(`| ${endpoint.method} | ${endpoint.path} | ${endpoint.role} | ${endpoint.guards.join(', ') || '(none)'} |`);
  }
  return lines.join('\n');
}

function renderViewsSection(views) {
  if (!views.length) return '### (none)\n- (none)';

  const lines = [];
  for (const item of views) {
    lines.push(`### ${item.view}`);
    lines.push(item.apis.length ? item.apis.map((api) => `- ${api}`).join('\n') : '- (none)');
    lines.push('');
  }
  return lines.join('\n').trimEnd();
}

export async function runSystemMap() {
  const projectRoot = process.cwd();
  const outputAbsPath = path.join(projectRoot, OUTPUT_PATH);

  const [endpoints, tables, moneyTypes, viewsWithApi] = await Promise.all([
    collectEndpoints(projectRoot),
    collectDbTables(projectRoot),
    collectMoneyTypes(projectRoot),
    collectViewsWithApi(projectRoot),
  ]);

  const allGuards = uniqueSorted(endpoints.flatMap((endpoint) => endpoint.guards || []));

  const report = [
    '# System Map',
    '',
    '> Auto-generated by orchestrator stage `runSystemMap`. Do not edit manually.',
    '',
    '## Express Endpoints',
    renderEndpointTable(endpoints),
    '',
    '## Middleware Guards',
    toBulletList(allGuards),
    '',
    '## DB Tables',
    toBulletList(tables),
    '',
    '## Money-Related Types',
    toBulletList(moneyTypes),
    '',
    '## Main React Views and Related API',
    renderViewsSection(viewsWithApi),
    '',
  ].join('\n');

  await fs.mkdir(path.dirname(outputAbsPath), { recursive: true });
  await fs.writeFile(outputAbsPath, report, 'utf8');

  return {
    stage: 'system-map',
    status: 'ok',
    reportPath: OUTPUT_PATH,
    endpointsCount: endpoints.length,
    guardsCount: allGuards.length,
    tablesCount: tables.length,
    moneyTypesCount: moneyTypes.length,
    viewsCount: viewsWithApi.length,
  };
}
