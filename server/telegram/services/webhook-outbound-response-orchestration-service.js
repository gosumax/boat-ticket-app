import {
  buildTelegramLatestTimestampSummary,
  freezeTelegramHandoffValue,
  TELEGRAM_NOTIFICATION_DELIVERY_ADAPTER_CONTRACT_VERSION,
  TELEGRAM_NOTIFICATION_DELIVERY_EXECUTION_STATUSES,
  TELEGRAM_SERVICE_MESSAGE_TYPES,
} from '../../../shared/telegram/index.js';
import { TELEGRAM_NOTIFICATION_DELIVERY_CHANNEL } from './notification-delivery-planning-service.js';

export const TELEGRAM_WEBHOOK_OUTBOUND_RESPONSE_RESULT_VERSION =
  'telegram_webhook_outbound_response_result.v1';

const SERVICE_NAME = 'telegram_webhook_outbound_response_orchestration_service';
const MINI_APP_LAUNCH_ACTION_TYPE = 'open_mini_app';
const BUTTON_ACTION_LABELS = Object.freeze({
  open_mini_app: 'Открыть приложение',
  open_ticket: 'Мой билет / заявки',
  open_my_tickets: 'Мой билет / заявки',
  open_trips: 'Рейсы в приложении',
  open_useful_content: 'Полезное',
  open_faq: 'FAQ',
  open_contact: 'Связь',
  cancel_before_prepayment: 'Отменить заявку',
});
const FALLBACK_NOTIFICATION_TYPE = TELEGRAM_SERVICE_MESSAGE_TYPES.booking_created;

function normalizeString(value) {
  const normalized = String(value ?? '').trim();
  return normalized || null;
}

function sortValue(value) {
  if (Array.isArray(value)) {
    return value.map((item) => sortValue(item));
  }
  if (!value || typeof value !== 'object') {
    return value;
  }

  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortValue(value[key])])
  );
}

function freezeSortedValue(value) {
  return freezeTelegramHandoffValue(sortValue(value));
}

function normalizeBookingRequestId(reference) {
  const bookingRequestId = Number(reference?.booking_request_id);
  if (!Number.isInteger(bookingRequestId) || bookingRequestId <= 0) {
    return null;
  }

  return bookingRequestId;
}

function buildCallbackPayload(actionType, bookingRequestReference = null) {
  const bookingRequestId = normalizeBookingRequestId(bookingRequestReference);
  if (bookingRequestId) {
    return `action:${actionType}:${bookingRequestId}`;
  }
  return `action:${actionType}`;
}

function buildButtonPayload(
  actionType,
  bookingRequestReference = null,
  { webAppUrl = null } = {}
) {
  const isMiniAppLaunchAction = actionType === MINI_APP_LAUNCH_ACTION_TYPE;
  return freezeSortedValue({
    action_type: actionType,
    button_text: BUTTON_ACTION_LABELS[actionType] || actionType,
    callback_data: isMiniAppLaunchAction
      ? null
      : buildCallbackPayload(actionType, bookingRequestReference),
    web_app_url: isMiniAppLaunchAction ? normalizeString(webAppUrl) : null,
  });
}

function resolveMiniAppLaunchUrl(miniAppLaunchSummary = null) {
  const hasSummary =
    miniAppLaunchSummary &&
    typeof miniAppLaunchSummary === 'object' &&
    !Array.isArray(miniAppLaunchSummary);
  if (!hasSummary || miniAppLaunchSummary.launch_ready !== true) {
    return null;
  }
  return normalizeString(miniAppLaunchSummary.launch_url);
}

function buildPrimaryMiniAppButton({
  miniAppLaunchSummary = null,
  bookingRequestReference = null,
} = {}) {
  return [];
}

function appendQueryParamToUrl(rawUrl, key, value) {
  const normalizedUrl = normalizeString(rawUrl);
  const normalizedKey = normalizeString(key);
  const normalizedValue = normalizeString(value);
  if (!normalizedUrl || !normalizedKey || !normalizedValue) {
    return normalizedUrl;
  }

  try {
    const parsed = new URL(normalizedUrl);
    parsed.searchParams.set(normalizedKey, normalizedValue);
    return parsed.toString();
  } catch {
    const [basePart, hashPart] = normalizedUrl.split('#', 2);
    const separator = basePart.includes('?') ? '&' : '?';
    const encodedParam = `${encodeURIComponent(normalizedKey)}=${encodeURIComponent(
      normalizedValue
    )}`;
    const withQuery = `${basePart}${separator}${encodedParam}`;
    return hashPart ? `${withQuery}#${hashPart}` : withQuery;
  }
}

function resolveButtonPayloadsForTarget(buttonPayloads = [], targetSummary = null) {
  const telegramUserId = normalizeString(targetSummary?.telegram_user_id);
  if (!telegramUserId) {
    return buttonPayloads;
  }

  return buttonPayloads.map((button) => {
    const webAppUrl = normalizeString(button?.web_app_url);
    if (!webAppUrl) {
      return button;
    }
    return freezeSortedValue({
      ...button,
      web_app_url: appendQueryParamToUrl(
        webAppUrl,
        'telegram_user_id',
        telegramUserId
      ),
    });
  });
}

