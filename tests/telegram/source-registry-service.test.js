import { beforeEach, describe, expect, it } from 'vitest';
import {
  createClock,
  createTestContext,
  wireClock,
} from './_guest-ticket-test-helpers.js';

describe('telegram source-registry foundation service', () => {
  let clock;
  let context;

  beforeEach(() => {
    clock = createClock('2026-04-14T10:30:00.000Z');
    ({ context } = createTestContext(clock));
    wireClock(context, clock);
    if (context.services.sourceRegistryService) {
      context.services.sourceRegistryService.now = clock.now;
    }
  });

  it('creates seller/owner/generic/point-promo source records and reads stable list shapes', () => {
    context.services.sourceRegistryService.createSourceRegistryItem({
      source_reference: 'tg_src_seller_6201',
      source_family: 'seller_source',
      source_type: 'seller_qr',
      source_token: 'seller-qr-token-6201',
      seller_id: 1,
      is_exportable: true,
    });
    context.services.sourceRegistryService.createSourceRegistryItem({
      source_reference: 'tg_src_owner_6201',
      source_family: 'owner_source',
      source_type: 'owner_source',
      source_token: 'owner-desk-6201',
    });
    context.services.sourceRegistryService.createSourceRegistryItem({
      source_reference: 'tg_src_generic_6201',
      source_family: 'generic_source',
      source_type: 'generic_qr',
      source_token: 'generic-entry-6201',
    });
    context.services.sourceRegistryService.createSourceRegistryItem({
      source_reference: 'tg_src_promo_6201',
      source_family: 'point_promo_source',
      source_type: 'promo_qr',
      source_token: 'promo-entry-6201',
    });

    const list = context.services.sourceRegistryService.listSourceRegistryItems();
    expect(list.response_version).toBe('telegram_source_registry_list.v1');
    expect(list.item_count).toBe(4);
    expect(
      list.items.map((item) => item.source_type_family_summary.source_family).sort()
    ).toEqual([
      'generic_source',
      'owner_source',
      'point_promo_source',
      'seller_source',
    ]);
    expect(Object.isFrozen(list)).toBe(true);
    expect(Object.isFrozen(list.items[0])).toBe(true);

    const readOne = context.services.sourceRegistryService.readSourceRegistryItemByReference({
      source_reference: 'tg_src_seller_6201',
    });
    expect(readOne.source_registry_item.source_reference.source_reference).toBe(
      'tg_src_seller_6201'
    );
    expect(readOne.source_registry_item.seller_reference.seller_id).toBe(1);
  });

  it('enables and disables one source registry item', () => {
    context.services.sourceRegistryService.createSourceRegistryItem({
      source_reference: 'tg_src_toggle_6201',
      source_family: 'owner_source',
      source_type: 'owner_source',
      source_token: 'owner-toggle-6201',
    });

    const disabled = context.services.sourceRegistryService.disableSourceRegistryItem({
      source_reference: 'tg_src_toggle_6201',
    });
    expect(disabled.source_registry_item.enabled_state_summary.enabled).toBe(false);

    const enabled = context.services.sourceRegistryService.enableSourceRegistryItem({
      source_reference: 'tg_src_toggle_6201',
    });
    expect(enabled.source_registry_item.enabled_state_summary.enabled).toBe(true);
  });

  it('updates one source record for seller binding/type changes and keeps idempotent updates stable', () => {
    context.services.sourceRegistryService.createSourceRegistryItem({
      source_reference: 'tg_src_update_6201',
      source_family: 'seller_source',
      source_type: 'seller_qr',
      source_token: 'seller-qr-update-6201',
      seller_id: 1,
    });

    const updated = context.services.sourceRegistryService.updateSourceRegistryItem({
      source_reference: 'tg_src_update_6201',
      source_type: 'seller_direct_link',
      seller_id: 1,
      is_exportable: false,
    });
    expect(updated.operation).toBe('updated');
    expect(
      updated.source_registry_item.source_type_family_summary.source_type
    ).toBe('seller_direct_link');
    expect(
      updated.source_registry_item.printable_exportable_flag_summary.exportable
    ).toBe(false);

    const idempotent = context.services.sourceRegistryService.updateSourceRegistryItem({
      source_reference: 'tg_src_update_6201',
      source_type: 'seller_direct_link',
      seller_id: 1,
      is_exportable: false,
    });
    expect(idempotent.operation).toBe('idempotent_update');
  });

  it('accepts unresolved-yet-token-compatible source tokens while rejecting invalid tokens and duplicates', () => {
    const unresolvedCreate = context.services.sourceRegistryService.createSourceRegistryItem({
      source_reference: 'tg_src_unresolved_6201',
      source_family: 'seller_source',
      source_type: 'seller_qr',
      source_token: 'maxim',
      seller_id: 1,
    });
    expect(unresolvedCreate.source_registry_item.source_token_summary.source_token).toBe('maxim');

    const sellerUnderscoreCreate = context.services.sourceRegistryService.createSourceRegistryItem({
      source_reference: 'tg_src_unresolved_6202',
      source_family: 'seller_source',
      source_type: 'seller_qr',
      source_token: 'seller_maxim_1',
      seller_id: 1,
    });
    expect(
      sellerUnderscoreCreate.source_registry_item.source_token_summary.source_token
    ).toBe('seller_maxim_1');

    const promoCreate = context.services.sourceRegistryService.createSourceRegistryItem({
      source_reference: 'tg_src_promo_6202',
      source_family: 'point_promo_source',
      source_type: 'promo_qr',
      source_token: 'promo-main-1',
    });
    expect(promoCreate.source_registry_item.source_token_summary.source_token).toBe(
      'promo-main-1'
    );

    expect(() =>
      context.services.sourceRegistryService.createSourceRegistryItem({
        source_reference: 'tg_src_bad_6201',
        source_family: 'generic_source',
        source_type: 'generic_qr',
        source_token: 'promo-incompatible-6201',
      })
    ).toThrow('incompatible source payload');

    expect(() =>
      context.services.sourceRegistryService.createSourceRegistryItem({
        source_reference: 'tg_src_unknown_6201',
        source_family: 'generic_source',
        source_type: 'generic_qr',
        source_token: 'bad token with spaces',
      })
    ).toThrow('source token must contain only letters');

    context.services.sourceRegistryService.createSourceRegistryItem({
      source_reference: 'tg_src_dup_6201',
      source_family: 'seller_source',
      source_type: 'seller_qr',
      source_token: 'seller-qr-dup-6201',
      seller_id: 1,
    });

    expect(() =>
      context.services.sourceRegistryService.createSourceRegistryItem({
        source_reference: 'tg_src_dup_drift_6201',
        source_family: 'seller_source',
        source_type: 'seller_qr',
        source_token: 'seller-qr-dup-6201',
        seller_id: 2,
      })
    ).toThrow('duplicate incompatible source payload');
  });

  it('accepts valid seller-bound source payloads and rejects missing/incompatible seller-source payloads', () => {
    const accepted = context.services.sourceRegistryService.createSourceRegistryItem({
      source_reference: 'seller-maxim-1',
      source_family: 'seller_source',
      source_type: 'seller_qr',
      source_token: 'seller-maxim-1',
      seller_id: 1,
      is_enabled: true,
      is_exportable: true,
    });
    expect(
      accepted.source_registry_item.source_reference.source_reference
    ).toBe('seller-maxim-1');
    expect(accepted.source_registry_item.seller_reference.seller_id).toBe(1);

    expect(() =>
      context.services.sourceRegistryService.createSourceRegistryItem({
        source_reference: 'seller-maxim-2',
        source_family: 'seller_source',
        source_type: 'seller_qr',
        source_token: 'seller-maxim-2',
      })
    ).toThrow('seller source requires seller reference');

    expect(() =>
      context.services.sourceRegistryService.createSourceRegistryItem({
        source_reference: 'seller-maxim-3',
        source_family: 'seller_source',
        source_type: 'promo_qr',
        source_token: 'seller-maxim-3',
        seller_id: 1,
      })
    ).toThrow('incompatible source payload for type/family');
  });
});
