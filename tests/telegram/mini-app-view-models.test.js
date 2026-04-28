import { describe, expect, it } from 'vitest';
import {
  buildMiniAppHoldResultViewModel,
} from '../../src/telegram/hold-result-view-model.js';
import {
  resolveTelegramMiniAppEntrypointContent,
} from '../../shared/telegram/mini-app-entrypoints.js';

describe('telegram mini app frontend view models', () => {
  function formatExpectedLocalHoldDeadline(iso) {
    const date = new Date(iso);
    const dateLabel = new Intl.DateTimeFormat('ru-RU', {
      day: 'numeric',
      month: 'long',
      timeZone: 'Europe/Moscow',
    }).format(date);
    const timeLabel = new Intl.DateTimeFormat('ru-RU', {
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
      timeZone: 'Europe/Moscow',
    }).format(date);
    return `${dateLabel}, ${timeLabel}`;
  }

  it('builds deterministic hold-active result model for request-created state', () => {
    const viewModel = buildMiniAppHoldResultViewModel({
      submit_status: 'submitted_with_hold',
      booking_request_reference: {
        booking_request_id: 7,
      },
      hold_reference: {
        booking_hold_id: 3,
      },
      hold_expires_at_summary: {
        iso: '2036-04-10T10:46:00.000Z',
      },
      seller_contact_summary: {
        seller_display_name: 'Seller A',
        seller_phone_e164: '+79991112233',
      },
    });

    expect(viewModel).toMatchObject({
      tone: 'success',
      headline: 'Заявка создана',
      statusLabel: 'Ждём предоплату',
      holdExpiresAtIso: '2036-04-10T10:46:00.000Z',
      holdDeadlineLabel: formatExpectedLocalHoldDeadline('2036-04-10T10:46:00.000Z'),
      sellerContact: {
        sellerName: 'Seller A',
        sellerPhone: '+79991112233',
        sellerCallHref: 'tel:+79991112233',
      },
      referenceText: 'ID заявки: 7 • ID брони: 3',
      instructionSteps: [
        'Свяжитесь с продавцом или дождитесь его звонка.',
        'Передайте предоплату, чтобы подтвердить бронь.',
        'После подтверждения предоплаты билет появится здесь.',
      ],
      isSuccess: true,
    });
    expect(viewModel.primaryText).toBeNull();
    expect(viewModel.secondaryText).toBeNull();
    expect(viewModel.summaryItems).toEqual([]);
  });

  it('maps duplicate active requests into a friendly existing-request result', () => {
    const viewModel = buildMiniAppHoldResultViewModel({
      submit_status: 'submit_blocked',
      submit_reason_code: 'duplicate_active_request',
    });

    expect(viewModel.tone).toBe('success');
    expect(viewModel.headline).toBe('Заявка уже создана');
    expect(viewModel.statusLabel).toBe('Откройте «Мои заявки»');
    expect(viewModel.primaryText).toContain('активная заявка');
    expect(viewModel.isSuccess).toBe(true);
  });

  it('maps seat-capacity blocking into a buyer-facing warning message', () => {
    const viewModel = buildMiniAppHoldResultViewModel({
      submit_status: 'submit_blocked',
      submit_reason_code: 'not_enough_seats',
    });

    expect(viewModel.statusLabel).toBe('Отправка недоступна');
    expect(viewModel.primaryText).toContain('меньше мест');
    expect(viewModel.isSuccess).toBe(false);
  });

  it('resolves fallback/default placeholder content for unknown entrypoints', () => {
    const fallback = resolveTelegramMiniAppEntrypointContent('unknown-entrypoint');
    expect(fallback).toEqual({
      entrypoint_key: 'catalog',
      fallback_used: true,
      title: 'Каталог рейсов',
      body: 'Просматривайте доступные рейсы и открывайте карточку рейса, чтобы продолжить.',
      placeholder: false,
    });
  });
});
