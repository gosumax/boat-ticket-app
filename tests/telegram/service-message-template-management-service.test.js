import { beforeEach, describe, expect, it } from 'vitest';
import {
  TELEGRAM_SERVICE_MESSAGE_TEMPLATE_TYPES,
} from '../../shared/telegram/index.js';
import {
  createClock,
  createTestContext,
  wireClock,
} from './_guest-ticket-test-helpers.js';

describe('telegram service-message template management service', () => {
  let clock;
  let context;

  beforeEach(() => {
    clock = createClock('2026-04-14T12:45:00.000Z');
    ({ context } = createTestContext(clock));
    wireClock(context, clock);
  });

  it('lists and reads baseline service-message templates with stable frozen summaries', () => {
    const list =
      context.services.serviceMessageTemplateManagementService.listServiceMessageTemplates();

    expect(list.response_version).toBe('telegram_service_message_template_list.v1');
    expect(list.item_count).toBeGreaterThanOrEqual(8);
    expect(
      TELEGRAM_SERVICE_MESSAGE_TEMPLATE_TYPES.every((templateType) =>
        list.items.some((item) => item.template_type === templateType)
      )
    ).toBe(true);
    expect(Object.isFrozen(list)).toBe(true);
    expect(Object.isFrozen(list.items[0])).toBe(true);

    const read =
      context.services.serviceMessageTemplateManagementService
        .readServiceMessageTemplateByReference({
          template_reference: 'tg_service_message_template_booking_created',
        });
    expect(read.service_message_template.template_type).toBe('booking_created');
    expect(read.service_message_template.title_name_summary.title_name).toBeTruthy();
  });

  it('updates one template version-safe and supports enable/disable with deterministic versioning', () => {
    const initial =
      context.services.serviceMessageTemplateManagementService
        .readServiceMessageTemplateByReference({
          template_reference: 'tg_service_message_template_hold_extended',
        });
    const initialVersion = initial.service_message_template.version_summary.template_version;

    const updated =
      context.services.serviceMessageTemplateManagementService
        .updateServiceMessageTemplateVersionSafe({
          template_reference: 'tg_service_message_template_hold_extended',
          expected_version: initialVersion,
          title_name_summary: 'Hold Extended Updated',
          text_body_summary: 'Extended hold window remains active for your request.',
        });
    expect(updated.service_message_template.version_summary.template_version).toBe(
      initialVersion + 1
    );
    expect(updated.service_message_template.title_name_summary.title_name).toBe(
      'Hold Extended Updated'
    );

    const disabled =
      context.services.serviceMessageTemplateManagementService
        .disableServiceMessageTemplate({
          template_reference: 'tg_service_message_template_hold_extended',
          expected_version: initialVersion + 1,
        });
    expect(disabled.service_message_template.enabled_state_summary.enabled).toBe(false);
    expect(disabled.service_message_template.version_summary.template_version).toBe(
      initialVersion + 2
    );

    const enabled =
      context.services.serviceMessageTemplateManagementService
        .enableServiceMessageTemplate({
          template_reference: 'tg_service_message_template_hold_extended',
          expected_version: initialVersion + 2,
        });
    expect(enabled.service_message_template.enabled_state_summary.enabled).toBe(true);
    expect(enabled.service_message_template.version_summary.template_version).toBe(
      initialVersion + 3
    );
  });

  it('supports idempotent create and rejects invalid or incompatible payloads deterministically', () => {
    const idempotent =
      context.services.serviceMessageTemplateManagementService
        .createServiceMessageTemplate({
          template_type: 'booking_confirmed',
          template_reference: 'tg_service_message_template_booking_confirmed',
          title_name_summary: 'Booking Confirmed',
          text_body_summary:
            'Prepayment is confirmed. Your ticket status is available in Telegram.',
        });
    expect(idempotent.operation).toBe('idempotent_create');

    expect(() =>
      context.services.serviceMessageTemplateManagementService
        .createServiceMessageTemplate({
          template_type: 'booking_created',
          template_reference: 'tg_service_message_template_hold_expired',
          title_name_summary: 'Invalid',
          text_body_summary: 'Invalid',
        })
    ).toThrow('incompatible template reference/type');

    expect(() =>
      context.services.serviceMessageTemplateManagementService
        .updateServiceMessageTemplateVersionSafe({
          template_reference: 'tg_service_message_template_booking_created',
          expected_version: 999,
          title_name_summary: 'Version Drift',
        })
    ).toThrow('version conflict');
  });
});