function buildInlineKeyboardButton(button) {
  const text = normalizeString(button?.button_text) || 'Открыть';
  const webAppUrl = normalizeString(button?.web_app_url);
  if (webAppUrl) {
    return {
      text,
      web_app: {
        url: webAppUrl,
      },
    };
  }

  return {
    text,
    callback_data: button.callback_data,
  };
}

function buildInlineKeyboard(buttonPayloads = [], rowSize = 2) {
  const normalizedButtons = buttonPayloads.filter((button) => {
    const hasCallbackData = Boolean(normalizeString(button?.callback_data));
    const hasWebAppUrl = Boolean(normalizeString(button?.web_app_url));
    return hasCallbackData || hasWebAppUrl;
  });
  const rows = [];
  if (normalizedButtons.length === 0) {
    return freezeSortedValue({
      inline_keyboard: rows,
    });
  }

  let list = normalizedButtons;
  if (
    normalizeString(normalizedButtons[0]?.action_type) === MINI_APP_LAUNCH_ACTION_TYPE
  ) {
    rows.push([buildInlineKeyboardButton(normalizedButtons[0])]);
    list = normalizedButtons.slice(1);
  }

  let index = 0;
  while (index < list.length) {
    const rowButtons = list
      .slice(index, index + rowSize)
      .map((button) => buildInlineKeyboardButton(button));
    rows.push(rowButtons);
    index += rowSize;
  }
  return freezeSortedValue({
    inline_keyboard: rows,
  });
}

function extractResponseTarget(rawUpdate = {}) {
  const message = rawUpdate?.message || rawUpdate?.callback_query?.message || null;
  const from = rawUpdate?.message?.from || rawUpdate?.callback_query?.from || null;
  const firstName = normalizeString(from?.first_name);
  const lastName = normalizeString(from?.last_name);
  const displayName = normalizeString(
    [firstName, lastName].filter(Boolean).join(' ')
  );

  return freezeSortedValue({
    telegram_update_id:
      Number.isInteger(rawUpdate?.update_id) && rawUpdate.update_id >= 0
        ? rawUpdate.update_id
        : null,
    telegram_user_id: normalizeString(from?.id),
    telegram_chat_id: normalizeString(message?.chat?.id),
    telegram_chat_type: normalizeString(message?.chat?.type),
    display_name: displayName || normalizeString(from?.username) || normalizeString(from?.id),
    username: normalizeString(from?.username),
    language_code: normalizeString(from?.language_code),
  });
}

function normalizeActionStatus(actionStatus) {
  return normalizeString(actionStatus) || 'action_unknown';
}

const DEFAULT_OPEN_APP_STATUS_LINE = 'Нажмите «Открыть приложение».';

const TICKET_STATE_LABELS = Object.freeze({
  linked_ticket_ready: 'Билет готов',
  linked_ticket_completed: 'Поездка завершена',
  linked_ticket_cancelled_or_unavailable: 'Билет недоступен',
  no_ticket_yet: 'Оформляется',
});

const REQUEST_LIFECYCLE_LABELS = Object.freeze({
  new: 'Заявка принята',
  hold_active: 'Ожидаем предоплату',
  hold_extended: 'Ожидаем предоплату',
  prepayment_confirmed: 'Предоплата подтверждена',
  hold_expired: 'Бронь истекла',
  cancelled_before_prepayment: 'Заявка отменена',
});

const REQUEST_BOOKING_STATUS_LABELS = Object.freeze({
  NEW: 'Заявка принята',
  ATTRIBUTED: 'Заявка в работе',
  CONTACT_IN_PROGRESS: 'Заявка в работе',
  HOLD_ACTIVE: 'Ожидаем предоплату',
  WAITING_PREPAYMENT: 'Ожидаем предоплату',
  PREPAYMENT_CONFIRMED: 'Предоплата подтверждена',
  CONFIRMED_TO_PRESALE: 'Билет оформляется',
  GUEST_CANCELLED: 'Заявка отменена',
  HOLD_EXPIRED: 'Бронь истекла',
  SELLER_NOT_REACHED: 'Связь с продавцом уточняется',
  CLOSED_UNCONVERTED: 'Заявка закрыта',
});

function hasCyrillicText(value) {
  return /[А-Яа-яЁё]/.test(String(value ?? ''));
}

function formatGuestDate(value) {
  const normalized = normalizeString(value);
  if (!normalized) {
    return null;
  }
  const parts = normalized.split('-');
  if (parts.length !== 3) {
    return normalized;
  }
  const [year, month, day] = parts;
  if (year.length !== 4 || month.length !== 2 || day.length !== 2) {
    return normalized;
  }
  return `${day}.${month}.${year}`;
}

function formatGuestTime(value) {
  const normalized = normalizeString(value);
  if (!normalized) {
    return null;
  }
  const match = normalized.match(/^(\d{2}):(\d{2})/);
  if (match) {
    return `${match[1]}:${match[2]}`;
  }
  return normalized;
}

function formatGuestDateTime(dateValue, timeValue) {
  const dateLabel = formatGuestDate(dateValue);
  const timeLabel = formatGuestTime(timeValue);
  if (dateLabel && timeLabel) {
    return `${dateLabel} ${timeLabel}`;
  }
  return dateLabel || timeLabel || 'уточняется';
}

