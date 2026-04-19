import { describe, expect, it } from 'vitest';
import {
  buildTelegramSourceManagementModel,
  createTelegramSourceDraft,
  getSourceTypeOptionsForFamily,
  reduceTelegramSourceEditorState,
  TELEGRAM_SOURCE_EDITOR_VIEW_STATES,
  TELEGRAM_SOURCE_FORM_MODES,
} from '../../src/telegram/admin-telegram-source-management-model.js';

describe('telegram admin source-management model', () => {
  it('maps source list + analytics + qr payload into deterministic operator model', () => {
    const model = buildTelegramSourceManagementModel({
      sourceRegistryList: {
        items: [
          {
            source_reference: {
              source_reference: 'tg_source_owner_alpha',
            },
            source_type_family_summary: {
              source_family: 'owner_source',
              source_type: 'owner_source',
            },
            source_token_summary: {
              source_token: 'owner-source-alpha',
            },
            enabled_state_summary: { enabled: true },
            printable_exportable_flag_summary: { exportable: true },
          },
          {
            source_reference: {
              source_reference: 'tg_source_seller_alpha',
            },
            source_type_family_summary: {
              source_family: 'seller_source',
              source_type: 'seller_qr',
            },
            source_token_summary: {
              source_token: 'seller-source-alpha',
            },
            seller_reference: { seller_id: 1 },
            enabled_state_summary: { enabled: true },
            printable_exportable_flag_summary: { exportable: true },
          },
        ],
      },
      analyticsList: {
        items: [
          {
            source_reference: { source_reference: 'tg_source_seller_alpha' },
            counters_summary: {
              entries: 10,
              attribution_starts: 7,
              booking_requests: 5,
              prepayment_confirmations: 3,
              completed_trips: 2,
            },
            conversion_summary: {
              booking_requests_from_entries: { percentage: 50 },
              prepayment_confirmations_from_booking_requests: { percentage: 60 },
              completed_trips_from_bridged_presales: { percentage: 66.67 },
            },
          },
        ],
      },
      qrExportPayloadList: {
        items: [
          {
            source_reference: { source_reference: 'tg_source_seller_alpha' },
            printable_exportable_payload_summary: {
              start_command_payload: '/start seller-source-alpha',
            },
          },
        ],
      },
      selectedSourceReference: 'tg_source_seller_alpha',
    });

    expect(model.summary).toEqual({
      total_sources: 2,
      enabled_sources: 2,
      seller_bound_sources: 1,
      exportable_sources: 2,
    });
    expect(model.selectedSource.sourceReference).toBe('tg_source_seller_alpha');
    expect(model.selectedCounters).toEqual({
      entries: 10,
      attribution_starts: 7,
      booking_requests: 5,
      confirmed_bookings: 3,
      completed_rides: 2,
    });
    expect(model.selectedConversion.booking_requests_from_entries_pct).toBe(50);
    expect(
      model.selectedQrPayloadItem.printable_exportable_payload_summary.start_command_payload
    ).toBe('/start seller-source-alpha');
  });

  it('keeps unavailable analytics/qr states safe and supports create mode drafts', () => {
    const createDraft = createTelegramSourceDraft(null);
    const model = buildTelegramSourceManagementModel({
      sourceRegistryList: {
        items: [
          {
            source_reference: { source_reference: 'tg_source_generic_beta' },
            source_type_family_summary: {
              source_family: 'generic_source',
              source_type: 'generic_qr',
            },
            source_token_summary: { source_token: 'generic-beta' },
            enabled_state_summary: { enabled: false },
            printable_exportable_flag_summary: { exportable: false },
          },
        ],
      },
      sourceDrafts: {
        __create__: {
          ...createDraft,
          sourceReference: 'tg_source_create_beta',
          sourceFamily: 'seller_source',
          sourceType: 'seller_qr',
          sellerId: '2',
          sourceToken: 'seller-create-beta',
        },
      },
      activeFormMode: TELEGRAM_SOURCE_FORM_MODES.CREATE,
    });

    expect(model.selectedSource.sourceReference).toBe('tg_source_generic_beta');
    expect(model.selectedCounters.entries).toBe(0);
    expect(model.selectedQrPayloadItem).toBe(null);
    expect(model.selectedDraft.sourceReference).toBe('tg_source_create_beta');
    expect(model.sourceTypeOptions).toEqual(getSourceTypeOptionsForFamily('seller_source'));
  });

  it('tracks source editor state transitions for load/save/error flows', () => {
    const afterLoadStart = reduceTelegramSourceEditorState(
      TELEGRAM_SOURCE_EDITOR_VIEW_STATES.IDLE,
      { type: 'start_load' }
    );
    const afterLoadSuccess = reduceTelegramSourceEditorState(afterLoadStart, {
      type: 'load_success',
    });
    const afterSaveStart = reduceTelegramSourceEditorState(afterLoadSuccess, {
      type: 'start_save',
    });
    const afterSaveError = reduceTelegramSourceEditorState(afterSaveStart, {
      type: 'save_error',
      errorMessage: 'duplicate incompatible source payload',
    });
    const afterReset = reduceTelegramSourceEditorState(afterSaveError, {
      type: 'reset_feedback',
    });

    expect(afterLoadStart).toBe(TELEGRAM_SOURCE_EDITOR_VIEW_STATES.LOADING);
    expect(afterLoadSuccess).toBe(TELEGRAM_SOURCE_EDITOR_VIEW_STATES.READY);
    expect(afterSaveStart).toBe(TELEGRAM_SOURCE_EDITOR_VIEW_STATES.SAVING);
    expect(afterSaveError).toBe(TELEGRAM_SOURCE_EDITOR_VIEW_STATES.ERROR);
    expect(afterReset).toBe(TELEGRAM_SOURCE_EDITOR_VIEW_STATES.READY);
  });
});
