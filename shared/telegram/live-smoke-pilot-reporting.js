import { freezeTelegramHandoffValue } from './handoff-readiness.js';
import { buildTelegramLatestTimestampSummary } from './seller-operations.js';

export const TELEGRAM_LIVE_SMOKE_PILOT_CHECKLIST_VERSION =
  'telegram_live_smoke_pilot_checklist.v1';
export const TELEGRAM_LIVE_SMOKE_PILOT_RESULT_CAPTURE_VERSION =
  'telegram_live_smoke_pilot_result_capture.v1';
export const TELEGRAM_LIVE_SMOKE_PILOT_REPORT_VERSION =
  'telegram_live_smoke_pilot_report.v1';

export const TELEGRAM_LIVE_SMOKE_PILOT_RESULT_STATUSES = Object.freeze({
  pass: 'pass',
  blocked: 'blocked',
  fail: 'fail',
  pending: 'pending',
});

export const TELEGRAM_LIVE_SMOKE_PILOT_RESULT_STATUS_NAMES = Object.freeze(
  Object.values(TELEGRAM_LIVE_SMOKE_PILOT_RESULT_STATUSES)
);

export const TELEGRAM_LIVE_SMOKE_PILOT_SCENARIO_KEYS = Object.freeze({
  start_command: 'start_command',
  approved_callback_actions: 'approved_callback_actions',
  mini_app_open: 'mini_app_open',
  booking_request_submit: 'booking_request_submit',
  seller_attributed_request_visibility: 'seller_attributed_request_visibility',
  manual_fallback_request_visibility: 'manual_fallback_request_visibility',
  ticket_my_tickets_access: 'ticket_my_tickets_access',
  faq_contact_useful_flows: 'faq_contact_useful_flows',
  reminder_or_post_trip_delivery_path: 'reminder_or_post_trip_delivery_path',
});

const CAPTURE_ALLOWED_STATUSES = new Set([
  TELEGRAM_LIVE_SMOKE_PILOT_RESULT_STATUSES.pass,
  TELEGRAM_LIVE_SMOKE_PILOT_RESULT_STATUSES.blocked,
  TELEGRAM_LIVE_SMOKE_PILOT_RESULT_STATUSES.fail,
]);

