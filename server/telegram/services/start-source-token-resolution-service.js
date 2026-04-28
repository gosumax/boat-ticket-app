import {
  SELLER_SOURCE_FAMILIES,
  TELEGRAM_SOURCE_FAMILIES,
  freezeTelegramHandoffValue,
} from '../../../shared/telegram/index.js';
import {
  TELEGRAM_GUEST_ENTRY_PROJECTION_ITEM_TYPE,
  TELEGRAM_GUEST_ENTRY_PROJECTION_VERSION,
} from './guest-entry-projection-service.js';
import {
  TELEGRAM_START_UPDATE_NORMALIZED_EVENT_TYPE,
} from './start-update-normalization-service.js';

export const TELEGRAM_START_SOURCE_TOKEN_RESOLUTION_VERSION =
  'telegram_start_source_token_resolution.v1';

export const TELEGRAM_START_SOURCE_RESOLUTION_STATUSES = Object.freeze([
  'no_source_token',
  'unresolved_source_token',
  'resolved_seller_source',
  'resolved_owner_source',
  'resolved_generic_source',
]);

const ERROR_PREFIX = '[TELEGRAM_START_SOURCE_TOKEN_RESOLUTION]';
const SERVICE_NAME = 'start-source-token-resolution-service';
const SOURCE_TOKEN_PATTERN = /^[A-Za-z0-9_-]+$/;
const SOURCE_TOKEN_PRESALE_PAYLOAD_PATTERN = /^([A-Za-z0-9_-]+)__p([1-9]\d*)$/;
const OWNER_SOURCE_FAMILIES = Object.freeze(['owner_source']);
const GENERIC_SOURCE_FAMILIES = Object.freeze(
  TELEGRAM_SOURCE_FAMILIES.filter(
    (sourceFamily) => !SELLER_SOURCE_FAMILIES.includes(sourceFamily)
  )
);
const ALL_RESOLVABLE_SOURCE_FAMILIES = Object.freeze([
  ...SELLER_SOURCE_FAMILIES,
  ...OWNER_SOURCE_FAMILIES,
  ...GENERIC_SOURCE_FAMILIES,
]);

function rejectSourceTokenResolution(message) {
  throw new Error(`${ERROR_PREFIX} ${message}`);
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeOptionalString(value) {
  const normalized = String(value ?? '').trim();
  return normalized || null;
}

function normalizeSourceToken(value) {
  const normalized = normalizeOptionalString(value);
  if (!normalized) {
    return null;
  }

  if (!SOURCE_TOKEN_PATTERN.test(normalized)) {
    rejectSourceTokenResolution('source token must contain only letters, numbers, underscores, or hyphens');
  }

  return normalized.toLowerCase();
}

export function normalizeTelegramStartSourceTokenForRegistry(value) {
  return normalizeSourceToken(value);
}

function normalizePayloadSourceToken(value) {
  const normalized = normalizeOptionalString(value);
  if (!normalized || !SOURCE_TOKEN_PATTERN.test(normalized)) {
    return null;
  }

  const handoffMatch = normalized.match(SOURCE_TOKEN_PRESALE_PAYLOAD_PATTERN);
  return String(handoffMatch?.[1] || normalized).toLowerCase();
}

function normalizeTokenForFamily(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[-\s]+/g, '_');
}

