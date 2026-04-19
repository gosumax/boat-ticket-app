import { describe, expect, it } from 'vitest';
import {
  formatMiniAppSeatCountLabel,
  resolveMiniAppBuyerTicketPresentation,
} from '../../src/telegram/ticket-state-presentation.js';

describe('telegram mini app buyer ticket-state presentation', () => {
  it('keeps pending requests free from technical numeric hashes', () => {
    const presentation = resolveMiniAppBuyerTicketPresentation({
      status: 'no_ticket_yet',
      availability: 'not_available_yet',
      bookingRequestId: 17,
      lifecycleState: 'hold_active',
      holdActive: true,
      requestedPrepaymentAmount: 6500,
    });

    expect(presentation.entityLabel).toBeTruthy();
    expect(presentation.cardTitle).not.toContain('#');
    expect(presentation.detailTitle).not.toContain('#');
    expect(presentation.statusTone).toBe('warning');
    expect(presentation.statusLabel).toBe('Ждём предоплату');
    expect(presentation.holdStatusLabel).toBe('Идёт таймер');
    expect(presentation.prepaymentStatusLabel).toBe('Нужно передать предоплату');
    expect(presentation.ticketTone).toBe('accent');
  });

  it('uses the compact buyer code for ready tickets', () => {
    const presentation = resolveMiniAppBuyerTicketPresentation({
      status: 'linked_ticket_ready',
      availability: 'available',
      bookingRequestId: 23,
      buyerTicketCode: 'А1',
    });

    expect(presentation.statusTone).toBe('success');
    expect(presentation.actionLabel).toBeTruthy();
    expect(presentation.cardTitle).toContain('А1');
    expect(presentation.cardTitle).not.toContain('#');
    expect(presentation.detailTitle).toContain('А1');
  });

  it('keeps the buyer code visible while the confirmed ticket is still being prepared', () => {
    const presentation = resolveMiniAppBuyerTicketPresentation({
      status: 'no_ticket_yet',
      availability: 'not_available_yet',
      bookingRequestId: 44,
      buyerTicketCode: 'Б2',
      lifecycleState: 'prepayment_confirmed',
      requestConfirmed: true,
      requestedPrepaymentAmount: 3200,
    });

    expect(presentation.ticketTone).toBe('warning');
    expect(presentation.cardTitle).toContain('Б2');
    expect(presentation.cardTitle).not.toContain('#');
    expect(presentation.nextActionLabel).toBeTruthy();
  });

  it('formats seat counts without leaking request references', () => {
    expect(formatMiniAppSeatCountLabel(1)).toContain('1');
    expect(formatMiniAppSeatCountLabel(2)).toContain('2');
    expect(formatMiniAppSeatCountLabel(5)).toContain('5');
    expect(formatMiniAppSeatCountLabel(null)).toBeTruthy();
  });
});
