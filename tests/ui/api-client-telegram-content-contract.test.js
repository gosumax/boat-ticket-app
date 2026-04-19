import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('../../src/utils/apiClient.js', import.meta.url), 'utf8');

describe('apiClient telegram content-management contract smoke', () => {
  it('contains Telegram admin content method wrappers used by the operator screen', () => {
    const requiredMethods = [
      'getTelegramAdminServiceMessageTemplates',
      'getTelegramAdminServiceMessageTemplate',
      'updateTelegramAdminServiceMessageTemplate',
      'setTelegramAdminServiceMessageTemplateEnabled',
      'getTelegramAdminManagedContent',
      'getTelegramAdminManagedContentItem',
      'updateTelegramAdminManagedContentItem',
      'setTelegramAdminManagedContentEnabled',
      'getTelegramAdminFaq',
      'getTelegramAdminUsefulContentFeed',
      'getTelegramAdminSourceRegistryItems',
      'getTelegramAdminSourceRegistryItem',
      'createTelegramAdminSourceRegistryItem',
      'updateTelegramAdminSourceRegistryItem',
      'setTelegramAdminSourceRegistryItemEnabled',
      'getTelegramAdminSourceQrExportPayload',
      'getTelegramAdminSourceQrExportPayloads',
      'getTelegramAdminSourceAnalyticsSummaries',
      'getTelegramAdminSourceAnalyticsReport',
      'getTelegramAdminSourceAnalyticsFunnelSummary',
    ];

    for (const methodName of requiredMethods) {
      expect(source).toMatch(new RegExp(`\\b${methodName}\\s*\\(`));
    }
  });

  it('targets the Telegram admin backend routes and unwraps route envelopes', () => {
    expect(source).toMatch(/\/telegram\/admin\/service-message-templates/);
    expect(source).toMatch(/\/telegram\/admin\/managed-content/);
    expect(source).toMatch(/\/telegram\/admin\/faq/);
    expect(source).toMatch(/\/telegram\/admin\/useful-content/);
    expect(source).toMatch(/\/telegram\/admin\/source-registry/);
    expect(source).toMatch(/\/telegram\/admin\/source-analytics/);
    expect(source).toMatch(/unwrapTelegramRouteOperationResult/);
  });
});
