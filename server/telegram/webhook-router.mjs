import express from 'express';
import {
  buildTelegramLatestTimestampSummary,
  buildTelegramLiveSmokePilotChecklist,
  buildTelegramLiveSmokePilotReportEnvelope,
  captureTelegramLiveSmokePilotScenarioResults,
  freezeTelegramHandoffValue,
} from '../../shared/telegram/index.js';
import {
  buildTelegramMiniAppLaunchReadinessSummary,
  buildTelegramRuntimeHealthSummary,
  buildTelegramRuntimeSmokeReadinessResult,
  buildTelegramRuntimeStartupValidation,
  resolveTelegramRuntimeConfig,
} from './runtime-config.mjs';
import {
  createTelegramBotCommandAdapter,
  TELEGRAM_BOT_COMMAND_ADAPTER_NAME,
} from './adapters/telegram-bot-command-adapter.mjs';
import {
  createTelegramBotCallbackAdapter,
  TELEGRAM_BOT_CALLBACK_ADAPTER_NAME,
} from './adapters/telegram-bot-callback-adapter.mjs';

export const TELEGRAM_WEBHOOK_ROUTE_RESULT_VERSION = 'telegram_webhook_route_result.v1';
export const TELEGRAM_WEBHOOK_ROUTE_NAME = 'telegram_webhook_route';

