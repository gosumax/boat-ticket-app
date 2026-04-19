import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchMiniAppUsefulContentScreen } from '../../src/telegram/mini-app-api.js';

function createJsonResponse({
  ok = true,
  status = 200,
  payload = null,
  contentType = 'application/json; charset=utf-8',
} = {}) {
  return {
    ok,
    status,
    headers: {
      get(name) {
        return String(name || '').toLowerCase() === 'content-type'
          ? contentType
          : null;
      },
    },
    async text() {
      return payload === null ? 'null' : JSON.stringify(payload);
    },
    async json() {
      return payload;
    },
  };
}

function createRoutePayload({
  operationResultSummary = null,
  rejectionReason = null,
} = {}) {
  return {
    response_version: 'telegram_mini_app_http_route_result.v1',
    route_status: operationResultSummary ? 'processed' : 'rejected_invalid_input',
    operation_result_summary: operationResultSummary,
    rejection_reason: rejectionReason,
  };
}

describe('telegram mini app useful-content api client', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('loads useful-content screen/read model through the useful entrypoint route', async () => {
    global.fetch.mockResolvedValueOnce(
      createJsonResponse({
        ok: true,
        status: 200,
        payload: createRoutePayload({
          operationResultSummary: {
            entrypoint_key: 'useful_content',
            placeholder: false,
            useful_content_read_model: {
              weather_summary: {
                weather_data_state: 'partial',
              },
              trip_context_summary: {
                applicability_state: 'upcoming_trip_selected',
              },
            },
          },
        }),
      })
    );

    const result = await fetchMiniAppUsefulContentScreen({
      telegramUserId: '777000111',
      bookingRequestId: 17,
    });

    expect(result).toMatchObject({
      entrypoint_key: 'useful_content',
      placeholder: false,
      useful_content_read_model: {
        weather_summary: {
          weather_data_state: 'partial',
        },
        trip_context_summary: {
          applicability_state: 'upcoming_trip_selected',
        },
      },
    });
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch.mock.calls[0][0]).toContain(
      '/api/telegram/mini-app/entrypoint/useful_content'
    );
    expect(global.fetch.mock.calls[0][0]).toContain('telegram_user_id=777000111');
    expect(global.fetch.mock.calls[0][0]).toContain('booking_request_id=17');
  });

  it('returns deterministic rejection reason when useful-content route is blocked', async () => {
    global.fetch.mockResolvedValueOnce(
      createJsonResponse({
        ok: false,
        status: 404,
        payload: createRoutePayload({
          operationResultSummary: null,
          rejectionReason: 'No valid Telegram guest identity',
        }),
      })
    );

    await expect(
      fetchMiniAppUsefulContentScreen({
        telegramUserId: 'tg-not-found',
      })
    ).rejects.toThrow('No valid Telegram guest identity');
  });
});
