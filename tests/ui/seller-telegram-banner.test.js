import { beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const hoisted = vi.hoisted(() => ({
  queueModel: {
    hasRequests: false,
    hasBanner: false,
    activeCount: 0,
    unacknowledgedCount: 0,
    bannerItems: [],
    bannerPrimaryItem: null,
    bannerUrgency: 'normal',
  },
  navigate: vi.fn(),
  markRequestOpened: vi.fn(),
  markRequestsOpened: vi.fn(),
}));

vi.mock('../../src/components/seller/telegram/SellerTelegramRequestsContext', () => ({
  useSellerTelegramRequests: () => ({
    queueModel: hoisted.queueModel,
    markRequestOpened: hoisted.markRequestOpened,
    markRequestsOpened: hoisted.markRequestsOpened,
  }),
}));

vi.mock('react-router-dom', () => ({
  useNavigate: () => hoisted.navigate,
}));

describe('seller telegram banner', () => {
  beforeEach(() => {
    hoisted.queueModel = {
      hasRequests: false,
      hasBanner: false,
      activeCount: 0,
      unacknowledgedCount: 0,
      bannerItems: [],
      bannerPrimaryItem: null,
      bannerUrgency: 'normal',
    };
    hoisted.navigate.mockReset();
    hoisted.markRequestOpened.mockReset();
    hoisted.markRequestsOpened.mockReset();
  });

  it('stays hidden when there are no active Telegram requests', async () => {
    const { default: SellerTelegramGlobalAlertBanner } = await import(
      '../../src/components/seller/telegram/SellerTelegramGlobalAlertBanner.jsx'
    );
    const html = renderToStaticMarkup(React.createElement(SellerTelegramGlobalAlertBanner));
    expect(html).toBe('');
  });

  it('shows global alert with dedicated navigation target when queue is active', async () => {
    hoisted.queueModel = {
      hasRequests: true,
      hasBanner: true,
      activeCount: 3,
      unacknowledgedCount: 3,
      bannerItems: [
        { bookingRequestId: 31, timerLabel: '03:00' },
        { bookingRequestId: 32, timerLabel: '05:00' },
      ],
      bannerPrimaryItem: {
        bookingRequestId: 31,
        timerLabel: '03:00',
      },
      bannerUrgency: 'near_expiry',
    };

    const { default: SellerTelegramGlobalAlertBanner } = await import(
      '../../src/components/seller/telegram/SellerTelegramGlobalAlertBanner.jsx'
    );
    const html = renderToStaticMarkup(React.createElement(SellerTelegramGlobalAlertBanner));

    expect(html).toContain('seller-telegram-global-alert');
    expect(html).toContain('data-navigation-target=\"/seller/telegram-requests\"');
    expect(html).toContain('Новые Telegram заявки');
    expect(html).toContain('Заявок: 3 • Ближайший таймер: 03:00');
    expect(html).toContain('Открыть');
  });

  it('routes click handler to the seller Telegram requests screen', async () => {
    const {
      openSellerTelegramRequests,
      SELLER_TELEGRAM_REQUESTS_ROUTE,
    } = await import('../../src/components/seller/telegram/SellerTelegramGlobalAlertBanner.jsx');

    openSellerTelegramRequests(hoisted.navigate);
    expect(hoisted.navigate).toHaveBeenCalledWith(SELLER_TELEGRAM_REQUESTS_ROUTE);

    openSellerTelegramRequests(hoisted.navigate, { requestId: 77 });
    expect(hoisted.navigate).toHaveBeenCalledWith(`${SELLER_TELEGRAM_REQUESTS_ROUTE}?requestId=77`);
  });
});