function formatTemperature(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 'н/д';
  }
  const rounded = Math.round(numeric * 10) / 10;
  return `${rounded}°C`;
}

function formatSunset(weatherSummary = null) {
  const local = formatGuestTime(weatherSummary?.sunset_time_local);
  if (local) {
    return local;
  }
  const iso = normalizeString(weatherSummary?.sunset_time_iso);
  if (!iso) {
    return 'н/д';
  }
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) {
    return formatGuestTime(iso) || 'н/д';
  }
  return parsed.toISOString().slice(11, 16);
}

function extractTicketSummary(resolvedData = null) {
  if (!resolvedData || typeof resolvedData !== 'object' || Array.isArray(resolvedData)) {
    return null;
  }
  if (
    resolvedData.ticket_view_summary &&
    typeof resolvedData.ticket_view_summary === 'object' &&
    !Array.isArray(resolvedData.ticket_view_summary)
  ) {
    return resolvedData.ticket_view_summary;
  }
  if (
    resolvedData.ticket_status_summary ||
    resolvedData.buyer_ticket_reference_summary ||
    resolvedData.ticket_availability_state
  ) {
    return resolvedData;
  }
  return null;
}

function extractBookingRequestsSummary(resolvedData = null) {
  if (!resolvedData || typeof resolvedData !== 'object' || Array.isArray(resolvedData)) {
    return null;
  }
  if (
    resolvedData.booking_requests_summary &&
    typeof resolvedData.booking_requests_summary === 'object' &&
    Array.isArray(resolvedData.booking_requests_summary.items)
  ) {
    return resolvedData.booking_requests_summary;
  }
  if (
    Array.isArray(resolvedData.items) &&
    resolvedData.items.some((item) => item?.booking_request_reference)
  ) {
    return resolvedData;
  }
  return null;
}

function isActiveTicketSummary(ticketSummary = null) {
  const ticketState = normalizeString(
    ticketSummary?.ticket_status_summary?.deterministic_ticket_state
  );
  const availability = normalizeString(ticketSummary?.ticket_availability_state);
  return ticketState === 'linked_ticket_ready' || availability === 'available';
}

function resolveTicketStatusLabel(ticketSummary = null) {
  const ticketState = normalizeString(
    ticketSummary?.ticket_status_summary?.deterministic_ticket_state
  );
  if (ticketState && TICKET_STATE_LABELS[ticketState]) {
    return TICKET_STATE_LABELS[ticketState];
  }
  return 'Статус обновляется';
}

function buildTicketBlock(ticketSummary = null) {
  if (!ticketSummary || !isActiveTicketSummary(ticketSummary)) {
    return null;
  }
  const dateTimeLabel = formatGuestDateTime(
    ticketSummary?.date_time_summary?.requested_trip_date,
    ticketSummary?.date_time_summary?.requested_time_slot
  );
  const ticketCode = normalizeString(
    ticketSummary?.buyer_ticket_reference_summary?.buyer_ticket_code
  );
  return [
    'Билет',
    `- Дата и время: ${dateTimeLabel}`,
    `- Статус: ${resolveTicketStatusLabel(ticketSummary)}`,
    `- Номер билета: ${ticketCode ? `№ ${ticketCode}` : 'выдаётся'}`,
  ].join('\n');
}

function resolveRequestStatusLabel(requestItem = null) {
  const lifecycleState = normalizeString(requestItem?.lifecycle_state);
  if (lifecycleState && REQUEST_LIFECYCLE_LABELS[lifecycleState]) {
    return REQUEST_LIFECYCLE_LABELS[lifecycleState];
  }
  const bookingStatus = normalizeString(requestItem?.booking_request_status)?.toUpperCase();
  if (bookingStatus && REQUEST_BOOKING_STATUS_LABELS[bookingStatus]) {
    return REQUEST_BOOKING_STATUS_LABELS[bookingStatus];
  }
  return 'Статус обновляется';
}

function resolveRequestProgressLine(requestItem = null) {
  const lifecycleState = normalizeString(requestItem?.lifecycle_state);
  if (lifecycleState === 'hold_active' || lifecycleState === 'hold_extended') {
    return 'Ждём предоплату, после подтверждения оформим билет.';
  }
  if (lifecycleState === 'prepayment_confirmed') {
    return 'Оформляем билет.';
  }
  if (lifecycleState === 'new') {
    return 'Уточняем детали заявки.';
  }
  return null;
}

function pickActiveRequestItem(bookingRequestsSummary = null, ticketSummary = null) {
  const items = Array.isArray(bookingRequestsSummary?.items)
    ? bookingRequestsSummary.items
    : [];
  if (items.length === 0) {
    return null;
  }
  const ticketBookingRequestId = Number(
    ticketSummary?.booking_request_reference?.booking_request_id
  );
  const activeItems = items.filter((item) => Boolean(item?.request_active));
  if (activeItems.length === 0) {
    return null;
  }
  const withoutTicketItem = Number.isInteger(ticketBookingRequestId)
    ? activeItems.filter(
        (item) => Number(item?.booking_request_reference?.booking_request_id) !== ticketBookingRequestId
      )
    : activeItems;
  return withoutTicketItem[0] || activeItems[0] || null;
}