const SCENARIO_DEFINITIONS = Object.freeze([
  Object.freeze({
    scenario_key: TELEGRAM_LIVE_SMOKE_PILOT_SCENARIO_KEYS.start_command,
    scenario_title: '/start command',
    scenario_scope: 'webhook_runtime',
    required_smoke_checks: ['start_command_route'],
    required_services: ['runtimeEntrypointOrchestrationService'],
    verification_hint:
      'Send /start and record webhook route_status plus outbound delivery handoff status.',
  }),
  Object.freeze({
    scenario_key:
      TELEGRAM_LIVE_SMOKE_PILOT_SCENARIO_KEYS.approved_callback_actions,
    scenario_title: 'Approved callback actions',
    scenario_scope: 'bot_callbacks',
    required_smoke_checks: ['approved_callback_actions'],
    required_services: ['guestCommandActionOrchestrationService'],
    verification_hint:
      'Record one approved callback action result and route outcome for live smoke.',
  }),
  Object.freeze({
    scenario_key: TELEGRAM_LIVE_SMOKE_PILOT_SCENARIO_KEYS.mini_app_open,
    scenario_title: 'Mini App open',
    scenario_scope: 'mini_app_runtime',
    required_smoke_checks: ['mini_app_launch_readiness'],
    required_services: ['miniAppTripsCatalogQueryService', 'miniAppTripCardQueryService'],
    verification_hint:
      'Open Mini App launch URL and confirm catalog/trip-card path is reachable.',
  }),
  Object.freeze({
    scenario_key:
      TELEGRAM_LIVE_SMOKE_PILOT_SCENARIO_KEYS.booking_request_submit,
    scenario_title: 'Booking request submit',
    scenario_scope: 'mini_app_runtime',
    required_smoke_checks: ['mini_app_launch_readiness'],
    required_services: ['miniAppBookingSubmitOrchestrationService'],
    verification_hint:
      'Submit one booking request and capture submit_status plus route outcome.',
  }),
  Object.freeze({
    scenario_key:
      TELEGRAM_LIVE_SMOKE_PILOT_SCENARIO_KEYS.seller_attributed_request_visibility,
    scenario_title: 'Seller-attributed request visibility',
    scenario_scope: 'seller_runtime',
    required_smoke_checks: [],
    required_services: [
      'sellerWorkQueueService',
      'sellerWorkQueueQueryService',
      'sellerRequestStateProjectionService',
    ],
    verification_hint:
      'Confirm created seller-attributed request appears in seller queue/request-state views.',
  }),
  Object.freeze({
    scenario_key:
      TELEGRAM_LIVE_SMOKE_PILOT_SCENARIO_KEYS.manual_fallback_request_visibility,
    scenario_title: 'Manual-fallback request visibility',
    scenario_scope: 'owner_runtime',
    required_smoke_checks: [],
    required_services: [
      'manualFallbackQueueQueryService',
      'manualFallbackRequestStateProjectionService',
    ],
    verification_hint:
      'Confirm manual fallback request appears in owner/operator queue and state views.',
  }),
  Object.freeze({
    scenario_key:
      TELEGRAM_LIVE_SMOKE_PILOT_SCENARIO_KEYS.ticket_my_tickets_access,
    scenario_title: 'Ticket/my-tickets access',
    scenario_scope: 'mini_app_runtime',
    required_smoke_checks: ['mini_app_launch_readiness'],
    required_services: ['guestTicketViewProjectionService', 'offlineTicketSnapshotService'],
    verification_hint:
      'Read my-tickets list and at least one ticket/offline snapshot path.',
  }),
  Object.freeze({
    scenario_key:
      TELEGRAM_LIVE_SMOKE_PILOT_SCENARIO_KEYS.faq_contact_useful_flows,
    scenario_title: 'FAQ/contact/useful flows',
    scenario_scope: 'content_runtime',
    required_smoke_checks: ['mini_app_launch_readiness'],
    required_services: ['usefulContentFaqProjectionService', 'guestProfileService'],
    verification_hint:
      'Confirm FAQ, contact, and useful-content entrypoint read models are available.',
  }),
  Object.freeze({
    scenario_key:
      TELEGRAM_LIVE_SMOKE_PILOT_SCENARIO_KEYS.reminder_or_post_trip_delivery_path,
    scenario_title: 'Reminder/post-trip delivery readiness path',
    scenario_scope: 'scheduled_delivery_runtime',
    required_smoke_checks: ['outbound_delivery_readiness'],
    required_services: [
      'scheduledMessageRunnerService',
      'preTripReminderPlanningService',
      'templateExecutionOrchestrationService',
      'notificationDeliveryRunService',
      'notificationDeliveryExecutorService',
    ],
    verification_hint:
      'Confirm at least one reminder/post-trip execution path is ready for delivery handoff.',
  }),
]);

function normalizeString(value) {
  const normalized = String(value ?? '').trim();
  return normalized || null;
}

function resolveNowIso(now) {
  const value = typeof now === 'function' ? now() : now || new Date();
  const iso = value instanceof Date ? value.toISOString() : new Date(value).toISOString();
  if (Number.isNaN(Date.parse(iso))) {
    throw new Error('[TELEGRAM_LIVE_SMOKE_PILOT] invalid clock timestamp');
  }
  return iso;
}

function assertScenarioKey(scenarioKey) {
  if (!SCENARIO_DEFINITIONS.find((item) => item.scenario_key === scenarioKey)) {
    throw new Error(`Unsupported pilot scenario: ${String(scenarioKey || 'unknown')}`);
  }
}

function assertCaptureStatus(resultStatus) {
  if (!CAPTURE_ALLOWED_STATUSES.has(resultStatus)) {
    throw new Error(`Unsupported pilot result status: ${String(resultStatus || 'unknown')}`);
  }
}

