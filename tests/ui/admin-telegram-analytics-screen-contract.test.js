import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const desktopAppSource = readFileSync(new URL('../../src/DesktopApp.jsx', import.meta.url), 'utf8');
const analyticsViewSource = readFileSync(
  new URL('../../src/telegram/AdminTelegramAnalyticsView.jsx', import.meta.url),
  'utf8'
);
const analyticsModelSource = readFileSync(
  new URL('../../src/telegram/admin-telegram-analytics-model.js', import.meta.url),
  'utf8'
);
const sourceViewSource = readFileSync(
  new URL('../../src/telegram/AdminTelegramSourceManagementView.jsx', import.meta.url),
  'utf8'
);
const contentViewSource = readFileSync(
  new URL('../../src/telegram/AdminTelegramContentManagementView.jsx', import.meta.url),
  'utf8'
);

describe('telegram analytics operator screen integration seam', () => {
  it('registers dedicated Telegram analytics route in App router', () => {
    expect(desktopAppSource).toMatch(/path="\/admin\/telegram-analytics"/);
    expect(desktopAppSource).toMatch(/AdminTelegramAnalyticsView/);
  });

  it('loads analytics/funnel/source-detail data from existing Telegram admin analytics API methods', () => {
    expect(analyticsModelSource).toMatch(/getTelegramAdminSourceAnalyticsFunnelSummary/);
    expect(analyticsModelSource).toMatch(/getTelegramAdminSourceAnalyticsSummaries/);
    expect(analyticsModelSource).toMatch(/getTelegramAdminSourceAnalyticsReport/);
    expect(analyticsViewSource).toMatch(/Overall funnel summary|Воронка выбранного источника/);
    expect(analyticsViewSource).toMatch(/Source detail|Детали источника/);
  });

  it('keeps cross-links from Telegram source/content screens to the dedicated analytics screen', () => {
    expect(sourceViewSource).toMatch(/\/admin\/telegram-analytics/);
    expect(contentViewSource).toMatch(/\/admin\/telegram-analytics/);
  });
});