function buildRequestBlock(requestItem = null) {
  if (!requestItem) {
    return null;
  }
  const dateTimeLabel = formatGuestDateTime(
    requestItem?.requested_trip_slot_reference?.requested_trip_date,
    requestItem?.requested_trip_slot_reference?.requested_time_slot
  );
  const progressLine = resolveRequestProgressLine(requestItem);
  const lines = [
    'Заявка',
    `- Дата и время: ${dateTimeLabel}`,
    `- Статус: ${resolveRequestStatusLabel(requestItem)}`,
  ];
  if (progressLine) {
    lines.push(`- Сейчас: ${progressLine}`);
  }
  return lines.join('\n');
}

function buildTicketAndRequestTextSummary(resolvedData = null) {
  const ticketSummary = extractTicketSummary(resolvedData);
  const bookingRequestsSummary = extractBookingRequestsSummary(resolvedData);
  const ticketBlock = buildTicketBlock(ticketSummary);
  const requestBlock = buildRequestBlock(
    pickActiveRequestItem(bookingRequestsSummary, ticketSummary)
  );
  const blocks = [ticketBlock, requestBlock].filter(Boolean);
  if (blocks.length > 0) {
    return {
      body: blocks.join('\n\n'),
      content_source: 'resolved_action_content',
    };
  }

  return {
    body: 'Сейчас нет активных билетов и заявок.',
    content_source:
      ticketSummary || bookingRequestsSummary
        ? 'resolved_action_content'
        : 'default_fallback_content',
  };
}

function buildUsefulTextSummary(resolvedData = null) {
  const weatherSummary =
    resolvedData?.weather_summary &&
    typeof resolvedData.weather_summary === 'object' &&
    !Array.isArray(resolvedData.weather_summary)
      ? resolvedData.weather_summary
      : null;
  const condition =
    normalizeString(weatherSummary?.condition_label) ||
    normalizeString(weatherSummary?.condition_code) ||
    'нет данных';
  const body = [
    `Погода: ${condition}`,
    `Воздух: ${formatTemperature(weatherSummary?.temperature_c)}`,
    `Вода: ${formatTemperature(weatherSummary?.water_temperature_c)}`,
    `Закат: ${formatSunset(weatherSummary)}`,
  ].join('\n');
  const hasWeatherPayload = Boolean(weatherSummary);
  return {
    body,
    content_source: hasWeatherPayload
      ? 'resolved_action_content'
      : 'default_fallback_content',
  };
}

function buildFaqTextSummary(resolvedData = null) {
  const items = Array.isArray(resolvedData?.items) ? resolvedData.items : [];
  const list = items
    .map((item) => ({
      title: normalizeString(item?.title_short_text_summary?.title),
      shortText: normalizeString(item?.title_short_text_summary?.short_text),
    }))
    .filter(
      (item) =>
        Boolean(item.title || item.shortText) &&
        (hasCyrillicText(item.title) || hasCyrillicText(item.shortText))
    )
    .slice(0, 3)
    .map(
      (item, index) =>
        `${index + 1}. ${item.title || 'Вопрос'}${item.shortText ? ` — ${item.shortText}` : ''}`
    );
  if (list.length > 0) {
    return {
      body: list.join('\n'),
      content_source: 'resolved_action_content',
    };
  }

  return {
    body: [
      '1. Как купить билет?',
      '2. Когда приходить на посадку?',
      '3. Что делать, если опаздываю?',
    ].join('\n'),
    content_source: 'default_fallback_content',
  };
}

function buildContactTextSummary(resolvedData = null) {
  const preferredPhone = normalizeString(resolvedData?.preferred_contact_phone_e164);
  const supportItems = Array.isArray(resolvedData?.support_content_feed_summary?.items)
    ? resolvedData.support_content_feed_summary.items
    : [];
  const supportLine = supportItems
    .map((item) => normalizeString(item?.title_short_text_summary?.short_text))
    .find((line) => hasCyrillicText(line));
  const routeLine =
    supportLine ||
    'По вопросам маршрута и времени посадки звоните диспетчеру заранее.';
  const body = [
    `Телефон диспетчера: ${preferredPhone || 'уточните в приложении'}.`,
    routeLine,
  ].join('\n');
  return {
    body,
    content_source:
      preferredPhone || supportLine
        ? 'resolved_action_content'
        : 'default_fallback_content',
  };
}

function buildStartTextFields(_startMode, _operationStatus) {
  return freezeSortedValue({
    headline: 'МОРЕ: билеты на катер',
    body:
      'Если у вас уже есть билет, введите номер билета сообщением в этот чат. Например: А12. Если номера под рукой нет, нажмите «Открыть приложение».',
    status_line: 'Нажмите «Открыть приложение».',
    content_source: 'start_mode_content',
  });
}

