import express from 'express';
import {
  buildTelegramLatestTimestampSummary,
  TELEGRAM_MANUAL_FALLBACK_ACTION_NAMES,
} from '../../shared/telegram/index.js';

export const TELEGRAM_OWNER_HTTP_ROUTE_RESULT_VERSION =
  'telegram_owner_http_route_result.v1';
export const TELEGRAM_OWNER_HTTP_ROUTE_NAME = 'telegram_owner_http_route';

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

function normalizeString(value) {
  const normalized = String(value ?? '').trim();
  return normalized || null;
}

function parsePositiveInteger(value, label) {
  const normalized = Number(value);
  if (!Number.isInteger(normalized) || normalized <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
  return normalized;
}

function parseLimitInput(value, { fallback = DEFAULT_LIMIT, max = MAX_LIMIT } = {}) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }
  const normalized = Number(value);
  if (!Number.isInteger(normalized) || normalized <= 0) {
    throw new Error('limit must be a positive integer');
  }
  return Math.min(normalized, max);
}

function resolveNowIso(now) {
  const value = typeof now === 'function' ? now() : new Date();
  const iso = value instanceof Date ? value.toISOString() : new Date(value).toISOString();
  if (Number.isNaN(Date.parse(iso))) {
    throw new Error('[TELEGRAM_OWNER_ROUTE] invalid clock timestamp');
  }
  return iso;
}

function validateTelegramContext(telegramContext) {
  if (!telegramContext || typeof telegramContext !== 'object' || Array.isArray(telegramContext)) {
    throw new Error('[TELEGRAM_OWNER_ROUTE] telegramContext is required');
  }
  if (!telegramContext.services) {
    throw new Error('[TELEGRAM_OWNER_ROUTE] telegramContext.services is required');
  }
}

function sortResultValue(value) {
  if (Array.isArray(value)) {
    return value.map((item) => sortResultValue(item));
  }
  if (!value || typeof value !== 'object') {
    return value;
  }

  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortResultValue(value[key])])
  );
}

function buildRouteResult({
  routeStatus,
  routeOperationType,
  operationResultSummary = null,
  rejectionReason = null,
  nowIso,
  httpStatus,
}) {
  return sortResultValue({
    response_version: TELEGRAM_OWNER_HTTP_ROUTE_RESULT_VERSION,
    routed_by: TELEGRAM_OWNER_HTTP_ROUTE_NAME,
    route_status: routeStatus,
    route_operation_type: routeOperationType,
    http_status: httpStatus,
    operation_result_summary: operationResultSummary,
    rejection_reason: rejectionReason,
    latest_timestamp_summary: buildTelegramLatestTimestampSummary(
      nowIso,
      operationResultSummary?.generated_at,
      operationResultSummary?.latest_timestamp_summary?.iso
    ),
  });
}

function mapRouteError(error, routeOperationType) {
  const message = normalizeString(error?.message) || 'internal_error';
  const lower = message.toLowerCase();

  if (
    lower.includes('must be a positive integer') ||
    lower.includes('unsupported') ||
    lower.includes('required') ||
    lower.includes('payload fields conflict')
  ) {
    return {
      httpStatus: 422,
      routeStatus: 'rejected_invalid_input',
      routeOperationType,
      rejectionReason: message,
    };
  }

  if (lower.includes('idempotency conflict')) {
    return {
      httpStatus: 409,
      routeStatus: 'blocked_not_possible',
      routeOperationType,
      rejectionReason: message,
    };
  }

  if (
    lower.includes('not found') ||
    lower.includes('invalid booking request reference')
  ) {
    return {
      httpStatus: 404,
      routeStatus: 'rejected_not_found',
      routeOperationType,
      rejectionReason: message,
    };
  }

  if (
    lower.includes('not a manual fallback request') ||
    lower.includes('no active manual path') ||
    lower.includes('no longer actionable') ||
    lower.includes('cannot apply') ||
    lower.includes('after prepayment is final')
  ) {
    return {
      httpStatus: 409,
      routeStatus: 'blocked_not_possible',
      routeOperationType,
      rejectionReason: message,
    };
  }

  return {
    httpStatus: 400,
    routeStatus: 'rejected_invalid_input',
    routeOperationType,
    rejectionReason: message,
  };
}

function requireOwnerRole(req, res) {
  const role = String(req?.user?.role || '').trim().toLowerCase();
  if (role !== 'owner' && role !== 'admin') {
    res.status(403).json({
      response_version: TELEGRAM_OWNER_HTTP_ROUTE_RESULT_VERSION,
      routed_by: TELEGRAM_OWNER_HTTP_ROUTE_NAME,
      route_status: 'rejected_forbidden',
      route_operation_type: 'owner_role_check',
      http_status: 403,
      operation_result_summary: null,
      rejection_reason: 'Owner role is required',
    });
    return false;
  }
  return true;
}

function buildIdempotencyKey({ bookingRequestId, actionType }) {
  return [
    'owner-http',
    bookingRequestId,
    actionType || 'unknown',
    Date.now().toString(36),
    Math.random().toString(36).slice(2, 8),
  ].join(':');
}

function parseActionType(value) {
  const normalized = normalizeString(value);
  if (!normalized) {
    throw new Error('action_type is required');
  }
  if (!TELEGRAM_MANUAL_FALLBACK_ACTION_NAMES.includes(normalized)) {
    throw new Error(`Unsupported action type: ${normalized}`);
  }
  return normalized;
}