function normalizeScenarioResultInput(item = {}) {
  const scenarioKey = normalizeString(item.scenario_key ?? item.scenarioKey);
  const resultStatus = normalizeString(item.result_status ?? item.resultStatus);
  const resultReason = normalizeString(item.result_reason ?? item.resultReason);
  const evidenceSummary = normalizeString(
    item.evidence_summary ?? item.evidenceSummary ?? item.evidence
  );
  const observedRouteStatus = normalizeString(
    item.observed_route_status ?? item.observedRouteStatus
  );

  assertScenarioKey(scenarioKey);
  assertCaptureStatus(resultStatus);

  return freezeTelegramHandoffValue({
    scenario_key: scenarioKey,
    result_status: resultStatus,
    result_reason: resultReason,
    evidence_summary: evidenceSummary,
    observed_route_status: observedRouteStatus,
  });
}

function evaluateScenarioReadiness(definition, { smokeReadinessSummary = null, services = null } = {}) {
  const smokeChecks = smokeReadinessSummary?.checks || {};
  const smokeStatus = normalizeString(smokeReadinessSummary?.smoke_status);
  const blockedReasons = [];

  if (smokeStatus === 'invalid_configuration') {
    blockedReasons.push('invalid_runtime_config');
  }

  for (const checkName of definition.required_smoke_checks) {
    const checkStatus = normalizeString(smokeChecks?.[checkName]?.check_status);
    if (checkStatus !== 'ready') {
      blockedReasons.push(`${checkName}_not_ready`);
    }
  }

  for (const serviceName of definition.required_services) {
    if (!services?.[serviceName]) {
      blockedReasons.push(`missing_service:${serviceName}`);
    }
  }

  return freezeTelegramHandoffValue({
    readiness_status: blockedReasons.length > 0 ? 'blocked' : 'ready',
    readiness_reason: blockedReasons[0] || null,
    blocked_reasons: blockedReasons,
  });
}

function listScenarioResultsInDefinitionOrder(resultMap = {}) {
  return SCENARIO_DEFINITIONS.map((definition) => {
    const record = resultMap?.[definition.scenario_key] || null;
    return freezeTelegramHandoffValue({
      scenario_key: definition.scenario_key,
      result_status: normalizeString(record?.result_status),
      result_reason: normalizeString(record?.result_reason),
      evidence_summary: normalizeString(record?.evidence_summary),
      observed_route_status: normalizeString(record?.observed_route_status),
      captured_at_summary: record?.captured_at_summary || null,
    });
  });
}

function buildDefaultResultForScenario(scenarioReadiness) {
  if (scenarioReadiness.readiness_status !== 'ready') {
    return {
      result_status: TELEGRAM_LIVE_SMOKE_PILOT_RESULT_STATUSES.blocked,
      result_reason: scenarioReadiness.readiness_reason || 'scenario_not_ready',
      source: 'readiness_fallback',
    };
  }
  return {
    result_status: TELEGRAM_LIVE_SMOKE_PILOT_RESULT_STATUSES.pending,
    result_reason: null,
    source: 'not_captured',
  };
}

function buildOverallResultStatus(counters = {}) {
  if (Number(counters.fail || 0) > 0) {
    return 'fail';
  }
  if (Number(counters.blocked || 0) > 0) {
    return 'blocked';
  }
  if (Number(counters.pending || 0) > 0) {
    return 'in_progress';
  }
  return 'pass';
}

