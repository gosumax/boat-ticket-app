import { describe, expect, it } from 'vitest';
import {
  buildTelegramLiveSmokePilotChecklist,
  buildTelegramLiveSmokePilotReportEnvelope,
  captureTelegramLiveSmokePilotScenarioResults,
  TELEGRAM_LIVE_SMOKE_PILOT_SCENARIO_KEYS,
} from '../../shared/telegram/index.js';

function createReadySmokeReadiness() {
  return {
    smoke_status: 'ready_for_live_smoke',
    checks: {
      start_command_route: { check_status: 'ready' },
      approved_callback_actions: { check_status: 'ready' },
      mini_app_launch_readiness: { check_status: 'ready' },
      outbound_delivery_readiness: { check_status: 'ready' },
      webhook_secret_handling: { check_status: 'ready' },
    },
    latest_timestamp_summary: {
      iso: '2026-04-15T10:00:00.000Z',
      unix_seconds: 1776247200,
    },
  };
}

function createReadyServices() {
  return {
    runtimeEntrypointOrchestrationService: {},
    guestCommandActionOrchestrationService: {},
    miniAppTripsCatalogQueryService: {},
    miniAppTripCardQueryService: {},
    miniAppBookingSubmitOrchestrationService: {},
    sellerWorkQueueService: {},
    sellerWorkQueueQueryService: {},
    sellerRequestStateProjectionService: {},
    manualFallbackQueueQueryService: {},
    manualFallbackRequestStateProjectionService: {},
    guestTicketViewProjectionService: {},
    offlineTicketSnapshotService: {},
    usefulContentFaqProjectionService: {},
    guestProfileService: {},
    scheduledMessageRunnerService: {},
    preTripReminderPlanningService: {},
    templateExecutionOrchestrationService: {},
    notificationDeliveryRunService: {},
    notificationDeliveryExecutorService: {},
  };
}