function classifyNormalizedSourceToken(normalizedSourceToken) {
  const token = normalizeTokenForFamily(normalizedSourceToken);

  if (!token) {
    return null;
  }

  if (
    token === 'seller' ||
    token.startsWith('seller_') ||
    token.startsWith('seller_qr') ||
    token.startsWith('seller_direct') ||
    token.startsWith('seller_link') ||
    token.startsWith('seller_tshirt') ||
    token.startsWith('seller_t_shirt')
  ) {
    return {
      resolutionStatus: 'resolved_seller_source',
      sourceFamily: token.startsWith('seller_t_shirt') || token.startsWith('seller_tshirt')
        ? 'seller_tshirt_qr'
        : token.startsWith('seller_direct') || token.startsWith('seller_link')
          ? 'seller_direct_link'
          : 'seller_qr',
      reason: 'source_token_matches_seller_family_prefix',
    };
  }

  if (token === 'owner' || token.startsWith('owner_')) {
    return {
      resolutionStatus: 'resolved_owner_source',
      sourceFamily: 'owner_source',
      reason: 'source_token_matches_owner_family_prefix',
    };
  }

  if (
    token === 'generic' ||
    token.startsWith('generic') ||
    token.startsWith('promo') ||
    token.startsWith('point') ||
    token.startsWith('bot_search') ||
    token.startsWith('messenger') ||
    token.startsWith('campaign') ||
    token.startsWith('other_campaign')
  ) {
    return {
      resolutionStatus: 'resolved_generic_source',
      sourceFamily: token.startsWith('promo')
        ? 'promo_qr'
        : token.startsWith('point')
          ? 'point_qr'
          : token.startsWith('bot_search')
            ? 'bot_search_entry'
            : token.startsWith('messenger')
              ? 'messenger_link'
              : token.startsWith('campaign') || token.startsWith('other_campaign')
                ? 'other_campaign'
                : 'generic_qr',
      reason: 'source_token_matches_generic_family_prefix',
    };
  }

  return {
    resolutionStatus: 'unresolved_source_token',
    sourceFamily: null,
    reason: 'source_token_does_not_match_telegram_boundary_rules',
  };
}

export function classifyTelegramStartSourceTokenForRegistry(sourceToken) {
  const normalizedSourceToken = normalizeSourceToken(sourceToken);
  if (!normalizedSourceToken) {
    return freezeTelegramHandoffValue({
      resolutionStatus: 'no_source_token',
      sourceFamily: null,
      reason: 'normalized_start_payload_has_no_source_token',
    });
  }

  return freezeTelegramHandoffValue(
    classifyNormalizedSourceToken(normalizedSourceToken)
  );
}

function assertResolvableSourceFamily(sourceFamily) {
  if (sourceFamily && !ALL_RESOLVABLE_SOURCE_FAMILIES.includes(sourceFamily)) {
    rejectSourceTokenResolution(`Unsupported source family classification: ${sourceFamily}`);
  }
}

function assertNormalizedStartPayload(payload, label) {
  if (!isPlainObject(payload)) {
    rejectSourceTokenResolution(`${label}.normalized_start_payload is required`);
  }

  if (typeof payload.has_payload !== 'boolean') {
    rejectSourceTokenResolution(
      `${label}.normalized_start_payload.has_payload must be boolean`
    );
  }

  return payload;
}

function buildCandidate({ item, inputKind }) {
  const normalizedStartPayload = assertNormalizedStartPayload(item.normalized_start_payload, inputKind);
  const sourceToken = normalizeSourceToken(item.source_token);
  const normalizedPayloadToken = normalizePayloadSourceToken(
    normalizedStartPayload.has_payload
      ? normalizedStartPayload.normalized_payload
      : null
  );
  const resolvedSourceToken = sourceToken || normalizedPayloadToken;
  const rawSourceToken = normalizeOptionalString(item.source_token) ||
    normalizeOptionalString(normalizedStartPayload.normalized_payload);

  if (sourceToken && normalizedPayloadToken && sourceToken !== normalizedPayloadToken) {
    rejectSourceTokenResolution(
      `${inputKind} source_token must match normalized_start_payload.normalized_payload`
    );
  }

  return {
    inputKind,
    rawSourceToken: resolvedSourceToken ? rawSourceToken : null,
    normalizedSourceToken: resolvedSourceToken,
    hasSourceToken: Boolean(resolvedSourceToken),
  };
}

function isNormalizedStartEvent(value) {
  return value?.normalized_event_type === TELEGRAM_START_UPDATE_NORMALIZED_EVENT_TYPE;
}

function isGuestEntryProjectionItem(value) {
  return value?.response_version === TELEGRAM_GUEST_ENTRY_PROJECTION_VERSION &&
    value?.projection_item_type === TELEGRAM_GUEST_ENTRY_PROJECTION_ITEM_TYPE;
}

function addInputCandidate(candidates, item, inputKind) {
  if (!isPlainObject(item)) {
    rejectSourceTokenResolution(`${inputKind} must be an object`);
  }

  candidates.push(buildCandidate({ item, inputKind }));
}

