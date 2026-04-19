import { describe, expect, it } from 'vitest';
import {
  BUYER_CATALOG_TYPE_SELECTION_OPTIONS,
  BUYER_TRIP_CARD_AGE_HINT,
  buildBuyerRequestedTicketMix,
  buildBuyerTicketSelectionSummary,
  buildBuyerTripPriceRows,
  filterBuyerCatalogItems,
  formatBuyerFacingDateLabel,
  formatDateTimeLabel,
} from '../../src/telegram/TelegramMiniApp.jsx';

function createCatalogItem({ slotUid, tripType, availabilityState }) {
  return {
    trip_slot_reference: {
      slot_uid: slotUid,
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
});
