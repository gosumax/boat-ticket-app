import { describe, expect, it } from 'vitest';
import {
  buildSellerTelegramQueueModel,
  formatSellerTelegramTimer,
  resolveSellerTelegramUrgency,
} from '../../src/components/seller/telegram/sellerTelegramQueueModel.js';

describe('seller telegram queue model', () => {
  it('classifies urgency as normal, urgent, and near_expiry using hold timer', () => {
    const nowMs = Date.parse('2036-04-10T10:00:00.000Z');
    expect(resolveSellerTelegramUrgency('2036-04-10T11:00:00.000Z', nowMs)).toBe('normal');
    expect(resolveSellerTelegramUrgency('2036-04-10T10:12:00.000Z', nowMs)).toBe('urgent');
    expect(resolveSellerTelegramUrgency('2036-04-10T10:04:59.000Z', nowMs)).toBe('near_expiry');
    expect(resolveSellerTelegramUrgency('2036-04-10T09:59:59.000Z', nowMs)).toBe('near_expiry');
  });

  it('builds queue cards with required seller fields and urgency ordering', () => {
    const nowMs = Date.parse('2036-04-10T10:00:00.000Z');
    const model = buildSellerTelegramQueueModel(
      {
        items: [
          {
            booking_request: {
              booking_request_id: 10,
              request_status: 'HOLD_ACTIVE',
              requested_trip_date: '2036-04-11',
              requested_time_slot: '12:00',
              requested_seats: 2,
              requested_prepayment_amount: 900,
              contact_phone_e164: '+79990000010',
            },
            booking_hold: {
              hold_expires_at: '2036-04-10T10:14:59.000Z',
              requested_amount: 1000,
            },
            guest_profile: {
              display_name: 'Guest Ten',
            },
            available_actions: ['call_started', 'not_reached', 'prepayment_confirmed'],
          },
          {
            booking_request: {
              booking_request_id: 11,
              request_status: 'HOLD_ACTIVE',
              requested_trip_date: '2036-04-11',
              requested_time_slot: '13:00',
              requested_seats: 3,
              requested_prepayment_amount: 700,
              contact_phone_e164: '+79990000011',
            },
            booking_hold: {
              hold_expires_at: '2036-04-10T10:04:30.000Z',
              requested_amount: 700,
            },
            guest_profile: {
              display_name: 'Guest Eleven',
            },
            available_actions: ['call_started', 'hold_extend', 'cancel_request'],
          },
        ],
      },
      { nowMs }
    );

    expect(model.activeCount).toBe(2);
    expect(model.bannerUrgency).toBe('near_expiry');
    expect(model.hasBanner).toBe(true);
    expect(model.unacknowledgedCount).toBe(2);
    expect(model.items[0]).toMatchObject({
      bookingRequestId: 11,
      guestName: 'Guest Eleven',
      phone: '+79990000011',
      requestedSeats: 3,
      requestedPrepaymentAmount: 700,
      requestedTripDate: '2036-04-11',
      requestedTimeSlot: '13:00',
      requestStatusLabel: 'Hold активен',
      urgency: 'near_expiry',
      availableActions: ['call_started', 'hold_extend', 'cancel_request'],
    });
    expect(model.items[1].urgency).toBe('urgent');
  });

  it('hides banner when all active requests are acknowledged', () => {
    const nowMs = Date.parse('2036-04-10T10:00:00.000Z');
    const model = buildSellerTelegramQueueModel(
      {
        items: [
          {
            booking_request: {
              booking_request_id: 21,
              request_status: 'HOLD_ACTIVE',
              requested_trip_date: '2036-04-11',
              requested_time_slot: '12:00',
              requested_seats: 2,
              requested_prepayment_amount: 1200,
              contact_phone_e164: '+79990000021',
            },
            booking_hold: {
              hold_expires_at: '2036-04-10T10:09:00.000Z',
              requested_amount: 1200,
            },
            guest_profile: {
              display_name: 'Guest Twenty One',
            },
            available_actions: ['prepayment_confirmed'],
          },
        ],
      },
      { nowMs, acknowledgedRequestIds: [21] }
    );

    expect(model.activeCount).toBe(1);
    expect(model.hasRequests).toBe(true);
    expect(model.hasBanner).toBe(false);
    expect(model.unacknowledgedCount).toBe(0);
  });

  it('renders timer labels for live and expired requests', () => {
    expect(formatSellerTelegramTimer(65_000)).toBe('01:05');
    expect(formatSellerTelegramTimer(3_661_000)).toBe('01:01:01');
    expect(formatSellerTelegramTimer(0)).toBe('Истек');
    expect(formatSellerTelegramTimer(-1000)).toBe('Истек');
  });
});
