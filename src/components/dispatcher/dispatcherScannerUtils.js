const LOOKUP_PARAM_PRIORITY = Object.freeze([
  'buyer_ticket_code',
  'ticket_code',
  'ticket',
  'code',
  'token',
  'query',
  'q',
  'start',
  'payload',
]);

function safeDecodeLookupURIComponent(value) {
  const normalized = String(value ?? '');
  try {
    return decodeURIComponent(normalized);
  } catch {
    return normalized;
  }
}

function normalizeDispatcherLookupToken(value) {
  const normalized = String(value ?? '').trim();
  if (!normalized) {
    return '';
  }
  return normalized.toUpperCase().replace(/\s+/g, ' ');
}

function normalizeDispatcherLookupCompact(value) {
  return normalizeDispatcherLookupToken(value).replace(/[^0-9A-ZА-ЯЁ]/g, '');
}

function parseLookupUrlOrNull(input) {
  try {
    return new URL(input);
  } catch {
    try {
      if (/^[a-z0-9.-]+\.[a-z]{2,}/i.test(input)) {
        return new URL(`https://${input}`);
      }
    } catch {
      return null;
    }
  }
  return null;
}

function collectLikelyLookupValuesFromUrl(parsedUrl) {
  if (!parsedUrl) return [];

  const prioritized = [];
  const fallback = [];
  const seen = new Set();
  const push = (arr, value) => {
    const token = normalizeDispatcherLookupToken(safeDecodeLookupURIComponent(value));
    if (!token) return;
    const key = normalizeDispatcherLookupCompact(token) || token;
    if (seen.has(key)) return;
    seen.add(key);
    arr.push(token);
  };

  for (const key of LOOKUP_PARAM_PRIORITY) {
    parsedUrl.searchParams.getAll(key).forEach((value) => push(prioritized, value));
  }
  parsedUrl.searchParams.forEach((value, key) => {
    if (!LOOKUP_PARAM_PRIORITY.includes(String(key || '').toLowerCase())) {
      push(fallback, value);
    }
  });

  const hashRaw = String(parsedUrl.hash || '').replace(/^#/, '').trim();
  if (hashRaw) {
    if (hashRaw.includes('=')) {
      try {
        const hashParams = new URLSearchParams(hashRaw);
        for (const key of LOOKUP_PARAM_PRIORITY) {
          hashParams.getAll(key).forEach((value) => push(prioritized, value));
        }
        hashParams.forEach((value, key) => {
          if (!LOOKUP_PARAM_PRIORITY.includes(String(key || '').toLowerCase())) {
            push(fallback, value);
          }
        });
      } catch {
        push(fallback, hashRaw);
      }
    } else {
      push(fallback, hashRaw);
    }
  }

  const pathSegments = String(parsedUrl.pathname || '')
    .split('/')
    .map((segment) => segment.trim())
    .filter(Boolean);
  for (let index = pathSegments.length - 1; index >= 0; index -= 1) {
    push(fallback, pathSegments[index]);
  }

  return [...prioritized, ...fallback];
}

function scoreLookupCandidate(candidate) {
  let score = 0;
  if (!candidate) return Number.NEGATIVE_INFINITY;

  if (/^[A-ZА-ЯЁ]{1,4}-?\d{1,10}$/i.test(candidate)) score += 90;
  if (/^\d{1,10}$/.test(candidate)) score += 65;
  if (/^[A-Z0-9:_-]{4,}$/i.test(candidate)) score += 35;
  if (candidate.length <= 2) score -= 20;
  if (candidate.length > 96) score -= 20;
  if (candidate.includes('://')) score -= 120;
  if (candidate.includes('/')) score -= 45;
  if (candidate.includes('?')) score -= 35;
  if (candidate.includes('&')) score -= 20;
  if (/^[A-Z0-9.-]+\.[A-Z]{2,}/i.test(candidate)) score -= 10;
  return score;
}

function buildDispatcherLookupCandidates(rawInput) {
  const input = String(rawInput ?? '').trim();
  if (!input) return [];

  const candidateMap = new Map();
  const pushCandidate = (value) => {
    const decoded = safeDecodeLookupURIComponent(value);
    const token = normalizeDispatcherLookupToken(decoded);
    if (!token) return;
    const key = normalizeDispatcherLookupCompact(token) || token;
    if (!candidateMap.has(key)) {
      candidateMap.set(key, token);
    }
  };

  pushCandidate(input);

  String(input)
    .split(/[\s,;|]+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .forEach((part) => pushCandidate(part));

  const parsedUrl = parseLookupUrlOrNull(input);
  if (parsedUrl) {
    collectLikelyLookupValuesFromUrl(parsedUrl).forEach((value) => pushCandidate(value));
    const hostWithPath = `${parsedUrl.hostname}${parsedUrl.pathname || ''}`;
    pushCandidate(hostWithPath);
  }

  return Array.from(candidateMap.values());
}

export function resolveDispatcherLookupQuery(rawInput) {
  const candidates = buildDispatcherLookupCandidates(rawInput);
  if (candidates.length === 0) return '';

  let best = candidates[0];
  let bestScore = scoreLookupCandidate(best);
  for (let index = 1; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    const score = scoreLookupCandidate(candidate);
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  return best;
}

export function isScannerLikeCapture({
  buffer = '',
  startedAt = 0,
  now = Date.now(),
  intervals = [],
  source = 'keyboard',
}) {
  const cleanedBuffer = String(buffer || '').trim();
  if (cleanedBuffer.length < 3) return false;

  const elapsed = startedAt > 0 ? now - startedAt : Number.POSITIVE_INFINITY;
  if (elapsed > 2200) return false;

  if (source === 'paste') return true;

  const normalizedIntervals = Array.isArray(intervals)
    ? intervals.filter((value) => Number.isFinite(value) && value >= 0)
    : [];
  if (normalizedIntervals.length === 0) return true;

  const total = normalizedIntervals.reduce((sum, value) => sum + value, 0);
  const averageInterval = total / normalizedIntervals.length;
  const fastIntervals = normalizedIntervals.filter((value) => value <= 95).length;

  return (
    averageInterval <= 95 ||
    fastIntervals >= Math.max(1, Math.floor(normalizedIntervals.length * 0.6))
  );
}

