import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  fetchMiniAppCatalog,
  fetchMiniAppMyRequests,
  fetchMiniAppTicketViewWithOfflineFallback,
  readMiniAppApiDiagnosticsSnapshot,
  resetMiniAppApiDiagnostics,
} from '../../src/telegram/mini-app-api.js';

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

function createTextResponse({
  ok = true,
  status = 200,
  body = '',
  contentType = 'text/plain; charset=utf-8',
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
      return body;
    },
    async json() {
      return JSON.parse(body);
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

describe('telegram mini app ticket api client fallback behavior', () => {
  const originalFetch = global.fetch;
  const originalWindow = global.window;

  beforeEach(() => {
    global.fetch = vi.fn();
    resetMiniAppApiDiagnostics();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    global.window = originalWindow;
    resetMiniAppApiDiagnostics();
    vi.restoreAllMocks();
  });

  it('returns ticket view without fallback when primary ticket request succeeds', async () => {
    global.fetch.mockResolvedValueOnce(
      createJsonResponse({
        ok: true,
        status: 200,
        payload: createRoutePayload({
          operationResultSummary: {
            booking_request_reference: {
              booking_request_id: 17,
            },
            ticket_status_summary: {
              deterministic_ticket_state: 'linked_ticket_ready',
            },
          },
        }),
      })
    );

    const result = await fetchMiniAppTicketViewWithOfflineFallback({
      telegramUserId: '777000111',
      bookingRequestId: 17,
    });

    expect(result).toEqual({
      ticketView: {
        booking_request_reference: {
          booking_request_id: 17,
        },
        ticket_status_summary: {
          deterministic_ticket_state: 'linked_ticket_ready',
        },
      },
      offlineSnapshot: null,
      fallbackUsed: false,
      ticketViewErrorMessage: null,
    });
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('falls back to offline snapshot when ticket view endpoint fails', async () => {
    global.fetch
      .mockResolvedValueOnce(
        createJsonResponse({
          ok: false,
          status: 404,
          payload: createRoutePayload({
            operationResultSummary: null,
            rejectionReason: 'Invalid booking request reference: 27',
          }),
        })
      )
      .mockResolvedValueOnce(
        createJsonResponse({
          ok: true,
          status: 200,
          payload: createRoutePayload({
            operationResultSummary: {
              booking_request_reference: {
                booking_request_id: 27,
              },
              offline_snapshot_status: 'offline_unavailable',
            },
          }),
        })
      );

    const result = await fetchMiniAppTicketViewWithOfflineFallback({
      telegramUserId: '777000111',
      bookingRequestId: 27,
    });

    expect(result).toEqual({
      ticketView: null,
      offlineSnapshot: {
        booking_request_reference: {
          booking_request_id: 27,
        },
        offline_snapshot_status: 'offline_unavailable',
      },
      fallbackUsed: true,
      ticketViewErrorMessage: 'Invalid booking request reference: 27',
    });
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(global.fetch.mock.calls[1][0]).toContain('/offline-snapshot');
  });

  it('throws deterministic error when both ticket and offline requests fail', async () => {
    global.fetch
      .mockResolvedValueOnce(
        createJsonResponse({
          ok: false,
          status: 409,
          payload: createRoutePayload({
            operationResultSummary: null,
            rejectionReason: 'blocked_ticket_projection',
          }),
        })
      )
      .mockResolvedValueOnce(
        createJsonResponse({
          ok: false,
          status: 409,
          payload: createRoutePayload({
            operationResultSummary: null,
            rejectionReason: 'offline_snapshot_unavailable',
          }),
        })
      );

    await expect(
      fetchMiniAppTicketViewWithOfflineFallback({
        telegramUserId: '777000111',
        bookingRequestId: 28,
      })
    ).rejects.toThrow('blocked_ticket_projection');
  });

  it('forwards telegram webapp init-data header for runtime guest binding', async () => {
    global.window = {
      Telegram: {
        WebApp: {
          initData:
            'query_id=qa&user=%7B%22id%22%3A777000111%7D&auth_date=1775815200&hash=test',
        },
      },
    };
    global.fetch.mockResolvedValueOnce(
      createJsonResponse({
        ok: true,
        status: 200,
        payload: createRoutePayload({
          operationResultSummary: {
            booking_request_reference: {
              booking_request_id: 29,
            },
            ticket_status_summary: {
              deterministic_ticket_state: 'no_ticket_yet',
            },
          },
        }),
      })
    );

    await fetchMiniAppTicketViewWithOfflineFallback({
      telegramUserId: null,
      bookingRequestId: 29,
    });

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch.mock.calls[0][1].headers).toMatchObject({
      'x-telegram-webapp-init-data':
        'query_id=qa&user=%7B%22id%22%3A777000111%7D&auth_date=1775815200&hash=test',
    });
  });

  it('uses tgWebAppData query fallback to bind guest identity and init-data header', async () => {
    const initData =
      'query_id=qa&user=%7B%22id%22%3A777000111%7D&auth_date=1775815200&hash=test';
    global.window = {
      location: {
        search: `?tgWebAppData=${encodeURIComponent(encodeURIComponent(initData))}`,
      },
    };
    global.fetch.mockResolvedValueOnce(
      createJsonResponse({
        ok: true,
        status: 200,
        payload: createRoutePayload({
          operationResultSummary: {
            list_scope: 'mini_app_guest_my_requests',
            active_reservation_count: 0,
            completed_cancelled_expired_count: 0,
          },
        }),
      })
    );

    await fetchMiniAppMyRequests({
      telegramUserId: null,
      limit: 25,
    });

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch.mock.calls[0][0]).toContain('/api/telegram/mini-app/my-requests');
    expect(global.fetch.mock.calls[0][0]).toContain('telegram_user_id=777000111');
    expect(global.fetch.mock.calls[0][0]).toContain('limit=25');
    const sentInitDataHeader =
      global.fetch.mock.calls[0][1].headers['x-telegram-webapp-init-data'];
    expect([initData, encodeURIComponent(initData)]).toContain(sentInitDataHeader);
  });

  it('uses tgWebAppData hash fallback to bind guest identity and init-data header', async () => {
    const initData =
      'query_id=qa&user=%7B%22id%22%3A777123999%7D&auth_date=1775815200&hash=test';
    global.window = {
      location: {
        search: '',
        hash: `#tgWebAppData=${encodeURIComponent(encodeURIComponent(initData))}&tgWebAppVersion=8.0`,
      },
    };
    global.fetch.mockResolvedValueOnce(
      createJsonResponse({
        ok: true,
        status: 200,
        payload: createRoutePayload({
          operationResultSummary: {
            list_scope: 'mini_app_guest_my_requests',
            active_reservation_count: 1,
          },
        }),
      })
    );

    await fetchMiniAppMyRequests({
      telegramUserId: null,
      limit: 20,
    });

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch.mock.calls[0][0]).toContain('telegram_user_id=777123999');
    const sentInitDataHeader =
      global.fetch.mock.calls[0][1].headers['x-telegram-webapp-init-data'];
    expect([initData, encodeURIComponent(initData)]).toContain(sentInitDataHeader);
  });

  it('loads my-requests read model for active reservation counters', async () => {
    global.fetch.mockResolvedValueOnce(
      createJsonResponse({
        ok: true,
        status: 200,
        payload: createRoutePayload({
          operationResultSummary: {
            list_scope: 'mini_app_guest_my_requests',
            active_reservation_count: 1,
            completed_cancelled_expired_count: 0,
            trip_timeline_item_count: 2,
          },
        }),
      })
    );

    const result = await fetchMiniAppMyRequests({
      telegramUserId: '777000111',
      limit: 50,
    });

    expect(result).toMatchObject({
      list_scope: 'mini_app_guest_my_requests',
      active_reservation_count: 1,
      trip_timeline_item_count: 2,
    });
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch.mock.calls[0][0]).toContain('/api/telegram/mini-app/my-requests');
    expect(global.fetch.mock.calls[0][0]).toContain('telegram_user_id=777000111');
    expect(global.fetch.mock.calls[0][0]).toContain('limit=50');
  });

  it('uses no-store same-origin GETs with accept header and no JSON content-type', async () => {
    global.fetch.mockResolvedValueOnce(
      createJsonResponse({
        ok: true,
        status: 200,
        payload: createRoutePayload({
          operationResultSummary: {
            list_scope: 'mini_app_guest_my_requests',
            active_reservation_count: 0,
          },
        }),
      })
    );

    await fetchMiniAppMyRequests({
      telegramUserId: '777000111',
      limit: 20,
    });

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch.mock.calls[0][1]).toMatchObject({
      method: 'GET',
      cache: 'no-store',
      credentials: 'same-origin',
    });
    expect(global.fetch.mock.calls[0][1].headers).toMatchObject({
      accept: 'application/json',
    });
    expect(global.fetch.mock.calls[0][1].headers['content-type']).toBeUndefined();
    expect(global.fetch.mock.calls[0][1].headers['ngrok-skip-browser-warning']).toBeUndefined();
  });

  it('adds the ngrok skip-browser-warning header for public ngrok Mini App requests', async () => {
    global.window = {
      location: {
        origin: 'https://buyer-shell.ngrok-free.dev',
        search: '',
        hash: '',
      },
    };
    global.fetch.mockResolvedValueOnce(
      createJsonResponse({
        ok: true,
        status: 200,
        payload: createRoutePayload({
          operationResultSummary: {
            list_scope: 'mini_app_guest_my_requests',
            active_reservation_count: 0,
          },
        }),
      })
    );

    await fetchMiniAppMyRequests({
      telegramUserId: '777000111',
      limit: 20,
    });

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch.mock.calls[0][0]).toBe(
      'https://buyer-shell.ngrok-free.dev/api/telegram/mini-app/my-requests?telegram_user_id=777000111&limit=20'
    );
    expect(global.fetch.mock.calls[0][1].headers).toMatchObject({
      accept: 'application/json',
      'ngrok-skip-browser-warning': '1',
    });
    expect(global.fetch.mock.calls[0][1].headers['content-type']).toBeUndefined();
  });

  it('forwards debug header when mini_app_debug query flag is enabled', async () => {
    global.window = {
      location: {
        search: '?mini_app_debug=1',
      },
    };
    global.fetch.mockResolvedValueOnce(
      createJsonResponse({
        ok: true,
        status: 200,
        payload: createRoutePayload({
          operationResultSummary: {
            list_scope: 'mini_app_guest_my_requests',
            active_reservation_count: 0,
          },
        }),
      })
    );

    await fetchMiniAppMyRequests({
      telegramUserId: '777000111',
      limit: 20,
    });

    expect(global.fetch.mock.calls[0][1].headers).toMatchObject({
      accept: 'application/json',
      'x-telegram-mini-app-debug': '1',
    });
  });

  it('captures non-JSON catalog responses in diagnostics and throws a precise parse error', async () => {
    global.fetch.mockResolvedValueOnce(
      createTextResponse({
        ok: true,
        status: 200,
        body: '<!doctype html><html><body>stale html</body></html>',
        contentType: 'text/html; charset=utf-8',
      })
    );

    await expect(
      fetchMiniAppCatalog({
        telegramUserId: '777000111',
      })
    ).rejects.toThrow(
      'Не удалось загрузить каталог рейсов (received non-JSON response: text/html; charset=utf-8, status 200)'
    );

    expect(readMiniAppApiDiagnosticsSnapshot().catalog).toMatchObject({
      requestUrl: expect.stringContaining('/api/telegram/mini-app/catalog'),
      method: 'GET',
      responseArrived: true,
      status: 200,
      contentType: 'text/html; charset=utf-8',
      jsonParseSucceeded: false,
      routeStatus: null,
      rejectionReason: null,
      responsePreview: '<!doctype html><html><body>stale html</body></html>',
    });
  });
});
