import { beforeEach, describe, expect, it } from 'vitest';
import {
  TELEGRAM_MANAGED_CONTENT_GROUPS,
} from '../../shared/telegram/index.js';
import {
  createClock,
  createTestContext,
  seedBookingRequest,
  wireClock,
} from './_guest-ticket-test-helpers.js';

describe('telegram content-management foundation service', () => {
  let clock;
  let context;
  let seeded;

  beforeEach(() => {
    clock = createClock('2026-04-14T09:10:00.000Z');
    ({ context } = createTestContext(clock));
    wireClock(context, clock);
    seeded = seedBookingRequest(context, clock, { suffix: '6201' });
  });

  it('keeps deterministic managed-content groups coverage', () => {
    expect(TELEGRAM_MANAGED_CONTENT_GROUPS).toEqual([
      'useful_places',
      'what_to_take',
      'trip_help',
      'faq_general',
      'faq_trip_rules',
      'simple_service_content',
    ]);
  });

  it('lists managed content by group with stable frozen item shape', () => {
    const result =
      context.services.usefulContentFaqProjectionService.listContentItemsByGroup({
        content_group: 'simple_service_content',
      });

    expect(result.response_version).toBe('telegram_content_management_list.v1');
    expect(result.item_count).toBeGreaterThan(0);
    expect(result.items[0].content_type_group_summary.content_group).toBe(
      'simple_service_content'
    );
    expect(result.items[0].content_reference).toMatch(/^tg_simple_service_content_/);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.items[0])).toBe(true);
  });

  it('creates, updates version-safe, and enables/disables one managed content item', () => {
    const created =
      context.services.usefulContentFaqProjectionService.createContentItem({
        content_reference: 'tg_service_content_custom_6201',
        content_group: 'simple_service_content',
        content_type: 'service_content_block',
        title_summary: 'Custom Service Block',
        short_text_summary: 'A custom block for service-side guest hints.',
        visibility_action_summary: {
          visibility_state: 'visible',
          action_type: 'none',
          action_reference: null,
        },
      });
    expect(created.content_item.version_summary.content_version).toBe(1);
    expect(created.content_item.visibility_enabled_summary.enabled).toBe(true);

    const updated =
      context.services.usefulContentFaqProjectionService.updateContentItemVersionSafe({
        content_reference: 'tg_service_content_custom_6201',
        expected_version: 1,
        short_text_summary: 'Updated block text for deterministic version-safe update.',
      });
    expect(updated.content_item.version_summary.content_version).toBe(2);
    expect(updated.content_item.short_text_summary.short_text).toContain('Updated block text');

    const disabled =
      context.services.usefulContentFaqProjectionService.disableContentItem({
        content_reference: 'tg_service_content_custom_6201',
        expected_version: 2,
      });
    expect(disabled.content_item.version_summary.content_version).toBe(3);
    expect(disabled.content_item.visibility_enabled_summary.enabled).toBe(false);

    const readBack =
      context.services.usefulContentFaqProjectionService.readContentItemByReference({
        content_reference: 'tg_service_content_custom_6201',
      });
    expect(readBack.content_item.version_summary.content_version).toBe(3);
    expect(readBack.content_item.visibility_enabled_summary.enabled).toBe(false);
  });

  it('projects useful-content feed from managed storage and includes additive managed records', () => {
    context.services.usefulContentFaqProjectionService.createContentItem({
      content_reference: 'tg_useful_places_custom_6201',
      content_group: 'useful_places',
      content_type: 'useful_content_item',
      title_summary: 'Custom Useful Place',
      short_text_summary: 'An additive managed place item for guest feed projection.',
      visibility_action_summary: {
        visibility_state: 'visible',
        action_type: 'open_location_hint',
        action_reference: 'custom_place_6201',
      },
    });

    const feed =
      context.services.usefulContentFaqProjectionService.readUsefulContentFeedForTelegramGuest({
        telegram_user_reference: {
          reference_type: 'telegram_user',
          telegram_user_id: seeded.guest.telegram_user_id,
        },
        content_grouping: 'useful_places',
      });

    expect(
      feed.items.some((item) => item.content_reference === 'tg_useful_places_custom_6201')
    ).toBe(true);
    expect(feed.telegram_user_summary.telegram_user_id).toBe(seeded.guest.telegram_user_id);
  });

  it('rejects invalid or incompatible content payloads deterministically', () => {
    expect(() =>
      context.services.usefulContentFaqProjectionService.createContentItem({
        content_reference: 'tg_invalid_6201',
        content_group: 'faq_general',
        content_type: 'service_content_block',
        title_summary: 'Invalid',
        short_text_summary: 'Invalid',
      })
    ).toThrow('Incompatible content payload');

    context.services.usefulContentFaqProjectionService.createContentItem({
      content_reference: 'tg_valid_6201',
      content_group: 'trip_help',
      content_type: 'useful_content_item',
      title_summary: 'Valid Title',
      short_text_summary: 'Valid text',
    });

    expect(() =>
      context.services.usefulContentFaqProjectionService.updateContentItemVersionSafe({
        content_reference: 'tg_valid_6201',
        expected_version: 9,
        title_summary: 'drift',
      })
    ).toThrow('version conflict');
  });
});
