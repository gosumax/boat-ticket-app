import { beforeEach, describe, expect, it } from 'vitest';
import {
  TELEGRAM_BOT_START_RESPONSE_VERSION,
  TELEGRAM_GUEST_ACTION_STATE_PROJECTION_VERSION,
} from '../../shared/telegram/index.js';
import {
  createClock,
  createTestContext,
  wireClock,
} from './_guest-ticket-test-helpers.js';

function buildStartUpdate({ updateId, messageId, telegramUserId, unixSeconds, text }) {
  return {
    update_id: updateId,
    message: {
      message_id: messageId,
      date: unixSeconds,
      text,
      from: {
        id: telegramUserId,
        is_bot: false,
        first_name: 'Runtime',
        last_name: 'Guest',
        username: `runtime_guest_${telegramUserId}`,
        language_code: 'ru',
      },
      chat: {
        id: telegramUserId,
        type: 'private',
        first_name: 'Runtime',
        last_name: 'Guest',
        username: `runtime_guest_${telegramUserId}`,
      },
    },
  };
}

describe('telegram inbound start orchestration service', () => {
  let clock;
  let context;

  beforeEach(() => {
    clock = createClock('2026-04-14T13:10:00.000Z');
    ({ context } = createTestContext(clock));
    wireClock(context, clock);
  });

  it('processes /start with seller source attribution and keeps idempotent replay stable', () => {
    const source = context.repositories.trafficSources.create({
      source_code: 'start-orch-seller-source-9201',
      source_type: 'seller_qr',
      source_name: 'Start Orch Seller Source',
      default_seller_id: 1,
      is_active: 1,
    });
    context.repositories.sourceQRCodes.create({
      qr_token: 'seller_qr_start_9201',
      traffic_source_id: source.traffic_source_id,
      seller_id: 1,
      entry_context: { channel: 'qr' },
      is_active: 1,
    });

    const update = buildStartUpdate({
      updateId: 9201001,
      messageId: 101,
      telegramUserId: 920101,
      unixSeconds: 1767772200,
      text: '/start seller_qr_start_9201',
    });

    const first =
      context.services.inboundStartOrchestrationService.orchestrateInboundStartUpdate(
        update
      );
    const replay =
      context.services.inboundStartOrchestrationService.orchestrateInboundStartUpdate(
        update
      );

    expect(first).toMatchObject({
      orchestration_status: 'start_processed_with_seller_attribution',
      telegram_user_summary: {
        telegram_user_id: '920101',
      },
      guest_entry_reference: {
        reference_type: 'telegram_guest_entry_event',
      },
      source_binding_summary: {
        binding_status: 'resolved_seller_source',
        resolved_source_family: 'seller_qr',
      },
      attribution_summary: {
        attribution_status: 'ACTIVE',
        seller_attribution_active: true,
      },
      bot_start_state_summary: {
        response_version: TELEGRAM_BOT_START_RESPONSE_VERSION,
      },
      guest_action_state_summary: {
        response_version: TELEGRAM_GUEST_ACTION_STATE_PROJECTION_VERSION,
      },
    });
    expect(
      ['success', 'partial'].includes(
        first.analytics_capture_summary?.inbound_start_processed?.capture_status
      )
    ).toBe(true);
    expect(replay.guest_entry_reference.guest_entry_event_id).toBe(
      first.guest_entry_reference.guest_entry_event_id
    );
    expect(
      replay.source_binding_summary.source_binding_reference.source_binding_event_id
    ).toBe(first.source_binding_summary.source_binding_reference.source_binding_event_id);
    expect(Object.isFrozen(first)).toBe(true);
  });

  it('processes /start without source token deterministically', () => {
    const update = buildStartUpdate({
      updateId: 9202002,
      messageId: 102,
      telegramUserId: 920202,
      unixSeconds: 1767772800,
      text: '/start',
    });

    const result =
      context.services.inboundStartOrchestrationService.orchestrateInboundStartUpdate(
        update
      );

    expect(result).toMatchObject({
      orchestration_status: 'start_processed_without_source',
      source_binding_summary: {
        binding_status: 'no_source_token',
      },
      attribution_summary: {
        attribution_status: 'NO_SELLER_ATTRIBUTION',
        seller_attribution_active: false,
      },
    });
  });

  it('bridges seller source-registry token into runtime attribution and keeps promo analytics intact', () => {
    context.services.sourceRegistryService.createSourceRegistryItem({
      source_reference: 'promo-main-1',
      source_family: 'point_promo_source',
      source_type: 'promo_qr',
      source_token: 'promo-main-1',
    });
    context.services.sourceRegistryService.createSourceRegistryItem({
      source_reference: 'seller-maxim-1',
      source_family: 'seller_source',
      source_type: 'seller_qr',
      source_token: 'seller-maxim-1',
      seller_id: 1,
    });

    const promoResult =
      context.services.inboundStartOrchestrationService.orchestrateInboundStartUpdate(
        buildStartUpdate({
          updateId: 9202101,
          messageId: 201,
          telegramUserId: 920211,
          unixSeconds: 1767773400,
          text: '/start promo-main-1',
        })
      );
    const sellerResult =
      context.services.inboundStartOrchestrationService.orchestrateInboundStartUpdate(
        buildStartUpdate({
          updateId: 9202102,
          messageId: 202,
          telegramUserId: 920212,
          unixSeconds: 1767773460,
          text: '/start seller-maxim-1',
        })
      );

    expect(promoResult.orchestration_status).toBe('start_processed');
    expect(sellerResult.orchestration_status).toBe(
      'start_processed_with_seller_attribution'
    );
    expect(sellerResult.attribution_summary).toMatchObject({
      attribution_status: 'ACTIVE',
      seller_attribution_active: true,
    });

    const linkedRuntimeQr = context.repositories.sourceQRCodes.findOneBy(
      { qr_token: 'seller-maxim-1' },
      { orderBy: 'source_qr_code_id ASC' }
    );
    expect(linkedRuntimeQr).toBeTruthy();
    const linkedRuntimeSource = context.repositories.trafficSources.findOneBy(
      { source_code: 'seller-maxim-1' },
      { orderBy: 'traffic_source_id ASC' }
    );
    expect(linkedRuntimeSource).toBeTruthy();

    const sourceAnalyticsList =
      context.services.sourceAnalyticsReportingService.listSourcePerformanceSummaries();
    const promoItem = sourceAnalyticsList.items.find(
      (item) => item.source_reference.source_reference === 'promo-main-1'
    );
    const sellerItem = sourceAnalyticsList.items.find(
      (item) => item.source_reference.source_reference === 'seller-maxim-1'
    );

    expect(promoItem.counters_summary).toMatchObject({
      entries: 1,
      source_bindings: 1,
    });
    expect(sellerItem.counters_summary).toMatchObject({
      entries: 1,
      source_bindings: 1,
    });

    const overallSummary =
      context.services.sourceAnalyticsReportingService
        .readOverallTelegramFunnelCountersSummary();
    expect(overallSummary.counters_summary.entries).toBe(2);
    expect(overallSummary.counters_summary.source_bindings).toBe(2);

    const sourceDetailSeller =
      context.services.sourceAnalyticsReportingService
        .readSourcePerformanceReportBySourceReference({
          source_reference: 'seller-maxim-1',
        });
    expect(sourceDetailSeller.source_performance_report.counters_summary.entries).toBe(1);
  });

  it('rejects invalid and non-start updates with deterministic status', () => {
    const result =
      context.services.inboundStartOrchestrationService.orchestrateInboundStartUpdate({
        update_id: 9203003,
        callback_query: {
          id: 'cbq-1',
        },
      });

    expect(result).toMatchObject({
      orchestration_status: 'start_rejected_invalid_update',
      rejection_reason: expect.stringContaining('Unsupported non-message update'),
      guest_entry_reference: null,
      source_binding_summary: null,
      attribution_summary: null,
    });
  });
});