export function createTelegramOwnerRouter({
  telegramContext,
  now = () => new Date(),
} = {}) {
  validateTelegramContext(telegramContext);
  const services = telegramContext.services;

  if (!services.manualFallbackQueueQueryService) {
    throw new Error('[TELEGRAM_OWNER_ROUTE] manualFallbackQueueQueryService is required');
  }
  if (!services.manualFallbackRequestStateProjectionService) {
    throw new Error(
      '[TELEGRAM_OWNER_ROUTE] manualFallbackRequestStateProjectionService is required'
    );
  }
  if (!services.manualFallbackQueueService) {
    throw new Error('[TELEGRAM_OWNER_ROUTE] manualFallbackQueueService is required');
  }

  const router = express.Router();

  router.get('/manual-fallback/queue', (req, res) => {
    if (!requireOwnerRole(req, res)) return undefined;

    const nowIso = resolveNowIso(now);
    try {
      const operationResultSummary =
        services.manualFallbackQueueQueryService.listCurrentManualFallbackQueueItems({
          limit: parseLimitInput(req.query.limit),
          queue_state: normalizeString(req.query.queue_state) || undefined,
        });

      return res.status(200).json(
        buildRouteResult({
          routeStatus: 'processed',
          routeOperationType: 'owner_manual_fallback_queue_list',
          operationResultSummary,
          rejectionReason: null,
          nowIso,
          httpStatus: 200,
        })
      );
    } catch (error) {
      const routeError = mapRouteError(error, 'owner_manual_fallback_queue_list');
      return res.status(routeError.httpStatus).json(
        buildRouteResult({
          routeStatus: routeError.routeStatus,
          routeOperationType: routeError.routeOperationType,
          operationResultSummary: null,
          rejectionReason: routeError.rejectionReason,
          nowIso,
          httpStatus: routeError.httpStatus,
        })
      );
    }
  });

  router.get('/manual-fallback/request-states/active', (req, res) => {
    if (!requireOwnerRole(req, res)) return undefined;

    const nowIso = resolveNowIso(now);
    try {
      const operationResultSummary =
        services.manualFallbackRequestStateProjectionService
          .listManualHandlingStatesForActiveManualQueueItems({
            limit: parseLimitInput(req.query.limit),
          });

      return res.status(200).json(
        buildRouteResult({
          routeStatus: 'processed',
          routeOperationType: 'owner_manual_fallback_request_states_active',
          operationResultSummary,
          rejectionReason: null,
          nowIso,
          httpStatus: 200,
        })
      );
    } catch (error) {
      const routeError = mapRouteError(
        error,
        'owner_manual_fallback_request_states_active'
      );
      return res.status(routeError.httpStatus).json(
        buildRouteResult({
          routeStatus: routeError.routeStatus,
          routeOperationType: routeError.routeOperationType,
          operationResultSummary: null,
          rejectionReason: routeError.rejectionReason,
          nowIso,
          httpStatus: routeError.httpStatus,
        })
      );
    }
  });

  router.get('/manual-fallback/request-states/:bookingRequestId', (req, res) => {
    if (!requireOwnerRole(req, res)) return undefined;

    const nowIso = resolveNowIso(now);
    try {
      const bookingRequestId = parsePositiveInteger(
        req.params.bookingRequestId,
        'bookingRequestId'
      );
      const operationResultSummary =
        services.manualFallbackRequestStateProjectionService
          .readCurrentManualHandlingStateByBookingRequestReference(bookingRequestId);

      return res.status(200).json(
        buildRouteResult({
          routeStatus: 'processed',
          routeOperationType: 'owner_manual_fallback_request_state_read',
          operationResultSummary,
          rejectionReason: null,
          nowIso,
          httpStatus: 200,
        })
      );
    } catch (error) {
      const routeError = mapRouteError(
        error,
        'owner_manual_fallback_request_state_read'
      );
      return res.status(routeError.httpStatus).json(
        buildRouteResult({
          routeStatus: routeError.routeStatus,
          routeOperationType: routeError.routeOperationType,
          operationResultSummary: null,
          rejectionReason: routeError.rejectionReason,
          nowIso,
          httpStatus: routeError.httpStatus,
        })
      );
    }
  });

  router.post('/manual-fallback/queue/:bookingRequestId/actions', (req, res) => {
    if (!requireOwnerRole(req, res)) return undefined;

    const nowIso = resolveNowIso(now);
    try {
      const bookingRequestId = parsePositiveInteger(
        req.params.bookingRequestId,
        'bookingRequestId'
      );
      const actionType = parseActionType(
        req.body?.action_type ?? req.body?.actionType ?? req.body?.action
      );
      const idempotencyKey =
        normalizeString(req.body?.idempotency_key ?? req.body?.idempotencyKey) ||
        buildIdempotencyKey({ bookingRequestId, actionType });

      const operationResultSummary =
        services.manualFallbackQueueService.recordManualFallbackAction({
          bookingRequestId,
          action: actionType,
          idempotencyKey,
          actorType: String(req.user?.role || 'owner').trim().toLowerCase() || 'owner',
          actorId: req.user?.id ? String(req.user.id) : null,
          actionPayload: req.body?.action_payload ?? req.body?.actionPayload ?? {},
        });

      return res.status(200).json(
        buildRouteResult({
          routeStatus: 'processed',
          routeOperationType: 'owner_manual_fallback_action',
          operationResultSummary,
          rejectionReason: null,
          nowIso,
          httpStatus: 200,
        })
      );
    } catch (error) {
      const routeError = mapRouteError(error, 'owner_manual_fallback_action');
      return res.status(routeError.httpStatus).json(
        buildRouteResult({
          routeStatus: routeError.routeStatus,
          routeOperationType: routeError.routeOperationType,
          operationResultSummary: null,
          rejectionReason: routeError.rejectionReason,
          nowIso,
          httpStatus: routeError.httpStatus,
        })
      );
    }
  });

  return router;
}