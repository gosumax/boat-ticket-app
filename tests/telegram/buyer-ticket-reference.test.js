import { describe, expect, it } from 'vitest';
import {
  BUYER_TICKET_CODE_ALPHABET,
  buildBuyerTicketCodeFromCanonicalPresaleId,
  buildBuyerTicketCodeFromSequence,
  buildBuyerTicketReferenceSummary,
  buildDispatcherBoardingQrPayload,
  buildDispatcherBoardingQrSummary,
  parseDispatcherBoardingQrPayload,
} from '../../server/ticketing/buyer-ticket-reference.mjs';

describe('buyer ticket reference helpers', () => {
  it('builds the requested compact Cyrillic sequence deterministically', () => {
    const firstLetter = BUYER_TICKET_CODE_ALPHABET[0];
    const lastLetter = BUYER_TICKET_CODE_ALPHABET[BUYER_TICKET_CODE_ALPHABET.length - 1];
    const lastSingleLetterSequence = BUYER_TICKET_CODE_ALPHABET.length * 99;

    expect(buildBuyerTicketCodeFromSequence(1)).toBe('А1');
    expect(buildBuyerTicketCodeFromSequence(99)).toBe('А99');
    expect(buildBuyerTicketCodeFromSequence(100)).toBe('Б1');
    expect(buildBuyerTicketCodeFromSequence(198)).toBe('Б99');
    expect(buildBuyerTicketCodeFromSequence(lastSingleLetterSequence)).toBe(
      `${lastLetter}99`
    );
    expect(buildBuyerTicketCodeFromSequence(lastSingleLetterSequence + 1)).toBe(
      `${firstLetter}${firstLetter}1`
    );
    expect(
      buildBuyerTicketCodeFromCanonicalPresaleId(lastSingleLetterSequence + 2)
    ).toBe(`${firstLetter}${firstLetter}2`);
  });

  it('stays collision-safe for growing presale ids', () => {
    const codes = new Set();

    for (let presaleId = 1; presaleId <= 500; presaleId += 1) {
      codes.add(buildBuyerTicketCodeFromCanonicalPresaleId(presaleId));
    }

    expect(codes.size).toBe(500);
  });

  it('builds boarding qr payloads from canonical dispatcher identifiers', () => {
    const summary = buildBuyerTicketReferenceSummary({
      canonicalPresaleId: 145,
      canonicalTicketIds: [901, 902],
    });
    const qrPayload = buildDispatcherBoardingQrPayload({
      canonicalPresaleId: 145,
      canonicalTicketIds: [902, 901],
    });
    const qrSummary = buildDispatcherBoardingQrSummary({
      canonicalPresaleId: 145,
      canonicalTicketIds: [902, 901],
      buyerTicketCode: summary?.buyer_ticket_code,
    });

    expect(summary).toMatchObject({
      buyer_ticket_code: 'Б46',
      canonical_presale_id: 145,
      canonical_ticket_ids: [901, 902],
    });
    expect(qrPayload).toBe('boat-ticket:v1|presale=145|tickets=901,902');
    expect(qrSummary).toMatchObject({
      payload_source: 'canonical_presale_id_and_ticket_ids',
      compatibility_target: 'dispatcher_boarding_existing_ids',
      qr_payload_text: 'boat-ticket:v1|presale=145|tickets=901,902',
      buyer_ticket_code: 'Б46',
    });
    expect(parseDispatcherBoardingQrPayload(qrPayload)).toEqual({
      payload_format: 'boat_ticket_boarding_qr_v1',
      canonicalPresaleId: 145,
      canonicalTicketIds: [901, 902],
    });
  });
});