function buildStartTextFieldsWithHandoff(startMode, operationStatus, startHandoffSummary = null) {
  const handoffLookupStatus = normalizeString(startHandoffSummary?.lookup_status);
  const handoffBuyerTicketCode = normalizeString(startHandoffSummary?.buyer_ticket_code);
  const handoffCanonicalPresaleId = Number(startHandoffSummary?.canonical_presale_id);
  const hasHandoffTicket =
    handoffLookupStatus === 'ticket_found' ||
    (Number.isInteger(handoffCanonicalPresaleId) && handoffCanonicalPresaleId > 0);

  if (hasHandoffTicket) {
    return freezeSortedValue({
      headline: 'Билет найден',
      body: handoffBuyerTicketCode
        ? `Номер билета: № ${handoffBuyerTicketCode}.`
        : 'Билет уже привязан.',
      status_line: 'Нажмите «Открыть приложение».',
      content_source: 'start_handoff_ticket_content',
    });
  }

  if (startMode === 'new_guest') {
    return freezeSortedValue({
      headline: 'Добро пожаловать',
      body:
        'Введите номер билета сообщением в этот чат. Например: А12. Если номера под рукой нет, нажмите «Открыть приложение».',
      status_line: DEFAULT_OPEN_APP_STATUS_LINE,
      content_source: 'start_mode_content',
    });
  }

  return buildStartTextFields(startMode, operationStatus);
}

function buildTicketCodeLookupTextFields(lookupSummary = {}) {
  const lookupStatus = normalizeString(lookupSummary?.lookup_status);
  const buyerTicketCode = normalizeString(lookupSummary?.buyer_ticket_code);
  if (lookupStatus === 'ticket_found') {
    return freezeSortedValue({
      headline: 'Билет найден',
      body: buyerTicketCode
        ? `Номер билета: № ${buyerTicketCode}.`
        : 'Билет найден.',
      status_line: 'Нажмите «Открыть приложение».',
      content_source: 'ticket_lookup_content',
    });
  }

  return freezeSortedValue({
    headline: 'Не удалось найти билет',
    body: 'Проверьте номер и отправьте его ещё раз.',
    status_line: DEFAULT_OPEN_APP_STATUS_LINE,
    content_source: 'default_fallback_content',
  });
}

function buildGuestActionTextFields(mappedActionType, actionResult = {}) {
  const actionStatus = normalizeActionStatus(actionResult.action_status);
  const resolvedData = actionResult.resolved_data_summary || null;

  if (actionStatus === 'action_not_available') {
    return freezeSortedValue({
      headline: 'Действие временно недоступно',
      body: 'Сейчас это действие недоступно в чате. Продолжите в приложении.',
      status_line: DEFAULT_OPEN_APP_STATUS_LINE,
      content_source: 'default_fallback_content',
    });
  }

  if (actionStatus === 'action_rejected_invalid_input') {
    return freezeSortedValue({
      headline: 'Не удалось обработать запрос',
      body: 'Попробуйте ещё раз или откройте приложение.',
      status_line: DEFAULT_OPEN_APP_STATUS_LINE,
      content_source: 'default_fallback_content',
    });
  }

  if (mappedActionType === 'open_ticket' || mappedActionType === 'open_my_tickets') {
    const ticketRequestTextSummary = buildTicketAndRequestTextSummary(resolvedData);
    return freezeSortedValue({
      headline: 'Мой билет / заявки',
      body: ticketRequestTextSummary.body,
      status_line: DEFAULT_OPEN_APP_STATUS_LINE,
      content_source: ticketRequestTextSummary.content_source,
    });
  }

  if (mappedActionType === 'open_trips') {
    return freezeSortedValue({
      headline: 'Откройте приложение',
      body: 'Выбор рейса и оформление билета доступны в приложении.',
      content_source: 'resolved_action_content',
      status_line: DEFAULT_OPEN_APP_STATUS_LINE,
    });
  }

  if (
    mappedActionType === 'open_useful_content' ||
    mappedActionType === 'open_faq' ||
    mappedActionType === 'open_contact'
  ) {
    return freezeSortedValue({
      headline: 'Откройте приложение',
      body:
        'Полезные материалы, ответы на вопросы и контактная информация доступны в приложении.',
      status_line: DEFAULT_OPEN_APP_STATUS_LINE,
      content_source: 'resolved_action_content',
    });
  }

  if (mappedActionType === 'cancel_before_prepayment') {
    return freezeSortedValue({
      headline:
        actionStatus === 'action_completed'
          ? 'Заявка отменена'
          : 'Отмена недоступна',
      body:
        actionStatus === 'action_completed'
          ? 'Отмена заявки до предоплаты сохранена.'
          : 'Эту заявку сейчас нельзя отменить в боте.',
      status_line: DEFAULT_OPEN_APP_STATUS_LINE,
      content_source:
        actionStatus === 'action_completed'
          ? 'resolved_action_content'
          : 'default_fallback_content',
    });
  }

  return freezeSortedValue({
    headline: 'Готово',
    body: 'Запрос обработан.',
    status_line: DEFAULT_OPEN_APP_STATUS_LINE,
    content_source: 'default_fallback_content',
  });
}

function pickBookingReferenceFromStart(runtimeResult = {}) {
  const inboundResult = runtimeResult.operation_result_summary || {};
  return (
    runtimeResult.related_booking_request_reference ||
    inboundResult?.bot_start_state_summary?.active_booking_request_summary
      ?.booking_request_reference ||
    null
  );
}

function buildStartActionButtons(runtimeResult = {}, miniAppLaunchSummary = null) {
  const bookingRequestReference = pickBookingReferenceFromStart(runtimeResult);
  return buildPrimaryMiniAppButton({
    miniAppLaunchSummary,
    bookingRequestReference,
  });
}

