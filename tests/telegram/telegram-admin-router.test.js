import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTelegramAdminRouter } from '../../server/telegram/admin-router.mjs';
import {
  createClock,
  createTestContext,
  seedBookingRequest,
  wireClock,
} from './_guest-ticket-test-helpers.js';

describe('telegram admin content-management router', () => {
  let db;
  let clock;
  let context;
  let app;
  let currentRole;

  beforeEach(() => {
    clock = createClock('2026-04-14T13:30:00.000Z');
    ({ db, context } = createTestContext(clock));
    wireClock(context, clock);
    currentRole = 'admin';

    app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.user = { id: 9901, role: currentRole };
      next();
    });
    app.use(
      '/api/telegram/admin',
      createTelegramAdminRouter({
        telegramContext: context,
        now: clock.now,
      })
    );
  });

  afterEach(() => {
    db.close();
  });

  it('loads service-message templates and supports type filtering', async () => {
    const listResponse = await request(app).get('/api/telegram/admin/service-message-templates');
    expect(listResponse.status).toBe(200);
    expect(listResponse.body).toMatchObject({
      response_version: 'telegram_admin_http_route_result.v1',
      route_status: 'processed',
      route_operation_type: 'admin_service_message_template_list',
      operation_result_summary: {
        response_version: 'telegram_service_message_template_list.v1',
        item_count: expect.any(Number),
        items: expect.any(Array),
      },
    });

    const reminderResponse = await request(app).get(
      '/api/telegram/admin/service-message-templates?template_type=1_hour_before_trip'
    );
    expect(reminderResponse.status).toBe(200);
    expect(reminderResponse.body.operation_result_summary.item_count).toBe(1);
    expect(
      reminderResponse.body.operation_result_summary.items[0].template_type
    ).toBe('1_hour_before_trip');
  });

  it('updates templates version-safe and supports enable/disable lifecycle', async () => {
    const readResponse = await request(app).get(
      '/api/telegram/admin/service-message-templates/tg_service_message_template_hold_extended'
    );
    expect(readResponse.status).toBe(200);
    const currentVersion =
      readResponse.body.operation_result_summary.service_message_template.version_summary
        .template_version;

    const updateResponse = await request(app)
      .patch(
        '/api/telegram/admin/service-message-templates/tg_service_message_template_hold_extended'
      )
      .send({
        expected_version: currentVersion,
        title_name_summary: 'Hold Extended Operator Edit',
        text_body_summary: 'Operator-edited hold extension message body.',
      });
    expect(updateResponse.status).toBe(200);
    expect(updateResponse.body).toMatchObject({
      route_operation_type: 'admin_service_message_template_update',
      operation_result_summary: {
        operation: 'updated_version_safe',
        service_message_template: {
          title_name_summary: {
            title_name: 'Hold Extended Operator Edit',
          },
        },
      },
    });

    const staleConflictResponse = await request(app)
      .patch(
        '/api/telegram/admin/service-message-templates/tg_service_message_template_hold_extended'
      )
      .send({
        expected_version: currentVersion,
        title_name_summary: 'stale write',
      });
    expect(staleConflictResponse.status).toBe(409);
    expect(staleConflictResponse.body.route_status).toBe('blocked_not_possible');
    expect(staleConflictResponse.body.rejection_reason).toContain('version conflict');

    const latestVersion =
      updateResponse.body.operation_result_summary.service_message_template.version_summary
        .template_version;
    const disableResponse = await request(app)
      .post(
        '/api/telegram/admin/service-message-templates/tg_service_message_template_hold_extended/disable'
      )
      .send({ expected_version: latestVersion });
    expect(disableResponse.status).toBe(200);
    expect(
      disableResponse.body.operation_result_summary.service_message_template.enabled_state_summary
        .enabled
    ).toBe(false);

    const disabledVersion =
      disableResponse.body.operation_result_summary.service_message_template.version_summary
        .template_version;
    const enableResponse = await request(app)
      .post(
        '/api/telegram/admin/service-message-templates/tg_service_message_template_hold_extended/enable'
      )
      .send({ expected_version: disabledVersion });
    expect(enableResponse.status).toBe(200);
    expect(
      enableResponse.body.operation_result_summary.service_message_template.enabled_state_summary
        .enabled
    ).toBe(true);
  });

  it('loads, edits, and disables managed FAQ/useful content with projection readbacks', async () => {
    const listResponse = await request(app).get(
      '/api/telegram/admin/managed-content?content_group=faq_general&content_group=useful_places'
    );
    expect(listResponse.status).toBe(200);
    expect(listResponse.body.operation_result_summary.item_count).toBeGreaterThan(0);

    const faqItem = listResponse.body.operation_result_summary.items.find(
      (item) => item.content_type_group_summary?.content_group === 'faq_general'
    );
    expect(faqItem).toBeTruthy();

    const faqReference = faqItem.content_reference;
    const faqVersion = faqItem.version_summary.content_version;
    const updateResponse = await request(app)
      .patch(`/api/telegram/admin/managed-content/${faqReference}`)
      .send({
        expected_version: faqVersion,
        title_summary: 'Updated FAQ title from admin router',
      });
    expect(updateResponse.status).toBe(200);
    expect(updateResponse.body).toMatchObject({
      route_operation_type: 'admin_managed_content_update',
      operation_result_summary: {
        operation: 'updated_version_safe',
        content_item: {
          content_reference: faqReference,
          title_summary: {
            title: 'Updated FAQ title from admin router',
          },
        },
      },
    });

    const updatedVersion =
      updateResponse.body.operation_result_summary.content_item.version_summary
        .content_version;
    const disableResponse = await request(app)
      .post(`/api/telegram/admin/managed-content/${faqReference}/disable`)
      .send({ expected_version: updatedVersion });
    expect(disableResponse.status).toBe(200);
    expect(
      disableResponse.body.operation_result_summary.content_item.visibility_enabled_summary.enabled
    ).toBe(false);

    const faqProjectionResponse = await request(app).get('/api/telegram/admin/faq');
    expect(faqProjectionResponse.status).toBe(200);
    expect(faqProjectionResponse.body.route_operation_type).toBe('admin_faq_list');
    expect(
      faqProjectionResponse.body.operation_result_summary.items.some(
        (item) => item.faq_reference === faqReference
      )
    ).toBe(false);

    const usefulProjectionResponse = await request(app).get(
      '/api/telegram/admin/useful-content'
    );
    expect(usefulProjectionResponse.status).toBe(200);
    expect(usefulProjectionResponse.body.route_operation_type).toBe(
      'admin_useful_content_list'
    );
    expect(usefulProjectionResponse.body.operation_result_summary.item_count).toBeGreaterThan(0);
  });

  it('supports telegram source registry create/read/update/seller-binding, qr payload retrieval, and analytics reporting', async () => {
    const createSourceResponse = await request(app)
      .post('/api/telegram/admin/source-registry')
      .send({
        source_reference: 'tg_src_admin_router_7101',
        source_family: 'seller_source',
        source_type: 'seller_qr',
        source_token: 'seller-qr-admin-router-7101',
        seller_id: 1,
        is_exportable: true,
      });
    expect(createSourceResponse.status).toBe(200);
    expect(createSourceResponse.body).toMatchObject({
      route_operation_type: 'admin_source_registry_create',
      operation_result_summary: {
        source_registry_item: {
          source_reference: {
            source_reference: 'tg_src_admin_router_7101',
          },
          seller_reference: {
            seller_id: 1,
          },
          source_type_family_summary: {
            source_family: 'seller_source',
            source_type: 'seller_qr',
          },
        },
      },
    });

    const listResponse = await request(app).get(
      '/api/telegram/admin/source-registry?source_family=seller_source'
    );
    expect(listResponse.status).toBe(200);
    expect(listResponse.body.route_operation_type).toBe('admin_source_registry_list');
    expect(
      listResponse.body.operation_result_summary.items.some(
        (item) =>
          item.source_reference?.source_reference === 'tg_src_admin_router_7101'
      )
    ).toBe(true);

    const readResponse = await request(app).get(
      '/api/telegram/admin/source-registry/tg_src_admin_router_7101'
    );
    expect(readResponse.status).toBe(200);
    expect(readResponse.body.route_operation_type).toBe('admin_source_registry_read');

    const updateResponse = await request(app)
      .patch('/api/telegram/admin/source-registry/tg_src_admin_router_7101')
      .send({
        source_type: 'seller_direct_link',
        seller_id: 1,
        is_enabled: true,
      });
    expect(updateResponse.status).toBe(200);
    expect(updateResponse.body).toMatchObject({
      route_operation_type: 'admin_source_registry_update',
      operation_result_summary: {
        operation: 'updated',
        source_registry_item: {
          source_type_family_summary: {
            source_type: 'seller_direct_link',
          },
          seller_reference: {
            seller_id: 1,
          },
        },
      },
    });

    const qrPayloadResponse = await request(app).get(
      '/api/telegram/admin/source-registry/tg_src_admin_router_7101/qr-export-payload'
    );
    expect(qrPayloadResponse.status).toBe(200);
    expect(qrPayloadResponse.body.route_operation_type).toBe(
      'admin_qr_export_payload_read'
    );
    expect(
      qrPayloadResponse.body.operation_result_summary.qr_export_payload
        .printable_exportable_payload_summary.start_command_payload
    ).toBe('/start seller-qr-admin-router-7101');

    const qrPayloadListResponse = await request(app).get(
      '/api/telegram/admin/source-registry/qr-export-payloads'
    );
    expect(qrPayloadListResponse.status).toBe(200);
    expect(qrPayloadListResponse.body.route_operation_type).toBe(
      'admin_qr_export_payload_list'
    );

    const seeded = seedBookingRequest(context, clock, { suffix: '7101' });
    const sourceReference =
      createSourceResponse.body.operation_result_summary.source_registry_item
        .source_reference;
    context.services.analyticsFoundationService.captureAnalyticsEventFromTelegramState({
      event_type: 'guest_entry',
      booking_request_id: seeded.bookingRequestId,
      guest_profile_id: seeded.guest.guest_profile_id,
      source_reference: sourceReference,
      idempotency_key: 'tg_router_analytics_entry_7101',
      event_payload: {},
    });
    context.services.analyticsFoundationService.captureAnalyticsEventFromTelegramState({
      event_type: 'booking_request_created',
      booking_request_id: seeded.bookingRequestId,
      guest_profile_id: seeded.guest.guest_profile_id,
      source_reference: sourceReference,
      idempotency_key: 'tg_router_analytics_request_7101',
      event_payload: {},
    });
    context.services.analyticsFoundationService.captureAnalyticsEventFromTelegramState({
      event_type: 'prepayment_confirmed',
      booking_request_id: seeded.bookingRequestId,
      guest_profile_id: seeded.guest.guest_profile_id,
      source_reference: sourceReference,
      idempotency_key: 'tg_router_analytics_confirm_7101',
      event_payload: {},
    });
    context.services.analyticsFoundationService.captureAnalyticsEventFromTelegramState({
      event_type: 'bridge_outcome',
      booking_request_id: seeded.bookingRequestId,
      guest_profile_id: seeded.guest.guest_profile_id,
      source_reference: sourceReference,
      idempotency_key: 'tg_router_analytics_bridge_7101',
      event_payload: {
        linked_to_presale: true,
        completed_trip: true,
      },
    });

    const analyticsListResponse = await request(app).get('/api/telegram/admin/source-analytics');
    expect(analyticsListResponse.status).toBe(200);
    expect(analyticsListResponse.body.route_operation_type).toBe(
      'admin_source_analytics_list'
    );
    const sourceAnalyticsItem = analyticsListResponse.body.operation_result_summary.items.find(
      (item) => item.source_reference?.source_reference === 'tg_src_admin_router_7101'
    );
    expect(sourceAnalyticsItem.counters_summary).toMatchObject({
      entries: 1,
      booking_requests: 1,
      prepayment_confirmations: 1,
      completed_trips: 1,
    });

    const analyticsReadResponse = await request(app).get(
      '/api/telegram/admin/source-analytics/tg_src_admin_router_7101'
    );
    expect(analyticsReadResponse.status).toBe(200);
    expect(analyticsReadResponse.body.route_operation_type).toBe(
      'admin_source_analytics_read'
    );

    const funnelSummaryResponse = await request(app).get(
      '/api/telegram/admin/source-analytics/funnel-summary'
    );
    expect(funnelSummaryResponse.status).toBe(200);
    expect(funnelSummaryResponse.body.route_operation_type).toBe(
      'admin_source_analytics_funnel_summary'
    );
    expect(
      funnelSummaryResponse.body.operation_result_summary.counters_summary.entries
    ).toBeGreaterThanOrEqual(1);
  });

  it('returns unavailable or invalid responses for source/qr management edge cases', async () => {
    const missingReadResponse = await request(app).get(
      '/api/telegram/admin/source-registry/tg_src_missing_router_7102'
    );
    expect(missingReadResponse.status).toBe(404);
    expect(missingReadResponse.body.route_status).toBe('rejected_not_found');

    const sellerAliasCreateResponse = await request(app)
      .post('/api/telegram/admin/source-registry')
      .send({
        source_reference: 'tg_src_bad_router_7102',
        source_family: 'seller_source',
        source_type: 'seller_qr',
        source_token: 'seller-maxim-1',
        seller_id: 1,
      });
    expect(sellerAliasCreateResponse.status).toBe(200);
    expect(sellerAliasCreateResponse.body.route_status).toBe('processed');

    const sellerAliasQrReadResponse = await request(app).get(
      '/api/telegram/admin/source-registry/tg_src_bad_router_7102/qr-export-payload'
    );
    expect(sellerAliasQrReadResponse.status).toBe(200);
    expect(sellerAliasQrReadResponse.body.route_status).toBe('processed');

    const sellerAliasQrListResponse = await request(app).get(
      '/api/telegram/admin/source-registry/qr-export-payloads'
    );
    expect(sellerAliasQrListResponse.status).toBe(200);
    expect(
      sellerAliasQrListResponse.body.operation_result_summary.items.some(
        (item) =>
          item.source_reference?.source_reference === 'tg_src_bad_router_7102'
      )
    ).toBe(true);

    const invalidTokenCreateResponse = await request(app)
      .post('/api/telegram/admin/source-registry')
      .send({
        source_reference: 'tg_src_bad_token_router_7102',
        source_family: 'generic_source',
        source_type: 'generic_qr',
        source_token: 'bad token with spaces',
      });
    expect(invalidTokenCreateResponse.status).toBe(400);
    expect(invalidTokenCreateResponse.body.route_status).toBe('rejected_invalid_input');

    await request(app)
      .post('/api/telegram/admin/source-registry')
      .send({
        source_reference: 'tg_src_disabled_router_7102',
        source_family: 'owner_source',
        source_type: 'owner_source',
        source_token: 'owner-disabled-router-7102',
        is_enabled: false,
      })
      .expect(200);

    const disabledQrResponse = await request(app).get(
      '/api/telegram/admin/source-registry/tg_src_disabled_router_7102/qr-export-payload'
    );
    expect(disabledQrResponse.status).toBe(422);
    expect(disabledQrResponse.body.route_status).toBe('rejected_invalid_input');
  });

  it('rejects non-admin roles', async () => {
    currentRole = 'seller';

    const response = await request(app).get('/api/telegram/admin/service-message-templates');
    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({
      route_status: 'rejected_forbidden',
      route_operation_type: 'admin_role_check',
    });
  });
});
