import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const originalWindow = global.window;
const originalFetch = global.fetch;
let apiClient = null;

function createResponse({
  status = 200,
  body = { ok: true },
} = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() {
      return JSON.stringify(body);
    },
  };
}

describe('api client storage guard', () => {
  beforeEach(async () => {
    global.fetch = vi.fn().mockResolvedValue(createResponse());
    global.window = {
      addEventListener() {},
      fetch: global.fetch,
    };
    ({ default: apiClient } = await import('../../src/utils/apiClient.js'));
    apiClient.token = null;
  });

  afterEach(() => {
    global.window = originalWindow;
    global.fetch = originalFetch;
    if (apiClient) {
      apiClient.token = null;
    }
    apiClient = null;
    vi.restoreAllMocks();
  });

  it('keeps requests working when localStorage getter throws SecurityError', async () => {
    global.window = {
      get localStorage() {
        throw new Error('SecurityError');
      },
    };

    await expect(apiClient.request('/telegram/smoke-readiness')).resolves.toEqual({
      ok: true,
    });
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch.mock.calls[0][0]).toBe('/api/telegram/smoke-readiness');
  });

  it('does not throw when setting or clearing token with blocked localStorage', () => {
    global.window = {
      get localStorage() {
        throw new Error('SecurityError');
      },
    };

    expect(() => apiClient.setToken('token-123')).not.toThrow();
    expect(() => apiClient.clearToken()).not.toThrow();
  });
});
