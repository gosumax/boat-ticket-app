import express from 'express';
import { buildTelegramLatestTimestampSummary } from '../../shared/telegram/index.js';

export const TELEGRAM_SELLER_HTTP_ROUTE_RESULT_VERSION =
  'telegram_seller_http_route_result.v1';
export const TELEGRAM_SELLER_HTTP_ROUTE_NAME = 'telegram_seller_http_route';

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

function parseLimitInput(value, { fallback = 100, max = 300 } = {}) {
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
    throw new Error('[TELEGRAM_SELLER_ROUTE] invalid clock timestamp');
  }
  return iso;
}

function validateTelegramContext(telegramContext) {
  if (!telegramContext || typeof telegramContext !== 'object' || Array.isArray(telegramContext)) {
    throw new Error('[TELEGRAM_SELLER_ROUTE] telegramContext is required');
  }
  if (!telegramContext.services) {
    throw new Error('[TELEGRAM_SELLER_ROUTE] telegramContext.services is required');
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
    response_version: TELEGRAM_SELLER_HTTP_ROUTE_RESULT_VERSION,
    routed_by: TELEGRAM_SELLER_HTTP_ROUTE_NAME,
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
    lower.includes('required')
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
    lower.includes('not assigned to seller') ||
    lower.includes('cannot apply') ||
    lower.includes('cannot extend') ||
    lower.includes('already used') ||
    lower.includes('already extended') ||
    lower.includes('prepayment is final') ||
    lower.includes('no active seller path') ||
    lower.includes('no longer actionable')
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

function requireSellerRole(req, res) {
  const role = String(req?.user?.role || '').trim().toLowerCase();
  if (role !== 'seller') {
    res.status(403).json({
      response_version: TELEGRAM_SELLER_HTTP_ROUTE_RESULT_VERSION,
      routed_by: TELEGRAM_SELLER_HTTP_ROUTE_NAME,
      route_status: 'rejected_forbidden',
      route_operation_type: 'seller_role_check',
      http_status: 403,
      operation_result_summary: null,
      rejection_reason: 'Seller role is required',
    });
    return false;
  }
  return true;
}

function buildIdempotencyKey({ bookingRequestId, actionType }) {
  return [
    'seller-http',
    bookingRequestId,
    actionType || 'unknown',
    Date.now().toString(36),
    Math.random().toString(36).slice(2, 8),
  ].join(':');
}

export function createTelegramSellerRouter({
  telegramContext,
  now = () => new Date(),
} = {}) {
  validateTelegramContext(telegramContext);
  const services = telegramContext.services;

  if (!services.sellerWorkQueueService) {
    throw new Error('[TELEGRAM_SELLER_ROUTE] sellerWorkQueueService is required');
  }

  const router = express.Router();

  router.get('/work-queue', (req, res) => {
    if (!requireSellerRole(req, res)) return undefined;

    const nowIso = resolveNowIso(now);
    try {
      const sellerId = parsePositiveInteger(req.user?.id, 'seller_id');
      const operationResultSummary = services.sellerWorkQueueService.listSellerWorkQueue(
        sellerId,
        {
          limit: parseLimitInput(req.query.limit),
        }
      );

      return res.status(200).json(
        buildRouteResult({
          routeStatus: 'processed',
          routeOperationType: 'seller_work_queue_list',
          operationResultSummary,
          rejectionReason: null,
          nowIso,
          httpStatus: 200,
        })
      );
    } catch (error) {
      const routeError = mapRouteError(error, 'seller_work_queue_list');
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

  router.post('/work-queue/:bookingRequestId/actions', (req, res) => {
    if (!requireSellerRole(req, res)) return undefined;

    const nowIso = resolveNowIso(now);
    try {
      const sellerId = parsePositiveInteger(req.user?.id, 'seller_id');
      const bookingRequestId = parsePositiveInteger(
        req.params.bookingRequestId,
        'bookingRequestId'
      );
      const actionType = normalizeString(
        req.body?.action_type ?? req.body?.actionType ?? req.body?.action
      );
      if (!actionType) {
        throw new Error('action_type is required');
      }
      const idempotencyKey =
        normalizeString(req.body?.idempotency_key ?? req.body?.idempotencyKey) ||
        buildIdempotencyKey({ bookingRequestId, actionType });

      const operationResultSummary = services.sellerWorkQueueService.recordSellerAction({
        sellerId,
        bookingRequestId,
        action: actionType,
        idempotencyKey,
        actionPayload: req.body?.action_payload ?? req.body?.actionPayload ?? {},
      });

      return res.status(200).json(
        buildRouteResult({
          routeStatus: 'processed',
          routeOperationType: 'seller_work_queue_action',
          operationResultSummary,
          rejectionReason: null,
          nowIso,
          httpStatus: 200,
        })
      );
    } catch (error) {
      const routeError = mapRouteError(error, 'seller_work_queue_action');
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
