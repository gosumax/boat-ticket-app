import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('../../src/utils/apiClient.js', import.meta.url), 'utf8');

describe('apiClient telegram live smoke pilot contract smoke', () => {
  it('contains live smoke pilot method wrappers for operator capture/reporting', () => {
    const requiredMethods = [
      'getTelegramLiveSmokePilotChecklist',
      'captureTelegramLiveSmokePilotResults',
    ];

    for (const methodName of requiredMethods) {
      expect(source).toMatch(new RegExp(`\\b${methodName}\\s*\\(`));
    }
  });

  it('targets telegram smoke pilot endpoints and unwraps route envelopes', () => {
    expect(source).toMatch(/\/telegram\/smoke-pilot\/checklist/);
    expect(source).toMatch(/\/telegram\/smoke-pilot\/report/);
    expect(source).toMatch(/unwrapTelegramRouteOperationResult/);
  });
});
