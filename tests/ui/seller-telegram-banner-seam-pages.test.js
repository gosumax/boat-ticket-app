import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('react-router-dom', () => ({
  useNavigate: () => () => {},
  useSearchParams: () => [
    {
      get: () => null,
    },
    () => {},
  ],
}));

vi.mock('../../src/contexts/AuthContext', () => ({
  useAuth: () => ({
    logout: () => {},
  }),
}));

vi.mock('../../src/contexts/OwnerDataContext', () => ({
  useOwnerData: () => ({
    refreshOwnerData: () => {},
  }),
}));

vi.mock('../../src/components/seller/telegram/SellerTelegramGlobalAlertBanner.jsx', () => ({
  default: () => 'SELLER_TELEGRAM_ALERT_SLOT',
  SELLER_TELEGRAM_REQUESTS_ROUTE: '/seller/telegram-requests',
}));

describe('seller pages banner seam', () => {
  let previousReact;
  let previousWindow;
  let previousDocument;

  beforeEach(() => {
    previousReact = globalThis.React;
    previousWindow = globalThis.window;
    previousDocument = globalThis.document;

    globalThis.React = React;
    globalThis.window = {
      addEventListener: () => {},
      removeEventListener: () => {},
      localStorage: {
        getItem: () => null,
        setItem: () => {},
        removeItem: () => {},
      },
    };
    globalThis.document = {
      addEventListener: () => {},
      removeEventListener: () => {},
      visibilityState: 'visible',
      body: {
        style: {},
      },
    };
  });

  afterEach(() => {
    globalThis.React = previousReact;
    globalThis.window = previousWindow;
    globalThis.document = previousDocument;
  });

  it('keeps global Telegram alert seam in seller home, flow, earnings, media, and requests pages', async () => {
    const { default: SellerHome } = await import('../../src/views/SellerHome.jsx');
    const { default: SellerView } = await import('../../src/views/SellerView.jsx');
    const { default: SellerEarnings } = await import('../../src/views/SellerEarnings.jsx');
    const { default: SellerMedia } = await import('../../src/views/SellerMedia.jsx');
    const { default: SellerTelegramRequests } = await import(
      '../../src/views/SellerTelegramRequests.jsx'
    );

    const homeHtml = renderToStaticMarkup(React.createElement(SellerHome));
    const flowHtml = renderToStaticMarkup(React.createElement(SellerView));
    const earningsHtml = renderToStaticMarkup(React.createElement(SellerEarnings));
    const mediaHtml = renderToStaticMarkup(React.createElement(SellerMedia));
    const requestsHtml = renderToStaticMarkup(React.createElement(SellerTelegramRequests));

    expect(homeHtml).toContain('SELLER_TELEGRAM_ALERT_SLOT');
    expect(homeHtml).toContain('seller-home-requests-btn');
    expect(homeHtml).toContain('Мои заявки');
    expect(flowHtml).toContain('SELLER_TELEGRAM_ALERT_SLOT');
    expect(earningsHtml).toContain('SELLER_TELEGRAM_ALERT_SLOT');
    expect(mediaHtml).toContain('SELLER_TELEGRAM_ALERT_SLOT');
    expect(requestsHtml).toContain('SELLER_TELEGRAM_ALERT_SLOT');
  });
});