function pickSourceResolutionCandidate(input = {}) {
  if (!isPlainObject(input)) {
    rejectSourceTokenResolution('source resolution input must be an object');
  }

  const candidates = [];

  if (isNormalizedStartEvent(input)) {
    addInputCandidate(candidates, input, 'normalized_start_event');
  }
  if (isGuestEntryProjectionItem(input)) {
    addInputCandidate(candidates, input, 'guest_entry_projection_item');
  }

  const nestedNormalizedStartEvent =
    input.normalized_start_event ?? input.normalizedStartEvent;
  const nestedGuestEntryProjectionItem =
    input.guest_entry_projection_item ?? input.guestEntryProjectionItem;

  if (nestedNormalizedStartEvent !== undefined) {
    addInputCandidate(candidates, nestedNormalizedStartEvent, 'normalized_start_event');
  }
  if (nestedGuestEntryProjectionItem !== undefined) {
    addInputCandidate(candidates, nestedGuestEntryProjectionItem, 'guest_entry_projection_item');
  }

  if (candidates.length === 0) {
    rejectSourceTokenResolution('Unsupported source resolution input');
  }

  const [firstCandidate] = candidates;
  for (const candidate of candidates.slice(1)) {
    if (candidate.normalizedSourceToken !== firstCandidate.normalizedSourceToken) {
      rejectSourceTokenResolution('source token inputs must match');
    }
  }

  return {
    ...firstCandidate,
    inputKind: candidates.length > 1 ? 'combined_start_source_input' : firstCandidate.inputKind,
  };
}

function buildNoSourceTokenResult(candidate) {
  return freezeTelegramHandoffValue({
    response_version: TELEGRAM_START_SOURCE_TOKEN_RESOLUTION_VERSION,
    read_only: true,
    resolution_status: 'no_source_token',
    raw_source_token: candidate.rawSourceToken,
    normalized_source_token: null,
    has_source_token: false,
    source_family: null,
    source_resolution_reason: 'normalized_start_payload_has_no_source_token',
    resolution_input_kind: candidate.inputKind,
    resolved_by: SERVICE_NAME,
    no_op_guards: {
      source_binding_created: false,
      seller_attribution_created: false,
      booking_created: false,
      production_webhook_route_invoked: false,
      bot_command_handler_invoked: false,
      mini_app_ui_invoked: false,
      admin_ui_invoked: false,
      money_ledger_written: false,
    },
  });
}

function buildSourceTokenResult(candidate, classification) {
  assertResolvableSourceFamily(classification.sourceFamily);

  return freezeTelegramHandoffValue({
    response_version: TELEGRAM_START_SOURCE_TOKEN_RESOLUTION_VERSION,
    read_only: true,
    resolution_status: classification.resolutionStatus,
    raw_source_token: candidate.rawSourceToken,
    normalized_source_token: candidate.normalizedSourceToken,
    has_source_token: true,
    source_family: classification.sourceFamily,
    source_resolution_reason: classification.reason,
    resolution_input_kind: candidate.inputKind,
    resolved_by: SERVICE_NAME,
    no_op_guards: {
      source_binding_created: false,
      seller_attribution_created: false,
      booking_created: false,
      production_webhook_route_invoked: false,
      bot_command_handler_invoked: false,
      mini_app_ui_invoked: false,
      admin_ui_invoked: false,
      money_ledger_written: false,
    },
  });
}

export class TelegramStartSourceTokenResolutionService {
  describe() {
    return Object.freeze({
      serviceName: SERVICE_NAME,
      status: 'stateless_start_source_token_resolution_ready',
      dependencyKeys: [],
    });
  }

  resolveStartSourceToken(input = {}) {
    const candidate = pickSourceResolutionCandidate(input);

    if (!candidate.hasSourceToken) {
      return buildNoSourceTokenResult(candidate);
    }

    return buildSourceTokenResult(
      candidate,
      classifyNormalizedSourceToken(candidate.normalizedSourceToken)
    );
  }

  resolveSourceToken(input = {}) {
    return this.resolveStartSourceToken(input);
  }

  resolve(input = {}) {
    return this.resolveStartSourceToken(input);
  }
}
