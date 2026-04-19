import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  fetchMiniAppContactScreen,
  fetchMiniAppFaqScreen,
} from '../../src/telegram/mini-app-api.js';

function createJsonResponse({
  ok = true,
  status = 200,
  payload = null,
} = {}) {
  return {
    ok,
    status,
    headers: {
      get(name) {
        return String(name || '').toLowerCase() === 'content-type'
          ? 'application/json; charset=utf-8'
          : null;
      },
    },
    async text() {
      return payload === null ? 'null' : JSON.stringify(payload);
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

describe('telegram mini app faq/contact api client', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('loads FAQ and Contact screens through the Mini App entrypoint route', async () => {
    global.fetch
      .mockResolvedValueOnce(
        createJsonResponse({
          ok: true,
          status: 200,
          payload: createRoutePayload({
            operationResultSummary: {
              entrypoint_key: 'faq',
              faq_read_model: {
                item_count: 2,
              },
            },
          }),
        })
      )
      .mockResolvedValueOnce(
        createJsonResponse({
          ok: true,
          status: 200,
          payload: createRoutePayload({
            operationResultSummary: {
              entrypoint_key: 'contact',
              contact_read_model: {
                applicability_state: 'booking_request_context',
                preferred_contact_phone_e164: '+79990000000',
              },
            },
          }),
        })
      );

    const faqResult = await fetchMiniAppFaqScreen({
      telegramUserId: '777000111',
    });
    const contactResult = await fetchMiniAppContactScreen({
      telegramUserId: '777000111',
      bookingRequestId: 15,
    });

    expect(faqResult).toMatchObject({
      entrypoint_key: 'faq',
      faq_read_model: {
        item_count: 2,
      },
    });
    expect(contactResult).toMatchObject({
      entrypoint_key: 'contact',
      contact_read_model: {
        applicability_state: 'booking_request_context',
        preferred_contact_phone_e164: '+79990000000',
      },
    });
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(global.fetch.mock.calls[0][0]).toContain('/api/telegram/mini-app/entrypoint/faq');
    expect(global.fetch.mock.calls[0][0]).toContain('telegram_user_id=777000111');
    expect(global.fetch.mock.calls[1][0]).toContain('/api/telegram/mini-app/entrypoint/contact');
    expect(global.fetch.mock.calls[1][0]).toContain('telegram_user_id=777000111');
    expect(global.fetch.mock.calls[1][0]).toContain('booking_request_id=15');
  });

  it('returns deterministic rejection reasons for blocked Contact route', async () => {
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
      fetchMiniAppContactScreen({
        telegramUserId: 'tg-not-found',
      })
    ).rejects.toThrow('No valid Telegram guest identity');
  });
});
