import { beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const hoisted = vi.hoisted(() => ({
  queueModel: {
    hasRequests: false,
    activeCount: 0,
    bannerUrgency: 'normal',
  },
  navigate: vi.fn(),
}));

vi.mock('../../src/components/seller/telegram/SellerTelegramRequestsContext', () => ({
  useSellerTelegramRequests: () => ({
    queueModel: hoisted.queueModel,
  }),
}));

vi.mock('react-router-dom', () => ({
  useNavigate: () => hoisted.navigate,
}));

describe('seller telegram banner', () => {
  beforeEach(() => {
    hoisted.queueModel = {
      hasRequests: false,
      activeCount: 0,
      bannerUrgency: 'normal',
    };
    hoisted.navigate.mockReset();
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
      activeCount: 3,
      bannerUrgency: 'near_expiry',
    };

    const { default: SellerTelegramGlobalAlertBanner } = await import(
      '../../src/components/seller/telegram/SellerTelegramGlobalAlertBanner.jsx'
    );
    const html = renderToStaticMarkup(React.createElement(SellerTelegramGlobalAlertBanner));

    expect(html).toContain('seller-telegram-global-alert');
    expect(html).toContain('data-navigation-target=\"/seller/telegram-requests\"');
    expect(html).toContain('Telegram queue: 3 active requests');
    expect(html).toContain('Near expiry');
  });

  it('routes click handler to the seller Telegram requests screen', async () => {
    const {
      openSellerTelegramRequests,
      SELLER_TELEGRAM_REQUESTS_ROUTE,
    } = await import('../../src/components/seller/telegram/SellerTelegramGlobalAlertBanner.jsx');

    openSellerTelegramRequests(hoisted.navigate);
    expect(hoisted.navigate).toHaveBeenCalledWith(SELLER_TELEGRAM_REQUESTS_ROUTE);
  });
});
