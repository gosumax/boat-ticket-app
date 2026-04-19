import { describe, expect, it, vi } from 'vitest';
import {
  buildTelegramAnalyticsScreenModel,
  loadTelegramAnalyticsSnapshot,
  reduceTelegramAnalyticsViewState,
  TELEGRAM_ANALYTICS_VIEW_STATES,
} from '../../src/telegram/admin-telegram-analytics-model.js';

function makeSourceReport({
  sourceReference,
  sourceFamily = 'seller_source',
  sourceType = 'seller_qr',
  counters = {},
  conversion = {},
} = {}) {
  return {
    source_reference: {
      source_reference: sourceReference,
    },
    source_type_family_summary: {
      source_family: sourceFamily,
      source_type: sourceType,
    },
    counters_summary: {
      entries: 0,
      source_bindings: 0,
      attribution_starts: 0,
      booking_requests: 0,
      prepayment_confirmations: 0,
      bridged_presales: 0,
      completed_trips: 0,
      review_submissions: 0,
      ...counters,
    },
    conversion_summary: conversion,
  };
}

describe('telegram admin analytics model', () => {
  it('loads analytics snapshot with funnel + list + selected source detail', async () => {
    const getFunnel = vi.fn(async () => ({
      counters_summary: {
        entries: 20,
        attribution_starts: 10,
      },
      source_coverage_summary: {
        registered_sources: 2,
      },
    }));
    const getList = vi.fn(async () => ({
      items: [
        makeSourceReport({ sourceReference: 'tg_source_a' }),
        makeSourceReport({ sourceReference: 'tg_source_b' }),
      ],
    }));
    const getDetail = vi.fn(async (sourceReference) => ({
      source_performance_report: makeSourceReport({
        sourceReference,
        counters: { entries: 9, booking_requests: 4 },
      }),
    }));

    const snapshot = await loadTelegramAnalyticsSnapshot({
      apiClient: {
        getTelegramAdminSourceAnalyticsFunnelSummary: getFunnel,
        getTelegramAdminSourceAnalyticsSummaries: getList,
        getTelegramAdminSourceAnalyticsReport: getDetail,
      },
      preferredSourceReference: 'tg_source_b',
    });

    expect(snapshot.selectedSourceReference).toBe('tg_source_b');
    expect(snapshot.sourceDetailReport.source_reference.source_reference).toBe(
      'tg_source_b'
    );
    expect(snapshot.sourceDetailError).toBe('');
    expect(getFunnel).toHaveBeenCalledTimes(1);
    expect(getList).toHaveBeenCalledTimes(1);
    expect(getDetail).toHaveBeenCalledWith('tg_source_b');
  });

  it('builds funnel and per-source detail rendering model from existing backend shapes', () => {
    const model = buildTelegramAnalyticsScreenModel({
      funnelSummary: {
        counters_summary: {
          entries: 100,
          attribution_starts: 70,
          booking_requests: 45,
          prepayment_confirmations: 30,
          bridged_presales: 24,
          completed_trips: 12,
          review_submissions: 5,
        },
        source_coverage_summary: {
          registered_sources: 3,
        },
      },
      sourceAnalyticsList: {
        items: [
          makeSourceReport({
            sourceReference: 'tg_source_seller_alpha',
            counters: {
              entries: 20,
              attribution_starts: 16,
              booking_requests: 10,
              prepayment_confirmations: 8,
              bridged_presales: 7,
              completed_trips: 4,
              review_submissions: 1,
            },
          }),
        ],
      },
      selectedSourceReference: 'tg_source_seller_alpha',
      sourceDetailReport: makeSourceReport({
        sourceReference: 'tg_source_seller_alpha',
        counters: {
          entries: 22,
          attribution_starts: 17,
          booking_requests: 11,
          prepayment_confirmations: 9,
          bridged_presales: 8,
          completed_trips: 5,
          review_submissions: 2,
        },
      }),
    });

    expect(model.summary.registered_sources).toBe(3);
    expect(model.funnelSteps.map((item) => item.label)).toEqual([
      'Entries',
      'Attribution starts',
      'Request creation',
      'Prepayment confirmations',
      'Confirmed bookings',
      'Completed rides',
      'Reviews',
    ]);
    expect(model.funnelSteps[2].dropoff_from_previous).toBe(25);
    expect(model.selectedSourceReport.sourceReference).toBe('tg_source_seller_alpha');
    expect(model.selectedSourceReport.counters.booking_requests).toBe(11);
  });

  it('keeps empty and no-data analytics states safe', () => {
    const model = buildTelegramAnalyticsScreenModel({
      funnelSummary: {},
      sourceAnalyticsList: { items: [] },
      selectedSourceReference: null,
      sourceDetailReport: null,
    });

    expect(model.hasAnySources).toBe(false);
    expect(model.hasAnyOverallData).toBe(false);
    expect(model.summary.entries).toBe(0);
    expect(model.selectedSourceReport).toBe(null);
  });

  it('surfaces unavailable/invalid source detail without breaking the selected source summary', async () => {
    const snapshot = await loadTelegramAnalyticsSnapshot({
      apiClient: {
        getTelegramAdminSourceAnalyticsFunnelSummary: async () => ({
          counters_summary: { entries: 1 },
        }),
        getTelegramAdminSourceAnalyticsSummaries: async () => ({
          items: [makeSourceReport({ sourceReference: 'tg_source_invalid_case' })],
        }),
        getTelegramAdminSourceAnalyticsReport: async () => {
          throw Object.assign(new Error('invalid or non-projectable source input'), {
            response: {
              rejection_reason: 'invalid or non-projectable source input',
            },
          });
        },
      },
    });

    expect(snapshot.selectedSourceReference).toBe('tg_source_invalid_case');
    expect(snapshot.sourceDetailReport).toBe(null);
    expect(snapshot.sourceDetailError).toContain('invalid or non-projectable source input');

    const model = buildTelegramAnalyticsScreenModel({
      funnelSummary: snapshot.funnelSummary,
      sourceAnalyticsList: snapshot.sourceAnalyticsList,
      selectedSourceReference: snapshot.selectedSourceReference,
      sourceDetailReport: snapshot.sourceDetailReport,
      sourceDetailError: snapshot.sourceDetailError,
    });

    expect(model.selectedSourceSummary.sourceReference).toBe('tg_source_invalid_case');
    expect(model.selectedSourceDetail).toBe(null);
    expect(model.selectedSourceDetailUnavailable).toBe(true);
  });

  it('keeps global summary stable while selected source funnel switches per source', () => {
    const sourceAnalyticsList = {
      items: [
        makeSourceReport({
          sourceReference: 'promo-main-1',
          sourceFamily: 'point_promo_source',
          sourceType: 'promo_qr',
          counters: {
            entries: 30,
            attribution_starts: 20,
            booking_requests: 10,
            prepayment_confirmations: 8,
            bridged_presales: 6,
            completed_trips: 4,
            review_submissions: 2,
          },
        }),
        makeSourceReport({
          sourceReference: 'seller-maxim-1',
          sourceFamily: 'seller_source',
          counters: {
            entries: 12,
            attribution_starts: 9,
            booking_requests: 5,
            prepayment_confirmations: 3,
            bridged_presales: 2,
            completed_trips: 1,
            review_submissions: 1,
          },
        }),
        makeSourceReport({
          sourceReference: 'seller-sofiya',
          sourceFamily: 'seller_source',
          counters: {
            entries: 5,
            attribution_starts: 4,
            booking_requests: 3,
            prepayment_confirmations: 2,
            bridged_presales: 1,
            completed_trips: 1,
            review_submissions: 0,
          },
        }),
      ],
    };

    const buildFor = (selectedSourceReference) =>
      buildTelegramAnalyticsScreenModel({
        funnelSummary: {
          counters_summary: {
            entries: 77,
            attribution_starts: 55,
            booking_requests: 29,
            prepayment_confirmations: 20,
            bridged_presales: 14,
            completed_trips: 9,
            review_submissions: 3,
          },
          source_coverage_summary: { registered_sources: 3 },
        },
        sourceAnalyticsList,
        selectedSourceReference,
      });

    const promoModel = buildFor('promo-main-1');
    const maximModel = buildFor('seller-maxim-1');
    const sofiyaModel = buildFor('seller-sofiya');

    expect(promoModel.selectedSourceReport.sourceReference).toBe('promo-main-1');
    expect(promoModel.selectedSourceFunnelSteps[0].count).toBe(30);
    expect(maximModel.selectedSourceReport.sourceReference).toBe('seller-maxim-1');
    expect(maximModel.selectedSourceFunnelSteps[0].count).toBe(12);
    expect(sofiyaModel.selectedSourceReport.sourceReference).toBe('seller-sofiya');
    expect(sofiyaModel.selectedSourceFunnelSteps[0].count).toBe(5);

    expect(promoModel.funnelSteps[0].count).toBe(77);
    expect(maximModel.funnelSteps[0].count).toBe(77);
    expect(sofiyaModel.funnelSteps[0].count).toBe(77);
  });

  it('accepts source detail reports where source_reference is a plain string', () => {
    const model = buildTelegramAnalyticsScreenModel({
      sourceAnalyticsList: {
        items: [
          makeSourceReport({
            sourceReference: 'seller-maxim-1',
            counters: { entries: 4, booking_requests: 2 },
          }),
        ],
      },
      selectedSourceReference: 'seller-maxim-1',
      sourceDetailReport: {
        source_reference: 'seller-maxim-1',
        source_type_family_summary: {
          source_family: 'seller_source',
          source_type: 'seller_qr',
        },
        counters_summary: {
          entries: 9,
          booking_requests: 5,
        },
      },
    });

    expect(model.selectedSourceDetail.sourceReference).toBe('seller-maxim-1');
    expect(model.selectedSourceReport.counters.entries).toBe(9);
  });

  it('tracks analytics UI state transitions for loading, detail loading, warning, and error', () => {
    const afterLoadStart = reduceTelegramAnalyticsViewState(
      TELEGRAM_ANALYTICS_VIEW_STATES.IDLE,
      { type: 'start_load' }
    );
    const afterLoadSuccess = reduceTelegramAnalyticsViewState(afterLoadStart, {
      type: 'load_success',
    });
    const afterDetailStart = reduceTelegramAnalyticsViewState(afterLoadSuccess, {
      type: 'start_detail',
    });
    const afterDetailError = reduceTelegramAnalyticsViewState(afterDetailStart, {
      type: 'detail_error',
    });
    const afterReset = reduceTelegramAnalyticsViewState(afterDetailError, {
      type: 'reset_feedback',
    });
    const afterLoadError = reduceTelegramAnalyticsViewState(afterReset, {
      type: 'load_error',
    });

    expect(afterLoadStart).toBe(TELEGRAM_ANALYTICS_VIEW_STATES.LOADING);
    expect(afterLoadSuccess).toBe(TELEGRAM_ANALYTICS_VIEW_STATES.READY);
    expect(afterDetailStart).toBe(TELEGRAM_ANALYTICS_VIEW_STATES.DETAIL_LOADING);
    expect(afterDetailError).toBe(TELEGRAM_ANALYTICS_VIEW_STATES.DETAIL_WARNING);
    expect(afterReset).toBe(TELEGRAM_ANALYTICS_VIEW_STATES.READY);
    expect(afterLoadError).toBe(TELEGRAM_ANALYTICS_VIEW_STATES.ERROR);
  });
});
