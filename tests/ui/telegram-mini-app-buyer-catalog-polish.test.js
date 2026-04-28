import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  BUYER_CATALOG_TYPE_SELECTION_OPTIONS,
  BUYER_TRIP_CARD_AGE_HINT,
  buildMiniAppBuyerCountdownSummary,
  buildMiniAppPostCreateActiveRequestDeadlineViewModel,
  buildMiniAppPolledTicketDetailState,
  buildMiniAppTicketDetailSeedState,
  buildBuyerRequestedTicketMix,
  buildBuyerTicketSelectionSummary,
  buildBuyerTripPriceRows,
  filterBuyerCatalogItems,
  findMiniAppTicketItemByBookingRequestId,
  formatBuyerFacingDateLabel,
  formatDateTimeLabel,
  formatMiniAppHoldDeadlineLabel,
  isBuyerCatalogItemUpcoming,
  resolveMiniAppCanonicalHoldExpiresAtIso,
  shouldShowMiniAppCurrentTicketContext,
} from '../../src/telegram/TelegramMiniApp.jsx';

const telegramMiniAppSource = readFileSync(
  new URL('../../src/telegram/TelegramMiniApp.jsx', import.meta.url),
  'utf8'
);

function createCatalogItem({
  slotUid,
  tripType,
  availabilityState,
  requestedTripDate = '2036-04-11',
  requestedTimeSlot = '12:00',
}) {
  return {
    trip_slot_reference: {
      slot_uid: slotUid,
    },
    date_time_summary: {
      requested_trip_date: requestedTripDate,
      requested_time_slot: requestedTimeSlot,
    },
    trip_type_summary: {
      trip_type: tripType,
    },
    booking_availability_state: availabilityState,
  };
}