function normalizeString(value) {
  const normalized = String(value ?? '').trim();
  return normalized || null;
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

function freezeSortedResultValue(value) {
  return freezeTelegramHandoffValue(sortResultValue(value));
}

function resolveNowIso(now) {
  const value = typeof now === 'function' ? now() : new Date();
  const iso = value instanceof Date ? value.toISOString() : new Date(value).toISOString();
  if (Number.isNaN(Date.parse(iso))) {
    throw new Error('[TELEGRAM_WEBHOOK_ROUTE] invalid clock timestamp');
  }
  return iso;
}

function pickHeaderValue(headers, headerName) {
  if (!headers || typeof headers !== 'object') {
    return null;
  }
  const direct = headers[headerName];
  if (Array.isArray(direct)) {
    return normalizeString(direct[0]);
  }
  return normalizeString(direct);
}

function normalizePilotRunReference(value) {
  return normalizeString(value) || 'default_live_smoke_pilot';
}

function normalizeScenarioResultsInput(rawBody = {}) {
  const list = rawBody?.scenario_results ?? rawBody?.scenarioResults;
  if (list === undefined || list === null) {
    return [];
  }
  if (!Array.isArray(list)) {
    throw new Error('scenario_results must be an array');
  }
  return list;
}

function buildTelegramUpdateReference(rawUpdate = {}) {
  const callbackQuery = rawUpdate?.callback_query || {};
  const callbackMessage = callbackQuery?.message || {};
  const message = rawUpdate?.message || {};
  return freezeSortedResultValue({
    telegram_update_id:
      Number.isInteger(rawUpdate?.update_id) && rawUpdate.update_id >= 0
        ? rawUpdate.update_id
        : null,
    telegram_message_id:
      Number.isInteger(message?.message_id) && message.message_id > 0
        ? message.message_id
        : Number.isInteger(callbackMessage?.message_id) && callbackMessage.message_id > 0
          ? callbackMessage.message_id
          : null,
    callback_query_id: normalizeString(callbackQuery?.id),
  });
}

function mapAdapterResultToRouteStatus(adapterResult) {
  const operationStatus = normalizeString(adapterResult?.operation_status);
  if (operationStatus) {
    return operationStatus;
  }
  const mappingStatus = normalizeString(adapterResult?.mapping_status);
  if (mappingStatus === 'ignored_non_command') {
    return 'ignored_unsupported_update';
  }
  if (mappingStatus === 'ignored_non_callback') {
    return 'ignored_unsupported_update';
  }
  return 'rejected_invalid_input';
}

function buildRouteResult({
  routeStatus,
  routeOperationType = null,
  adapterType = null,
  adapterResultSummary = null,
  operationResultSummary = null,
  telegramUpdateReference = null,
  rejectionReason = null,
  nowIso,
}) {
  return freezeSortedResultValue({
    response_version: TELEGRAM_WEBHOOK_ROUTE_RESULT_VERSION,
    routed_by: TELEGRAM_WEBHOOK_ROUTE_NAME,
    route_status: routeStatus,
    route_operation_type: routeOperationType,
    adapter_type: adapterType,
    telegram_update_reference: telegramUpdateReference,
    adapter_result_summary: adapterResultSummary,
    operation_result_summary: operationResultSummary,
    rejection_reason: rejectionReason,
    latest_timestamp_summary: buildTelegramLatestTimestampSummary(
      nowIso,
      adapterResultSummary?.latest_timestamp_summary?.iso,
      operationResultSummary?.latest_timestamp_summary?.iso
    ),
  });
}

function validateTelegramContext(telegramContext) {
  if (!telegramContext || typeof telegramContext !== 'object' || Array.isArray(telegramContext)) {
    throw new Error('[TELEGRAM_WEBHOOK_ROUTE] telegramContext is required');
  }
  if (!telegramContext.services) {
    throw new Error('[TELEGRAM_WEBHOOK_ROUTE] telegramContext.services is required');
  }
}

export function createTelegramWebhookRouter({
  telegramContext,
  commandAdapter = null,
  callbackAdapter = null,
  telegramRuntimeConfig = null,
  telegramWebhookSecretToken = undefined,
  now = () => new Date(),
} = {}) {
  validateTelegramContext(telegramContext);
  const services = telegramContext.services;
  const resolvedRuntimeConfig =
    telegramRuntimeConfig || resolveTelegramRuntimeConfig();
  const miniAppLaunchSummary =
    buildTelegramMiniAppLaunchReadinessSummary(resolvedRuntimeConfig);

  const resolvedCommandAdapter =
    commandAdapter ||
    createTelegramBotCommandAdapter({
      runtimeEntrypointOrchestrationService: services.runtimeEntrypointOrchestrationService,
      guestCommandActionOrchestrationService:
        services.guestCommandActionOrchestrationService,
      templateExecutionOrchestrationService: services.templateExecutionOrchestrationService,
      webhookOutboundResponseOrchestrationService:
        services.webhookOutboundResponseOrchestrationService,
      telegramMiniAppLaunchSummary: miniAppLaunchSummary,
      now,
    });
  const resolvedCallbackAdapter =
    callbackAdapter ||
    createTelegramBotCallbackAdapter({
      guestCommandActionOrchestrationService:
        services.guestCommandActionOrchestrationService,
      templateExecutionOrchestrationService: services.templateExecutionOrchestrationService,
      webhookOutboundResponseOrchestrationService:
        services.webhookOutboundResponseOrchestrationService,
      telegramMiniAppLaunchSummary: miniAppLaunchSummary,
      now,
    });
  const webhookSecretCandidate =
    telegramWebhookSecretToken === undefined
      ? resolvedRuntimeConfig.telegram_webhook_secret_token
      : telegramWebhookSecretToken;
  const webhookSecret = normalizeString(webhookSecretCandidate);

  const router = express.Router();
  const liveSmokePilotResultsByRunReference = new Map();

  function buildSmokeReadinessSummary() {
    return buildTelegramRuntimeSmokeReadinessResult({
      runtimeConfig: resolvedRuntimeConfig,
      startupValidation: buildTelegramRuntimeStartupValidation(
        resolvedRuntimeConfig
      ),
      commandAdapter: resolvedCommandAdapter,
      callbackAdapter: resolvedCallbackAdapter,
      services,
      webhookSecretRequired: Boolean(webhookSecret),
      now,
    });
  }

  function readStoredPilotResults(pilotRunReference) {
    const stored = liveSmokePilotResultsByRunReference.get(pilotRunReference);
    if (!stored || typeof stored !== 'object' || Array.isArray(stored)) {
      return {};
    }
    return stored;
  }

  function buildLiveSmokePilotSummaryEnvelope(pilotRunReference) {
    const smokeReadinessSummary = buildSmokeReadinessSummary();
    const checklistSummary = buildTelegramLiveSmokePilotChecklist({
      smokeReadinessSummary,
      services,
      now,
    });
    const reportSummary = buildTelegramLiveSmokePilotReportEnvelope({
      checklist: checklistSummary,
      capturedResults: readStoredPilotResults(pilotRunReference),
      now,
    });

    return freezeSortedResultValue({
      response_version: 'telegram_live_smoke_pilot_summary_envelope.v1',
      pilot_run_reference: pilotRunReference,
      smoke_readiness_summary: smokeReadinessSummary,
      checklist_summary: checklistSummary,
      report_summary: reportSummary,
      latest_timestamp_summary: buildTelegramLatestTimestampSummary(
        checklistSummary.latest_timestamp_summary?.iso,
        reportSummary.latest_timestamp_summary?.iso
      ),
    });
  }

  function buildRuntimeReadinessSummary() {
    const runtimeHealthSummary = buildTelegramRuntimeHealthSummary(
      resolvedRuntimeConfig,
      {
        now,
        webhookSecretRequired: Boolean(webhookSecret),
      }
    );
    const startupValidationSummary =
      buildTelegramRuntimeStartupValidation(resolvedRuntimeConfig);
    const smokeReadinessSummary = buildSmokeReadinessSummary();

    return freezeSortedResultValue({
      response_version: 'telegram_runtime_readiness_envelope.v1',
      runtime_health_summary: runtimeHealthSummary,
      startup_validation_summary: startupValidationSummary,
      smoke_readiness_summary: smokeReadinessSummary,
      latest_timestamp_summary: buildTelegramLatestTimestampSummary(
        runtimeHealthSummary.latest_timestamp_summary?.iso,
        smokeReadinessSummary.latest_timestamp_summary?.iso
      ),
    });
  }

  router.get('/health', (req, res) => {
    const nowIso = resolveNowIso(now);
    return res.status(200).json(
      buildRouteResult({
        routeStatus: 'processed',
        routeOperationType: 'health_check',
        adapterType: null,
        adapterResultSummary: freezeSortedResultValue({
          command_adapter: TELEGRAM_BOT_COMMAND_ADAPTER_NAME,
          callback_adapter: TELEGRAM_BOT_CALLBACK_ADAPTER_NAME,
          webhook_secret_required: Boolean(webhookSecret),
        }),
        operationResultSummary: buildRuntimeReadinessSummary(),
        telegramUpdateReference: null,
        rejectionReason: null,
        nowIso,
      })
    );
  });

  router.get('/readiness', (req, res) => {
    const nowIso = resolveNowIso(now);
    return res.status(200).json(
      buildRouteResult({
        routeStatus: 'processed',
        routeOperationType: 'runtime_readiness_check',
        adapterType: null,
        adapterResultSummary: null,
        operationResultSummary: buildRuntimeReadinessSummary(),
        telegramUpdateReference: null,
        rejectionReason: null,
        nowIso,
      })
    );
  });

  router.get('/smoke-readiness', (req, res) => {
    const nowIso = resolveNowIso(now);
    const smokeReadinessSummary = buildSmokeReadinessSummary();

    return res.status(200).json(
      buildRouteResult({
        routeStatus: 'processed',
        routeOperationType: 'runtime_smoke_readiness_check',
        adapterType: null,
        adapterResultSummary: null,
        operationResultSummary: smokeReadinessSummary,
        telegramUpdateReference: null,
        rejectionReason: null,
        nowIso,
      })
    );
  });

  router.get('/smoke-pilot/checklist', (req, res) => {
    const nowIso = resolveNowIso(now);
    try {
      const pilotRunReference = normalizePilotRunReference(
        req.query?.pilot_run_reference ?? req.query?.pilotRunReference
      );
      const operationResultSummary =
        buildLiveSmokePilotSummaryEnvelope(pilotRunReference);
      return res.status(200).json(
        buildRouteResult({
          routeStatus: 'processed',
          routeOperationType: 'runtime_live_smoke_pilot_checklist',
          adapterType: null,
          adapterResultSummary: null,
          operationResultSummary,
          telegramUpdateReference: null,
          rejectionReason: null,
          nowIso,
        })
      );
    } catch (error) {
      return res.status(422).json(
        buildRouteResult({
          routeStatus: 'rejected_invalid_input',
          routeOperationType: 'runtime_live_smoke_pilot_checklist',
          adapterType: null,
          adapterResultSummary: null,
          operationResultSummary: null,
          telegramUpdateReference: null,
          rejectionReason:
            normalizeString(error?.message) ||
            '[TELEGRAM_WEBHOOK_ROUTE] invalid smoke pilot checklist input',
          nowIso,
        })
      );
    }
  });

  router.post('/smoke-pilot/report', (req, res) => {
    const nowIso = resolveNowIso(now);
    try {
      const pilotRunReference = normalizePilotRunReference(
        req.body?.pilot_run_reference ??
          req.body?.pilotRunReference ??
          req.query?.pilot_run_reference ??
          req.query?.pilotRunReference
      );
      const scenarioResults = normalizeScenarioResultsInput(req.body || {});
      const captureSummary = captureTelegramLiveSmokePilotScenarioResults({
        previousResults: readStoredPilotResults(pilotRunReference),
        scenarioResults,
        now,
      });
      liveSmokePilotResultsByRunReference.set(
        pilotRunReference,
        captureSummary.captured_results_by_scenario || {}
      );
      const pilotSummaryEnvelope =
        buildLiveSmokePilotSummaryEnvelope(pilotRunReference);

      const operationResultSummary = freezeSortedResultValue({
        response_version: 'telegram_live_smoke_pilot_capture_envelope.v1',
        pilot_run_reference: pilotRunReference,
        capture_summary: captureSummary,
        pilot_summary: pilotSummaryEnvelope,
        latest_timestamp_summary: buildTelegramLatestTimestampSummary(
          captureSummary.latest_timestamp_summary?.iso,
          pilotSummaryEnvelope.latest_timestamp_summary?.iso
        ),
      });

      return res.status(200).json(
        buildRouteResult({
          routeStatus: 'processed',
          routeOperationType: 'runtime_live_smoke_pilot_result_capture',
          adapterType: null,
          adapterResultSummary: null,
          operationResultSummary,
          telegramUpdateReference: null,
          rejectionReason: null,
          nowIso,
        })
      );
    } catch (error) {
      return res.status(422).json(
        buildRouteResult({
          routeStatus: 'rejected_invalid_input',
          routeOperationType: 'runtime_live_smoke_pilot_result_capture',
          adapterType: null,
          adapterResultSummary: null,
          operationResultSummary: null,
          telegramUpdateReference: null,
          rejectionReason:
            normalizeString(error?.message) ||
            '[TELEGRAM_WEBHOOK_ROUTE] invalid smoke pilot capture payload',
          nowIso,
        })
      );
    }
  });

  router.post('/webhook', (req, res) => {
    const nowIso = resolveNowIso(now);
    const rawUpdate = req.body;
    const telegramUpdateReference = buildTelegramUpdateReference(rawUpdate);
    const incomingSecret = pickHeaderValue(
      req.headers,
      'x-telegram-bot-api-secret-token'
    );

    if (webhookSecret && incomingSecret !== webhookSecret) {
      return res.status(401).json(
        buildRouteResult({
          routeStatus: 'rejected_unauthorized',
          routeOperationType: 'webhook_secret_validation',
          adapterType: null,
          adapterResultSummary: null,
          operationResultSummary: null,
          telegramUpdateReference,
          rejectionReason: '[TELEGRAM_WEBHOOK_ROUTE] Invalid webhook secret token',
          nowIso,
        })
      );
    }

    try {
      let adapterType = null;
      let adapterResult = null;

      if (rawUpdate && typeof rawUpdate === 'object' && !Array.isArray(rawUpdate)) {
        if (rawUpdate.message) {
          adapterType = 'command';
          adapterResult = resolvedCommandAdapter.handleCommandUpdate(rawUpdate);
        } else if (rawUpdate.callback_query) {
          adapterType = 'callback';
          adapterResult = resolvedCallbackAdapter.handleCallbackUpdate(rawUpdate);
        }
      }

      if (!adapterResult) {
        return res.status(200).json(
          buildRouteResult({
            routeStatus: 'ignored_unsupported_update',
            routeOperationType: 'unsupported_update',
            adapterType: null,
            adapterResultSummary: null,
            operationResultSummary: null,
            telegramUpdateReference,
            rejectionReason: null,
            nowIso,
          })
        );
      }

      const routeStatus = mapAdapterResultToRouteStatus(adapterResult);
      return res.status(200).json(
        buildRouteResult({
          routeStatus,
          routeOperationType: adapterResult.operation_type || null,
          adapterType,
          adapterResultSummary: adapterResult,
          operationResultSummary: adapterResult.operation_result_summary || null,
          telegramUpdateReference,
          rejectionReason: adapterResult.rejection_reason || null,
          nowIso,
        })
      );
    } catch (error) {
      return res.status(500).json(
        buildRouteResult({
          routeStatus: 'internal_error',
          routeOperationType: 'webhook_dispatch',
          adapterType: null,
          adapterResultSummary: null,
          operationResultSummary: null,
          telegramUpdateReference,
          rejectionReason: normalizeString(error?.message) || 'internal_error',
          nowIso,
        })
      );
    }
  });

  return router;
}
