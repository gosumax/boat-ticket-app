import { describe, expect, it } from 'vitest';
import {
  buildOwnerTelegramManualQueueModel,
  formatOwnerTelegramTimer,
} from '../../src/telegram/owner-manual-fallback-model.js';

describe('owner telegram manual fallback model', () => {
  it('maps queue + request-state projection into actionable operator cards', () => {
    const nowMs = Date.parse('2026-04-10T12:00:00.000Z');
    const queueResponse = {
      operation_result_summary: {
        items: [
          {
            queue_state: 'waiting_for_manual_contact',
            booking_request_reference: { booking_request_id: 101 },
            telegram_user_summary: {
              display_name: 'Guest 101',
              username: 'guest101',
              telegram_user_id: 'tg-101',
            },
            contact_phone_summary: { phone_e164: '+79991112233' },
            requested_seats_count: 3,
            requested_prepayment_amount: 4200,
            requested_trip_slot_reference: {
              requested_trip_date: '2026-04-12',
              requested_time_slot: '11:00',
            },
            hold_state_summary: {
              hold_expires_at_summary: {
                iso: '2026-04-10T12:10:00.000Z',
              },
            },
            attribution_summary: {
              source_family: 'promo_qr',
              traffic_source_summary: {
                source_name: 'Promo Source',
                source_code: 'promo-101',
              },
            },
            current_route_target: {
              route_target_type: 'owner_manual',
              seller_reference: null,
            },
            current_route_reason: 'resolved_owner_source',
            latest_timestamp_summary: {
              iso: '2026-04-10T12:00:00.000Z',
            },
          },
        ],
      },
    };

    const requestStateResponse = {
      operation_result_summary: {
        items: [
          {
            booking_request_reference: { booking_request_id: 101 },
            current_manual_handling_state: 'manual_contact_in_progress',
          },
        ],
      },
    };

    const model = buildOwnerTelegramManualQueueModel(queueResponse, requestStateResponse, {
      nowMs,
    });

    expect(model.itemCount).toBe(1);
    expect(model.actionableCount).toBe(1);
    expect(model.items[0]).toMatchObject({
      bookingRequestId: 101,
      guestName: 'Guest 101',
      phone: '+79991112233',
      requestedSeats: 3,
      requestedPrepaymentAmount: 4200,
      requestedTripDate: '2026-04-12',
      requestedTimeSlot: '11:00',
      sourceLabel: 'Promo Source (promo-101)',
      fallbackReason: 'Resolved owner source',
      handlingState: 'manual_contact_in_progress',
      queueState: 'waiting_for_manual_contact',
      routeTargetLabel: 'owner_manual',
    });
    expect(model.items[0].availableActions).toEqual([
      'call_started',
      'not_reached',
      'assign_to_seller',
      'manual_prepayment_confirmed',
    ]);
    expect(formatOwnerTelegramTimer(model.items[0].remainingMs)).toBe('10:00');
  });

  it('marks unavailable and expired cards as non-actionable with stable handling fallbacks', () => {
    const nowMs = Date.parse('2026-04-10T12:00:00.000Z');
    const queueResponse = {
      operation_result_summary: {
        items: [
          {
            queue_state: 'no_longer_actionable',
            booking_request_reference: { booking_request_id: 201 },
            telegram_user_summary: {
              display_name: 'Guest 201',
              telegram_user_id: 'tg-201',
            },
            hold_state_summary: {
              hold_expires_at_summary: {
                iso: '2026-04-10T11:30:00.000Z',
              },
            },
            current_route_target: {
              route_target_type: 'manual_review',
              seller_reference: null,
            },
            current_route_reason: 'unresolved_source_token',
            latest_timestamp_summary: {
              iso: '2026-04-10T11:59:00.000Z',
            },
          },
          {
            queue_state: 'prepayment_confirmed_waiting_handoff',
            booking_request_reference: { booking_request_id: 202 },
            telegram_user_summary: {
              display_name: 'Guest 202',
              telegram_user_id: 'tg-202',
            },
            hold_state_summary: {
              hold_expires_at_summary: {
                iso: '2026-04-10T12:20:00.000Z',
              },
            },
            current_route_target: {
              route_target_type: 'owner_manual',
              seller_reference: null,
            },
            current_route_reason: 'resolved_owner_source',
            latest_timestamp_summary: {
              iso: '2026-04-10T11:58:00.000Z',
            },
          },
        ],
      },
    };

    const model = buildOwnerTelegramManualQueueModel(queueResponse, { items: [] }, { nowMs });

    const unavailable = model.items.find((item) => item.bookingRequestId === 201);
    const prepayment = model.items.find((item) => item.bookingRequestId === 202);

    expect(unavailable.handlingState).toBe('no_longer_actionable');
    expect(unavailable.availableActions).toEqual([]);
    expect(unavailable.isExpired).toBe(true);
    expect(formatOwnerTelegramTimer(unavailable.remainingMs)).toBe('Expired');
    expect(unavailable.fallbackReason).toBe('Unresolved source token');

    expect(prepayment.handlingState).toBe('prepayment_confirmed');
    expect(prepayment.availableActions).toEqual([]);
  });

  it('reflects assign-to-seller transition by dropping reassigned item from queue list', () => {
    const nowMs = Date.parse('2026-04-10T12:00:00.000Z');
    const beforeAssign = buildOwnerTelegramManualQueueModel(
      {
        operation_result_summary: {
          items: [
            {
              queue_state: 'waiting_for_manual_contact',
              booking_request_reference: { booking_request_id: 301 },
              telegram_user_summary: {
                display_name: 'Guest 301',
                telegram_user_id: 'tg-301',
              },
              hold_state_summary: {
                hold_expires_at_summary: {
                  iso: '2026-04-10T12:15:00.000Z',
                },
              },
              current_route_target: {
                route_target_type: 'owner_manual',
                seller_reference: null,
              },
              current_route_reason: 'resolved_owner_source',
              latest_timestamp_summary: {
                iso: '2026-04-10T12:00:00.000Z',
              },
            },
          ],
        },
      },
      { items: [] },
      { nowMs }
    );

    const afterAssign = buildOwnerTelegramManualQueueModel(
      {
        operation_result_summary: {
          items: [],
        },
      },
      { items: [] },
      { nowMs }
    );

    expect(beforeAssign.itemCount).toBe(1);
    expect(beforeAssign.items[0].availableActions).toContain('assign_to_seller');
    expect(afterAssign.itemCount).toBe(0);
  });
});