describe('telegram mini app buyer catalog polish helpers', () => {
  it('keeps only buyer-bookable trips and applies speed/cruise/banana filters', () => {
    const items = [
      createCatalogItem({
        slotUid: 'generated:1',
        tripType: 'speed',
        availabilityState: 'bookable',
      }),
      createCatalogItem({
        slotUid: 'generated:2',
        tripType: 'speed',
        availabilityState: 'unavailable',
      }),
      createCatalogItem({
        slotUid: 'generated:3',
        tripType: 'cruise',
        availabilityState: 'low_availability',
      }),
      createCatalogItem({
        slotUid: 'generated:4',
        tripType: 'banana',
        availabilityState: 'bookable',
      }),
    ];

    expect(filterBuyerCatalogItems(items, 'all').map((item) => item.trip_slot_reference.slot_uid)).toEqual([
      'generated:1',
      'generated:3',
      'generated:4',
    ]);
    expect(
      filterBuyerCatalogItems(items, 'speed').map((item) => item.trip_slot_reference.slot_uid)
    ).toEqual(['generated:1']);
    expect(
      filterBuyerCatalogItems(items, 'cruise').map((item) => item.trip_slot_reference.slot_uid)
    ).toEqual(['generated:3']);
    expect(
      filterBuyerCatalogItems(items, 'banana').map((item) => item.trip_slot_reference.slot_uid)
    ).toEqual(['generated:4']);
  });

  it('hides same-day trips that have already departed in the buyer catalog', () => {
    const nowMs = Date.parse('2036-04-11T15:03:00');
    const pastTrip = createCatalogItem({
      slotUid: 'generated:past',
      tripType: 'speed',
      availabilityState: 'bookable',
      requestedTripDate: '2036-04-11',
      requestedTimeSlot: '15:00',
    });
    const futureTrip = createCatalogItem({
      slotUid: 'generated:future',
      tripType: 'speed',
      availabilityState: 'bookable',
      requestedTripDate: '2036-04-11',
      requestedTimeSlot: '15:24',
    });

    expect(isBuyerCatalogItemUpcoming(pastTrip, nowMs)).toBe(false);
    expect(isBuyerCatalogItemUpcoming(futureTrip, nowMs)).toBe(true);
    expect(
      filterBuyerCatalogItems([pastTrip, futureTrip], 'speed', nowMs).map(
        (item) => item.trip_slot_reference.slot_uid
      )
    ).toEqual(['generated:future']);
  });

  it('builds russian age-based price rows for adult, teen, and child', () => {
    expect(
      buildBuyerTripPriceRows({
        currency: 'RUB',
        adult_price: 2000,
        teen_price: 1000,
        child_price: 500,
      })
    ).toEqual([
      { key: 'adult', label: 'Взрослый', value: '2000 RUB' },
      { key: 'teen', label: 'Подросток', value: '1000 RUB' },
      { key: 'child', label: 'Ребёнок', value: '500 RUB' },
    ]);
  });

  it('builds a mixed-ticket summary, total seats, and total price for buyer booking counters', () => {
    expect(buildBuyerRequestedTicketMix({ adult: 2, teen: 1, child: 1 })).toEqual({
      adult: 2,
      teen: 1,
      child: 1,
    });

    expect(
      buildBuyerTicketSelectionSummary(
        { adult: '2', teen: 1, child: 1 },
        {
          currency: 'RUB',
          adult_price: 2000,
          teen_price: 1500,
          child_price: 800,
        }
      )
    ).toEqual({
      ticketCounts: {
        adult: 2,
        teen: 1,
        child: 1,
      },
      requestedTicketMix: {
        adult: 2,
        teen: 1,
        child: 1,
      },
      totalSeats: 4,
      totalPrice: 6300,
      mixLabel: '2 взрослых, 1 подросток, 1 ребёнок',
    });
  });

  it('keeps russian copy for the first-step type selection cards and compact age hint text', () => {
    expect(BUYER_CATALOG_TYPE_SELECTION_OPTIONS).toEqual([
      {
        key: 'speed',
        title: 'Скоростной катер',
        description: 'Быстрый выезд по воде, когда хочется скорее отправиться в путь.',
        actionLabel: 'Смотреть рейсы',
      },
      {
        key: 'cruise',
        title: 'Прогулка',
        description: 'Спокойная поездка для отдыха, видов и приятной прогулки по воде.',
        actionLabel: 'Смотреть рейсы',
      },
      {
        key: 'banana',
        title: 'Банан',
        description: 'Активная водная прогулка для тех, кто хочет эмоций и движения.',
        actionLabel: 'Смотреть рейсы',
      },
    ]);
    expect(BUYER_TRIP_CARD_AGE_HINT).toBe(
      'Ребёнок: до 5 лет включительно. Подросток: старше 5 и до 14 лет. Взрослый: 14+.'
    );
  });

  it('formats buyer-facing booking dates in clean russian form with readable time', () => {
    expect(formatBuyerFacingDateLabel('2026-04-18')).toBe('18 апреля');
    expect(formatDateTimeLabel('2026-04-18', '09:00')).toBe('18 апреля, 09:00');
    expect(formatDateTimeLabel('2026-04-18', '09:00:30')).toBe('18 апреля, 09:00');
  });

  it('formats hold deadline with the same local timestamp source used by countdowns', () => {
    const holdExpiresAtIso = '2036-04-10T10:46:00.000Z';
    const countdownSummary = buildMiniAppBuyerCountdownSummary(
      holdExpiresAtIso,
      Date.parse('2036-04-10T10:31:00.000Z')
    );

    expect(countdownSummary.remainingMs).toBe(15 * 60 * 1000);
    expect(countdownSummary.valueLabel).toBe('15:00');
    expect(formatMiniAppHoldDeadlineLabel(holdExpiresAtIso)).toContain('13:46');
  });

  it('renders the post-create active request deadline as Moscow time instead of UTC', () => {
    const model = buildMiniAppPostCreateActiveRequestDeadlineViewModel({
      bookingRequestId: 504,
      ticketItems: [],
      submitHoldExpiresAtIso: '2026-04-27T12:58:00.000Z',
      nowMs: Date.parse('2026-04-27T12:43:00.000Z'),
    });

    expect(model.rawHoldExpiresAtIso).toBe('2026-04-27T12:58:00.000Z');
    expect(model.holdExpiresAtIso).toBe('2026-04-27T12:58:00.000Z');
    expect(new Date(model.holdExpiresAtIso).toISOString()).toBe(
      '2026-04-27T12:58:00.000Z'
    );
    expect(model.countdownSummary.remainingMs).toBe(15 * 60 * 1000);
    expect(model.countdownSummary.valueLabel).toBe('15:00');
    expect(model.holdDeadlineLabel).toBe('27 апреля, 15:58');
    expect(model.holdDeadlineLabel).not.toContain('12:58');
  });

  it('keeps the post-create timer visible and omits removed deadline labels in result flow', () => {
    const postCreateSectionStart = telegramMiniAppSource.indexOf(
      "{activeSection === 'result' && submitResult && ("
    );
    const pendingFlowStart = telegramMiniAppSource.indexOf(
      '{resultShowsPendingFlow && (',
      postCreateSectionStart
    );
    const pendingFlowEnd = telegramMiniAppSource.indexOf(
      '{holdResultViewModel.isSuccess && !resultPendingPrepaymentFlow && (',
      pendingFlowStart
    );

    expect(postCreateSectionStart).toBeGreaterThanOrEqual(0);
    expect(pendingFlowStart).toBeGreaterThanOrEqual(0);
    expect(pendingFlowEnd).toBeGreaterThan(pendingFlowStart);

    const postCreatePendingFlowSection = telegramMiniAppSource.slice(
      pendingFlowStart,
      pendingFlowEnd
    );

    expect(postCreatePendingFlowSection).toContain('Осталось времени');
    expect(postCreatePendingFlowSection).toContain('telegram-mini-app-post-request-timer');
    expect(postCreatePendingFlowSection).not.toContain('Срок брони');
    expect(postCreatePendingFlowSection).not.toContain('Бронь действует до');
  });

  it('keeps ticket-view pending timer visible and omits deadline labels there too', () => {
    const ticketViewSectionStart = telegramMiniAppSource.indexOf(
      "{activeSection === 'ticket_view' && ("
    );
    const pendingFlowStart = telegramMiniAppSource.indexOf(
      '{ticketDetailPendingPrepaymentFlow ? (',
      ticketViewSectionStart
    );
    const pendingFlowEnd = telegramMiniAppSource.indexOf(
      ') : (',
      pendingFlowStart
    );

    expect(ticketViewSectionStart).toBeGreaterThanOrEqual(0);
    expect(pendingFlowStart).toBeGreaterThanOrEqual(0);
    expect(pendingFlowEnd).toBeGreaterThan(pendingFlowStart);

    const ticketViewPendingFlowSection = telegramMiniAppSource.slice(
      pendingFlowStart,
      pendingFlowEnd
    );

    expect(ticketViewPendingFlowSection).toContain('Осталось времени');
    expect(ticketViewPendingFlowSection).toContain('telegram-mini-app-ticket-view-timer');
    expect(ticketViewPendingFlowSection).not.toContain('Срок брони');
    expect(ticketViewPendingFlowSection).not.toContain('Бронь действует до');
  });

  it('renders detail deadline from canonical request hold instant and shows Moscow local time', () => {
    const resolvedHoldExpiresAtIso = resolveMiniAppCanonicalHoldExpiresAtIso({
      bookingRequestId: 501,
      ticketItems: [
        {
          booking_request_reference: { booking_request_id: 501 },
          hold_status_summary: {
            hold_expires_at_summary: { iso: '2036-04-10T12:49:00.000Z' },
          },
        },
      ],
      fallbackHoldExpiresAtIso: '2036-04-10T09:49:00.000Z',
    });

    expect(resolvedHoldExpiresAtIso).toBe('2036-04-10T12:49:00.000Z');
    expect(formatMiniAppHoldDeadlineLabel(resolvedHoldExpiresAtIso)).toBe(
      '10 апреля, 15:49'
    );
  });

  it('uses the latest polled list projection for opened request detail after hold extension', () => {
    const bookingRequestId = 77;
    const previousState = {
      loading: false,
      error: null,
      selectedBookingRequestId: bookingRequestId,
      ticketView: {
        booking_request_reference: { booking_request_id: bookingRequestId },
        hold_status_summary: {
          hold_expires_at_summary: { iso: '2036-04-10T10:46:00.000Z' },
        },
      },
      offlineSnapshot: null,
      fallbackUsed: false,
      ticketViewErrorMessage: null,
    };
    const refreshedTicketView = {
      ticketView: previousState.ticketView,
      offlineSnapshot: null,
      fallbackUsed: false,
      ticketViewErrorMessage: null,
    };
    const ticketItems = [
      {
        booking_request_reference: { booking_request_id: bookingRequestId },
        hold_status_summary: {
          hold_expires_at_summary: { iso: '2036-04-10T10:56:00.000Z' },
        },
      },
    ];

    const nextState = buildMiniAppPolledTicketDetailState({
      previousState,
      selectedBookingRequestId: bookingRequestId,
      refreshedTicketView,
      ticketItems,
    });

    expect(nextState.ticketView.hold_status_summary.hold_expires_at_summary.iso).toBe(
      '2036-04-10T10:56:00.000Z'
    );
  });

  it('uses the latest polled list projection for opened request detail after prepayment confirmation', () => {
    const bookingRequestId = 78;
    const previousState = {
      loading: false,
      error: null,
      selectedBookingRequestId: bookingRequestId,
      ticketView: {
        booking_request_reference: { booking_request_id: bookingRequestId },
        ticket_status_summary: { deterministic_ticket_state: 'no_ticket_yet' },
        ticket_availability_state: 'not_available_yet',
      },
      offlineSnapshot: null,
      fallbackUsed: false,
      ticketViewErrorMessage: null,
    };
    const ticketItems = [
      {
        booking_request_reference: { booking_request_id: bookingRequestId },
        ticket_status_summary: { deterministic_ticket_state: 'linked_ticket_ready' },
        ticket_availability_state: 'available',
      },
    ];

    const nextState = buildMiniAppPolledTicketDetailState({
      previousState,
      selectedBookingRequestId: bookingRequestId,
      refreshedTicketView: null,
      ticketItems,
    });

    expect(nextState.ticketView.ticket_status_summary.deterministic_ticket_state).toBe(
      'linked_ticket_ready'
    );
    expect(nextState.ticketView.ticket_availability_state).toBe('available');
  });

  it('seeds ticket detail from my-tickets projection without waiting for detail fetch', () => {
    const bookingRequestId = 179;
    const seededState = buildMiniAppTicketDetailSeedState({
      bookingRequestId,
      ticketItem: {
        booking_request_reference: { booking_request_id: bookingRequestId },
        ticket_status_summary: { deterministic_ticket_state: 'linked_ticket_ready' },
        ticket_availability_state: 'available',
      },
    });

    expect(seededState).toMatchObject({
      loading: false,
      error: null,
      selectedBookingRequestId: bookingRequestId,
      fallbackUsed: false,
      ticketViewErrorMessage: null,
    });
    expect(seededState.ticketView.ticket_status_summary.deterministic_ticket_state).toBe(
      'linked_ticket_ready'
    );
  });

  it('clears endless loading when polled ticket refresh fails and no projection is available', () => {
    const bookingRequestId = 180;
    const nextState = buildMiniAppPolledTicketDetailState({
      previousState: {
        loading: true,
        error: null,
        selectedBookingRequestId: bookingRequestId,
        ticketView: null,
        offlineSnapshot: null,
        fallbackUsed: false,
        ticketViewErrorMessage: null,
      },
      selectedBookingRequestId: bookingRequestId,
      refreshedTicketView: null,
      ticketItems: [],
      hasRefreshFailure: true,
      refreshFailureMessage: 'Не удалось загрузить данные. Попробуйте обновить.',
    });

    expect(nextState.loading).toBe(false);
    expect(nextState.error).toBe('Не удалось загрузить данные. Попробуйте обновить.');
  });

  it('clears loading after prepayment poll when list projection is available', () => {
    const bookingRequestId = 181;
    const nextState = buildMiniAppPolledTicketDetailState({
      previousState: {
        loading: true,
        error: null,
        selectedBookingRequestId: bookingRequestId,
        ticketView: null,
        offlineSnapshot: null,
        fallbackUsed: false,
        ticketViewErrorMessage: null,
      },
      selectedBookingRequestId: bookingRequestId,
      refreshedTicketView: null,
      ticketItems: [
        {
          booking_request_reference: { booking_request_id: bookingRequestId },
          ticket_status_summary: { deterministic_ticket_state: 'linked_ticket_ready' },
          ticket_availability_state: 'available',
        },
      ],
    });

    expect(nextState.loading).toBe(false);
    expect(nextState.error).toBeNull();
    expect(nextState.ticketView.ticket_availability_state).toBe('available');
  });

  it('suppresses the current request context card when the same active request is already in the list', () => {
    const activeRequest = {
      booking_request_reference: { booking_request_id: 79 },
      ticket_status_summary: { deterministic_ticket_state: 'no_ticket_yet' },
      ticket_availability_state: 'not_available_yet',
    };

    expect(findMiniAppTicketItemByBookingRequestId([activeRequest], 79)).toBe(activeRequest);
    expect(
      shouldShowMiniAppCurrentTicketContext({
        hasCurrentTicketContext: true,
        selectedBookingRequestId: 79,
        ticketItems: [activeRequest],
      })
    ).toBe(false);
    expect(
      shouldShowMiniAppCurrentTicketContext({
        hasCurrentTicketContext: true,
        selectedBookingRequestId: 80,
        ticketItems: [activeRequest],
      })
    ).toBe(true);
  });
});