describe('telegram live smoke pilot reporting', () => {
  it('maps mixed pass/blocked/fail capture results into deterministic report counters', () => {
    const checklist = buildTelegramLiveSmokePilotChecklist({
      smokeReadinessSummary: createReadySmokeReadiness(),
      services: createReadyServices(),
      now: () => new Date('2026-04-15T10:00:00.000Z'),
    });
    const capture = captureTelegramLiveSmokePilotScenarioResults({
      previousResults: {},
      scenarioResults: [
        {
          scenario_key: TELEGRAM_LIVE_SMOKE_PILOT_SCENARIO_KEYS.start_command,
          result_status: 'pass',
        },
        {
          scenario_key:
            TELEGRAM_LIVE_SMOKE_PILOT_SCENARIO_KEYS.approved_callback_actions,
          result_status: 'blocked',
          result_reason: 'callback_payload_mismatch',
        },
        {
          scenario_key: TELEGRAM_LIVE_SMOKE_PILOT_SCENARIO_KEYS.mini_app_open,
          result_status: 'fail',
          result_reason: 'mini_app_launch_http_500',
        },
      ],
      now: () => new Date('2026-04-15T10:05:00.000Z'),
    });
    const report = buildTelegramLiveSmokePilotReportEnvelope({
      checklist,
      capturedResults: capture.captured_results_by_scenario,
      now: () => new Date('2026-04-15T10:05:30.000Z'),
    });

    expect(report).toMatchObject({
      response_version: 'telegram_live_smoke_pilot_report.v1',
      overall_result_status: 'fail',
      status_counters: {
        pass: 1,
        blocked: 1,
        fail: 1,
        pending: 6,
      },
      hardening_summary: {
        action_required: true,
        blocked_reasons: expect.arrayContaining(['callback_payload_mismatch']),
        failed_reasons: expect.arrayContaining(['mini_app_launch_http_500']),
      },
    });
  });

  it('tracks scenario status transitions across repeated result capture calls', () => {
    const checklist = buildTelegramLiveSmokePilotChecklist({
      smokeReadinessSummary: createReadySmokeReadiness(),
      services: createReadyServices(),
      now: () => new Date('2026-04-15T10:00:00.000Z'),
    });
    const firstCapture = captureTelegramLiveSmokePilotScenarioResults({
      previousResults: {},
      scenarioResults: [
        {
          scenario_key: TELEGRAM_LIVE_SMOKE_PILOT_SCENARIO_KEYS.start_command,
          result_status: 'blocked',
          result_reason: 'webhook_secret_unauthorized',
        },
      ],
      now: () => new Date('2026-04-15T10:01:00.000Z'),
    });
    const secondCapture = captureTelegramLiveSmokePilotScenarioResults({
      previousResults: firstCapture.captured_results_by_scenario,
      scenarioResults: [
        {
          scenario_key: TELEGRAM_LIVE_SMOKE_PILOT_SCENARIO_KEYS.start_command,
          result_status: 'pass',
        },
      ],
      now: () => new Date('2026-04-15T10:02:00.000Z'),
    });
    const report = buildTelegramLiveSmokePilotReportEnvelope({
      checklist,
      capturedResults: secondCapture.captured_results_by_scenario,
      now: () => new Date('2026-04-15T10:02:10.000Z'),
    });

    expect(secondCapture).toMatchObject({
      updated_scenarios_count: 1,
      updated_scenarios: [
        {
          scenario_key: TELEGRAM_LIVE_SMOKE_PILOT_SCENARIO_KEYS.start_command,
          previous_result_status: 'blocked',
          next_result_status: 'pass',
          transition_applied: true,
        },
      ],
    });
    expect(
      report.scenario_results.find(
        (item) =>
          item.scenario_key === TELEGRAM_LIVE_SMOKE_PILOT_SCENARIO_KEYS.start_command
      )
    ).toMatchObject({
      result_status: 'pass',
      result_source: 'captured',
    });
  });

  it('marks scenarios blocked in misconfigured runtime and overrides invalid pass captures', () => {
    const checklist = buildTelegramLiveSmokePilotChecklist({
      smokeReadinessSummary: {
        smoke_status: 'invalid_configuration',
        checks: {
          start_command_route: { check_status: 'not_ready' },
          approved_callback_actions: { check_status: 'not_ready' },
          mini_app_launch_readiness: { check_status: 'not_ready' },
          outbound_delivery_readiness: { check_status: 'not_ready' },
        },
      },
      services: createReadyServices(),
      now: () => new Date('2026-04-15T09:00:00.000Z'),
    });
    const capture = captureTelegramLiveSmokePilotScenarioResults({
      previousResults: {},
      scenarioResults: [
        {
          scenario_key: TELEGRAM_LIVE_SMOKE_PILOT_SCENARIO_KEYS.start_command,
          result_status: 'pass',
        },
      ],
      now: () => new Date('2026-04-15T09:01:00.000Z'),
    });
    const report = buildTelegramLiveSmokePilotReportEnvelope({
      checklist,
      capturedResults: capture.captured_results_by_scenario,
      now: () => new Date('2026-04-15T09:02:00.000Z'),
    });
    const startScenario = report.scenario_results.find(
      (item) => item.scenario_key === TELEGRAM_LIVE_SMOKE_PILOT_SCENARIO_KEYS.start_command
    );

    expect(checklist).toMatchObject({
      pilot_status: 'blocked',
      blocked_scenarios_count: 9,
    });
    expect(startScenario).toMatchObject({
      readiness_status: 'blocked',
      result_status: 'blocked',
      result_source: 'capture_overridden_by_readiness_guard',
    });
    expect(String(startScenario.result_reason)).toContain(
      'scenario_not_ready:invalid_runtime_config'
    );
    expect(report).toMatchObject({
      overall_result_status: 'blocked',
      hardening_summary: {
        misconfigured_scenarios_count: expect.any(Number),
      },
    });
    expect(report.hardening_summary.misconfigured_scenarios_count).toBeGreaterThan(0);
  });

  it('builds pending report envelopes when capture has not started yet', () => {
    const checklist = buildTelegramLiveSmokePilotChecklist({
      smokeReadinessSummary: createReadySmokeReadiness(),
      services: createReadyServices(),
      now: () => new Date('2026-04-15T10:00:00.000Z'),
    });
    const report = buildTelegramLiveSmokePilotReportEnvelope({
      checklist,
      capturedResults: {},
      now: () => new Date('2026-04-15T10:00:10.000Z'),
    });

    expect(report).toMatchObject({
      response_version: 'telegram_live_smoke_pilot_report.v1',
      report_type: 'telegram_live_smoke_pilot',
      overall_result_status: 'in_progress',
      status_counters: {
        pass: 0,
        blocked: 0,
        fail: 0,
        pending: 9,
      },
      hardening_summary: {
        action_required: true,
        blocked_reasons: [],
        failed_reasons: [],
      },
    });
  });
});