export function buildTelegramLiveSmokePilotChecklist({
  smokeReadinessSummary = null,
  services = null,
  now = () => new Date(),
} = {}) {
  const nowIso = resolveNowIso(now);
  const scenarios = SCENARIO_DEFINITIONS.map((definition) => {
    const readiness = evaluateScenarioReadiness(definition, {
      smokeReadinessSummary,
      services,
    });

    return freezeTelegramHandoffValue({
      scenario_key: definition.scenario_key,
      scenario_title: definition.scenario_title,
      scenario_scope: definition.scenario_scope,
      required_for_live_pilot: true,
      readiness_status: readiness.readiness_status,
      readiness_reason: readiness.readiness_reason,
      blocked_reasons: readiness.blocked_reasons,
      required_smoke_checks: definition.required_smoke_checks,
      required_services: definition.required_services,
      verification_hint: definition.verification_hint,
    });
  });

  const readyCount = scenarios.filter((item) => item.readiness_status === 'ready').length;
  const blockedCount = scenarios.length - readyCount;

  return freezeTelegramHandoffValue({
    response_version: TELEGRAM_LIVE_SMOKE_PILOT_CHECKLIST_VERSION,
    checklist_type: 'telegram_live_smoke_pilot',
    smoke_status: normalizeString(smokeReadinessSummary?.smoke_status) || null,
    pilot_status: blockedCount > 0 ? 'blocked' : 'ready_for_execution',
    scenario_count: scenarios.length,
    ready_scenarios_count: readyCount,
    blocked_scenarios_count: blockedCount,
    scenarios,
    latest_timestamp_summary: buildTelegramLatestTimestampSummary(
      nowIso,
      smokeReadinessSummary?.latest_timestamp_summary?.iso
    ),
  });
}

export function captureTelegramLiveSmokePilotScenarioResults({
  previousResults = null,
  scenarioResults = [],
  now = () => new Date(),
} = {}) {
  if (!Array.isArray(scenarioResults)) {
    throw new Error('scenario_results must be an array');
  }

  const nowIso = resolveNowIso(now);
  const baseMap = {};
  if (previousResults && typeof previousResults === 'object' && !Array.isArray(previousResults)) {
    for (const [scenarioKey, value] of Object.entries(previousResults)) {
      if (!value || typeof value !== 'object') {
        continue;
      }
      if (!SCENARIO_DEFINITIONS.find((item) => item.scenario_key === scenarioKey)) {
        continue;
      }
      baseMap[scenarioKey] = freezeTelegramHandoffValue({
        scenario_key: scenarioKey,
        result_status: normalizeString(value.result_status),
        result_reason: normalizeString(value.result_reason),
        evidence_summary: normalizeString(value.evidence_summary),
        observed_route_status: normalizeString(value.observed_route_status),
        captured_at_summary: value.captured_at_summary || null,
      });
    }
  }

  const transitions = [];
  for (const rawResult of scenarioResults) {
    const normalized = normalizeScenarioResultInput(rawResult);
    const scenarioKey = normalized.scenario_key;
    const previous = baseMap[scenarioKey] || null;
    baseMap[scenarioKey] = freezeTelegramHandoffValue({
      scenario_key: scenarioKey,
      result_status: normalized.result_status,
      result_reason:
        normalized.result_reason || (normalized.result_status === 'pass' ? null : 'reason_not_provided'),
      evidence_summary: normalized.evidence_summary,
      observed_route_status: normalized.observed_route_status,
      captured_at_summary: buildTelegramLatestTimestampSummary(nowIso),
    });

    transitions.push(
      freezeTelegramHandoffValue({
        scenario_key: scenarioKey,
        previous_result_status: normalizeString(previous?.result_status),
        next_result_status: normalized.result_status,
        transition_applied:
          normalizeString(previous?.result_status) !== normalized.result_status ||
          normalizeString(previous?.result_reason) !==
            (normalized.result_reason || (normalized.result_status === 'pass' ? null : 'reason_not_provided')),
      })
    );
  }

  const ordered = listScenarioResultsInDefinitionOrder(baseMap);
  const capturedCount = ordered.filter((item) => item.result_status).length;

  return freezeTelegramHandoffValue({
    response_version: TELEGRAM_LIVE_SMOKE_PILOT_RESULT_CAPTURE_VERSION,
    capture_status: 'captured',
    updated_scenarios_count: transitions.filter((item) => item.transition_applied).length,
    captured_scenarios_count: capturedCount,
    updated_scenarios: transitions,
    scenario_results: ordered,
    captured_results_by_scenario: baseMap,
    latest_timestamp_summary: buildTelegramLatestTimestampSummary(nowIso),
  });
}