function buildGuestActionButtons(
  _mappedActionType,
  _actionResult = {},
  relatedBookingReference = null,
  miniAppLaunchSummary = null
) {
  return buildPrimaryMiniAppButton({
    miniAppLaunchSummary,
    bookingRequestReference: relatedBookingReference,
  });
}

function pickDeliveryOutcome(rawResult) {
  return normalizeString(
    rawResult?.outcome ??
      rawResult?.delivery_outcome ??
      rawResult?.deliveryOutcome ??
      rawResult?.status ??
      null
  );
}

function mapDeliveryHandoffStatus(outcome) {
  if (outcome === TELEGRAM_NOTIFICATION_DELIVERY_EXECUTION_STATUSES.sent) {
    return 'sent';
  }
  if (outcome === TELEGRAM_NOTIFICATION_DELIVERY_EXECUTION_STATUSES.blocked) {
    return 'blocked';
  }
  if (outcome === TELEGRAM_NOTIFICATION_DELIVERY_EXECUTION_STATUSES.failed) {
    return 'failed';
  }
  return 'failed';
}

export class TelegramWebhookOutboundResponseOrchestrationService {
  constructor({
    notificationDeliveryExecutorService = null,
    executeTelegramNotificationDelivery = null,
    now = () => new Date(),
  } = {}) {
    this.notificationDeliveryExecutorService = notificationDeliveryExecutorService;
    this.executeTelegramNotificationDelivery = executeTelegramNotificationDelivery;
    this.now = now;
  }

  describe() {
    return Object.freeze({
      serviceName: SERVICE_NAME,
      status: 'telegram_webhook_outbound_response_orchestration_ready',
      dependencyKeys: [
        'notificationDeliveryExecutorService',
        'executeTelegramNotificationDelivery',
      ],
    });
  }

  nowIso() {
    const date = this.now();
    const iso = date instanceof Date ? date.toISOString() : new Date(date).toISOString();
    if (Number.isNaN(Date.parse(iso))) {
      throw new Error('[TELEGRAM_WEBHOOK_OUTBOUND_RESPONSE] invalid clock timestamp');
    }
    return iso;
  }

  resolveDeliveryExecutor() {
    if (typeof this.executeTelegramNotificationDelivery === 'function') {
      return this.executeTelegramNotificationDelivery;
    }

    const deliveryAdapter = this.notificationDeliveryExecutorService?.deliveryAdapter;
    if (typeof deliveryAdapter === 'function') {
      return deliveryAdapter;
    }
    if (typeof deliveryAdapter?.executeTelegramNotificationDelivery === 'function') {
      return deliveryAdapter.executeTelegramNotificationDelivery.bind(deliveryAdapter);
    }
    if (typeof deliveryAdapter?.deliverNotification === 'function') {
      return deliveryAdapter.deliverNotification.bind(deliveryAdapter);
    }
    if (typeof deliveryAdapter?.execute === 'function') {
      return deliveryAdapter.execute.bind(deliveryAdapter);
    }

    return null;
  }

  buildDeliveryAdapterInput({
    adapterType,
    targetSummary,
    buttonPayloads,
    textFields,
    miniAppLaunchSummary = null,
    mappedActionType = null,
    operationType = null,
    operationStatus = null,
  }) {
    const dedupeKey = [
      'telegram_webhook_outbound_response',
      `update=${targetSummary.telegram_update_id ?? 'unknown'}`,
      `adapter=${adapterType || 'unknown'}`,
      `action=${mappedActionType || 'none'}`,
      `operation=${operationType || 'none'}`,
      `status=${operationStatus || 'unknown'}`,
      `target=${targetSummary.telegram_chat_id || targetSummary.telegram_user_id || 'unknown'}`,
    ].join('|');
    const replyMarkup =
      buttonPayloads.length > 0 ? buildInlineKeyboard(buttonPayloads) : null;
    const menuButtonLaunchUrl = resolveMiniAppLaunchUrl(miniAppLaunchSummary);
    const telegramMenuButton = menuButtonLaunchUrl
      ? {
          type: 'web_app',
          text: BUTTON_ACTION_LABELS[MINI_APP_LAUNCH_ACTION_TYPE],
          web_app: {
            url: menuButtonLaunchUrl,
          },
        }
      : null;

    return freezeSortedValue({
      adapter_contract_version: TELEGRAM_NOTIFICATION_DELIVERY_ADAPTER_CONTRACT_VERSION,
      delivery_channel: TELEGRAM_NOTIFICATION_DELIVERY_CHANNEL,
      notification_type: FALLBACK_NOTIFICATION_TYPE,
      delivery_target_summary: {
        target_type: 'telegram_guest',
        telegram_user_id: targetSummary.telegram_user_id,
        telegram_chat_id: targetSummary.telegram_chat_id,
        display_name: targetSummary.display_name,
        username: targetSummary.username,
        language_code: targetSummary.language_code,
      },
      dedupe_key: dedupeKey,
      idempotency_key: dedupeKey,
      no_op_guards: {
        telegram_api_called_by_executor: false,
        telegram_message_sent_by_executor: false,
        notification_log_row_created: false,
        bot_handlers_invoked: false,
        mini_app_ui_invoked: false,
        seller_owner_admin_ui_invoked: false,
        production_routes_invoked: false,
        money_ledger_written: false,
      },
      queue_item_reference: {
        reference_type: 'telegram_webhook_outbound_response',
        telegram_update_id: targetSummary.telegram_update_id,
        adapter_type: adapterType || null,
        mapped_action_type: mappedActionType,
        operation_type: operationType,
      },
      requested_by: SERVICE_NAME,
      text_payload: {
        fields: {
          headline: textFields.headline,
          body: textFields.body,
          status_line: textFields.status_line,
        },
      },
      telegram_reply_markup: replyMarkup,
      telegram_menu_button: telegramMenuButton,
      resolved_payload_summary_reference: {
        reference_type: 'telegram_webhook_outbound_response',
        resolution_version: TELEGRAM_WEBHOOK_OUTBOUND_RESPONSE_RESULT_VERSION,
        message_mode: 'telegram_webhook_runtime_response',
        message_type: FALLBACK_NOTIFICATION_TYPE,
        content_key: 'telegram.webhook.outbound_response',
        field_keys: ['body', 'headline', 'status_line'],
        action_button_ids: buttonPayloads.map((button) => button.action_type),
        resolved_text_fields: {
          headline: textFields.headline,
          body: textFields.body,
          status_line: textFields.status_line,
        },
      },
    });
  }

