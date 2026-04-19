import { describe, expect, it } from 'vitest';
import {
  MINI_APP_TICKET_RENDER_STATES,
  buildMiniAppTicketDetailViewModel,
  resolveMiniAppTicketRenderState,
} from '../../src/telegram/ticket-access-view-model.js';

describe('telegram mini app ticket access view model', () => {
  it('supports deterministic render-state transitions for ticket rendering', () => {
    const loadingState = resolveMiniAppTicketRenderState({ loading: true });
    const onlineState = resolveMiniAppTicketRenderState({
      ticketView: {
        booking_request_reference: { booking_request_id: 10 },
      },
    });
    const offlineState = resolveMiniAppTicketRenderState({
      offlineSnapshot: {
        booking_request_reference: { booking_request_id: 10 },
      },
    });
    const errorState = resolveMiniAppTicketRenderState({ error: 'network' });
    const emptyState = resolveMiniAppTicketRenderState({});

    expect(loadingState).toBe('loading');
    expect(onlineState).toBe('ready_online');
    expect(offlineState).toBe('ready_offline');
    expect(errorState).toBe('error');
    expect(emptyState).toBe('empty');
    expect(MINI_APP_TICKET_RENDER_STATES).toEqual([
      'loading',
      'error',
      'ready_online',
      'ready_offline',
      'empty',
    ]);
  });

  it('builds stable ticket detail view model from online ticket projection', () => {
    const viewModel = buildMiniAppTicketDetailViewModel({
      ticketView: {
        booking_request_reference: {
          booking_request_id: 11,
        },
        ticket_status_summary: {
          deterministic_ticket_state: 'linked_ticket_ready',
        },
        ticket_availability_state: 'available',
        date_time_summary: {
          requested_trip_date: '2036-04-11',
          requested_time_slot: '12:00',
        },
        seats_count_summary: {
          requested_seats: 2,
          linked_ticket_count: 2,
        },
        payment_summary: {
          currency: 'RUB',
          total_price: 6000,
          prepayment_amount: 2000,
          remaining_payment_amount: 4000,
        },
        contact_summary: {
          preferred_contact_phone_e164: '+79990000000',
        },
        seller_contact_summary: {
          seller_display_name: 'Seller A',
          seller_phone_e164: '+79991112233',
        },
        hold_status_summary: {
          hold_status: 'hold_active',
          requested_amount: 2000,
          currency: 'RUB',
          hold_started_at_summary: {
            iso: '2036-04-10T10:31:00.000Z',
          },
          hold_expires_at_summary: {
            iso: '2036-04-10T10:46:00.000Z',
          },
        },
        buyer_ticket_reference_summary: {
          buyer_ticket_code: 'А1',
          display_title: 'Билет А1',
        },
        boarding_qr_payload_summary: {
          payload_format: 'boat_ticket_boarding_qr_v1',
          compatibility_target: 'dispatcher_boarding_existing_ids',
          qr_payload_text: 'boat-ticket:v1|presale=1|tickets=11,12',
        },
      },
    });

    expect(viewModel).toEqual({
      renderState: 'ready_online',
      sourceMode: 'online_ticket',
      bookingRequestId: 11,
      buyerTicketCode: 'А1',
      buyerTicketDisplayTitle: 'Билет А1',
      status: 'linked_ticket_ready',
      availability: 'available',
      requestedTripDate: '2036-04-11',
      requestedTimeSlot: '12:00',
      requestedSeats: 2,
      linkedTicketCount: 2,
      paymentSummary: {
        currency: 'RUB',
        total_price: 6000,
        prepayment_amount: 2000,
        remaining_payment_amount: 4000,
      },
      contactPhone: '+79990000000',
      contactCallHref: 'tel:+79990000000',
      sellerName: 'Seller A',
      sellerPhone: '+79991112233',
      sellerCallHref: 'tel:+79991112233',
      holdStatus: 'hold_active',
      holdExpiresAtIso: '2036-04-10T10:46:00.000Z',
      holdStartedAtIso: '2036-04-10T10:31:00.000Z',
      holdRequestedAmount: 2000,
      holdCurrency: 'RUB',
      boardingQrPayloadText: 'boat-ticket:v1|presale=1|tickets=11,12',
      boardingQrPayloadFormat: 'boat_ticket_boarding_qr_v1',
      boardingQrCompatibilityTarget: 'dispatcher_boarding_existing_ids',
      offlineSnapshotStatus: null,
      offlineReferenceCode: null,
      hasBoardingQr: true,
      fallbackUsed: false,
    });
  });

  it('builds offline fallback model when ticket view is not available', () => {
    const viewModel = buildMiniAppTicketDetailViewModel({
      offlineSnapshot: {
        booking_request_reference: {
          booking_request_id: 12,
        },
        minimal_ticket_identity_summary: {
          deterministic_ticket_state: 'linked_ticket_cancelled_or_unavailable',
          ticket_availability_state: 'unavailable',
          canonical_ticket_read_status: 'missing',
        },
        trip_date_time_summary: {
          requested_trip_date: '2036-04-11',
          requested_time_slot: '14:00',
        },
        seats_count_summary: {
          requested_seats: 2,
          linked_ticket_count: null,
        },
        contact_summary: {
          preferred_contact_phone_e164: '+79998887766',
        },
        seller_contact_summary: {
          seller_display_name: 'Seller B',
          seller_phone_e164: '+79992223344',
        },
        hold_status_summary: {
          hold_status: 'hold_expired',
          requested_amount: 0,
          currency: 'RUB',
          hold_started_at_summary: {
            iso: '2036-04-10T10:31:00.000Z',
          },
          hold_expires_at_summary: {
            iso: '2036-04-10T10:46:00.000Z',
          },
        },
        buyer_ticket_reference_summary: {
          buyer_ticket_code: 'Б7',
          display_title: 'Билет Б7',
        },
        offline_snapshot_status: 'offline_unavailable',
        offline_safe_code_reference_summary: {
          offline_reference_code: 'TG-12-0-20360411-1400',
        },
      },
      fallbackUsed: true,
    });

    expect(viewModel).toEqual({
      renderState: 'ready_offline',
      sourceMode: 'offline_snapshot',
      bookingRequestId: 12,
      buyerTicketCode: 'Б7',
      buyerTicketDisplayTitle: 'Билет Б7',
      status: 'linked_ticket_cancelled_or_unavailable',
      availability: 'unavailable',
      requestedTripDate: '2036-04-11',
      requestedTimeSlot: '14:00',
      requestedSeats: 2,
      linkedTicketCount: null,
      paymentSummary: null,
      contactPhone: '+79998887766',
      contactCallHref: 'tel:+79998887766',
      sellerName: 'Seller B',
      sellerPhone: '+79992223344',
      sellerCallHref: 'tel:+79992223344',
      holdStatus: 'hold_expired',
      holdExpiresAtIso: '2036-04-10T10:46:00.000Z',
      holdStartedAtIso: '2036-04-10T10:31:00.000Z',
      holdRequestedAmount: 0,
      holdCurrency: 'RUB',
      boardingQrPayloadText: null,
      boardingQrPayloadFormat: null,
      boardingQrCompatibilityTarget: null,
      offlineSnapshotStatus: 'offline_unavailable',
      offlineReferenceCode: 'TG-12-0-20360411-1400',
      hasBoardingQr: false,
      fallbackUsed: true,
    });
  });
});
