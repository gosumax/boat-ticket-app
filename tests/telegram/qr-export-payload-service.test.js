import { beforeEach, describe, expect, it } from 'vitest';
import {
  createClock,
  createTestContext,
  wireClock,
} from './_guest-ticket-test-helpers.js';

describe('telegram qr export payload service', () => {
  let clock;
  let context;

  beforeEach(() => {
    clock = createClock('2026-04-14T14:05:00.000Z');
    ({ context } = createTestContext(clock));
    wireClock(context, clock);

    context.services.sourceRegistryService.createSourceRegistryItem({
      source_reference: 'tg_src_qr_seller_6401',
      source_family: 'seller_source',
      source_type: 'seller_qr',
      source_token: 'seller-qr-export-6401',
      seller_id: 1,
    });
    context.services.sourceRegistryService.createSourceRegistryItem({
      source_reference: 'tg_src_qr_owner_6401',
      source_family: 'owner_source',
      source_type: 'owner_source',
      source_token: 'owner-qr-export-6401',
    });
    context.services.sourceRegistryService.createSourceRegistryItem({
      source_reference: 'tg_src_qr_generic_6401',
      source_family: 'generic_source',
      source_type: 'generic_qr',
      source_token: 'generic-qr-export-6401',
    });
    context.services.sourceRegistryService.createSourceRegistryItem({
      source_reference: 'tg_src_qr_promo_6401',
      source_family: 'point_promo_source',
      source_type: 'promo_qr',
      source_token: 'promo-qr-export-6401',
    });
  });

  it('builds one export payload by source reference with stable frozen summaries', () => {
    const payload =
      context.services.qrExportPayloadService.buildQrExportPayloadBySourceReference(
        {
          source_reference: 'tg_src_qr_seller_6401',
        }
      );

    expect(payload.response_version).toBe('telegram_qr_export_payload_item.v1');
    expect(payload.qr_export_payload.source_reference.source_reference).toBe(
      'tg_src_qr_seller_6401'
    );
    expect(
      payload.qr_export_payload.source_type_family_summary.source_family
    ).toBe('seller_source');
    expect(
      payload.qr_export_payload.printable_exportable_payload_summary.start_command_payload
    ).toBe('/start seller-qr-export-6401');
    expect(Object.isFrozen(payload)).toBe(true);
    expect(Object.isFrozen(payload.qr_export_payload)).toBe(true);
  });

  it('lists qr export payloads for all enabled and exportable sources', () => {
    const list =
      context.services.qrExportPayloadService.listQrExportPayloadsForEnabledSources();

    expect(list.response_version).toBe('telegram_qr_export_payload_list.v1');
    expect(list.item_count).toBe(4);
    expect(
      list.items.map((item) => item.source_reference.source_reference).sort()
    ).toEqual([
      'tg_src_qr_generic_6401',
      'tg_src_qr_owner_6401',
      'tg_src_qr_promo_6401',
      'tg_src_qr_seller_6401',
    ]);
  });

  it('rejects invalid, disabled, non-exportable, or incompatible source inputs deterministically', () => {
    context.services.sourceRegistryService.createSourceRegistryItem({
      source_reference: 'tg_src_qr_disabled_6401',
      source_family: 'owner_source',
      source_type: 'owner_source',
      source_token: 'owner-qr-disabled-6401',
      is_enabled: false,
    });
    context.services.sourceRegistryService.createSourceRegistryItem({
      source_reference: 'tg_src_qr_non_export_6401',
      source_family: 'generic_source',
      source_type: 'generic_qr',
      source_token: 'generic-qr-non-export-6401',
      is_exportable: false,
    });
    context.repositories.sourceRegistryItems.create({
      source_reference: 'tg_src_qr_incompatible_6401',
      source_family: 'generic_source',
      source_type: 'generic_qr',
      source_token: 'seller-qr-incompatible-6401',
      seller_id: null,
      is_enabled: 1,
      is_exportable: 1,
      source_payload: {},
      created_at: clock.now().toISOString(),
      updated_at: clock.now().toISOString(),
    });

    expect(() =>
      context.services.qrExportPayloadService.buildQrExportPayloadBySourceReference({
        source_reference: 'tg_src_missing_qr_6401',
      })
    ).toThrow('invalid or non-projectable source input');
    expect(() =>
      context.services.qrExportPayloadService.buildQrExportPayloadBySourceReference({
        source_reference: 'tg_src_qr_disabled_6401',
      })
    ).toThrow('source is disabled');
    expect(() =>
      context.services.qrExportPayloadService.buildQrExportPayloadBySourceReference({
        source_reference: 'tg_src_qr_non_export_6401',
      })
    ).toThrow('non-exportable');
    expect(() =>
      context.services.qrExportPayloadService.buildQrExportPayloadBySourceReference({
        source_reference: 'tg_src_qr_incompatible_6401',
      })
    ).toThrow('incompatible source family');
  });
});
