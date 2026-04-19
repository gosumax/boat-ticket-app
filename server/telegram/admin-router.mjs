import express from 'express';
import { buildTelegramLatestTimestampSummary } from '../../shared/telegram/index.js';

export const TELEGRAM_ADMIN_HTTP_ROUTE_RESULT_VERSION =
  'telegram_admin_http_route_result.v1';
export const TELEGRAM_ADMIN_HTTP_ROUTE_NAME = 'telegram_admin_http_route';

const ALLOWED_ADMIN_ROLES = new Set(['admin', 'owner', 'super-admin', 'super_admin']);

function normalizeString(value) {
  const normalized = String(value ?? '').trim();
  return normalized || null;
}

function normalizeOptionalBoolean(value, label = 'enabled') {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  if (value === true || value === 'true' || value === '1' || value === 1) {
    return true;
  }
  if (value === false || value === 'false' || value === '0' || value === 0) {
    return false;
  }
  throw new Error(`${label} must be boolean-compatible`);
}

function parsePositiveInteger(value, label) {
  const normalized = Number(value);
  if (!Number.isInteger(normalized) || normalized <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
  return normalized;
}

function resolveNowIso(now) {
  const value = typeof now === 'function' ? now() : new Date();
  const iso = value instanceof Date ? value.toISOString() : new Date(value).toISOString();
  if (Number.isNaN(Date.parse(iso))) {
    throw new Error('[TELEGRAM_ADMIN_ROUTE] invalid clock timestamp');
  }
  return iso;
}

function validateTelegramContext(telegramContext) {
  if (!telegramContext || typeof telegramContext !== 'object' || Array.isArray(telegramContext)) {
    throw new Error('[TELEGRAM_ADMIN_ROUTE] telegramContext is required');
  }
  if (!telegramContext.services) {
    throw new Error('[TELEGRAM_ADMIN_ROUTE] telegramContext.services is required');
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
    response_version: TELEGRAM_ADMIN_HTTP_ROUTE_RESULT_VERSION,
    routed_by: TELEGRAM_ADMIN_HTTP_ROUTE_NAME,
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

  if (lower.includes('version conflict') || lower.includes('cannot apply')) {
    return {
      httpStatus: 409,
      routeStatus: 'blocked_not_possible',
      routeOperationType,
      rejectionReason: message,
    };
  }

  if (
    lower.includes('must be') ||
    lower.includes('invalid') ||
    lower.includes('required') ||
    lower.includes('unsupported') ||
    lower.includes('incompatible') ||
    lower.includes('disabled') ||
    lower.includes('non-exportable') ||
    lower.includes('empty')
  ) {
    return {
      httpStatus: 422,
      routeStatus: 'rejected_invalid_input',
      routeOperationType,
      rejectionReason: message,
    };
  }

  if (lower.includes('not found')) {
    return {
      httpStatus: 404,
      routeStatus: 'rejected_not_found',
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

function requireTelegramAdminRole(req, res) {
  const role = String(req?.user?.role || '').trim().toLowerCase();
  if (!ALLOWED_ADMIN_ROLES.has(role)) {
    res.status(403).json({
      response_version: TELEGRAM_ADMIN_HTTP_ROUTE_RESULT_VERSION,
      routed_by: TELEGRAM_ADMIN_HTTP_ROUTE_NAME,
      route_status: 'rejected_forbidden',
      route_operation_type: 'admin_role_check',
      http_status: 403,
      operation_result_summary: null,
      rejection_reason: 'Admin/owner role is required',
    });
    return false;
  }
  return true;
}

function normalizeExpectedVersionInput(rawBody = {}) {
  const expectedVersionRaw = rawBody.expected_version ?? rawBody.expectedVersion;
  if (
    expectedVersionRaw === null ||
    expectedVersionRaw === undefined ||
    expectedVersionRaw === ''
  ) {
    return null;
  }
  return parsePositiveInteger(expectedVersionRaw, 'expected_version');
}

function readTemplateReference(req) {
  return normalizeString(req.params.templateReference);
}

function readContentReference(req) {
  return normalizeString(req.params.contentReference);
}

function readSourceReference(req) {
  return normalizeString(req.params.sourceReference);
}

function buildTemplatePatchPayload(req) {
  return {
    template_reference: readTemplateReference(req),
    expected_version: normalizeExpectedVersionInput(req.body || {}),
    title_name_summary:
      req.body?.title_name_summary ??
      req.body?.titleNameSummary ??
      req.body?.title_summary ??
      req.body?.title,
    text_body_summary:
      req.body?.text_body_summary ??
      req.body?.textBodySummary ??
      req.body?.body_summary ??
      req.body?.body,
    enabled: req.body?.enabled ?? req.body?.is_enabled ?? req.body?.isEnabled,
  };
}

function buildContentPatchPayload(req) {
  return {
    content_reference: readContentReference(req),
    expected_version: normalizeExpectedVersionInput(req.body || {}),
    content_group: req.body?.content_group ?? req.body?.contentGroup,
    content_type: req.body?.content_type ?? req.body?.contentType,
    title_summary: req.body?.title_summary ?? req.body?.title,
    short_text_summary:
      req.body?.short_text_summary ?? req.body?.short_text ?? req.body?.shortText,
    visibility_action_summary:
      req.body?.visibility_action_summary ?? req.body?.visibilityActionSummary,
    is_enabled: req.body?.is_enabled ?? req.body?.isEnabled ?? req.body?.enabled,
  };
}

function buildSourceRegistryCreatePayload(req) {
  return {
    source_reference:
      req.body?.source_reference ??
      req.body?.sourceReference,
    source_family:
      req.body?.source_family ??
      req.body?.sourceFamily,
    source_type:
      req.body?.source_type ??
      req.body?.sourceType,
    source_token:
      req.body?.source_token ??
      req.body?.sourceToken ??
      req.body?.token,
    seller_id:
      req.body?.seller_id ??
      req.body?.sellerId,
    is_enabled:
      req.body?.is_enabled ??
      req.body?.isEnabled ??
      req.body?.enabled,
    is_exportable:
      req.body?.is_exportable ??
      req.body?.isExportable ??
      req.body?.exportable ??
      req.body?.printable,
    source_payload:
      req.body?.source_payload ??
      req.body?.sourcePayload,
  };
}

function buildSourceRegistryUpdatePayload(req) {
  return {
    source_reference: readSourceReference(req),
    source_family:
      req.body?.source_family ??
      req.body?.sourceFamily,
    source_type:
      req.body?.source_type ??
      req.body?.sourceType,
    source_token:
      req.body?.source_token ??
      req.body?.sourceToken ??
      req.body?.token,
    seller_id:
      req.body?.seller_id ??
      req.body?.sellerId,
    is_enabled:
      req.body?.is_enabled ??
      req.body?.isEnabled ??
      req.body?.enabled,
    is_exportable:
      req.body?.is_exportable ??
      req.body?.isExportable ??
      req.body?.exportable ??
      req.body?.printable,
    source_payload:
      req.body?.source_payload ??
      req.body?.sourcePayload,
  };
}

function pickDefinedEntries(payload) {
  return Object.fromEntries(
    Object.entries(payload).filter(([, value]) => value !== undefined)
  );
}

export function createTelegramAdminRouter({
  telegramContext,
  now = () => new Date(),
} = {}) {
  validateTelegramContext(telegramContext);
  const services = telegramContext.services;

  if (!services.serviceMessageTemplateManagementService) {
    throw new Error('[TELEGRAM_ADMIN_ROUTE] serviceMessageTemplateManagementService is required');
  }
  if (!services.usefulContentFaqProjectionService) {
    throw new Error('[TELEGRAM_ADMIN_ROUTE] usefulContentFaqProjectionService is required');
  }
  if (!services.sourceRegistryService) {
    throw new Error('[TELEGRAM_ADMIN_ROUTE] sourceRegistryService is required');
  }
  if (!services.qrExportPayloadService) {
    throw new Error('[TELEGRAM_ADMIN_ROUTE] qrExportPayloadService is required');
  }
  if (!services.sourceAnalyticsReportingService) {
    throw new Error('[TELEGRAM_ADMIN_ROUTE] sourceAnalyticsReportingService is required');
  }

  const router = express.Router();

  router.get('/service-message-templates', (req, res) => {
    if (!requireTelegramAdminRole(req, res)) return undefined;

    const nowIso = resolveNowIso(now);
    try {
      const operationResultSummary =
        services.serviceMessageTemplateManagementService.listServiceMessageTemplates({
          template_type: normalizeString(req.query.template_type ?? req.query.templateType),
          enabled: normalizeOptionalBoolean(req.query.enabled, 'enabled'),
        });

      return res.status(200).json(
        buildRouteResult({
          routeStatus: 'processed',
          routeOperationType: 'admin_service_message_template_list',
          operationResultSummary,
          rejectionReason: null,
          nowIso,
          httpStatus: 200,
        })
      );
    } catch (error) {
      const routeError = mapRouteError(error, 'admin_service_message_template_list');
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

  router.get('/service-message-templates/:templateReference', (req, res) => {
    if (!requireTelegramAdminRole(req, res)) return undefined;

    const nowIso = resolveNowIso(now);
    try {
      const operationResultSummary =
        services.serviceMessageTemplateManagementService.readServiceMessageTemplateByReference({
          template_reference: readTemplateReference(req),
        });

      return res.status(200).json(
        buildRouteResult({
          routeStatus: 'processed',
          routeOperationType: 'admin_service_message_template_read',
          operationResultSummary,
          rejectionReason: null,
          nowIso,
          httpStatus: 200,
        })
      );
    } catch (error) {
      const routeError = mapRouteError(error, 'admin_service_message_template_read');
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

  router.patch('/service-message-templates/:templateReference', (req, res) => {
    if (!requireTelegramAdminRole(req, res)) return undefined;

    const nowIso = resolveNowIso(now);
    try {
      const operationResultSummary =
        services.serviceMessageTemplateManagementService.updateServiceMessageTemplateVersionSafe(
          pickDefinedEntries(buildTemplatePatchPayload(req))
        );

      return res.status(200).json(
        buildRouteResult({
          routeStatus: 'processed',
          routeOperationType: 'admin_service_message_template_update',
          operationResultSummary,
          rejectionReason: null,
          nowIso,
          httpStatus: 200,
        })
      );
    } catch (error) {
      const routeError = mapRouteError(error, 'admin_service_message_template_update');
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

  router.post('/service-message-templates/:templateReference/enable', (req, res) => {
    if (!requireTelegramAdminRole(req, res)) return undefined;

    const nowIso = resolveNowIso(now);
    try {
      const operationResultSummary =
        services.serviceMessageTemplateManagementService.enableServiceMessageTemplate(
          pickDefinedEntries({
            template_reference: readTemplateReference(req),
            expected_version: normalizeExpectedVersionInput(req.body || {}),
          })
        );

      return res.status(200).json(
        buildRouteResult({
          routeStatus: 'processed',
          routeOperationType: 'admin_service_message_template_enable',
          operationResultSummary,
          rejectionReason: null,
          nowIso,
          httpStatus: 200,
        })
      );
    } catch (error) {
      const routeError = mapRouteError(error, 'admin_service_message_template_enable');
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

  router.post('/service-message-templates/:templateReference/disable', (req, res) => {
    if (!requireTelegramAdminRole(req, res)) return undefined;

    const nowIso = resolveNowIso(now);
    try {
      const operationResultSummary =
        services.serviceMessageTemplateManagementService.disableServiceMessageTemplate(
          pickDefinedEntries({
            template_reference: readTemplateReference(req),
            expected_version: normalizeExpectedVersionInput(req.body || {}),
          })
        );

      return res.status(200).json(
        buildRouteResult({
          routeStatus: 'processed',
          routeOperationType: 'admin_service_message_template_disable',
          operationResultSummary,
          rejectionReason: null,
          nowIso,
          httpStatus: 200,
        })
      );
    } catch (error) {
      const routeError = mapRouteError(error, 'admin_service_message_template_disable');
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

  router.get('/managed-content', (req, res) => {
    if (!requireTelegramAdminRole(req, res)) return undefined;

    const nowIso = resolveNowIso(now);
    try {
      const rawGroupings =
        req.query.content_group ??
        req.query.contentGroup ??
        req.query.content_grouping ??
        req.query.contentGrouping ??
        req.query.group ??
        req.query.grouping ??
        req.query.groups ??
        req.query.groupings;
      const contentGrouping = Array.isArray(rawGroupings)
        ? rawGroupings.map((value) => normalizeString(value)).filter(Boolean)
        : normalizeString(rawGroupings);
      const operationResultSummary =
        services.usefulContentFaqProjectionService.listContentItemsByGroup({
          content_group: contentGrouping,
        });

      return res.status(200).json(
        buildRouteResult({
          routeStatus: 'processed',
          routeOperationType: 'admin_managed_content_list',
          operationResultSummary,
          rejectionReason: null,
          nowIso,
          httpStatus: 200,
        })
      );
    } catch (error) {
      const routeError = mapRouteError(error, 'admin_managed_content_list');
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

  router.get('/managed-content/:contentReference', (req, res) => {
    if (!requireTelegramAdminRole(req, res)) return undefined;

    const nowIso = resolveNowIso(now);
    try {
      const operationResultSummary =
        services.usefulContentFaqProjectionService.readContentItemByReference({
          content_reference: readContentReference(req),
        });

      return res.status(200).json(
        buildRouteResult({
          routeStatus: 'processed',
          routeOperationType: 'admin_managed_content_read',
          operationResultSummary,
          rejectionReason: null,
          nowIso,
          httpStatus: 200,
        })
      );
    } catch (error) {
      const routeError = mapRouteError(error, 'admin_managed_content_read');
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

  router.patch('/managed-content/:contentReference', (req, res) => {
    if (!requireTelegramAdminRole(req, res)) return undefined;

    const nowIso = resolveNowIso(now);
    try {
      const operationResultSummary =
        services.usefulContentFaqProjectionService.updateContentItemVersionSafe(
          pickDefinedEntries(buildContentPatchPayload(req))
        );

      return res.status(200).json(
        buildRouteResult({
          routeStatus: 'processed',
          routeOperationType: 'admin_managed_content_update',
          operationResultSummary,
          rejectionReason: null,
          nowIso,
          httpStatus: 200,
        })
      );
    } catch (error) {
      const routeError = mapRouteError(error, 'admin_managed_content_update');
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

  router.post('/managed-content/:contentReference/enable', (req, res) => {
    if (!requireTelegramAdminRole(req, res)) return undefined;

    const nowIso = resolveNowIso(now);
    try {
      const operationResultSummary = services.usefulContentFaqProjectionService.enableContentItem(
        pickDefinedEntries({
          content_reference: readContentReference(req),
          expected_version: normalizeExpectedVersionInput(req.body || {}),
        })
      );

      return res.status(200).json(
        buildRouteResult({
          routeStatus: 'processed',
          routeOperationType: 'admin_managed_content_enable',
          operationResultSummary,
          rejectionReason: null,
          nowIso,
          httpStatus: 200,
        })
      );
    } catch (error) {
      const routeError = mapRouteError(error, 'admin_managed_content_enable');
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

  router.post('/managed-content/:contentReference/disable', (req, res) => {
    if (!requireTelegramAdminRole(req, res)) return undefined;

    const nowIso = resolveNowIso(now);
    try {
      const operationResultSummary =
        services.usefulContentFaqProjectionService.disableContentItem(
          pickDefinedEntries({
            content_reference: readContentReference(req),
            expected_version: normalizeExpectedVersionInput(req.body || {}),
          })
        );

      return res.status(200).json(
        buildRouteResult({
          routeStatus: 'processed',
          routeOperationType: 'admin_managed_content_disable',
          operationResultSummary,
          rejectionReason: null,
          nowIso,
          httpStatus: 200,
        })
      );
    } catch (error) {
      const routeError = mapRouteError(error, 'admin_managed_content_disable');
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

  router.get('/source-registry', (req, res) => {
    if (!requireTelegramAdminRole(req, res)) return undefined;

    const nowIso = resolveNowIso(now);
    try {
      const operationResultSummary = services.sourceRegistryService.listSourceRegistryItems({
        source_family: normalizeString(req.query.source_family ?? req.query.sourceFamily),
        enabled: normalizeOptionalBoolean(req.query.enabled, 'enabled'),
      });
      return res.status(200).json(
        buildRouteResult({
          routeStatus: 'processed',
          routeOperationType: 'admin_source_registry_list',
          operationResultSummary,
          rejectionReason: null,
          nowIso,
          httpStatus: 200,
        })
      );
    } catch (error) {
      const routeError = mapRouteError(error, 'admin_source_registry_list');
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

  router.post('/source-registry', (req, res) => {
    if (!requireTelegramAdminRole(req, res)) return undefined;

    const nowIso = resolveNowIso(now);
    try {
      const operationResultSummary =
        services.sourceRegistryService.createSourceRegistryItem(
          pickDefinedEntries(buildSourceRegistryCreatePayload(req))
        );
      return res.status(200).json(
        buildRouteResult({
          routeStatus: 'processed',
          routeOperationType: 'admin_source_registry_create',
          operationResultSummary,
          rejectionReason: null,
          nowIso,
          httpStatus: 200,
        })
      );
    } catch (error) {
      const routeError = mapRouteError(error, 'admin_source_registry_create');
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

  router.get('/source-registry/qr-export-payloads', (req, res) => {
    if (!requireTelegramAdminRole(req, res)) return undefined;

    const nowIso = resolveNowIso(now);
    try {
      const operationResultSummary =
        services.qrExportPayloadService.listQrExportPayloadsForEnabledSources({});
      return res.status(200).json(
        buildRouteResult({
          routeStatus: 'processed',
          routeOperationType: 'admin_qr_export_payload_list',
          operationResultSummary,
          rejectionReason: null,
          nowIso,
          httpStatus: 200,
        })
      );
    } catch (error) {
      const routeError = mapRouteError(error, 'admin_qr_export_payload_list');
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

  router.get('/source-registry/:sourceReference', (req, res) => {
    if (!requireTelegramAdminRole(req, res)) return undefined;

    const nowIso = resolveNowIso(now);
    try {
      const operationResultSummary =
        services.sourceRegistryService.readSourceRegistryItemByReference({
          source_reference: readSourceReference(req),
        });
      return res.status(200).json(
        buildRouteResult({
          routeStatus: 'processed',
          routeOperationType: 'admin_source_registry_read',
          operationResultSummary,
          rejectionReason: null,
          nowIso,
          httpStatus: 200,
        })
      );
    } catch (error) {
      const routeError = mapRouteError(error, 'admin_source_registry_read');
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

  router.patch('/source-registry/:sourceReference', (req, res) => {
    if (!requireTelegramAdminRole(req, res)) return undefined;

    const nowIso = resolveNowIso(now);
    try {
      const operationResultSummary =
        services.sourceRegistryService.updateSourceRegistryItem(
          pickDefinedEntries(buildSourceRegistryUpdatePayload(req))
        );
      return res.status(200).json(
        buildRouteResult({
          routeStatus: 'processed',
          routeOperationType: 'admin_source_registry_update',
          operationResultSummary,
          rejectionReason: null,
          nowIso,
          httpStatus: 200,
        })
      );
    } catch (error) {
      const routeError = mapRouteError(error, 'admin_source_registry_update');
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

  router.post('/source-registry/:sourceReference/enable', (req, res) => {
    if (!requireTelegramAdminRole(req, res)) return undefined;

    const nowIso = resolveNowIso(now);
    try {
      const operationResultSummary = services.sourceRegistryService.enableSourceRegistryItem({
        source_reference: readSourceReference(req),
      });
      return res.status(200).json(
        buildRouteResult({
          routeStatus: 'processed',
          routeOperationType: 'admin_source_registry_enable',
          operationResultSummary,
          rejectionReason: null,
          nowIso,
          httpStatus: 200,
        })
      );
    } catch (error) {
      const routeError = mapRouteError(error, 'admin_source_registry_enable');
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

  router.post('/source-registry/:sourceReference/disable', (req, res) => {
    if (!requireTelegramAdminRole(req, res)) return undefined;

    const nowIso = resolveNowIso(now);
    try {
      const operationResultSummary = services.sourceRegistryService.disableSourceRegistryItem({
        source_reference: readSourceReference(req),
      });
      return res.status(200).json(
        buildRouteResult({
          routeStatus: 'processed',
          routeOperationType: 'admin_source_registry_disable',
          operationResultSummary,
          rejectionReason: null,
          nowIso,
          httpStatus: 200,
        })
      );
    } catch (error) {
      const routeError = mapRouteError(error, 'admin_source_registry_disable');
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

  router.get('/source-registry/:sourceReference/qr-export-payload', (req, res) => {
    if (!requireTelegramAdminRole(req, res)) return undefined;

    const nowIso = resolveNowIso(now);
    try {
      const operationResultSummary =
        services.qrExportPayloadService.buildQrExportPayloadBySourceReference({
          source_reference: readSourceReference(req),
        });
      return res.status(200).json(
        buildRouteResult({
          routeStatus: 'processed',
          routeOperationType: 'admin_qr_export_payload_read',
          operationResultSummary,
          rejectionReason: null,
          nowIso,
          httpStatus: 200,
        })
      );
    } catch (error) {
      const routeError = mapRouteError(error, 'admin_qr_export_payload_read');
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

  router.get('/source-analytics/funnel-summary', (req, res) => {
    if (!requireTelegramAdminRole(req, res)) return undefined;

    const nowIso = resolveNowIso(now);
    try {
      const operationResultSummary =
        services.sourceAnalyticsReportingService.readOverallTelegramFunnelCountersSummary(
          {}
        );
      return res.status(200).json(
        buildRouteResult({
          routeStatus: 'processed',
          routeOperationType: 'admin_source_analytics_funnel_summary',
          operationResultSummary,
          rejectionReason: null,
          nowIso,
          httpStatus: 200,
        })
      );
    } catch (error) {
      const routeError = mapRouteError(error, 'admin_source_analytics_funnel_summary');
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

  router.get('/source-analytics', (req, res) => {
    if (!requireTelegramAdminRole(req, res)) return undefined;

    const nowIso = resolveNowIso(now);
    try {
      const operationResultSummary =
        services.sourceAnalyticsReportingService.listSourcePerformanceSummaries({
          enabled: normalizeOptionalBoolean(req.query.enabled, 'enabled'),
        });
      return res.status(200).json(
        buildRouteResult({
          routeStatus: 'processed',
          routeOperationType: 'admin_source_analytics_list',
          operationResultSummary,
          rejectionReason: null,
          nowIso,
          httpStatus: 200,
        })
      );
    } catch (error) {
      const routeError = mapRouteError(error, 'admin_source_analytics_list');
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

  router.get('/source-analytics/:sourceReference', (req, res) => {
    if (!requireTelegramAdminRole(req, res)) return undefined;

    const nowIso = resolveNowIso(now);
    try {
      const operationResultSummary =
        services.sourceAnalyticsReportingService.readSourcePerformanceReportBySourceReference({
          source_reference: readSourceReference(req),
        });
      return res.status(200).json(
        buildRouteResult({
          routeStatus: 'processed',
          routeOperationType: 'admin_source_analytics_read',
          operationResultSummary,
          rejectionReason: null,
          nowIso,
          httpStatus: 200,
        })
      );
    } catch (error) {
      const routeError = mapRouteError(error, 'admin_source_analytics_read');
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

  router.get('/faq', (req, res) => {
    if (!requireTelegramAdminRole(req, res)) return undefined;

    const nowIso = resolveNowIso(now);
    try {
      const rawGrouping =
        req.query.content_grouping ??
        req.query.contentGrouping ??
        req.query.grouping ??
        req.query.groupings;
      const contentGrouping = Array.isArray(rawGrouping)
        ? rawGrouping.map((value) => normalizeString(value)).filter(Boolean)
        : normalizeString(rawGrouping);
      const operationResultSummary =
        services.usefulContentFaqProjectionService.readFaqListForTelegramGuest({
          content_grouping: contentGrouping,
        });

      return res.status(200).json(
        buildRouteResult({
          routeStatus: 'processed',
          routeOperationType: 'admin_faq_list',
          operationResultSummary,
          rejectionReason: null,
          nowIso,
          httpStatus: 200,
        })
      );
    } catch (error) {
      const routeError = mapRouteError(error, 'admin_faq_list');
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

  router.get('/faq/:faqReference', (req, res) => {
    if (!requireTelegramAdminRole(req, res)) return undefined;

    const nowIso = resolveNowIso(now);
    try {
      const operationResultSummary =
        services.usefulContentFaqProjectionService.readFaqItemByReference({
          faq_reference: normalizeString(req.params.faqReference),
        });

      return res.status(200).json(
        buildRouteResult({
          routeStatus: 'processed',
          routeOperationType: 'admin_faq_read',
          operationResultSummary,
          rejectionReason: null,
          nowIso,
          httpStatus: 200,
        })
      );
    } catch (error) {
      const routeError = mapRouteError(error, 'admin_faq_read');
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

  router.get('/useful-content', (req, res) => {
    if (!requireTelegramAdminRole(req, res)) return undefined;

    const nowIso = resolveNowIso(now);
    try {
      const rawGrouping =
        req.query.content_grouping ??
        req.query.contentGrouping ??
        req.query.grouping ??
        req.query.groupings;
      const contentGrouping = Array.isArray(rawGrouping)
        ? rawGrouping.map((value) => normalizeString(value)).filter(Boolean)
        : normalizeString(rawGrouping);
      const operationResultSummary =
        services.usefulContentFaqProjectionService.readUsefulContentFeedForTelegramGuest({
          content_grouping: contentGrouping,
        });

      return res.status(200).json(
        buildRouteResult({
          routeStatus: 'processed',
          routeOperationType: 'admin_useful_content_list',
          operationResultSummary,
          rejectionReason: null,
          nowIso,
          httpStatus: 200,
        })
      );
    } catch (error) {
      const routeError = mapRouteError(error, 'admin_useful_content_list');
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
