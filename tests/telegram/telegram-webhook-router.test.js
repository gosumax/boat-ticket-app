import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import {
  buildTelegramCallbackUpdate,
  buildTelegramMessageUpdate,
  createClock,
  createTelegramWebhookTestApp,
  seedBookingRequest,
} from './_webhook-runtime-test-helpers.js';

describe('telegram webhook router', () => {
  let clock;
  let app;
  let db;
  let telegramContext;

  beforeEach(() => {
    clock = createClock('2026-04-14T16:00:00.000Z');
    ({ app, db, telegramContext } = createTelegramWebhookTestApp(clock));
  });

  afterEach(() => {
    db.close();
  });

  it('handles /start command through webhook route with deterministic fallback envelope', async () => {
    const response = await request(app)
      .post('/api/telegram/webhook')
      .send(
        buildTelegramMessageUpdate({
          updateId: 8601001,
          messageId: 301,
          telegramUserId: 860101,
          unixSeconds: 1767777600,
          text: '/start',
        })
      );

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      response_version: 'telegram_webhook_route_result.v1',
      route_status: 'processed_with_fallback',
      route_operation_type: 'inbound_start_update',
      adapter_type: 'command',
      adapter_result_summary: {
        mapping_status: 'mapped_start_command',
        operation_status: 'processed_with_fallback',
        outbound_response_summary: {
          outbound_mapping_status: 'mapped_start_response',
          delivery_handoff_summary: {
            handoff_status: 'sent',
          },
        },
      },
    });
  });

  it('handles callback guest action, blocked action, unsupported update, and template fallback', async () => {
    await request(app)
      .post('/api/telegram/webhook')
      .send(
        buildTelegramMessageUpdate({
          updateId: 8602001,
          messageId: 302,
          telegramUserId: 860201,
          unixSeconds: 1767777660,
          text: '/start',
        })
      );

    const actionResponse = await request(app)
      .post('/api/telegram/webhook')
      .send(
        buildTelegramCallbackUpdate({
          updateId: 8602002,
          callbackQueryId: 'cbq-8602-a',
          messageId: 303,
          telegramUserId: 860201,
          unixSeconds: 1767777720,
          data: 'open_useful_content',
        })
      );
    expect(actionResponse.status).toBe(200);
    expect(actionResponse.body).toMatchObject({
      route_status: 'processed',
      route_operation_type: 'guest_action_by_telegram_user',
      adapter_type: 'callback',
      adapter_result_summary: {
        mapping_status: 'mapped_guest_action_callback',
        mapped_action_type: 'open_useful_content',
        outbound_response_summary: {
          outbound_mapping_status: 'mapped_guest_action_response',
          delivery_handoff_summary: {
            handoff_status: 'sent',
          },
        },
      },
    });

    const blockedResponse = await request(app)
      .post('/api/telegram/webhook')
      .send(
        buildTelegramCallbackUpdate({
          updateId: 8602003,
          callbackQueryId: 'cbq-8602-b',
          messageId: 304,
          telegramUserId: 860201,
          unixSeconds: 1767777780,
          data: 'cancel_before_prepayment',
        })
      );
    expect(blockedResponse.status).toBe(200);
    expect(blockedResponse.body).toMatchObject({
      route_status: 'blocked_not_possible',
      adapter_result_summary: {
        operation_status: 'blocked_not_possible',
        outbound_response_summary: {
          outbound_mapping_status: 'mapped_guest_action_response_with_fallback',
        },
        operation_result_summary: {
          action_status: 'action_not_available',
        },
      },
    });

    const unsupportedUpdateResponse = await request(app)
      .post('/api/telegram/webhook')
      .send({ update_id: 8602004, edited_message: { message_id: 305 } });
    expect(unsupportedUpdateResponse.status).toBe(200);
    expect(unsupportedUpdateResponse.body).toMatchObject({
      route_status: 'ignored_unsupported_update',
      route_operation_type: 'unsupported_update',
      adapter_type: null,
    });

    const seeded = seedBookingRequest(telegramContext, clock, {
      suffix: '8602',
    });
    telegramContext.services.serviceMessageTemplateManagementService.disableServiceMessageTemplate(
      {
        template_reference: 'tg_service_message_template_booking_created',
      }
    );

    const fallbackTemplateResponse = await request(app)
      .post('/api/telegram/webhook')
      .send(
        buildTelegramCallbackUpdate({
          updateId: 8602005,
          callbackQueryId: 'cbq-8602-c',
          messageId: 306,
          telegramUserId: 860201,
          unixSeconds: 1767777840,
          data: `template:booking_created:${seeded.bookingRequestId}`,
        })
      );
    expect(fallbackTemplateResponse.status).toBe(200);
    expect(fallbackTemplateResponse.body).toMatchObject({
      route_status: 'processed_with_fallback',
      route_operation_type: 'template_message_by_booking_request',
      adapter_type: 'callback',
      adapter_result_summary: {
        mapping_status: 'mapped_template_callback',
        operation_status: 'processed_with_fallback',
      },
    });
  });

  it('enforces webhook secret handling and exposes health plus smoke readiness envelopes', async () => {
    const secured = createTelegramWebhookTestApp(clock, {
      telegramWebhookSecretToken: 'secure-token-8603',
      runtimeEnvOverrides: {
        TELEGRAM_BOT_TOKEN: '123456:ABC_DEF-runtime',
        TELEGRAM_PUBLIC_BASE_URL: 'https://example.test/api/telegram/webhook',
      },
    });
    const securedApp = secured.app;

    const unauthorized = await request(securedApp)
      .post('/api/telegram/webhook')
      .send(
        buildTelegramMessageUpdate({
          updateId: 8603001,
          messageId: 307,
          telegramUserId: 860301,
          unixSeconds: 1767777900,
          text: '/start',
        })
      );
    expect(unauthorized.status).toBe(401);
    expect(unauthorized.body).toMatchObject({
      route_status: 'rejected_unauthorized',
      route_operation_type: 'webhook_secret_validation',
    });

    const authorized = await request(securedApp)
      .post('/api/telegram/webhook')
      .set('x-telegram-bot-api-secret-token', 'secure-token-8603')
      .send(
        buildTelegramMessageUpdate({
          updateId: 8603002,
          messageId: 308,
          telegramUserId: 860301,
          unixSeconds: 1767777960,
          text: '/start',
        })
      );
    expect(authorized.status).toBe(200);
    expect(authorized.body).toMatchObject({
      route_operation_type: 'inbound_start_update',
      adapter_result_summary: {
        outbound_response_summary: {
          button_payloads: expect.arrayContaining([
            expect.objectContaining({
              action_type: 'open_mini_app',
              callback_data: null,
              web_app_url: expect.stringContaining('/telegram/mini-app'),
            }),
          ]),
        },
      },
    });
    const hasInlineMiniAppButton = Boolean(
      authorized.body?.adapter_result_summary?.outbound_response_summary?.button_payloads?.some(
        (item) => item.action_type === 'open_mini_app'
      )
    );
    expect(hasInlineMiniAppButton).toBe(true);

    const health = await request(securedApp).get('/api/telegram/health');
    expect(health.status).toBe(200);
    expect(health.body).toMatchObject({
      route_status: 'processed',
      route_operation_type: 'health_check',
      operation_result_summary: {
        startup_validation_summary: {
          ready_for_live_test_bot: true,
        },
      },
    });

    const readiness = await request(securedApp).get('/api/telegram/readiness');
    expect(readiness.status).toBe(200);
    expect(readiness.body).toMatchObject({
      route_status: 'processed',
      route_operation_type: 'runtime_readiness_check',
      operation_result_summary: {
        startup_validation_summary: {
          ready_for_live_test_bot: true,
        },
      },
    });

    const smokeReadiness = await request(securedApp).get(
      '/api/telegram/smoke-readiness'
    );
    expect(smokeReadiness.status).toBe(200);
    expect(smokeReadiness.body).toMatchObject({
      route_status: 'processed',
      route_operation_type: 'runtime_smoke_readiness_check',
      operation_result_summary: {
        smoke_status: 'ready_for_live_smoke',
        checks: {
          start_command_route: {
            check_status: 'ready',
          },
          approved_callback_actions: {
            check_status: 'ready',
          },
          outbound_delivery_readiness: {
            check_status: 'ready',
          },
          webhook_secret_handling: {
            check_status: 'ready',
          },
          mini_app_launch_readiness: {
            check_status: 'ready',
          },
        },
      },
    });

    const pilotChecklist = await request(securedApp)
      .get('/api/telegram/smoke-pilot/checklist')
      .query({ pilot_run_reference: 'live-smoke-8603' });
    expect(pilotChecklist.status).toBe(200);
    expect(pilotChecklist.body).toMatchObject({
      route_status: 'processed',
      route_operation_type: 'runtime_live_smoke_pilot_checklist',
      operation_result_summary: {
        pilot_run_reference: 'live-smoke-8603',
        checklist_summary: {
          pilot_status: 'ready_for_execution',
          scenario_count: 9,
          ready_scenarios_count: 9,
          blocked_scenarios_count: 0,
        },
        report_summary: {
          overall_result_status: 'in_progress',
          status_counters: {
            pass: 0,
            blocked: 0,
            fail: 0,
            pending: 9,
          },
        },
      },
    });

    const pilotCapture = await request(securedApp)
      .post('/api/telegram/smoke-pilot/report')
      .send({
        pilot_run_reference: 'live-smoke-8603',
        scenario_results: [
          {
            scenario_key: 'start_command',
            result_status: 'pass',
            observed_route_status: 'processed_with_fallback',
          },
          {
            scenario_key: 'approved_callback_actions',
            result_status: 'blocked',
            result_reason: 'callback_action_requires_retry',
          },
          {
            scenario_key: 'mini_app_open',
            result_status: 'fail',
            result_reason: 'mini_app_launch_http_500',
          },
        ],
      });
    expect(pilotCapture.status).toBe(200);
    expect(pilotCapture.body).toMatchObject({
      route_status: 'processed',
      route_operation_type: 'runtime_live_smoke_pilot_result_capture',
      operation_result_summary: {
        response_version: 'telegram_live_smoke_pilot_capture_envelope.v1',
        capture_summary: {
          captured_scenarios_count: 3,
          updated_scenarios_count: 3,
        },
        pilot_summary: {
          report_summary: {
            overall_result_status: 'fail',
            status_counters: {
              pass: 1,
              blocked: 1,
              fail: 1,
              pending: 6,
            },
          },
        },
      },
    });

    const invalidPilotCapture = await request(securedApp)
      .post('/api/telegram/smoke-pilot/report')
      .send({
        pilot_run_reference: 'live-smoke-8603',
        scenario_results: [
          {
            scenario_key: 'start_command',
            result_status: 'pending',
          },
        ],
      });
    expect(invalidPilotCapture.status).toBe(422);
    expect(invalidPilotCapture.body).toMatchObject({
      route_status: 'rejected_invalid_input',
      route_operation_type: 'runtime_live_smoke_pilot_result_capture',
    });

    secured.db.close();
  });
});