export function buildTelegramLiveSmokePilotReportEnvelope({
  checklist = null,
  capturedResults = null,
  now = () => new Date(),
} = {}) {
  if (!checklist || typeof checklist !== 'object' || Array.isArray(checklist)) {
    throw new Error('checklist is required');
  }
  if (!Array.isArray(checklist.scenarios)) {
    throw new Error('checklist.scenarios must be an array');
  }

  const nowIso = resolveNowIso(now);
  const counters = {
    pass: 0,
    blocked: 0,
    fail: 0,
    pending: 0,
  };
  const blockedReasons = new Set();
  const failedReasons = new Set();

  const scenarioResults = checklist.scenarios.map((scenario) => {
    const captured = capturedResults?.[scenario.scenario_key] || null;
    const fallback = buildDefaultResultForScenario(scenario);
    const fromCapture = Boolean(captured?.result_status);
    let resultStatus = normalizeString(captured?.result_status) || fallback.result_status;
    let resultReason = normalizeString(captured?.result_reason) || fallback.result_reason;
    let resultSource = fromCapture ? 'captured' : fallback.source;

    if (resultStatus === TELEGRAM_LIVE_SMOKE_PILOT_RESULT_STATUSES.pass) {
      if (scenario.readiness_status !== 'ready') {
        resultStatus = TELEGRAM_LIVE_SMOKE_PILOT_RESULT_STATUSES.blocked;
        resultReason = `scenario_not_ready:${scenario.readiness_reason || 'blocked'}`;
        resultSource = 'capture_overridden_by_readiness_guard';
      }
    }

    counters[resultStatus] += 1;
    if (resultStatus === TELEGRAM_LIVE_SMOKE_PILOT_RESULT_STATUSES.blocked && resultReason) {
      blockedReasons.add(resultReason);
    }
    if (resultStatus === TELEGRAM_LIVE_SMOKE_PILOT_RESULT_STATUSES.fail && resultReason) {
      failedReasons.add(resultReason);
    }

    return freezeTelegramHandoffValue({
      scenario_key: scenario.scenario_key,
      scenario_title: scenario.scenario_title,
      readiness_status: scenario.readiness_status,
      readiness_reason: scenario.readiness_reason,
      result_status: resultStatus,
      result_reason: resultReason,
      result_source: resultSource,
      captured_at_summary: captured?.captured_at_summary || null,
      evidence_summary: normalizeString(captured?.evidence_summary),
      observed_route_status: normalizeString(captured?.observed_route_status),
    });
  });

  const overallResultStatus = buildOverallResultStatus(counters);
  const misconfiguredBlockedCount = scenarioResults.filter(
    (item) =>
      item.result_status === TELEGRAM_LIVE_SMOKE_PILOT_RESULT_STATUSES.blocked &&
      (String(item.result_reason || '').includes('invalid_runtime_config') ||
        String(item.result_reason || '').startsWith('scenario_not_ready:invalid_runtime_config') ||
        String(item.result_reason || '').includes('missing_service:'))
  ).length;

  return freezeTelegramHandoffValue({
    response_version: TELEGRAM_LIVE_SMOKE_PILOT_REPORT_VERSION,
    report_type: 'telegram_live_smoke_pilot',
    overall_result_status: overallResultStatus,
    checklist_summary: {
      pilot_status: checklist.pilot_status,
      scenario_count: checklist.scenario_count,
      ready_scenarios_count: checklist.ready_scenarios_count,
      blocked_scenarios_count: checklist.blocked_scenarios_count,
    },
    status_counters: freezeTelegramHandoffValue(counters),
    hardening_summary: {
      action_required: overallResultStatus !== 'pass',
      blocked_reasons: Array.from(blockedReasons),
      failed_reasons: Array.from(failedReasons),
      misconfigured_scenarios_count: misconfiguredBlockedCount,
    },
    scenario_results: scenarioResults,
    latest_timestamp_summary: buildTelegramLatestTimestampSummary(
      nowIso,
      checklist.latest_timestamp_summary?.iso
    ),
  });
}