  executeDeliveryHandoff(deliveryInput) {
    const deliveryExecutor = this.resolveDeliveryExecutor();
    if (!deliveryExecutor) {
      return freezeSortedValue({
        handoff_status: 'handoff_not_configured',
        adapter_outcome: null,
        blocked_reason: null,
        failed_reason: 'delivery_adapter_not_configured',
        provider_result_reference: null,
      });
    }

    try {
      const rawResult = deliveryExecutor(deliveryInput);
      if (rawResult && typeof rawResult.then === 'function') {
        throw new Error('delivery adapter returned async result');
      }
      const adapterOutcome = pickDeliveryOutcome(rawResult);
      const handoffStatus = mapDeliveryHandoffStatus(adapterOutcome);
      return freezeSortedValue({
        handoff_status: handoffStatus,
        adapter_outcome: adapterOutcome,
        blocked_reason:
          normalizeString(rawResult?.blocked_reason ?? rawResult?.blockedReason) || null,
        failed_reason:
          normalizeString(rawResult?.failed_reason ?? rawResult?.failedReason) || null,
        provider_result_reference: rawResult?.provider_result_reference || null,
      });
    } catch (error) {
      return freezeSortedValue({
        handoff_status: 'failed',
        adapter_outcome: TELEGRAM_NOTIFICATION_DELIVERY_EXECUTION_STATUSES.failed,
        blocked_reason: null,
        failed_reason:
          normalizeString(error?.message) || 'delivery_adapter_execution_failed',
        provider_result_reference: null,
      });
    }
  }

  buildStartResponseMapping(adapterResult, miniAppLaunchSummary = null) {
    const runtimeResult = adapterResult.operation_result_summary || {};
    const inboundResult = runtimeResult.operation_result_summary || {};
    const startState = inboundResult.bot_start_state_summary || {};
    const textFields = buildStartTextFieldsWithHandoff(
      normalizeString(startState.start_mode),
      normalizeString(adapterResult.operation_status),
      runtimeResult.start_handoff_summary || null
    );
    const buttonPayloads = buildStartActionButtons(runtimeResult, miniAppLaunchSummary);

    return freezeSortedValue({
      outbound_mapping_status: 'mapped_start_response',
      mapped_action_type: null,
      text_fields: textFields,
      button_payloads: buttonPayloads,
    });
  }

  buildTicketCodeLookupResponseMapping(adapterResult, miniAppLaunchSummary = null) {
    const lookupSummary = adapterResult.operation_result_summary || {};
    const textFields = buildTicketCodeLookupTextFields(lookupSummary);
    const buttonPayloads = buildPrimaryMiniAppButton({
      miniAppLaunchSummary,
      bookingRequestReference: null,
    });

    return freezeSortedValue({
      outbound_mapping_status: 'mapped_ticket_code_lookup_response',
      mapped_action_type: null,
      text_fields: textFields,
      button_payloads: buttonPayloads,
    });
  }

  buildGuestActionResponseMapping(adapterResult, miniAppLaunchSummary = null) {
    const actionResult = adapterResult.operation_result_summary || {};
    const mappedActionType = normalizeString(adapterResult.mapped_action_type);
    const relatedBookingReference =
      adapterResult.related_booking_request_reference ||
      actionResult.related_booking_request_reference ||
      null;
    const textFields = buildGuestActionTextFields(mappedActionType, actionResult);
    const buttonPayloads = buildGuestActionButtons(
      mappedActionType,
      actionResult,
      relatedBookingReference,
      miniAppLaunchSummary
    );

    return freezeSortedValue({
      outbound_mapping_status:
        textFields.content_source === 'default_fallback_content'
          ? 'mapped_guest_action_response_with_fallback'
          : 'mapped_guest_action_response',
      mapped_action_type: mappedActionType,
      text_fields: textFields,
      button_payloads: buttonPayloads,
    });
  }

