import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sourceManagementViewSource = readFileSync(
  new URL('../../src/telegram/AdminTelegramSourceManagementView.jsx', import.meta.url),
  'utf8'
);

describe('telegram source-management payload contract', () => {
  it('maps source token input into source_token payload field for create/update', () => {
    expect(sourceManagementViewSource).toMatch(/source_token:\s*selectedDraft\.sourceToken/);
    expect(sourceManagementViewSource).toMatch(
      /source_reference:\s*selectedDraft\.sourceReference/
    );
    expect(sourceManagementViewSource).toMatch(
      /apiClient\.createTelegramAdminSourceRegistryItem\(payload\)/
    );
    expect(sourceManagementViewSource).toMatch(
      /apiClient\.updateTelegramAdminSourceRegistryItem\(\s*selectedSourceReferenceValue,\s*payload\s*\)/
    );
  });

  it('maps seller-bound create payload through normalized seller_id and blocks empty seller binding', () => {
    expect(sourceManagementViewSource).toMatch(
      /const sellerId =\s*selectedDraft\.sourceFamily === 'seller_source'/
    );
    expect(sourceManagementViewSource).toMatch(/seller_id:\s*sellerId/);
    expect(sourceManagementViewSource).toMatch(
      /if \(selectedDraft\.sourceFamily === 'seller_source' && !sellerId\)/
    );
  });
});
