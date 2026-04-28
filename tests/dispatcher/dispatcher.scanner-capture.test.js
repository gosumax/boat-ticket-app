import { describe, expect, it } from 'vitest';
import {
  isScannerLikeCapture,
  resolveDispatcherLookupQuery,
} from '../../src/components/dispatcher/dispatcherScannerUtils.js';

describe('Dispatcher scanner capture helpers', () => {
  it('keeps raw compact ticket codes as-is', () => {
    expect(resolveDispatcherLookupQuery('G22')).toBe('G22');
    expect(resolveDispatcherLookupQuery('P65')).toBe('P65');
    expect(resolveDispatcherLookupQuery('EV-21')).toBe('EV-21');
  });

  it('extracts lookup token from QR URL query params', () => {
    expect(
      resolveDispatcherLookupQuery('https://example.local/ticket/open?buyer_ticket_code=ev-21'),
    ).toBe('EV-21');

    expect(
      resolveDispatcherLookupQuery('https://example.local/open?token=ab-123-xy'),
    ).toBe('AB-123-XY');
  });

  it('treats quick keyboard bursts as scanner-like', () => {
    expect(
      isScannerLikeCapture({
        buffer: 'G22',
        startedAt: 1000,
        now: 1140,
        intervals: [70, 70],
        source: 'keyboard',
      }),
    ).toBe(true);
  });

  it('rejects slow keyboard typing and short buffers', () => {
    expect(
      isScannerLikeCapture({
        buffer: 'G22',
        startedAt: 1000,
        now: 1550,
        intervals: [180, 190],
        source: 'keyboard',
      }),
    ).toBe(false);

    expect(
      isScannerLikeCapture({
        buffer: 'G2',
        startedAt: 1000,
        now: 1040,
        intervals: [20],
        source: 'keyboard',
      }),
    ).toBe(false);
  });

  it('accepts pasted scanner payloads awaiting Enter', () => {
    expect(
      isScannerLikeCapture({
        buffer: 'https://example.local/ticket/open?buyer_ticket_code=G22',
        startedAt: 1000,
        now: 1300,
        intervals: [],
        source: 'paste',
      }),
    ).toBe(true);
  });
});