  buildSkippedResult({
    adapterType = null,
    adapterResult = null,
    targetSummary = null,
    reason = 'skipped',
    nowIso,
  }) {
    return freezeSortedValue({
      response_version: TELEGRAM_WEBHOOK_OUTBOUND_RESPONSE_RESULT_VERSION,
      orchestrated_by: SERVICE_NAME,
      adapter_type: adapterType,
      outbound_mapping_status: reason,
      mapped_action_type: normalizeString(adapterResult?.mapped_action_type),
      mapped_operation_type: normalizeString(adapterResult?.operation_type),
      mapped_operation_status: normalizeString(adapterResult?.operation_status),
      response_text_fields: null,
      button_payloads: [],
      telegram_target_summary: targetSummary,
      delivery_handoff_summary: {
        handoff_status: 'skipped',
        adapter_outcome: null,
        blocked_reason: null,
        failed_reason: null,
        provider_result_reference: null,
      },
      latest_timestamp_summary: buildTelegramLatestTimestampSummary(nowIso),
    });
  }

  orchestrateOutboundResponse({
    adapter_type: adapterType = null,
    raw_update: rawUpdate = {},
    adapter_result_summary: adapterResult = null,
    mini_app_launch_summary: miniAppLaunchSummaryInput = null,
  } = {}) {
    const nowIso = this.nowIso();
    const targetSummary = extractResponseTarget(rawUpdate);
    if (!adapterResult || typeof adapterResult !== 'object') {
      return this.buildSkippedResult({
        adapterType,
        adapterResult,
        targetSummary,
        reason: 'skipped_invalid_adapter_result',
        nowIso,
      });
    }

    const mappingStatus = normalizeString(adapterResult.mapping_status);
    let responseMapping = null;
    if (mappingStatus === 'mapped_start_command') {
      responseMapping = this.buildStartResponseMapping(
        adapterResult,
        miniAppLaunchSummaryInput
      );
    } else if (
      mappingStatus === 'mapped_guest_action_command' ||
      mappingStatus === 'mapped_guest_action_callback'
    ) {
      responseMapping = this.buildGuestActionResponseMapping(
        adapterResult,
        miniAppLaunchSummaryInput
      );
    } else if (mappingStatus === 'mapped_ticket_code_message') {
      responseMapping = this.buildTicketCodeLookupResponseMapping(
        adapterResult,
        miniAppLaunchSummaryInput
      );
    } else {
      return this.buildSkippedResult({
        adapterType,
        adapterResult,
        targetSummary,
        reason: 'skipped_non_response_mapping',
        nowIso,
      });
    }
    const resolvedButtonPayloads = resolveButtonPayloadsForTarget(
      responseMapping.button_payloads,
      targetSummary
    );

    if (!targetSummary.telegram_chat_id && !targetSummary.telegram_user_id) {
      return freezeSortedValue({
        response_version: TELEGRAM_WEBHOOK_OUTBOUND_RESPONSE_RESULT_VERSION,
        orchestrated_by: SERVICE_NAME,
        adapter_type: adapterType,
        outbound_mapping_status: responseMapping.outbound_mapping_status,
        mapped_action_type: responseMapping.mapped_action_type,
        mapped_operation_type: normalizeString(adapterResult.operation_type),
        mapped_operation_status: normalizeString(adapterResult.operation_status),
        response_text_fields: responseMapping.text_fields,
        button_payloads: resolvedButtonPayloads,
        telegram_target_summary: targetSummary,
        delivery_handoff_summary: {
          handoff_status: 'failed',
          adapter_outcome: TELEGRAM_NOTIFICATION_DELIVERY_EXECUTION_STATUSES.failed,
          blocked_reason: null,
          failed_reason: 'missing_telegram_target',
          provider_result_reference: null,
        },
        latest_timestamp_summary: buildTelegramLatestTimestampSummary(nowIso),
      });
    }

    const deliveryInput = this.buildDeliveryAdapterInput({
      adapterType,
      targetSummary,
      buttonPayloads: resolvedButtonPayloads,
      textFields: responseMapping.text_fields,
      mappedActionType: responseMapping.mapped_action_type,
      operationType: normalizeString(adapterResult.operation_type),
      operationStatus: normalizeString(adapterResult.operation_status),
      miniAppLaunchSummary: miniAppLaunchSummaryInput,
    });
    const deliveryHandoffSummary = this.executeDeliveryHandoff(deliveryInput);

    return freezeSortedValue({
      response_version: TELEGRAM_WEBHOOK_OUTBOUND_RESPONSE_RESULT_VERSION,
      orchestrated_by: SERVICE_NAME,
      adapter_type: adapterType,
      outbound_mapping_status: responseMapping.outbound_mapping_status,
      mapped_action_type: responseMapping.mapped_action_type,
      mapped_operation_type: normalizeString(adapterResult.operation_type),
      mapped_operation_status: normalizeString(adapterResult.operation_status),
      response_text_fields: responseMapping.text_fields,
      button_payloads: resolvedButtonPayloads,
      telegram_target_summary: targetSummary,
      delivery_handoff_summary: deliveryHandoffSummary,
      latest_timestamp_summary: buildTelegramLatestTimestampSummary(nowIso),
    });
  }
}
