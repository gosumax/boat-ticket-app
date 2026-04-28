import fs from 'fs';
import path from 'path';
import { expect, test } from '@playwright/test';

const SCREENSHOT_DIR = path.resolve(
  process.cwd(),
  'dev_debug',
  'miniapp-ticket-context-preserve'
);

function buildRouteResult({
  routeOperationType,
  operationResultSummary,
  nowIso = '2026-04-24T12:00:00.000Z',
}) {
  return {
    route_status: 'processed',
    route_operation_type: routeOperationType,
    operation_result_summary: operationResultSummary,
    rejection_reason: null,
    now_iso: nowIso,
    http_status: 200,
  };
}

test.describe('Telegram Mini App ticket context preservation', () => {
  test('keeps deep-link ticket context after section navigation and return to my tickets', async ({
    page,
  }) => {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

    const oldBookingRequestId = 101;
    const deepLinkCanonicalPresaleId = 916;
    const deepLinkBuyerTicketCode = 'J16/G16';

    const myRequestsReadModel = {
      response_version: 'telegram_mini_app_guest_my_requests.v1',
      list_scope: 'mini_app_guest_my_requests',
      lifecycle_items: [
        {
          booking_request_reference: {
            reference_type: 'telegram_booking_request',
            booking_request_id: oldBookingRequestId,
          },
          lifecycle_state: 'prepayment_confirmed',
          hold_active: false,
          request_confirmed: true,
          requested_prepayment_amount: 1200,
          requested_seats: 1,
          requested_trip_slot_reference: {
            requested_trip_date: '2026-04-10',
            requested_time_slot: '11:20',
          },
        },
      ],
    };

    const oldTicketItem = {
      response_version: 'telegram_mini_app_guest_ticket_list_item.v1',
      projection_item_type: 'telegram_mini_app_guest_ticket_list_item',
      booking_request_reference: {
        reference_type: 'telegram_booking_request',
        booking_request_id: oldBookingRequestId,
      },
      linked_canonical_presale_reference: {
        reference_type: 'canonical_presale',
        presale_id: 800,
      },
      ticket_status_summary: {
        deterministic_ticket_state: 'linked_ticket_ready',
      },
      ticket_availability_state: 'available',
      date_time_summary: {
        requested_trip_date: '2026-04-10',
        requested_time_slot: '11:20',
      },
      seats_count_summary: {
        requested_seats: 1,
        linked_ticket_count: 1,
      },
      buyer_ticket_reference_summary: {
        buyer_ticket_code: 'A01',
      },
    };

    const deepLinkTicketView = {
      response_version: 'telegram_guest_ticket_view_projection.v1',
      projection_item_type: 'telegram_guest_ticket_view_projection_item',
      read_only: true,
      projection_only: true,
      booking_request_reference: null,
      linked_canonical_presale_reference: {
        reference_type: 'canonical_presale',
        presale_id: deepLinkCanonicalPresaleId,
      },
      ticket_status_summary: {
        deterministic_ticket_state: 'linked_ticket_ready',
        canonical_linkage_status: 'canonical_presale_only',
      },
      ticket_availability_state: 'available',
      date_time_summary: {
        requested_trip_date: '2026-05-03',
        requested_time_slot: '16:40',
      },
      seats_count_summary: {
        requested_seats: 2,
        linked_ticket_count: 2,
      },
      payment_summary: {
        currency: 'RUB',
        total_price: 7000,
        prepayment_amount: 7000,
        remaining_payment_amount: 0,
      },
      contact_summary: {
        preferred_contact_phone_e164: '+79990000000',
      },
      seller_contact_summary: {
        seller_display_name: 'Seller Deep Link',
        seller_phone_e164: '+79991110000',
      },
      buyer_ticket_reference_summary: {
        buyer_ticket_code: deepLinkBuyerTicketCode,
      },
      boarding_qr_payload_summary: {
        qr_payload_text: `boarding:${deepLinkCanonicalPresaleId}`,
        payload_format: 'plain_text',
        compatibility_target: 'dispatcher_boarding_qr_v1',
      },
    };

    await page.route('**/api/telegram/mini-app/**', async (route) => {
      const url = new URL(route.request().url());
      const pathname = url.pathname;

      if (pathname.endsWith('/mini-app/catalog')) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(
            buildRouteResult({
              routeOperationType: 'mini_app_catalog',
              operationResultSummary: {
                response_version: 'telegram_mini_app_catalog.v1',
                items: [
                  {
                    trip_slot_reference: {
                      slot_uid: 'generated:321',
                      requested_trip_date: '2026-05-03',
                      requested_time_slot: '16:40',
                    },
                    trip_type_summary: {
                      trip_type: 'speed',
                    },
                    trip_title_summary: {
                      title: 'Скоростной маршрут',
                    },
                    date_time_summary: {
                      requested_trip_date: '2026-05-03',
                      requested_time_slot: '16:40',
                    },
                    seats_availability_summary: {
                      seats_left: 8,
                      capacity_total: 10,
                    },
                    booking_availability_state: 'bookable',
                    price_summary: {
                      currency: 'RUB',
                      adult_price: 3500,
                      teen_price: 2500,
                      child_price: 1500,
                    },
                  },
                ],
              },
            })
          ),
        });
      }

      if (pathname.endsWith('/mini-app/trip-card')) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(
            buildRouteResult({
              routeOperationType: 'mini_app_trip_card',
              operationResultSummary: {
                trip_slot_reference: {
                  slot_uid: 'generated:321',
                  requested_trip_date: '2026-05-03',
                  requested_time_slot: '16:40',
                },
                trip_title_summary: {
                  title: 'Скоростной маршрут',
                },
                date_time_summary: {
                  requested_trip_date: '2026-05-03',
                  requested_time_slot: '16:40',
                },
                seats_availability_summary: {
                  seats_left: 8,
                  capacity_total: 10,
                },
                booking_availability_state: 'bookable',
                price_summary: {
                  currency: 'RUB',
                  adult_price: 3500,
                  teen_price: 2500,
                  child_price: 1500,
                },
              },
            })
          ),
        });
      }

      if (pathname.endsWith('/mini-app/my-requests')) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(
            buildRouteResult({
              routeOperationType: 'mini_app_my_requests_list',
              operationResultSummary: myRequestsReadModel,
            })
          ),
        });
      }

      if (pathname.endsWith('/mini-app/my-tickets')) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(
            buildRouteResult({
              routeOperationType: 'mini_app_my_tickets_list',
              operationResultSummary: {
                response_version: 'telegram_mini_app_guest_ticket_list.v1',
                list_scope: 'mini_app_guest_my_tickets',
                items: [oldTicketItem],
                my_requests_read_model: myRequestsReadModel,
              },
            })
          ),
        });
      }

      if (pathname.endsWith('/mini-app/ticket-view')) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(
            buildRouteResult({
              routeOperationType: 'mini_app_ticket_view',
              operationResultSummary: deepLinkTicketView,
            })
          ),
        });
      }

      if (pathname.includes('/mini-app/entrypoint/useful_content')) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(
            buildRouteResult({
              routeOperationType: 'mini_app_entrypoint_useful_content',
              operationResultSummary: {
                entrypoint_key: 'useful_content',
                title: 'Полезное',
                body: 'Погодный и курортный блок',
                useful_content_read_model: {
                  weather_summary: {
                    weather_data_state: 'available',
                    condition_label: 'Солнечно',
                    temperature_c: 24,
                    water_temperature_c: 19,
                    location_country: 'Россия',
                    location_region: 'Краснодарский край',
                    location_locality: 'Архипо-Осиповка',
                    location_water_body: 'Чёрное море',
                  },
                  useful_content_feed_summary: {
                    items: [],
                  },
                },
              },
            })
          ),
        });
      }

      return route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({
          route_status: 'rejected_not_found',
          route_operation_type: 'mock_not_found',
          operation_result_summary: null,
          rejection_reason: `No mock response for ${pathname}`,
          now_iso: '2026-04-24T12:00:00.000Z',
          http_status: 404,
        }),
      });
    });

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(
      `/telegram/mini-app?telegram_user_id=777001&canonical_presale_id=${deepLinkCanonicalPresaleId}&buyer_ticket_code=${encodeURIComponent(
        deepLinkBuyerTicketCode
      )}`
    );

    await expect(page.getByTestId('telegram-mini-app-ticket-view')).toBeVisible();
    await expect(page.getByText(deepLinkBuyerTicketCode)).toBeVisible();
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, '01-initial-direct-ticket-open.png'),
      fullPage: true,
    });

    const navButtons = page.locator('.tg-mini-app__nav-button');
    await navButtons.nth(2).click();
    await expect(page.locator('.tg-mini-app__panel--useful')).toBeVisible();

    await navButtons.nth(0).click();
    await expect(page.getByTestId('telegram-mini-app-catalog')).toBeVisible();
    await page.getByTestId('telegram-mini-app-type-selection-card-speed').getByRole('button').click();
    await page.getByTestId('telegram-mini-app-catalog-item').first().getByRole('button').click();
    await expect(page.getByTestId('telegram-mini-app-trip-card')).toBeVisible();
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, '02-after-moving-through-sections.png'),
      fullPage: true,
    });

    await page
      .getByTestId('telegram-mini-app-trip-card')
      .locator('.tg-mini-app__panel-actions button')
      .first()
      .click();
    await expect(page.getByTestId('telegram-mini-app-catalog')).toBeVisible();

    await navButtons.nth(1).click();
    await expect(page.getByTestId('telegram-mini-app-my-tickets')).toBeVisible();

    const currentTicketContextCard = page.getByTestId('telegram-mini-app-current-ticket-context');
    await expect(currentTicketContextCard).toBeVisible();
    await expect(currentTicketContextCard).toContainText(deepLinkBuyerTicketCode);
    await currentTicketContextCard.getByRole('button').click();

    await expect(page.getByTestId('telegram-mini-app-ticket-view')).toBeVisible();
    await expect(page.getByText(deepLinkBuyerTicketCode)).toBeVisible();
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, '03-current-ticket-still-preserved.png'),
      fullPage: true,
    });
  });
});
