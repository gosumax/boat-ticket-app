import clsx from 'clsx';
import QRCode from 'qrcode';
import { useEffect, useMemo, useState } from 'react';
import {
  TELEGRAM_MINI_APP_ENTRYPOINT_KEYS,
  resolveTelegramMiniAppEntrypointContent,
} from '../../shared/telegram/mini-app-entrypoints.js';
import {
  fetchMiniAppCatalog,
  fetchMiniAppContactScreen,
  isMiniAppApiDiagnosticsEnabled,
  fetchMiniAppMyRequests,
  fetchMiniAppMyTickets,
  fetchMiniAppOfflineTicketSnapshot,
  fetchMiniAppEntrypointContent,
  fetchMiniAppFaqScreen,
  readMiniAppApiDiagnosticsSnapshot,
  subscribeMiniAppApiDiagnostics,
  fetchMiniAppUsefulContentScreen,
  fetchMiniAppTicketViewWithOfflineFallback,
  fetchMiniAppTripCard,
  submitMiniAppBookingRequest,
} from './mini-app-api.js';
import {
  buildMiniAppContactViewModel,
  buildMiniAppFaqViewModel,
} from './faq-contact-view-model.js';
import { buildMiniAppHoldResultViewModel } from './hold-result-view-model.js';
import { buildMiniAppTicketDetailViewModel } from './ticket-access-view-model.js';
import {
  formatMiniAppSeatCountLabel,
  resolveMiniAppBuyerTicketPresentation,
} from './ticket-state-presentation.js';
import { buildMiniAppUsefulContentViewModel } from './useful-content-view-model.js';
import {
  normalizeString,
  readTelegramMiniAppInitDataRaw,
  readTelegramMiniAppUserId,
} from './mini-app-identity.js';
import { copyMiniAppTextToClipboard } from './mini-app-clipboard.js';
import {
  completeMiniAppBootstrap,
  markMiniAppBootstrapCheckpointOnce,
} from './mini-app-bootstrap-diagnostics.js';
import './mini-app.css';

const ENTRYPOINT_LABELS = Object.freeze({
  catalog: 'Каталог',
  my_tickets: 'Мои заявки',
  useful_content: 'Полезное',
  faq: 'Вопросы',
  contact: 'Связь',
});
const STATE_LABELS = Object.freeze({
  active: 'Активно',
  available: 'Доступно',
  banana: 'Банан',
  bookable: 'Можно бронировать',
  booking_request_context: 'Контекст заявки',
  booking_request_selected: 'Заявка выбрана',
  completed: 'Завершено',
  completed_or_idle: 'Завершено',
  confirmed: 'Подтверждено',
  confirmed_with_ticket: 'Подтверждено с билетом',
  contact_in_progress: 'Связь в процессе',
  cruise: 'Прогулка',
  faq_general: 'Общие вопросы',
  faq_trip_rules: 'Правила поездки',
  guest_profile_context: 'Контекст гостя',
  hold_active: 'Холд активен',
  hold_expired: 'Холд истёк',
  linked_ticket_cancelled_or_unavailable: 'Билет недоступен',
  linked_ticket_completed: 'Поездка завершена',
  linked_ticket_ready: 'Билет готов',
  low_availability: 'Мало мест',
  new: 'Новая',
  no_ticket_yet: 'Билета пока нет',
  not_applicable: 'Не применяется',
  not_available_yet: 'Пока недоступно',
  partial: 'Частично',
  payment_confirmed: 'Предоплата подтверждена',
  readable: 'Доступно',
  request_created: 'Заявка создана',
  request_received: 'Заявка получена',
  speed: 'Скоростной',
  ticket_ready: 'Билет готов',
  trip_context_unavailable: 'Контекст поездки недоступен',
  trip_help: 'Помощь по поездке',
  unavailable: 'Недоступно',
  unknown: 'Неизвестно',
  upcoming_trip_selected: 'Ближайшая поездка',
  useful_places: 'Полезные места',
  waiting_for_prepayment: 'Ожидает предоплату',
  what_to_take: 'Что взять с собой',
});
const MINI_APP_HTML_ID_META_NAME = 'telegram-mini-app-html-id';
const MINI_APP_BUILD_MARKER_META_NAME = 'telegram-mini-app-build-marker';
const MINI_APP_ENTRY_URL_META_NAME = 'telegram-mini-app-entry-url';
const RUSSIAN_BUYER_DATE_FORMATTER = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  month: 'long',
  timeZone: 'UTC',
});

function readQueryParam(name) {
  if (typeof window === 'undefined') {
    return null;
  }
  return normalizeString(new URLSearchParams(window.location.search).get(name));
}

function readMetaContent(name) {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return null;
  }
  const normalizedName = normalizeString(name);
  if (!normalizedName) {
    return null;
  }

  try {
    const meta = document.querySelector(`meta[name="${normalizedName}"]`);
    return normalizeString(meta?.getAttribute('content'));
  } catch {
    return null;
  }
}

function readStylesheetAssetUrls() {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return [];
  }

  let linkElements = [];
  try {
    linkElements = Array.from(document.querySelectorAll('link[rel="stylesheet"]'));
  } catch {
    return [];
  }

  const assetUrls = [];
  for (const linkElement of linkElements) {
    const href = normalizeString(linkElement?.getAttribute('href'));
    if (!href) {
      continue;
    }
    if (
      href.includes('/assets/') ||
      href.includes('/telegram/assets/') ||
      href.includes('/telegram/mini-app/assets/')
    ) {
      assetUrls.push(href);
    }
  }

  if (assetUrls.length > 0) {
    return assetUrls;
  }

  const fallbackHref = normalizeString(linkElements[0]?.getAttribute('href'));
  return fallbackHref ? [fallbackHref] : [];
}

function readRuntimeEntryUrl() {
  const metaEntryUrl = readMetaContent(MINI_APP_ENTRY_URL_META_NAME);
  if (metaEntryUrl) {
    return metaEntryUrl;
  }
  if (typeof window === 'undefined') {
    return null;
  }
  return normalizeString(window.__TELEGRAM_MINI_APP_BOOTSTRAP__?.entryScriptUrl);
}

function readMiniAppRuntimeDiagnosticsSnapshot() {
  const bootstrapRuntime =
    typeof window === 'undefined'
      ? null
      : window.__TELEGRAM_MINI_APP_BOOTSTRAP__ || null;
  const currentUrl =
    typeof window === 'undefined'
      ? null
      : normalizeString(window.location?.href);
  return Object.freeze({
    htmlIdentity: readMetaContent(MINI_APP_HTML_ID_META_NAME),
    buildMarker: readMetaContent(MINI_APP_BUILD_MARKER_META_NAME),
    entryUrl: readRuntimeEntryUrl(),
    stylesheetUrls: readStylesheetAssetUrls(),
    entryImportResult: normalizeString(bootstrapRuntime?.entryImportResult),
    failureCategory: normalizeString(bootstrapRuntime?.failureCategory),
    currentUrl,
    cacheBuster: readQueryParam('mini_app_v'),
  });
}


function padCatalogDateSegment(value) {
  return String(value).padStart(2, '0');
}

export function formatCatalogDateValue(date) {
  const candidateDate =
    date instanceof Date ? new Date(date.getTime()) : new Date(date);
  if (Number.isNaN(candidateDate.getTime())) {
    return '';
  }
  return [
    candidateDate.getFullYear(),
    padCatalogDateSegment(candidateDate.getMonth() + 1),
    padCatalogDateSegment(candidateDate.getDate()),
  ].join('-');
}

function shiftCatalogDate(baseDate, offsetDays) {
  const nextDate = new Date(baseDate.getTime());
  nextDate.setDate(nextDate.getDate() + offsetDays);
  return nextDate;
}

export function createCatalogDatePresets(referenceDate = new Date()) {
  const normalizedReferenceDate =
    referenceDate instanceof Date ? new Date(referenceDate.getTime()) : new Date(referenceDate);
  const baseDate = Number.isNaN(normalizedReferenceDate.getTime())
    ? new Date()
    : normalizedReferenceDate;

  return [
    {
      key: 'today',
      label: 'Сегодня',
      value: formatCatalogDateValue(baseDate),
    },
    {
      key: 'tomorrow',
      label: 'Завтра',
      value: formatCatalogDateValue(shiftCatalogDate(baseDate, 1)),
    },
    {
      key: 'day-after-tomorrow',
      label: 'Послезавтра',
      value: formatCatalogDateValue(shiftCatalogDate(baseDate, 2)),
    },
  ];
}

export function resolveDefaultCatalogDate(referenceDate = new Date()) {
  return createCatalogDatePresets(referenceDate)[0]?.value || '';
}

function normalizeCatalogDateValue(value) {
  const normalizedValue = normalizeString(value);
  if (normalizedValue && /^\d{4}-\d{2}-\d{2}$/.test(normalizedValue)) {
    return normalizedValue;
  }
  return resolveDefaultCatalogDate();
}

function readInitialCatalogDate() {
  return normalizeCatalogDateValue(readQueryParam('date'));
}

export const BUYER_CATALOG_TYPE_SELECTION_OPTIONS = Object.freeze([
  {
    key: 'speed',
    title: 'Скоростной катер',
    description: 'Быстрый выезд по воде, когда хочется скорее отправиться в путь.',
    actionLabel: 'Смотреть рейсы',
  },
  {
    key: 'cruise',
    title: 'Прогулка',
    description: 'Спокойная поездка для отдыха, видов и приятной прогулки по воде.',
    actionLabel: 'Смотреть рейсы',
  },
  {
    key: 'banana',
    title: 'Банан',
    description: 'Активная водная прогулка для тех, кто хочет эмоций и движения.',
    actionLabel: 'Смотреть рейсы',
  },
]);

export const BUYER_TRIP_CARD_AGE_HINT =
  'Ребёнок: до 5 лет включительно. Подросток: старше 5 и до 14 лет. Взрослый: 14+.';

const BUYER_TICKET_TYPE_OPTIONS = Object.freeze([
  Object.freeze({
    key: 'adult',
    label: 'Взрослый',
    summaryForms: ['взрослый', 'взрослых', 'взрослых'],
    priceKey: 'adult_price',
  }),
  Object.freeze({
    key: 'teen',
    label: 'Подросток',
    summaryForms: ['подросток', 'подростка', 'подростков'],
    priceKey: 'teen_price',
  }),
  Object.freeze({
    key: 'child',
    label: 'Детский',
    summaryForms: ['ребёнок', 'ребёнка', 'детей'],
    priceKey: 'child_price',
  }),
]);

const EMPTY_BUYER_TICKET_COUNTS = Object.freeze({
  adult: 0,
  teen: 0,
  child: 0,
});
const BUYER_CONTACT_PHONE_MAX_DIGITS = 11;

const BUYER_VISIBLE_CATALOG_AVAILABILITY_STATES = new Set([
  'bookable',
  'low_availability',
]);

function resolveBuyerCatalogTripTypeFilter(value) {
  const normalizedValue = normalizeString(value);
  if (normalizedValue === 'all') {
    return normalizedValue;
  }
  if (
    BUYER_CATALOG_TYPE_SELECTION_OPTIONS.some(
      (selectionOption) => selectionOption.key === normalizedValue
    )
  ) {
    return normalizedValue;
  }
  return 'all';
}

function resolveBuyerCatalogTripTypeSelection(value) {
  const normalizedValue = normalizeString(value);
  return BUYER_CATALOG_TYPE_SELECTION_OPTIONS.some(
    (selectionOption) => selectionOption.key === normalizedValue
  )
    ? normalizedValue
    : null;
}

export function isBuyerVisibleCatalogItem(item) {
  return BUYER_VISIBLE_CATALOG_AVAILABILITY_STATES.has(
    normalizeString(item?.booking_availability_state)
  );
}

export function filterBuyerCatalogItems(items, selectedTripType = 'all') {
  const resolvedTripType = resolveBuyerCatalogTripTypeFilter(selectedTripType);
  if (!Array.isArray(items) || items.length === 0) {
    return [];
  }

  return items.filter((item) => {
    if (!isBuyerVisibleCatalogItem(item)) {
      return false;
    }
    if (resolvedTripType === 'all') {
      return true;
    }
    return normalizeString(item?.trip_type_summary?.trip_type) === resolvedTripType;
  });
}

export function buildBuyerTripPriceRows(priceSummary) {
  const currency = priceSummary?.currency || 'RUB';

  return [
    {
      key: 'adult',
      label: 'Взрослый',
      value: formatMoney(priceSummary?.adult_price, currency),
    },
    {
      key: 'teen',
      label: 'Подросток',
      value: formatMoney(priceSummary?.teen_price, currency),
    },
    {
      key: 'child',
      label: 'Ребёнок',
      value: formatMoney(priceSummary?.child_price, currency),
    },
  ];
}

function normalizeNonNegativeInteger(value) {
  const normalizedValue = Number(value);
  if (!Number.isFinite(normalizedValue) || normalizedValue < 0) {
    return 0;
  }
  return Math.trunc(normalizedValue);
}

function formatRussianCount(value, forms) {
  const normalizedValue = Math.abs(Math.trunc(Number(value) || 0));
  const mod100 = normalizedValue % 100;
  const mod10 = normalizedValue % 10;

  if (mod100 >= 11 && mod100 <= 14) {
    return forms[2];
  }
  if (mod10 === 1) {
    return forms[0];
  }
  if (mod10 >= 2 && mod10 <= 4) {
    return forms[1];
  }
  return forms[2];
}

function normalizeBuyerTicketCounts(ticketCounts = EMPTY_BUYER_TICKET_COUNTS) {
  return BUYER_TICKET_TYPE_OPTIONS.reduce((accumulator, ticketType) => {
    accumulator[ticketType.key] = normalizeNonNegativeInteger(
      ticketCounts?.[ticketType.key]
    );
    return accumulator;
  }, {});
}

function sumBuyerTicketCounts(ticketCounts = EMPTY_BUYER_TICKET_COUNTS) {
  const normalizedCounts = normalizeBuyerTicketCounts(ticketCounts);
  return BUYER_TICKET_TYPE_OPTIONS.reduce(
    (sum, ticketType) => sum + normalizedCounts[ticketType.key],
    0
  );
}

function resolveBuyerTicketUnitPrice(priceSummary, priceKey) {
  const value = Number(priceSummary?.[priceKey]);
  return Number.isFinite(value) ? value : 0;
}

function isBuyerTicketTypeEnabled(tripCard, ticketTypeKey) {
  if (ticketTypeKey !== 'teen') {
    return true;
  }
  const tripType = normalizeString(tripCard?.trip_type_summary?.trip_type);
  return tripType !== 'banana';
}

export function buildBuyerRequestedTicketMix(ticketCounts) {
  const normalizedCounts = normalizeBuyerTicketCounts(ticketCounts);
  return BUYER_TICKET_TYPE_OPTIONS.reduce((accumulator, ticketType) => {
    const count = normalizedCounts[ticketType.key];
    if (count > 0) {
      accumulator[ticketType.key] = count;
    }
    return accumulator;
  }, {});
}

export function buildBuyerTicketSelectionSummary(ticketCounts, priceSummary) {
  const normalizedCounts = normalizeBuyerTicketCounts(ticketCounts);
  const mixSummaryParts = [];
  let totalPrice = 0;

  BUYER_TICKET_TYPE_OPTIONS.forEach((ticketType) => {
    const count = normalizedCounts[ticketType.key];
    if (count <= 0) {
      return;
    }
    const unitPrice = resolveBuyerTicketUnitPrice(priceSummary, ticketType.priceKey);
    totalPrice += count * unitPrice;
    mixSummaryParts.push(
      `${count} ${formatRussianCount(count, ticketType.summaryForms)}`
    );
  });

  const totalSeats = sumBuyerTicketCounts(normalizedCounts);

  return Object.freeze({
    ticketCounts: Object.freeze(normalizedCounts),
    requestedTicketMix: Object.freeze(buildBuyerRequestedTicketMix(normalizedCounts)),
    totalSeats,
    totalPrice,
    mixLabel:
      mixSummaryParts.length > 0 ? mixSummaryParts.join(', ') : 'Выберите билеты',
  });
}

export function validateBuyerCustomerName(value) {
  const normalizedName = normalizeString(value);
  if (!normalizedName) {
    return Object.freeze({
      isValid: false,
      normalizedName: null,
      message: 'Укажите имя от 2 символов.',
    });
  }

  if (Array.from(normalizedName).length < 2) {
    return Object.freeze({
      isValid: false,
      normalizedName,
      message: 'РРјСЏ должно содержать минимум 2 символа.',
    });
  }

  return Object.freeze({
    isValid: true,
    normalizedName,
    message: null,
  });
}

export function sanitizeBuyerContactPhoneInput(value) {
  const rawValue = String(value ?? '').trim();
  const hasLeadingPlus = rawValue.startsWith('+');
  const digits = rawValue
    .replace(/\D/g, '')
    .slice(0, BUYER_CONTACT_PHONE_MAX_DIGITS);

  if (hasLeadingPlus) {
    return digits ? `+${digits}` : '+';
  }

  return digits;
}

export function validateBuyerContactPhone(value) {
  const sanitizedValue = sanitizeBuyerContactPhoneInput(value);
  const digits = sanitizedValue.replace(/\D/g, '');
  const startsWithSupportedPrefix =
    sanitizedValue.startsWith('+7') || sanitizedValue.startsWith('8');

  if (!sanitizedValue) {
    return Object.freeze({
      isValid: false,
      normalizedPhoneE164: null,
      sanitizedValue,
      message: 'Укажите телефон в формате +7XXXXXXXXXX или 8XXXXXXXXXX.',
    });
  }

  if (!startsWithSupportedPrefix) {
    return Object.freeze({
      isValid: false,
      normalizedPhoneE164: null,
      sanitizedValue,
      message: 'Телефон должен начинаться с +7 или 8.',
    });
  }

  if (digits.length !== BUYER_CONTACT_PHONE_MAX_DIGITS) {
    return Object.freeze({
      isValid: false,
      normalizedPhoneE164: null,
      sanitizedValue,
      message: 'Телефон должен содержать 11 цифр.',
    });
  }

  const normalizedPhoneE164 = sanitizedValue.startsWith('+7')
    ? `+${digits}`
    : `+7${digits.slice(1)}`;

  if (!/^\+7\d{10}$/.test(normalizedPhoneE164)) {
    return Object.freeze({
      isValid: false,
      normalizedPhoneE164: null,
      sanitizedValue,
      message: 'Телефон должен быть в формате +7XXXXXXXXXX или 8XXXXXXXXXX.',
    });
  }

  return Object.freeze({
    isValid: true,
    normalizedPhoneE164,
    sanitizedValue,
    message: null,
  });
}

function resolveBuyerAvailableSeats(tripCard) {
  const availableSeats = Number(tripCard?.seats_availability_summary?.seats_left);
  return Number.isFinite(availableSeats) ? Math.max(0, Math.trunc(availableSeats)) : null;
}

function resolveBuyerCapacityTotal(tripCard) {
  const capacityTotal = Number(tripCard?.seats_availability_summary?.capacity_total);
  return Number.isFinite(capacityTotal) ? Math.max(0, Math.trunc(capacityTotal)) : null;
}

function formatBuyerTicketUnitPrice(tripCard, ticketType) {
  if (!isBuyerTicketTypeEnabled(tripCard, ticketType.key)) {
    return 'Недоступно';
  }
  return formatMoney(
    tripCard?.price_summary?.[ticketType.priceKey],
    tripCard?.price_summary?.currency
  );
}

function formatBuyerSeatAvailabilitySummary(tripCard) {
  const seatsLeft = resolveBuyerAvailableSeats(tripCard);
  const capacityTotal = resolveBuyerCapacityTotal(tripCard);
  if (seatsLeft === null && capacityTotal === null) {
    return 'Мест нет в данных рейса';
  }
  if (seatsLeft !== null && capacityTotal !== null) {
    return `Свободно: ${seatsLeft} из ${capacityTotal}`;
  }
  if (seatsLeft !== null) {
    return `Свободно: ${seatsLeft}`;
  }
  return `Вместимость: ${capacityTotal}`;
}

function createIdempotencyKey() {
  return `telegram-mini-app-${Date.now()}`;
}

function mapToneClass(tone) {
  if (tone === 'success') {
    return 'tg-mini-app__result--success';
  }
  if (tone === 'warning') {
    return 'tg-mini-app__result--warning';
  }
  return 'tg-mini-app__result--neutral';
}

function formatMoney(value, currency = 'RUB') {
  const amount = Number(value);
  if (!Number.isFinite(amount)) {
    return 'н/д';
  }
  return `${amount} ${currency}`;
}

function formatTripCountLabel(value) {
  const count = Number(value);
  if (!Number.isFinite(count) || count <= 0) {
    return '0 рейсов';
  }

  const normalizedCount = Math.trunc(count);
  const mod100 = normalizedCount % 100;
  const mod10 = normalizedCount % 10;
  if (mod100 >= 11 && mod100 <= 14) {
    return `${normalizedCount} рейсов`;
  }
  if (mod10 === 1) {
    return `${normalizedCount} рейс`;
  }
  if (mod10 >= 2 && mod10 <= 4) {
    return `${normalizedCount} рейса`;
  }
  return `${normalizedCount} рейсов`;
}

function formatDiagnosticValue(value) {
  return normalizeString(value) || 'н/д';
}

function formatDiagnosticList(values) {
  if (!Array.isArray(values) || values.length === 0) {
    return 'н/д';
  }
  return values
    .map((value) => normalizeString(value))
    .filter(Boolean)
    .join(', ') || 'н/д';
}

function formatDiagnosticFlag(value) {
  if (value === true) {
    return 'yes';
  }
  if (value === false) {
    return 'no';
  }
  return 'н/д';
}

function formatStateLabel(value) {
  const normalized = normalizeString(value);
  if (!normalized) {
    return 'н/д';
  }
  if (STATE_LABELS[normalized]) {
    return STATE_LABELS[normalized];
  }
  return normalized
    .split('_')
    .filter(Boolean)
    .join(' ');
}

function resolveStateTone(value) {
  const normalized = normalizeString(value);
  if (!normalized) {
    return 'neutral';
  }

  if (
    normalized === 'not_available_yet' ||
    normalized === 'no_ticket_yet' ||
    normalized === 'request_created' ||
    normalized === 'request_received'
  ) {
    return 'warning';
  }

  if (
    normalized.includes('unavailable') ||
    normalized.includes('not_available') ||
    normalized.includes('blocked') ||
    normalized.includes('expired') ||
    normalized.includes('cancelled') ||
    normalized.includes('refunded')
  ) {
    return 'danger';
  }

  if (
    normalized.includes('low') ||
    normalized.includes('pending') ||
    normalized.includes('warning') ||
    normalized.includes('hold')
  ) {
    return 'warning';
  }

  if (
    normalized.includes('bookable') ||
    normalized.includes('available') ||
    normalized.includes('active') ||
    normalized.includes('confirmed') ||
    normalized.includes('paid') ||
    normalized.includes('issued') ||
    normalized.includes('completed') ||
    normalized.includes('used')
  ) {
    return 'success';
  }

  return 'neutral';
}

export function formatBuyerFacingDateLabel(value) {
  const normalizedDate = normalizeString(value);
  if (!normalizedDate || !/^\d{4}-\d{2}-\d{2}$/.test(normalizedDate)) {
    return normalizedDate || '';
  }

  const [year, month, day] = normalizedDate.split('-').map((segment) => Number(segment));
  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day) ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31
  ) {
    return normalizedDate;
  }

  const parsedDate = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  if (Number.isNaN(parsedDate.getTime())) {
    return normalizedDate;
  }

  return RUSSIAN_BUYER_DATE_FORMATTER.format(parsedDate);
}

function formatBuyerFacingTimeLabel(value) {
  const normalizedTime = normalizeString(value);
  if (!normalizedTime) {
    return '';
  }

  const timeMatch = normalizedTime.match(/^(\d{2}:\d{2})/);
  return timeMatch ? timeMatch[1] : normalizedTime;
}

export function formatDateTimeLabel(date, time) {
  const dateLabel = formatBuyerFacingDateLabel(date);
  const timeLabel = formatBuyerFacingTimeLabel(time);

  if (dateLabel && timeLabel) {
    return `${dateLabel}, ${timeLabel}`;
  }
  if (dateLabel) {
    return dateLabel;
  }
  if (timeLabel) {
    return timeLabel;
  }
  return 'н/д';
}

function readBookingRequestId(reference) {
  const bookingRequestId = Number(reference?.booking_request_id);
  return Number.isInteger(bookingRequestId) && bookingRequestId > 0
    ? bookingRequestId
    : null;
}

function buildLifecycleItemMap(readModel) {
  const lifecycleItems = Array.isArray(readModel?.lifecycle_items)
    ? readModel.lifecycle_items
    : [];
  const lifecycleItemMap = new Map();

  lifecycleItems.forEach((item) => {
    const bookingRequestId = readBookingRequestId(item?.booking_request_reference);
    if (bookingRequestId !== null) {
      lifecycleItemMap.set(bookingRequestId, item);
    }
  });

  return lifecycleItemMap;
}

function resolveBuyerTicketCode(summary) {
  return normalizeString(summary?.buyer_ticket_code);
}

function formatBuyerTicketReferenceTopline(summary) {
  const buyerTicketCode = resolveBuyerTicketCode(summary);
  return buyerTicketCode ? `Код ${buyerTicketCode}` : 'Код появится после оформления';
}

function formatMiniAppRequestCountLabel(value) {
  const normalizedCount = Number(value);
  if (!Number.isInteger(normalizedCount) || normalizedCount <= 0) {
    return '0 заявок';
  }
  return `${normalizedCount} ${formatRussianCount(normalizedCount, [
    'заявка',
    'заявки',
    'заявок',
  ])}`;
}

const BUYER_PENDING_FLOW_STEPS = Object.freeze([
  'Свяжитесь с продавцом или дождитесь его звонка.',
  'Передайте предоплату, чтобы подтвердить бронь.',
  'Билет появится здесь после подтверждения предоплаты.',
]);
const BUYER_PENDING_FLOW_TITLE = 'Свяжитесь с продавцом и передайте предоплату';

function parseIsoMs(value) {
  const normalized = normalizeString(value);
  if (!normalized) {
    return null;
  }

  const parsed = Date.parse(normalized);
  return Number.isNaN(parsed) ? null : parsed;
}

function formatMiniAppCountdownClock(remainingMs) {
  if (!Number.isFinite(remainingMs)) {
    return null;
  }

  if (remainingMs <= 0) {
    return '00:00';
  }

  const totalSeconds = Math.floor(remainingMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(
      seconds
    ).padStart(2, '0')}`;
  }

  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function formatMiniAppHoldDeadlineLabel(isoValue) {
  const normalizedIso = normalizeString(isoValue);
  if (!normalizedIso) {
    return null;
  }

  const parsedDate = new Date(normalizedIso);
  if (Number.isNaN(parsedDate.getTime())) {
    return normalizedIso;
  }

  const dateLabel = RUSSIAN_BUYER_DATE_FORMATTER.format(parsedDate);
  const timeLabel = parsedDate.toISOString().slice(11, 16);
  return `${dateLabel}, ${timeLabel}`;
}

function buildMiniAppBuyerCountdownSummary(holdExpiresAtIso, nowMs = Date.now()) {
  const holdExpiresAtMs = parseIsoMs(holdExpiresAtIso);
  if (holdExpiresAtMs === null) {
    return Object.freeze({
      remainingMs: null,
      valueLabel: '15 минут',
      badgeLabel: 'Идёт таймер',
      detailLabel: 'У вас есть 15 минут, чтобы передать продавцу предоплату.',
      tone: 'warning',
      isExpired: false,
    });
  }

  const remainingMs = holdExpiresAtMs - Number(nowMs);
  if (!Number.isFinite(remainingMs) || remainingMs <= 0) {
    return Object.freeze({
      remainingMs: 0,
      valueLabel: '00:00',
      badgeLabel: 'Время вышло',
      detailLabel: 'Время брони истекло.',
      tone: 'danger',
      isExpired: true,
    });
  }

  const countdownLabel = formatMiniAppCountdownClock(remainingMs) || '15 минут';
  const deadlineLabel = formatMiniAppHoldDeadlineLabel(holdExpiresAtIso);

  return Object.freeze({
    remainingMs,
    valueLabel: countdownLabel,
    badgeLabel: `Осталось ${countdownLabel}`,
    detailLabel: deadlineLabel
      ? `Бронь действует до ${deadlineLabel}.`
      : 'У вас есть 15 минут, чтобы передать продавцу предоплату.',
    tone: remainingMs <= 5 * 60 * 1000 ? 'danger' : 'warning',
    isExpired: false,
  });
}

function resolveMiniAppSellerContact(summary) {
  if (!summary || typeof summary !== 'object') {
    return null;
  }

  const sellerName = normalizeString(
    summary.seller_display_name ??
      summary.sellerDisplayName ??
      summary.sellerName
  );
  const sellerPhone = normalizeString(
    summary.seller_phone_e164 ??
      summary.sellerPhoneE164 ??
      summary.sellerPhone
  );

  if (!sellerName && !sellerPhone) {
    return null;
  }

  return Object.freeze({
    sellerName,
    sellerPhone,
  });
}

function isMiniAppPendingPrepaymentFlow({
  status = null,
  availability = null,
  lifecycleState = null,
} = {}) {
  const normalizedStatus = normalizeString(status);
  const normalizedAvailability = normalizeString(availability);
  const normalizedLifecycleState = normalizeString(lifecycleState);

  if (
    normalizedLifecycleState === 'prepayment_confirmed' ||
    normalizedLifecycleState === 'hold_expired' ||
    normalizedLifecycleState === 'cancelled_before_prepayment'
  ) {
    return false;
  }

  return (
    (normalizedStatus === 'no_ticket_yet' ||
      normalizedStatus === 'request_created' ||
      normalizedStatus === 'request_received') &&
    normalizedAvailability === 'not_available_yet'
  );
}

function shouldHighlightBuyerCatalogAvailability(value) {
  return normalizeString(value) === 'low_availability';
}

function resolveActiveNavSection(activeSection) {
  if (
    activeSection === 'trip_card' ||
    activeSection === 'booking_form' ||
    activeSection === 'result'
  ) {
    return 'catalog';
  }

  if (activeSection === 'ticket_view') {
    return 'my_tickets';
  }

  return activeSection;
}

function MiniAppPill({ children, tone = 'neutral', className = '' }) {
  return (
    <span
      className={clsx(
        'tg-mini-app__pill',
        `tg-mini-app__pill--${tone}`,
        className
      )}
    >
      {children}
    </span>
  );
}

function MiniAppMetricCard({
  label,
  value,
  caption = null,
  tone = 'neutral',
  className = '',
}) {
  return (
    <div className={clsx('tg-mini-app__metric-card', `is-${tone}`, className)}>
      <div className="tg-mini-app__metric-label">{label}</div>
      <div className="tg-mini-app__metric-value">{value}</div>
      {caption ? <div className="tg-mini-app__metric-caption">{caption}</div> : null}
    </div>
  );
}

function MiniAppInfoCard({ label, value, tone = 'neutral', className = '' }) {
  return (
    <div className={clsx('tg-mini-app__info-card', `is-${tone}`, className)}>
      <div className="tg-mini-app__info-label">{label}</div>
      <div className="tg-mini-app__info-value">{value}</div>
    </div>
  );
}

function MiniAppMetaItem({
  label,
  value,
  tone = 'neutral',
  className = '',
  children = null,
}) {
  return (
    <div className={clsx('tg-mini-app__meta-item', `is-${tone}`, className)}>
      <div className="tg-mini-app__meta-label">{label}</div>
      <div className="tg-mini-app__meta-value">{value}</div>
      {children ? <div className="tg-mini-app__meta-extra">{children}</div> : null}
    </div>
  );
}

function MiniAppSellerPhoneCopyAction({
  phone,
  testId = null,
  feedbackTestId = null,
}) {
  const normalizedPhone = normalizeString(phone);
  const [copySuccessToken, setCopySuccessToken] = useState(0);
  const resolvedTestId = testId || 'telegram-mini-app-copy-seller-phone';
  const resolvedFeedbackTestId =
    feedbackTestId || 'telegram-mini-app-copy-seller-phone-feedback';

  useEffect(() => {
    if (copySuccessToken === 0) {
      return undefined;
    }

    const timeoutId = setTimeout(() => {
      setCopySuccessToken((currentToken) =>
        currentToken === copySuccessToken ? 0 : currentToken
      );
    }, 2000);

    return () => clearTimeout(timeoutId);
  }, [copySuccessToken]);

  if (!normalizedPhone) {
    return null;
  }

  const handleCopy = async () => {
    const didCopy = await copyMiniAppTextToClipboard(normalizedPhone);
    if (didCopy) {
      setCopySuccessToken((currentToken) => currentToken + 1);
    }
  };

  return (
    <>
      <button
        type="button"
        className="tg-mini-app__copy-action"
        data-testid={resolvedTestId}
        onClick={handleCopy}
      >
        Скопировать номер
      </button>
      {copySuccessToken > 0 ? (
        <span
          className="tg-mini-app__copy-feedback"
          data-testid={resolvedFeedbackTestId}
          role="status"
          aria-live="polite"
        >
          Номер скопирован
        </span>
      ) : null}
    </>
  );
}

function MiniAppSellerPhoneMetaItem({
  phone,
  className = '',
  actionTestId = null,
  feedbackTestId = null,
}) {
  const normalizedPhone = normalizeString(phone);
  if (!normalizedPhone) {
    return null;
  }

  return (
    <MiniAppMetaItem
      label="Телефон продавца"
      value={normalizedPhone}
      tone="accent"
      className={className}
    >
      <MiniAppSellerPhoneCopyAction
        phone={normalizedPhone}
        testId={actionTestId}
        feedbackTestId={feedbackTestId}
      />
    </MiniAppMetaItem>
  );
}

function MiniAppSectionHeader({
  eyebrow = null,
  title,
  description = null,
  aside = null,
  className = '',
}) {
  return (
    <div className={clsx('tg-mini-app__section-header', className)}>
      <div className="tg-mini-app__section-copy">
        {eyebrow ? <p className="tg-mini-app__section-eyebrow">{eyebrow}</p> : null}
        <h2 className="tg-mini-app__section-title">{title}</h2>
        {description ? <p className="tg-mini-app__section-description">{description}</p> : null}
      </div>
      {aside ? <div className="tg-mini-app__section-aside">{aside}</div> : null}
    </div>
  );
}

function MiniAppEmptyState({ title, description }) {
  return (
    <div className="tg-mini-app__empty-state">
      <div className="tg-mini-app__empty-title">{title}</div>
      <div className="tg-mini-app__empty-description">{description}</div>
    </div>
  );
}

function MiniAppBuyerFlowSteps({ steps = BUYER_PENDING_FLOW_STEPS, className = '' }) {
  if (!Array.isArray(steps) || steps.length === 0) {
    return null;
  }

  return (
    <ul className={clsx('tg-mini-app__buyer-flow-list', className)}>
      {steps.map((step) => (
        <li key={step}>{step}</li>
      ))}
    </ul>
  );
}

function MiniAppBoardingQrCard({
  buyerTicketCode = null,
  qrPayloadText = null,
}) {
  const normalizedBuyerTicketCode = normalizeString(buyerTicketCode);
  const normalizedQrPayloadText = normalizeString(qrPayloadText);
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [qrError, setQrError] = useState('');

  useEffect(() => {
    let disposed = false;

    if (!normalizedQrPayloadText) {
      setQrDataUrl('');
      setQrError('');
      return () => {
        disposed = true;
      };
    }

    setQrDataUrl('');
    setQrError('');

    QRCode.toDataURL(normalizedQrPayloadText, {
      type: 'image/png',
      width: 720,
      margin: 1,
      errorCorrectionLevel: 'M',
      color: {
        dark: '#07111d',
        light: '#ffffff',
      },
    })
      .then((dataUrl) => {
        if (!disposed) {
          setQrDataUrl(dataUrl);
        }
      })
      .catch((error) => {
        if (!disposed) {
          setQrDataUrl('');
          setQrError(
            normalizeString(error?.message) || 'Не удалось подготовить QR-код.'
          );
        }
      });

    return () => {
      disposed = true;
    };
  }, [normalizedQrPayloadText]);

  if (!normalizedQrPayloadText) {
    return null;
  }

  return (
    <div
      className="tg-mini-app__subpanel tg-mini-app__subpanel--boarding-qr"
      data-testid="telegram-mini-app-ticket-qr"
    >
      <div className="tg-mini-app__boarding-qr-head">
        <div>
          <p className="tg-mini-app__section-eyebrow">Посадка</p>
          <h3 className="tg-mini-app__subpanel-title">
            {normalizedBuyerTicketCode
              ? `QR для билета ${normalizedBuyerTicketCode}`
              : 'QR для посадки'}
          </h3>
          <p className="tg-mini-app__note">
            Покажите этот QR диспетчеру при посадке на рейс.
          </p>
        </div>
        {normalizedBuyerTicketCode ? (
          <MiniAppPill tone="accent">{normalizedBuyerTicketCode}</MiniAppPill>
        ) : null}
      </div>
      <div className="tg-mini-app__boarding-qr-frame">
        {qrDataUrl ? (
          <img
            className="tg-mini-app__boarding-qr-image"
            src={qrDataUrl}
            alt={
              normalizedBuyerTicketCode
                ? `QR-код для посадки по билету ${normalizedBuyerTicketCode}`
                : 'QR-код для посадки'
            }
          />
        ) : (
          <p className="tg-mini-app__hint">Подготавливаем QR-код для посадки…</p>
        )}
      </div>
      {qrError ? <p className="tg-mini-app__error">{qrError}</p> : null}
    </div>
  );
}

function MiniAppActionCard({
  title,
  description,
  actionLabel,
  onAction,
  tone = 'neutral',
}) {
  return (
    <div className={clsx('tg-mini-app__action-card', `is-${tone}`)}>
      <div className="tg-mini-app__action-card-copy">
        <h3 className="tg-mini-app__action-card-title">{title}</h3>
        <p className="tg-mini-app__action-card-description">{description}</p>
      </div>
      <button
        type="button"
        className="tg-mini-app__button tg-mini-app__button--secondary"
        onClick={onAction}
      >
        {actionLabel}
      </button>
    </div>
  );
}

function BuyerTicketCounterCard({
  label,
  priceLabel,
  value,
  onDecrement,
  onIncrement,
  canDecrement,
  canIncrement,
  disabled = false,
  testId,
}) {
  return (
    <article
      className={clsx('tg-mini-app__ticket-counter-card', disabled && 'is-disabled')}
      data-testid={testId}
    >
      <div className="tg-mini-app__ticket-counter-head">
        <div className="tg-mini-app__ticket-counter-label">{label}</div>
        <div className="tg-mini-app__ticket-counter-price">{priceLabel}</div>
      </div>
      <div className="tg-mini-app__ticket-counter-controls">
        <button
          type="button"
          className="tg-mini-app__ticket-counter-button"
          data-testid={`${testId}-minus`}
          aria-label={`Убавить ${label.toLowerCase()}`}
          disabled={disabled || !canDecrement}
          onClick={onDecrement}
        >
          −
        </button>
        <div
          className="tg-mini-app__ticket-counter-value"
          data-testid={`${testId}-value`}
        >
          {value}
        </div>
        <button
          type="button"
          className="tg-mini-app__ticket-counter-button"
          data-testid={`${testId}-plus`}
          aria-label={`Добавить ${label.toLowerCase()}`}
          disabled={disabled || !canIncrement}
          onClick={onIncrement}
        >
          +
        </button>
      </div>
    </article>
  );
}

function buildMiniAppApiRequestHeaderSummary(diagnostic) {
  const summary = [
    `accept=${formatDiagnosticValue(diagnostic?.requestAcceptHeader)}`,
    `content-type=${formatDiagnosticValue(diagnostic?.requestContentTypeHeader)}`,
    `debug=${formatDiagnosticValue(diagnostic?.requestDebugHeader)}`,
    `init-data-header=${diagnostic?.initDataHeaderAttached ? 'attached' : 'not-set'}`,
  ];
  return summary.join(', ');
}

function MiniAppApiDiagnosticsCard({ title, diagnostic }) {
  if (!diagnostic) {
    return (
      <div className="tg-mini-app__diagnostic-card">
        <h3>{title}</h3>
        <p className="tg-mini-app__hint">No request captured yet.</p>
      </div>
    );
  }

  return (
    <div className="tg-mini-app__diagnostic-card">
      <h3>{title}</h3>
      <ul className="tg-mini-app__diagnostic-lines">
        <li>
          <strong>Request URL:</strong> {formatDiagnosticValue(diagnostic.requestUrl)}
        </li>
        <li>
          <strong>Request method:</strong> {formatDiagnosticValue(diagnostic.method)}
        </li>
        <li>
          <strong>Fetch started:</strong> {formatDiagnosticFlag(diagnostic.fetchStarted)}
        </li>
        <li>
          <strong>Response arrived:</strong> {formatDiagnosticFlag(diagnostic.responseArrived)}
        </li>
        <li>
          <strong>Response status:</strong> {formatDiagnosticValue(diagnostic.status)}
        </li>
        <li>
          <strong>Response content-type:</strong> {formatDiagnosticValue(diagnostic.contentType)}
        </li>
        <li>
          <strong>Fetch options:</strong> cache={formatDiagnosticValue(diagnostic.cacheMode)},
          credentials={formatDiagnosticValue(diagnostic.credentialsMode)}
        </li>
        <li>
          <strong>Request headers:</strong>{' '}
          {buildMiniAppApiRequestHeaderSummary(diagnostic)}
        </li>
        <li>
          <strong>JSON parse succeeded:</strong>{' '}
          {formatDiagnosticFlag(diagnostic.jsonParseSucceeded)}
        </li>
        <li>
          <strong>Fetch reject name:</strong>{' '}
          {formatDiagnosticValue(diagnostic.fetchErrorName)}
        </li>
        <li>
          <strong>Fetch reject message:</strong>{' '}
          {formatDiagnosticValue(diagnostic.fetchErrorMessage)}
        </li>
        <li>
          <strong>Route status:</strong> {formatDiagnosticValue(diagnostic.routeStatus)}
        </li>
        <li>
          <strong>Backend rejection reason:</strong>{' '}
          {formatDiagnosticValue(diagnostic.rejectionReason)}
        </li>
        <li>
          <strong>JSON parse error:</strong>{' '}
          {formatDiagnosticValue(diagnostic.jsonParseErrorMessage)}
        </li>
        <li>
          <strong>Response preview:</strong> {formatDiagnosticValue(diagnostic.responsePreview)}
        </li>
      </ul>
    </div>
  );
}

const USEFUL_CONTENT_FALLBACK = resolveTelegramMiniAppEntrypointContent('useful_content');
const FAQ_FALLBACK = resolveTelegramMiniAppEntrypointContent('faq');
const CONTACT_FALLBACK = resolveTelegramMiniAppEntrypointContent('contact');
const MINI_APP_BASE_PATH = '/telegram/mini-app';
const MINI_APP_SECTION_BY_DEEP_LINK = Object.freeze({
  '/my-requests': 'my_tickets',
  '/my-tickets': 'my_tickets',
});

function readWindowPathname() {
  if (typeof window === 'undefined') {
    return MINI_APP_BASE_PATH;
  }
  return normalizeString(window.location?.pathname) || MINI_APP_BASE_PATH;
}

function normalizeMiniAppPathSuffix(pathname) {
  const normalizedPathname = normalizeString(pathname) || MINI_APP_BASE_PATH;
  if (normalizedPathname === MINI_APP_BASE_PATH) {
    return '/';
  }
  const withoutBasePath = normalizedPathname.startsWith(`${MINI_APP_BASE_PATH}/`)
    ? normalizedPathname.slice(MINI_APP_BASE_PATH.length)
    : normalizedPathname;
  if (!withoutBasePath) {
    return '/';
  }
  const suffix = withoutBasePath.startsWith('/')
    ? withoutBasePath
    : `/${withoutBasePath}`;
  return suffix.replace(/\/+$/, '') || '/';
}

export function resolveInitialMiniAppSection(pathname) {
  const suffix = normalizeMiniAppPathSuffix(pathname);
  if (suffix === '/' || suffix === '/index.html') {
    return 'catalog';
  }
  return MINI_APP_SECTION_BY_DEEP_LINK[suffix] || 'catalog';
}

markMiniAppBootstrapCheckpointOnce('TelegramMiniApp module evaluated');

export default function TelegramMiniApp() {
  markMiniAppBootstrapCheckpointOnce('TelegramMiniApp function render entered');

  const [telegramUserId, setTelegramUserId] = useState(readTelegramMiniAppUserId);
  const [catalogDate, setCatalogDate] = useState(readInitialCatalogDate);
  const [initialMiniAppSection] = useState(() =>
    resolveInitialMiniAppSection(readWindowPathname())
  );
  const [deepLinkMyTicketsOpened, setDeepLinkMyTicketsOpened] = useState(false);
  const [catalogState, setCatalogState] = useState({
    loading: false,
    error: null,
    items: [],
  });
  const [catalogTripType, setCatalogTripType] = useState(null);
  const [apiDiagnostics, setApiDiagnostics] = useState(
    readMiniAppApiDiagnosticsSnapshot
  );
  const [runtimeDiagnostics, setRuntimeDiagnostics] = useState(
    readMiniAppRuntimeDiagnosticsSnapshot
  );
  const [activeSection, setActiveSection] = useState(initialMiniAppSection);
  const [selectedTripCard, setSelectedTripCard] = useState(null);
  const [tripCardError, setTripCardError] = useState(null);
  const [ticketsState, setTicketsState] = useState({
    loading: false,
    error: null,
    items: [],
  });
  const [myRequestsState, setMyRequestsState] = useState({
    loading: false,
    error: null,
    readModel: null,
  });
  const [ticketDetailState, setTicketDetailState] = useState({
    loading: false,
    error: null,
    selectedBookingRequestId: null,
    ticketView: null,
    offlineSnapshot: null,
    fallbackUsed: false,
    ticketViewErrorMessage: null,
  });
  const [placeholderContent, setPlaceholderContent] = useState(
    resolveTelegramMiniAppEntrypointContent('catalog')
  );
  const [usefulContentState, setUsefulContentState] = useState({
    loading: false,
    error: null,
    content: null,
  });
  const [faqState, setFaqState] = useState({
    loading: false,
    error: null,
    content: null,
  });
  const [contactState, setContactState] = useState({
    loading: false,
    error: null,
    content: null,
  });
  const [bookingForm, setBookingForm] = useState({
    ticketCounts: {
      adult: 1,
      teen: 0,
      child: 0,
    },
    requestedPrepaymentAmount: 0,
    customerName: '',
    contactPhone: '',
  });
  const [bookingFormError, setBookingFormError] = useState(null);
  const [submitResult, setSubmitResult] = useState(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const holdResultViewModel = useMemo(
    () => buildMiniAppHoldResultViewModel(submitResult),
    [submitResult]
  );
  const resultCountdownSummary = useMemo(
    () => buildMiniAppBuyerCountdownSummary(holdResultViewModel.holdExpiresAtIso, nowMs),
    [holdResultViewModel.holdExpiresAtIso, nowMs]
  );
  const resultSellerContact = useMemo(
    () => resolveMiniAppSellerContact(holdResultViewModel.sellerContact),
    [holdResultViewModel.sellerContact]
  );
  const lifecycleItemByBookingRequestId = useMemo(
    () => buildLifecycleItemMap(myRequestsState.readModel),
    [myRequestsState.readModel]
  );
  const ticketDetailLifecycleItem = useMemo(() => {
    const selectedBookingRequestId = Number(ticketDetailState.selectedBookingRequestId);
    return Number.isInteger(selectedBookingRequestId) && selectedBookingRequestId > 0
      ? lifecycleItemByBookingRequestId.get(selectedBookingRequestId) || null
      : null;
  }, [ticketDetailState.selectedBookingRequestId, lifecycleItemByBookingRequestId]);
  const ticketDetailViewModel = useMemo(
    () =>
      buildMiniAppTicketDetailViewModel({
        ticketView: ticketDetailState.ticketView,
        offlineSnapshot: ticketDetailState.offlineSnapshot,
        fallbackUsed: ticketDetailState.fallbackUsed,
        loading: ticketDetailState.loading,
        error: ticketDetailState.error,
      }),
    [ticketDetailState]
  );
  const ticketDetailPresentation = useMemo(
    () =>
      resolveMiniAppBuyerTicketPresentation({
        status: ticketDetailViewModel.status,
        availability: ticketDetailViewModel.availability,
        bookingRequestId: ticketDetailViewModel.bookingRequestId,
        buyerTicketCode: ticketDetailViewModel.buyerTicketCode,
        lifecycleState: ticketDetailLifecycleItem?.lifecycle_state,
        holdActive: ticketDetailLifecycleItem?.hold_active,
        requestConfirmed: ticketDetailLifecycleItem?.request_confirmed,
        requestedPrepaymentAmount: ticketDetailLifecycleItem?.requested_prepayment_amount,
        holdExpiresAtIso: ticketDetailViewModel.holdExpiresAtIso,
      }),
    [
      ticketDetailViewModel.availability,
      ticketDetailViewModel.bookingRequestId,
      ticketDetailViewModel.buyerTicketCode,
      ticketDetailViewModel.holdExpiresAtIso,
      ticketDetailViewModel.status,
      ticketDetailLifecycleItem,
    ]
  );
  const ticketDetailPendingPrepaymentFlow = useMemo(
    () =>
      isMiniAppPendingPrepaymentFlow({
        status: ticketDetailViewModel.status,
        availability: ticketDetailViewModel.availability,
        lifecycleState: ticketDetailLifecycleItem?.lifecycle_state,
      }),
    [
      ticketDetailLifecycleItem?.lifecycle_state,
      ticketDetailViewModel.availability,
      ticketDetailViewModel.status,
    ]
  );
  const ticketDetailCountdownSummary = useMemo(
    () => buildMiniAppBuyerCountdownSummary(ticketDetailViewModel.holdExpiresAtIso, nowMs),
    [ticketDetailViewModel.holdExpiresAtIso, nowMs]
  );
  const ticketDetailSellerContact = useMemo(
    () =>
      resolveMiniAppSellerContact({
        sellerName: ticketDetailViewModel.sellerName,
        sellerPhone: ticketDetailViewModel.sellerPhone,
      }),
    [ticketDetailViewModel.sellerName, ticketDetailViewModel.sellerPhone]
  );
  const ticketDetailCanOpenSavedCopy = useMemo(() => {
    const selectedBookingRequestId = Number(ticketDetailState.selectedBookingRequestId);
    if (!Number.isInteger(selectedBookingRequestId) || selectedBookingRequestId <= 0) {
      return false;
    }
    if (ticketDetailPendingPrepaymentFlow) {
      return false;
    }
    return Boolean(ticketDetailViewModel.hasBoardingQr || ticketDetailViewModel.buyerTicketCode);
  }, [
    ticketDetailPendingPrepaymentFlow,
    ticketDetailState.selectedBookingRequestId,
    ticketDetailViewModel.buyerTicketCode,
    ticketDetailViewModel.hasBoardingQr,
  ]);
  const usefulContentViewModel = useMemo(
    () =>
      buildMiniAppUsefulContentViewModel({
        loading: usefulContentState.loading,
        error: usefulContentState.error,
        usefulScreenContent: usefulContentState.content,
        fallbackContent: USEFUL_CONTENT_FALLBACK,
      }),
    [usefulContentState]
  );
  const faqViewModel = useMemo(
    () =>
      buildMiniAppFaqViewModel({
        loading: faqState.loading,
        error: faqState.error,
        faqScreenContent: faqState.content,
        fallbackContent: FAQ_FALLBACK,
      }),
    [faqState]
  );
  const contactViewModel = useMemo(
    () =>
      buildMiniAppContactViewModel({
        loading: contactState.loading,
        error: contactState.error,
        contactScreenContent: contactState.content,
        fallbackContent: CONTACT_FALLBACK,
      }),
    [contactState]
  );
  const isMiniAppDebugMode = isMiniAppApiDiagnosticsEnabled();
  const showMiniAppApiDiagnostics = isMiniAppDebugMode;
  const activeNavSection = resolveActiveNavSection(activeSection);
  const catalogDatePresets = useMemo(() => createCatalogDatePresets(), []);
  const visibleCatalogItems = useMemo(
    () => filterBuyerCatalogItems(catalogState.items),
    [catalogState.items]
  );
  const filteredCatalogItems = useMemo(
    () =>
      catalogTripType ? filterBuyerCatalogItems(catalogState.items, catalogTripType) : [],
    [catalogState.items, catalogTripType]
  );
  const catalogTypeSelectionCards = useMemo(
    () =>
      BUYER_CATALOG_TYPE_SELECTION_OPTIONS.map((selectionOption) => ({
        ...selectionOption,
        tripCount: filterBuyerCatalogItems(catalogState.items, selectionOption.key).length,
      })),
    [catalogState.items]
  );
  const selectedCatalogTripType =
    BUYER_CATALOG_TYPE_SELECTION_OPTIONS.find(
      (selectionOption) => selectionOption.key === catalogTripType
    ) || null;
  const canSelectCatalogType = !catalogState.loading && !catalogState.error;
  const bookingTicketSelection = useMemo(
    () =>
      buildBuyerTicketSelectionSummary(
        bookingForm.ticketCounts,
        selectedTripCard?.price_summary
      ),
    [bookingForm.ticketCounts, selectedTripCard]
  );
  const resultInfoCards = useMemo(() => {
    const cards = [];
    const resultTripDateTime = formatDateTimeLabel(
      selectedTripCard?.date_time_summary?.requested_trip_date,
      selectedTripCard?.date_time_summary?.requested_time_slot
    );

    if (resultTripDateTime !== 'н/д') {
      cards.push({
        label: 'Рейс',
        value: resultTripDateTime,
        tone: 'neutral',
      });
    }

    if (bookingTicketSelection.totalSeats > 0) {
      cards.push({
        label: 'Пассажиры',
        value: bookingTicketSelection.mixLabel,
        tone: 'accent',
      });
    }

    return [...cards, ...holdResultViewModel.summaryItems];
  }, [
    bookingTicketSelection,
    holdResultViewModel.summaryItems,
    selectedTripCard,
  ]);
  const selectedTripAvailableSeats = useMemo(
    () => resolveBuyerAvailableSeats(selectedTripCard),
    [selectedTripCard]
  );
  const bookingCapacityExceeded =
    selectedTripAvailableSeats !== null &&
    bookingTicketSelection.totalSeats > selectedTripAvailableSeats;
  const bookingNameValidation = useMemo(
    () => validateBuyerCustomerName(bookingForm.customerName),
    [bookingForm.customerName]
  );
  const bookingPhoneValidation = useMemo(
    () => validateBuyerContactPhone(bookingForm.contactPhone),
    [bookingForm.contactPhone]
  );
  const bookingRequiredCustomerName = bookingNameValidation.normalizedName;
  const bookingRequiredContactPhone = bookingPhoneValidation.normalizedPhoneE164;
  const bookingRequiredFieldsFilled = Boolean(
    bookingNameValidation.isValid && bookingPhoneValidation.isValid
  );
  const bookingCanSubmit =
    bookingTicketSelection.totalSeats > 0 &&
    !bookingCapacityExceeded &&
    bookingRequiredFieldsFilled;
  const bookingSubmitButtonLabel = !bookingRequiredFieldsFilled
    ? 'Заполните имя и телефон'
    : bookingTicketSelection.totalSeats <= 0
      ? 'Выберите хотя бы один билет'
      : bookingCapacityExceeded
        ? 'Недостаточно мест'
        : 'Отправить заявку';

  const resolvedBookingSubmitButtonLabel =
    bookingTicketSelection.totalSeats <= 0
      ? 'Выберите хотя бы один билет'
      : bookingCapacityExceeded
        ? 'Недостаточно мест'
        : !bookingNameValidation.isValid && !bookingPhoneValidation.isValid
          ? 'Укажите имя и телефон'
          : !bookingNameValidation.isValid
            ? 'Укажите имя'
            : !bookingPhoneValidation.isValid
              ? 'Проверьте телефон'
              : bookingSubmitButtonLabel;
  const bookingSubmitHelperText =
    bookingTicketSelection.totalSeats <= 0
      ? 'Выберите хотя бы один билет для заявки.'
      : bookingCapacityExceeded
        ? `Доступно только ${formatMiniAppSeatCountLabel(selectedTripAvailableSeats)}.`
        : !bookingNameValidation.isValid && !bookingPhoneValidation.isValid
          ? 'Чтобы отправить заявку, укажите имя от 2 символов и телефон в формате +7XXXXXXXXXX или 8XXXXXXXXXX.'
          : !bookingNameValidation.isValid
            ? bookingNameValidation.message
            : !bookingPhoneValidation.isValid
              ? bookingPhoneValidation.message
              : null;
  useEffect(() => {
    const intervalId = setInterval(() => {
      setNowMs(Date.now());
    }, 1000);

    return () => {
      clearInterval(intervalId);
    };
  }, []);

  useEffect(() => {
    markMiniAppBootstrapCheckpointOnce('TelegramMiniApp first useEffect entered');
    completeMiniAppBootstrap();
    setRuntimeDiagnostics(readMiniAppRuntimeDiagnosticsSnapshot());

    if (typeof window === 'undefined') {
      return;
    }
    const webApp = window?.Telegram?.WebApp;
    if (!webApp) {
      return;
    }

    try {
      if (typeof webApp.ready === 'function') {
        webApp.ready();
      }
      if (typeof webApp.expand === 'function') {
        webApp.expand();
      }
    } catch {
      // Ignore runtime readiness exceptions in non-Telegram environments.
    }

    const runtimeTelegramUserId = readTelegramMiniAppUserId();
    if (runtimeTelegramUserId) {
      setTelegramUserId((prev) => normalizeString(prev) || runtimeTelegramUserId);
    }
  }, []);

  useEffect(() => subscribeMiniAppApiDiagnostics(setApiDiagnostics), []);

  useEffect(() => {
    if (normalizeString(telegramUserId)) {
      return undefined;
    }

    let attempts = 0;
    const intervalId = setInterval(() => {
      attempts += 1;
      const runtimeTelegramUserId = readTelegramMiniAppUserId();
      if (runtimeTelegramUserId) {
        setTelegramUserId(runtimeTelegramUserId);
        clearInterval(intervalId);
        return;
      }
      if (attempts >= 20) {
        clearInterval(intervalId);
      }
    }, 150);

    return () => {
      clearInterval(intervalId);
    };
  }, [telegramUserId]);

  useEffect(() => {
    let isAlive = true;

    async function loadCatalog() {
      markMiniAppBootstrapCheckpointOnce('catalog load started');

      const normalizedTelegramUserId = normalizeString(telegramUserId);
      const hasRuntimeInitData = Boolean(readTelegramMiniAppInitDataRaw());
      if (!normalizedTelegramUserId && !hasRuntimeInitData) {
        if (isAlive) {
          setCatalogState({
            loading: false,
            error: 'Telegram user id is required to open catalog.',
            items: [],
          });
        }
        return;
      }

      setCatalogState((prev) => ({ ...prev, loading: true, error: null }));
      try {
        const catalog = await fetchMiniAppCatalog({
          telegramUserId: normalizedTelegramUserId,
          date: catalogDate || null,
          onlyActiveBookable: true,
        });
        if (!isAlive) {
          return;
        }
        setCatalogState({
          loading: false,
          error: null,
          items: catalog.items || [],
        });
      } catch (error) {
        if (!isAlive) {
          return;
        }
        setCatalogState({
          loading: false,
          error: error?.message || 'Не удалось загрузить каталог.',
          items: [],
        });
      }
    }

    loadCatalog();
    return () => {
      isAlive = false;
    };
  }, [telegramUserId, catalogDate]);

  useEffect(() => {
    let isAlive = true;

    async function loadMyRequests() {
      markMiniAppBootstrapCheckpointOnce('my-requests load started');

      const normalizedTelegramUserId = normalizeString(telegramUserId);
      const hasRuntimeInitData = Boolean(readTelegramMiniAppInitDataRaw());
      if (!normalizedTelegramUserId && !hasRuntimeInitData) {
        if (isAlive) {
          setMyRequestsState({
            loading: false,
            error: 'Нужен Telegram user id, чтобы загрузить мои заявки.',
            readModel: null,
          });
        }
        return;
      }

      setMyRequestsState({
        loading: true,
        error: null,
        readModel: null,
      });

      try {
        const readModel = await fetchMiniAppMyRequests({
          telegramUserId: normalizedTelegramUserId,
        });
        if (!isAlive) {
          return;
        }
        setMyRequestsState({
          loading: false,
          error: null,
          readModel,
        });
      } catch (error) {
        if (!isAlive) {
          return;
        }
        setMyRequestsState({
          loading: false,
          error: error?.message || 'Не удалось загрузить мои заявки.',
          readModel: null,
        });
      }
    }

    loadMyRequests();
    return () => {
      isAlive = false;
    };
  }, [telegramUserId]);

  function resetToCatalog() {
    setActiveSection('catalog');
    setTripCardError(null);
    setBookingFormError(null);
  }

  function handleCatalogDateChange(nextCatalogDate) {
    setCatalogDate(normalizeCatalogDateValue(nextCatalogDate));
    if (activeNavSection === 'catalog' && activeSection !== 'catalog') {
      resetToCatalog();
    }
  }

  function handleCatalogTripTypeChange(nextTripType) {
    setCatalogTripType(resolveBuyerCatalogTripTypeSelection(nextTripType));
    if (activeNavSection === 'catalog' && activeSection !== 'catalog') {
      resetToCatalog();
    }
  }

  function handleCatalogTripTypeReset() {
    setCatalogTripType(null);
    if (activeNavSection === 'catalog' && activeSection !== 'catalog') {
      resetToCatalog();
    }
  }

  function resetTicketDetail() {
    setTicketDetailState({
      loading: false,
      error: null,
      selectedBookingRequestId: null,
      ticketView: null,
      offlineSnapshot: null,
      fallbackUsed: false,
      ticketViewErrorMessage: null,
    });
  }

  async function openTripCard(catalogItem) {
    const reference = catalogItem?.trip_slot_reference || null;
    if (!reference?.slot_uid) {
      setTripCardError('Выбранный рейс не содержит корректной ссылки на слот.');
      return;
    }
    setTripCardError(null);
    try {
      const tripCard = await fetchMiniAppTripCard({
        slotUid: reference.slot_uid,
        requestedTripDate: reference.requested_trip_date,
        requestedTimeSlot: reference.requested_time_slot,
      });
      const nextAdultCount = resolveBuyerAvailableSeats(tripCard) === 0 ? 0 : 1;
      setSelectedTripCard(tripCard);
      setBookingForm((prev) => ({
        ticketCounts: {
          adult: nextAdultCount,
          teen: 0,
          child: 0,
        },
        requestedPrepaymentAmount:
          Number(tripCard?.price_summary?.adult_price ?? prev.requestedPrepaymentAmount) || 0,
        customerName: prev.customerName,
        contactPhone: prev.contactPhone,
      }));
      setBookingFormError(null);
      setSubmitResult(null);
      setActiveSection('trip_card');
    } catch (error) {
      setTripCardError(error?.message || 'Не удалось загрузить карточку рейса.');
    }
  }

  function changeBookingTicketCount(ticketTypeKey, delta) {
    const normalizedDelta = Number(delta);
    if (!Number.isFinite(normalizedDelta) || normalizedDelta === 0) {
      return;
    }
    if (!isBuyerTicketTypeEnabled(selectedTripCard, ticketTypeKey)) {
      return;
    }

    setBookingForm((prev) => {
      const currentCounts = normalizeBuyerTicketCounts(prev.ticketCounts);
      const nextValue = Math.max(
        0,
        normalizeNonNegativeInteger(currentCounts[ticketTypeKey]) + Math.trunc(normalizedDelta)
      );
      const nextCounts = {
        ...currentCounts,
        [ticketTypeKey]: nextValue,
      };
      const nextSelection = buildBuyerTicketSelectionSummary(
        nextCounts,
        selectedTripCard?.price_summary
      );
      if (
        normalizedDelta > 0 &&
        selectedTripAvailableSeats !== null &&
        nextSelection.totalSeats > selectedTripAvailableSeats
      ) {
        return prev;
      }

      return {
        ...prev,
        ticketCounts: nextCounts,
      };
    });
    setBookingFormError(null);
  }

  async function openEntrypoint(entrypointKey) {
    if (entrypointKey === 'catalog') {
      resetToCatalog();
      return;
    }
    if (entrypointKey === 'my_tickets') {
      const normalizedTelegramUserId = normalizeString(telegramUserId);
      const hasRuntimeInitData = Boolean(readTelegramMiniAppInitDataRaw());
      setActiveSection('my_tickets');
      resetTicketDetail();
      if (!normalizedTelegramUserId && !hasRuntimeInitData) {
        setTicketsState({
          loading: false,
          error: 'Telegram user id is required to open ticket access.',
          items: [],
        });
        return;
      }

      setTicketsState({
        loading: true,
        error: null,
        items: [],
      });
      try {
        const ticketList = await fetchMiniAppMyTickets({
          telegramUserId: normalizedTelegramUserId,
        });
        if (
          ticketList?.my_requests_read_model &&
          typeof ticketList.my_requests_read_model === 'object'
        ) {
          setMyRequestsState({
            loading: false,
            error: null,
            readModel: ticketList.my_requests_read_model,
          });
        }
        setTicketsState({
          loading: false,
          error: null,
          items: Array.isArray(ticketList?.items) ? ticketList.items : [],
        });
      } catch (error) {
        setTicketsState({
          loading: false,
          error: error?.message || 'Не удалось загрузить список заявок и билетов.',
          items: [],
        });
      }
      return;
    }
    if (entrypointKey === 'useful_content') {
      const normalizedTelegramUserId = normalizeString(telegramUserId);
      const selectedBookingRequestId = Number(ticketDetailState.selectedBookingRequestId);
      const bookingRequestId =
        Number.isInteger(selectedBookingRequestId) && selectedBookingRequestId > 0
          ? selectedBookingRequestId
          : null;
      setActiveSection('useful_content');
      setUsefulContentState({
        loading: true,
        error: null,
        content: null,
      });
      try {
        const content = await fetchMiniAppUsefulContentScreen({
          telegramUserId: normalizedTelegramUserId,
          bookingRequestId,
        });
        setUsefulContentState({
          loading: false,
          error: null,
          content,
        });
      } catch (error) {
        setUsefulContentState({
          loading: false,
          error: error?.message || 'Не удалось загрузить полезную информацию.',
          content: USEFUL_CONTENT_FALLBACK,
        });
      }
      return;
    }
    if (entrypointKey === 'faq') {
      const normalizedTelegramUserId = normalizeString(telegramUserId);
      setActiveSection('faq');
      setFaqState({
        loading: true,
        error: null,
        content: null,
      });
      try {
        const content = await fetchMiniAppFaqScreen({
          telegramUserId: normalizedTelegramUserId,
        });
        setFaqState({
          loading: false,
          error: null,
          content,
        });
      } catch (error) {
        setFaqState({
          loading: false,
          error: error?.message || 'Не удалось загрузить раздел с вопросами.',
          content: FAQ_FALLBACK,
        });
      }
      return;
    }
    if (entrypointKey === 'contact') {
      const normalizedTelegramUserId = normalizeString(telegramUserId);
      const selectedBookingRequestId = Number(ticketDetailState.selectedBookingRequestId);
      const bookingRequestId =
        Number.isInteger(selectedBookingRequestId) && selectedBookingRequestId > 0
          ? selectedBookingRequestId
          : null;
      setActiveSection('contact');
      setContactState({
        loading: true,
        error: null,
        content: null,
      });
      try {
        const content = await fetchMiniAppContactScreen({
          telegramUserId: normalizedTelegramUserId,
          bookingRequestId,
        });
        setContactState({
          loading: false,
          error: null,
          content,
        });
      } catch (error) {
        setContactState({
          loading: false,
          error: error?.message || 'Не удалось загрузить контакты.',
          content: CONTACT_FALLBACK,
        });
      }
      return;
    }

    setActiveSection(entrypointKey);
    try {
      const content = await fetchMiniAppEntrypointContent(entrypointKey, {
        telegramUserId: normalizeString(telegramUserId),
      });
      setPlaceholderContent(content);
    } catch {
      setPlaceholderContent(resolveTelegramMiniAppEntrypointContent(entrypointKey));
    }
  }

  // This effect intentionally boots deep-link my-tickets once when guest identity becomes available.
  /* eslint-disable react-hooks/exhaustive-deps */
  useEffect(() => {
    if (initialMiniAppSection !== 'my_tickets' || deepLinkMyTicketsOpened) {
      return;
    }
    const hasRuntimeIdentity = Boolean(
      normalizeString(telegramUserId) || readTelegramMiniAppInitDataRaw()
    );
    if (!hasRuntimeIdentity) {
      return;
    }
    setDeepLinkMyTicketsOpened(true);
    openEntrypoint('my_tickets');
  }, [
    deepLinkMyTicketsOpened,
    initialMiniAppSection,
    telegramUserId,
  ]);
  /* eslint-enable react-hooks/exhaustive-deps */

  async function openTicketView(ticketItem) {
    const bookingRequestId = Number(ticketItem?.booking_request_reference?.booking_request_id);
    if (!Number.isInteger(bookingRequestId) || bookingRequestId <= 0) {
      setTicketDetailState({
        loading: false,
        error: 'Selected ticket is missing a valid booking request reference.',
        selectedBookingRequestId: null,
        ticketView: null,
        offlineSnapshot: null,
        fallbackUsed: false,
        ticketViewErrorMessage: null,
      });
      setActiveSection('ticket_view');
      return;
    }

    setActiveSection('ticket_view');
    setTicketDetailState({
      loading: true,
      error: null,
      selectedBookingRequestId: bookingRequestId,
      ticketView: null,
      offlineSnapshot: null,
      fallbackUsed: false,
      ticketViewErrorMessage: null,
    });

    try {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        const offlineSnapshot = await fetchMiniAppOfflineTicketSnapshot({
          telegramUserId,
          bookingRequestId,
        });
        setTicketDetailState({
          loading: false,
          error: null,
          selectedBookingRequestId: bookingRequestId,
          ticketView: null,
          offlineSnapshot,
          fallbackUsed: true,
          ticketViewErrorMessage: null,
        });
        return;
      }

      const result = await fetchMiniAppTicketViewWithOfflineFallback({
        telegramUserId,
        bookingRequestId,
      });
      setTicketDetailState({
        loading: false,
        error: null,
        selectedBookingRequestId: bookingRequestId,
        ticketView: result.ticketView,
        offlineSnapshot: result.offlineSnapshot,
        fallbackUsed: result.fallbackUsed,
        ticketViewErrorMessage: result.ticketViewErrorMessage,
      });
    } catch (error) {
      setTicketDetailState({
        loading: false,
        error: error?.message || 'Не удалось загрузить детали билета.',
        selectedBookingRequestId: bookingRequestId,
        ticketView: null,
        offlineSnapshot: null,
        fallbackUsed: false,
        ticketViewErrorMessage: null,
      });
    }
  }

  async function loadOfflineSnapshotForSelectedTicket() {
    const bookingRequestId = Number(ticketDetailState.selectedBookingRequestId);
    if (!Number.isInteger(bookingRequestId) || bookingRequestId <= 0) {
      return;
    }

    setTicketDetailState((prev) => ({
      ...prev,
      loading: true,
      error: null,
    }));
    try {
      const offlineSnapshot = await fetchMiniAppOfflineTicketSnapshot({
        telegramUserId,
        bookingRequestId,
      });
      setTicketDetailState((prev) => ({
        ...prev,
        loading: false,
        error: null,
        offlineSnapshot,
        fallbackUsed: true,
      }));
    } catch (error) {
      setTicketDetailState((prev) => ({
        ...prev,
        loading: false,
        error: error?.message || 'Не удалось загрузить офлайн-снимок билета.',
      }));
    }
  }

  async function submitBooking(event) {
    event.preventDefault();
    if (!selectedTripCard?.trip_slot_reference) {
      return;
    }
    if (!bookingCanSubmit) {
      setBookingFormError(
        bookingSubmitHelperText || 'Заполните имя и телефон перед отправкой заявки.'
      );
      return;
    }
    if (!bookingRequiredCustomerName || !bookingRequiredContactPhone) {
      setBookingFormError('Заполните имя и контактный телефон.');
      return;
    }
    if (bookingTicketSelection.totalSeats <= 0) {
      setBookingFormError('Выберите хотя бы один билет.');
      return;
    }
    if (
      selectedTripAvailableSeats !== null &&
      bookingTicketSelection.totalSeats > selectedTripAvailableSeats
    ) {
      setBookingFormError(
        `Доступно только ${formatMiniAppSeatCountLabel(selectedTripAvailableSeats)}.`
      );
      return;
    }
    setBookingFormError(null);

    const payload = {
      telegram_user_id: telegramUserId,
      selected_trip_slot_reference: selectedTripCard.trip_slot_reference,
      requested_seats: bookingTicketSelection.totalSeats,
      requested_ticket_mix: bookingTicketSelection.requestedTicketMix,
      requested_prepayment_amount: Number(bookingForm.requestedPrepaymentAmount),
      customer_name: bookingRequiredCustomerName,
      contact_phone: bookingRequiredContactPhone,
      idempotency_key: createIdempotencyKey(),
    };

    try {
      const response = await submitMiniAppBookingRequest(payload);
      setSubmitResult(response.submitResult);
    } catch (error) {
      setSubmitResult({
        submit_status: 'submit_blocked',
        submit_reason_code: 'network_error',
        submit_message: error?.message || 'Не удалось отправить заявку.',
      });
    }
    setActiveSection('result');
  }

  markMiniAppBootstrapCheckpointOnce('TelegramMiniApp first return JSX reached');

  return (
    <div className="tg-mini-app">
      <div className="tg-mini-app__shell">
        {activeNavSection === 'catalog' && (
          <section
            className="tg-mini-app__panel tg-mini-app__panel--date-filter"
            data-testid="telegram-mini-app-date-filter"
          >
            <div className="tg-mini-app__date-filter">
              <label className="tg-mini-app__date-filter-field">
                <span className="tg-mini-app__date-filter-label">Дата поездки</span>
                <input
                  className="tg-mini-app__input tg-mini-app__input--compact"
                  type="date"
                  value={catalogDate}
                  onChange={(event) => handleCatalogDateChange(event.target.value)}
                />
              </label>
              <div
                className="tg-mini-app__date-filter-presets"
                role="group"
                aria-label="Быстрый выбор даты"
              >
                {catalogDatePresets.map((preset) => (
                  <button
                    key={preset.key}
                    type="button"
                    className={clsx(
                      'tg-mini-app__date-filter-chip',
                      catalogDate === preset.value && 'is-active'
                    )}
                    onClick={() => handleCatalogDateChange(preset.value)}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>
          </section>
        )}

        {isMiniAppDebugMode && (
          <section
            className="tg-mini-app__panel tg-mini-app__panel--hero-subtle"
            data-testid="telegram-mini-app-runtime-diagnostics"
          >
            <MiniAppSectionHeader
              eyebrow="Runtime identity"
              title="Active buyer runtime markers"
              description="Debug-only markers for confirming the same Mini App HTML, build, and assets."
              aside={<MiniAppPill tone="neutral">Deterministic</MiniAppPill>}
            />
            <ul className="tg-mini-app__diagnostic-lines">
              <li>
                <strong>HTML identity:</strong>{' '}
                {formatDiagnosticValue(runtimeDiagnostics.htmlIdentity)}
              </li>
              <li>
                <strong>Build marker:</strong>{' '}
                {formatDiagnosticValue(runtimeDiagnostics.buildMarker)}
              </li>
              <li>
                <strong>Runtime entry URL:</strong>{' '}
                {formatDiagnosticValue(runtimeDiagnostics.entryUrl)}
              </li>
              <li>
                <strong>Stylesheet URL(s):</strong>{' '}
                {formatDiagnosticList(runtimeDiagnostics.stylesheetUrls)}
              </li>
              <li>
                <strong>Entry import result:</strong>{' '}
                {formatDiagnosticValue(runtimeDiagnostics.entryImportResult)}
              </li>
              <li>
                <strong>Failure category:</strong>{' '}
                {formatDiagnosticValue(runtimeDiagnostics.failureCategory)}
              </li>
              <li>
                <strong>Cache-buster query:</strong>{' '}
                {formatDiagnosticValue(runtimeDiagnostics.cacheBuster)}
              </li>
              <li>
                <strong>Current URL:</strong>{' '}
                {formatDiagnosticValue(runtimeDiagnostics.currentUrl)}
              </li>
            </ul>
          </section>
        )}

        {showMiniAppApiDiagnostics && (
          <section className="tg-mini-app__panel tg-mini-app__panel--diagnostic">
            <MiniAppSectionHeader
              eyebrow="Diagnostics"
              title="Buyer API diagnostics"
              description="Temporary iPhone/API investigation output for catalog and My Requests."
              aside={<MiniAppPill tone="neutral">Debug only</MiniAppPill>}
            />
            <div className="tg-mini-app__diagnostic-grid">
              <MiniAppApiDiagnosticsCard
                title="Catalog request"
                diagnostic={apiDiagnostics.catalog}
              />
              <MiniAppApiDiagnosticsCard
                title="My Requests request"
                diagnostic={apiDiagnostics.myRequests}
              />
            </div>
          </section>
        )}

        <nav className="tg-mini-app__nav" aria-label="Разделы мини-приложения покупателя">
          {TELEGRAM_MINI_APP_ENTRYPOINT_KEYS.map((entrypointKey) => (
            <button
              key={entrypointKey}
              type="button"
              className={clsx(
                'tg-mini-app__nav-button',
                activeNavSection === entrypointKey && 'is-active'
              )}
              onClick={() => openEntrypoint(entrypointKey)}
            >
              <span className="tg-mini-app__nav-label">
                {ENTRYPOINT_LABELS[entrypointKey] || entrypointKey}
              </span>
            </button>
          ))}
        </nav>

        {activeSection === 'catalog' && (
          <section
            className="tg-mini-app__panel tg-mini-app__panel--catalog"
            data-testid="telegram-mini-app-catalog"
          >
            <MiniAppSectionHeader
              title={selectedCatalogTripType ? selectedCatalogTripType.title : 'Выберите тип поездки'}
              className={
                selectedCatalogTripType
                  ? 'tg-mini-app__section-header--centered'
                  : ''
              }
              aside={
                <MiniAppPill tone="neutral">
                  {catalogState.loading
                    ? 'Загрузка...'
                    : formatTripCountLabel(
                        selectedCatalogTripType
                          ? filteredCatalogItems.length
                          : visibleCatalogItems.length
                      )}
                </MiniAppPill>
              }
            />
            {catalogState.loading && <p className="tg-mini-app__hint">Загружаем каталог...</p>}
            {catalogState.error && <p className="tg-mini-app__error">{catalogState.error}</p>}
            {!!tripCardError && <p className="tg-mini-app__error">{tripCardError}</p>}
            {!selectedCatalogTripType && (
              <div
                className="tg-mini-app__type-selection-grid"
                data-testid="telegram-mini-app-type-selection"
              >
                {catalogTypeSelectionCards.map((selectionOption) => (
                  <article
                    key={selectionOption.key}
                    className={clsx(
                      'tg-mini-app__action-card',
                      'tg-mini-app__action-card--type-selection',
                      `is-${selectionOption.key}`
                    )}
                    data-testid={`telegram-mini-app-type-selection-card-${selectionOption.key}`}
                  >
                    <div className="tg-mini-app__action-card-copy">
                      <div className="tg-mini-app__type-selection-kicker">Тип поездки</div>
                      <h3 className="tg-mini-app__action-card-title">{selectionOption.title}</h3>
                      <p className="tg-mini-app__action-card-description">
                        {selectionOption.description}
                      </p>
                      <p className="tg-mini-app__type-selection-meta">
                        {catalogState.loading
                          ? 'Загружаем рейсы на выбранную дату...'
                          : `${formatTripCountLabel(selectionOption.tripCount)} на выбранную дату`}
                      </p>
                    </div>
                    <button
                      type="button"
                      className="tg-mini-app__button tg-mini-app__button--secondary"
                      disabled={!canSelectCatalogType}
                      onClick={() => handleCatalogTripTypeChange(selectionOption.key)}
                    >
                      {selectionOption.actionLabel}
                    </button>
                  </article>
                ))}
              </div>
            )}
            {selectedCatalogTripType && (
              <div className="tg-mini-app__panel-actions tg-mini-app__panel-actions--catalog-tools">
                <button
                  type="button"
                  className="tg-mini-app__button tg-mini-app__button--ghost"
                  data-testid="telegram-mini-app-change-type-button"
                  onClick={handleCatalogTripTypeReset}
                >
                  Выбрать другой тип
                </button>
              </div>
            )}
            {!catalogState.loading &&
              !catalogState.error &&
              selectedCatalogTripType &&
              filteredCatalogItems.length > 0 && (
              <ul className="tg-mini-app__list">
                {filteredCatalogItems.map((item) => {
                  const availabilityState = item.booking_availability_state || 'unknown';
                  const capacityTotal = Number(item.seats_availability_summary?.capacity_total);
                  const capacityValue = Number.isFinite(capacityTotal)
                    ? formatMiniAppSeatCountLabel(capacityTotal)
                    : 'н/д';
                  const shouldHighlightAvailability =
                    shouldHighlightBuyerCatalogAvailability(availabilityState);
                  const dateTimeLabel = formatDateTimeLabel(
                    item.date_time_summary?.requested_trip_date,
                    item.date_time_summary?.requested_time_slot
                  );
                  return (
                    <li
                      key={item.trip_slot_reference.slot_uid}
                      className="tg-mini-app__list-card tg-mini-app__list-card--catalog"
                      data-testid="telegram-mini-app-catalog-item"
                      data-availability-state={availabilityState}
                      data-trip-type={normalizeString(item.trip_type_summary?.trip_type) || ''}
                    >
                      <div className="tg-mini-app__list-card-main">
                        {shouldHighlightAvailability ? (
                          <div className="tg-mini-app__list-card-topline">
                            <MiniAppPill tone="warning">
                              {formatStateLabel(availabilityState)}
                            </MiniAppPill>
                          </div>
                        ) : null}
                        <div className="tg-mini-app__list-card-header">
                          <h3 className="tg-mini-app__list-title tg-mini-app__list-title--catalog">
                            {item.trip_title_summary?.title || 'Рейс'}
                          </h3>
                        </div>
                        <div className="tg-mini-app__catalog-card-facts">
                          <div className="tg-mini-app__catalog-card-fact">
                            {dateTimeLabel}
                          </div>
                          <div className="tg-mini-app__catalog-card-fact">
                            Вместимость: {capacityValue}
                          </div>
                        </div>
                      </div>
                      <div className="tg-mini-app__list-card-actions">
                        <button
                          type="button"
                          className="tg-mini-app__button tg-mini-app__button--secondary"
                          onClick={() => openTripCard(item)}
                        >
                          Открыть рейс
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
            {!catalogState.loading &&
              !catalogState.error &&
              selectedCatalogTripType &&
              filteredCatalogItems.length === 0 && (
              <MiniAppEmptyState
                title="Рейсы не найдены"
                description={`На ${catalogDate || 'выбранную дату'} нет доступных рейсов формата «${selectedCatalogTripType.title}». Попробуйте выбрать другой тип или изменить дату.`}
              />
            )}
          </section>
        )}

        {activeSection === 'trip_card' && selectedTripCard && (
          <section
            className="tg-mini-app__panel tg-mini-app__panel--feature-card"
            data-testid="telegram-mini-app-trip-card"
          >
            {shouldHighlightBuyerCatalogAvailability(
              selectedTripCard.booking_availability_state
            ) ? (
              <div className="tg-mini-app__trip-card-status-row">
                <MiniAppPill
                  tone={resolveStateTone(selectedTripCard.booking_availability_state)}
                >
                  {formatStateLabel(selectedTripCard.booking_availability_state)}
                </MiniAppPill>
              </div>
            ) : null}
            <div className="tg-mini-app__subpanel tg-mini-app__subpanel--hero tg-mini-app__subpanel--trip-card">
              <div className="tg-mini-app__trip-card-heading">
                <h2 className="tg-mini-app__trip-card-title">
                  {selectedTripCard.trip_title_summary?.title || 'Рейс'}
                </h2>
                <div className="tg-mini-app__trip-card-facts">
                  <div className="tg-mini-app__trip-card-fact">
                    {formatDateTimeLabel(
                      selectedTripCard.date_time_summary?.requested_trip_date,
                      selectedTripCard.date_time_summary?.requested_time_slot
                    )}
                  </div>
                  <div className="tg-mini-app__trip-card-fact">
                    {formatBuyerSeatAvailabilitySummary(selectedTripCard)}
                  </div>
                </div>
              </div>
              <div
                className="tg-mini-app__trip-price-card tg-mini-app__trip-price-card--centered"
                data-testid="telegram-mini-app-trip-price-card"
              >
                <div className="tg-mini-app__trip-price-head">
                  <div>
                    <div className="tg-mini-app__info-label">Тарифы</div>
                  </div>
                  <details className="tg-mini-app__price-hint" data-testid="telegram-mini-app-age-hint">
                    <summary
                      className="tg-mini-app__price-hint-trigger"
                      data-testid="telegram-mini-app-age-hint-trigger"
                      aria-label="Возрастные категории"
                    >
                      ?
                    </summary>
                    <div
                      className="tg-mini-app__price-hint-body"
                      data-testid="telegram-mini-app-age-hint-body"
                    >
                      {BUYER_TRIP_CARD_AGE_HINT}
                    </div>
                  </details>
                </div>
                <ul className="tg-mini-app__trip-price-list">
                  {buildBuyerTripPriceRows(selectedTripCard.price_summary).map((priceRow) => (
                    <li
                      key={priceRow.key}
                      className="tg-mini-app__trip-price-row"
                      data-testid={`telegram-mini-app-trip-price-${priceRow.key}`}
                    >
                      <span className="tg-mini-app__trip-price-row-label">
                        {priceRow.label}
                      </span>
                      <strong className="tg-mini-app__trip-price-row-value">
                        {priceRow.value}
                      </strong>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
            <div className="tg-mini-app__panel-actions">
              <button
                type="button"
                className="tg-mini-app__button tg-mini-app__button--ghost"
                onClick={resetToCatalog}
              >
                Назад в каталог
              </button>
              <button
                type="button"
                className="tg-mini-app__button tg-mini-app__button--primary"
                onClick={() => {
                  setBookingFormError(null);
                  setActiveSection('booking_form');
                }}
                disabled={selectedTripCard.booking_availability_state === 'unavailable'}
              >
                Забронировать рейс
              </button>
            </div>
          </section>
        )}

        {activeSection === 'booking_form' && selectedTripCard && (
          <section
            className="tg-mini-app__panel tg-mini-app__panel--booking"
            data-testid="telegram-mini-app-booking-form"
          >
            <MiniAppSectionHeader
              eyebrow="Заявка на бронирование"
              title="Отправить заявку"
            />
            <form onSubmit={submitBooking} className="tg-mini-app__form">
              <div className="tg-mini-app__subpanel tg-mini-app__subpanel--booking-summary">
                <div className="tg-mini-app__booking-trip-head">
                  <h3 className="tg-mini-app__booking-trip-title">
                    {selectedTripCard.trip_title_summary?.title || 'Рейс'}
                  </h3>
                  <div className="tg-mini-app__trip-card-facts">
                    <div className="tg-mini-app__trip-card-fact">
                      {formatDateTimeLabel(
                        selectedTripCard.date_time_summary?.requested_trip_date,
                        selectedTripCard.date_time_summary?.requested_time_slot
                      )}
                    </div>
                    <div className="tg-mini-app__trip-card-fact">
                      {formatBuyerSeatAvailabilitySummary(selectedTripCard)}
                    </div>
                  </div>
                </div>
                <div className="tg-mini-app__booking-live-summary">
                  <div className="tg-mini-app__metric-card">
                    <div className="tg-mini-app__metric-label">Выбрано</div>
                    <div
                      className="tg-mini-app__booking-mix-value"
                      data-testid="telegram-mini-app-booking-selected-mix"
                    >
                      {bookingTicketSelection.mixLabel}
                    </div>
                  </div>
                  <div className="tg-mini-app__metric-card">
                    <div className="tg-mini-app__metric-label">Всего мест</div>
                    <div
                      className="tg-mini-app__booking-inline-value"
                      data-testid="telegram-mini-app-booking-total-seats"
                    >
                      {formatMiniAppSeatCountLabel(bookingTicketSelection.totalSeats)}
                    </div>
                  </div>
                </div>
              </div>

              <div className="tg-mini-app__ticket-counter-grid">
                {BUYER_TICKET_TYPE_OPTIONS.map((ticketType) => {
                  const ticketCount = bookingTicketSelection.ticketCounts[ticketType.key];
                  const ticketEnabled = isBuyerTicketTypeEnabled(
                    selectedTripCard,
                    ticketType.key
                  );
                  return (
                    <BuyerTicketCounterCard
                      key={ticketType.key}
                      label={ticketType.label}
                      priceLabel={formatBuyerTicketUnitPrice(selectedTripCard, ticketType)}
                      value={ticketCount}
                      testId={`telegram-mini-app-booking-counter-${ticketType.key}`}
                      onDecrement={() => changeBookingTicketCount(ticketType.key, -1)}
                      onIncrement={() => changeBookingTicketCount(ticketType.key, 1)}
                      canDecrement={ticketCount > 0}
                      canIncrement={
                        ticketEnabled &&
                        (selectedTripAvailableSeats === null ||
                          bookingTicketSelection.totalSeats < selectedTripAvailableSeats)
                      }
                      disabled={!ticketEnabled}
                    />
                  );
                })}
              </div>
              {bookingFormError ? <p className="tg-mini-app__error">{bookingFormError}</p> : null}
              <label className="tg-mini-app__field tg-mini-app__field-card">
                <span>Сумма предоплаты</span>
                <input
                  className="tg-mini-app__input"
                  type="number"
                  min="0"
                  step="1"
                  value={bookingForm.requestedPrepaymentAmount}
                  onChange={(event) => {
                    setBookingForm((prev) => ({
                      ...prev,
                      requestedPrepaymentAmount: event.target.value,
                    }));
                    setBookingFormError(null);
                  }}
                />
              </label>
              <label className="tg-mini-app__field tg-mini-app__field-card">
                <span>РРјСЏ</span>
                <input
                  className="tg-mini-app__input"
                  value={bookingForm.customerName}
                  onChange={(event) => {
                    setBookingForm((prev) => ({
                      ...prev,
                      customerName: event.target.value,
                    }));
                    setBookingFormError(null);
                  }}
                  placeholder="Введите имя"
                  autoComplete="name"
                  minLength={2}
                  aria-invalid={!bookingNameValidation.isValid}
                  required
                  data-testid="telegram-mini-app-booking-name-field"
                />
                {!bookingNameValidation.isValid ? (
                  <span
                    className="tg-mini-app__field-note tg-mini-app__field-note--warning"
                    data-testid="telegram-mini-app-booking-name-helper"
                  >
                    {bookingNameValidation.message}
                  </span>
                ) : null}
              </label>
              <label className="tg-mini-app__field tg-mini-app__field-card">
                <span>Контактный телефон</span>
                <input
                  className="tg-mini-app__input"
                  type="tel"
                  value={bookingForm.contactPhone}
                  onChange={(event) => {
                    setBookingForm((prev) => ({
                      ...prev,
                      contactPhone: sanitizeBuyerContactPhoneInput(event.target.value),
                    }));
                    setBookingFormError(null);
                  }}
                  placeholder="+79990000000"
                  autoComplete="tel"
                  inputMode="numeric"
                  maxLength={12}
                  aria-invalid={!bookingPhoneValidation.isValid}
                  required
                  data-testid="telegram-mini-app-booking-phone-field"
                />
                {!bookingPhoneValidation.isValid ? (
                  <span
                    className="tg-mini-app__field-note tg-mini-app__field-note--warning"
                    data-testid="telegram-mini-app-booking-phone-helper"
                  >
                    {bookingPhoneValidation.message}
                  </span>
                ) : null}
              </label>
              <div
                className="tg-mini-app__metric-card tg-mini-app__metric-card--featured tg-mini-app__booking-total-card"
                data-testid="telegram-mini-app-booking-total-card"
              >
                <div className="tg-mini-app__metric-label">РС‚РѕРіРѕ</div>
                <div
                  className="tg-mini-app__booking-total-price"
                  data-testid="telegram-mini-app-booking-total-price"
                >
                  {formatMoney(
                    bookingTicketSelection.totalPrice,
                    selectedTripCard.price_summary?.currency
                  )}
                </div>
              </div>
              {bookingSubmitHelperText ? (
                <p
                  className="tg-mini-app__hint tg-mini-app__booking-submit-helper"
                  data-testid="telegram-mini-app-booking-submit-helper"
                >
                  {bookingSubmitHelperText}
                </p>
              ) : null}
              <div className="tg-mini-app__panel-actions">
                <button
                  type="button"
                  className="tg-mini-app__button tg-mini-app__button--ghost"
                  onClick={() => {
                    setBookingFormError(null);
                    setActiveSection('trip_card');
                  }}
                >
                  Назад
                </button>
                <button
                  type="submit"
                  className="tg-mini-app__button tg-mini-app__button--primary"
                  disabled={!bookingCanSubmit}
                  data-testid="telegram-mini-app-booking-submit-button"
                >
                  {resolvedBookingSubmitButtonLabel}
                </button>
              </div>
            </form>
          </section>
        )}

        {activeSection === 'result' && submitResult && (
          <section
            className={clsx(
              'tg-mini-app__panel',
              'tg-mini-app__panel--result-card',
              'tg-mini-app__result',
              mapToneClass(holdResultViewModel.tone)
            )}
            data-testid="telegram-mini-app-submit-result"
          >
            <MiniAppSectionHeader
              title={holdResultViewModel.headline}
              description={holdResultViewModel.primaryText}
              aside={
                holdResultViewModel.isSuccess ? null : (
                  <MiniAppPill tone="warning">
                    {holdResultViewModel.statusLabel}
                  </MiniAppPill>
                )
              }
            />
            {holdResultViewModel.secondaryText && (
              <p className="tg-mini-app__note">{holdResultViewModel.secondaryText}</p>
            )}
            {holdResultViewModel.isSuccess && (
              <>
                <div className="tg-mini-app__subpanel tg-mini-app__subpanel--buyer-flow">
                  <div className="tg-mini-app__buyer-flow-head tg-mini-app__buyer-flow-head--with-timer">
                    <div>
                      <p className="tg-mini-app__section-eyebrow">Что делать сейчас</p>
                      <h3 className="tg-mini-app__subpanel-title">
                        {BUYER_PENDING_FLOW_TITLE}
                      </h3>
                    </div>
                    <div
                      className="tg-mini-app__buyer-flow-timer"
                      data-testid="telegram-mini-app-post-request-timer"
                    >
                      <MiniAppInfoCard
                        label={
                          '\u041E\u0441\u0442\u0430\u043B\u043E\u0441\u044C \u0432\u0440\u0435\u043C\u0435\u043D\u0438'
                        }
                        value={resultCountdownSummary.valueLabel}
                        tone={resultCountdownSummary.tone}
                        className="tg-mini-app__buyer-flow-timer-card tg-mini-app__info-card--centered"
                      />
                    </div>
                  </div>
                  <MiniAppBuyerFlowSteps steps={holdResultViewModel.instructionSteps} />
                  {resultSellerContact && (
                    <div className="tg-mini-app__meta-grid tg-mini-app__meta-grid--buyer-flow">
                      {resultSellerContact.sellerName && (
                        <MiniAppMetaItem
                          label="Продавец"
                          value={resultSellerContact.sellerName}
                          tone="accent"
                          className="tg-mini-app__meta-item--centered"
                        />
                      )}
                      {resultSellerContact.sellerPhone && (
                        <MiniAppSellerPhoneMetaItem
                          phone={resultSellerContact.sellerPhone}
                          className="tg-mini-app__meta-item--centered"
                          actionTestId="telegram-mini-app-post-request-copy-seller"
                          feedbackTestId="telegram-mini-app-post-request-copy-feedback"
                        />
                      )}
                    </div>
                  )}
                </div>
                <div className="tg-mini-app__subpanel">
                  <h3 className="tg-mini-app__subpanel-title">Срок брони</h3>
                  <div className="tg-mini-app__info-grid">
                    <MiniAppInfoCard
                      label={
                        holdResultViewModel.holdDeadlineLabel
                          ? 'Бронь действует до'
                          : 'Срок брони'
                      }
                      value={holdResultViewModel.holdDeadlineLabel || '15 минут'}
                      tone={resultCountdownSummary.tone}
                      className="tg-mini-app__info-card--centered"
                    />
                  </div>
                </div>
                {resultInfoCards.length > 0 && (
                  <div
                    className="tg-mini-app__info-grid tg-mini-app__info-grid--post-request"
                    data-testid="telegram-mini-app-post-request-lower-grid"
                  >
                    {resultInfoCards.map((item) => (
                      <MiniAppInfoCard
                        key={`${item.label}:${item.value}`}
                        label={item.label}
                        value={item.value}
                        tone={item.tone}
                        className="tg-mini-app__info-card--centered"
                      />
                    ))}
                  </div>
                )}
              </>
            )}
            {holdResultViewModel.referenceText && (
              <p className="tg-mini-app__hint tg-mini-app__supporting-meta">
                {holdResultViewModel.referenceText}
              </p>
            )}
            <div className="tg-mini-app__panel-actions">
              <button
                type="button"
                className="tg-mini-app__button tg-mini-app__button--secondary"
                onClick={() => openEntrypoint('my_tickets')}
              >
                Открыть мои заявки
              </button>
              <button
                type="button"
                className="tg-mini-app__button tg-mini-app__button--ghost"
                onClick={resetToCatalog}
              >
                Вернуться в каталог
              </button>
            </div>
          </section>
        )}

        {activeSection === 'my_tickets' && (
          <section
            className="tg-mini-app__panel tg-mini-app__panel--tickets"
            data-testid="telegram-mini-app-my-tickets"
          >
            <MiniAppSectionHeader
              title="Мои заявки"
              aside={
                <MiniAppPill tone="neutral">
                  {ticketsState.loading
                    ? 'Загрузка...'
                    : formatMiniAppRequestCountLabel(ticketsState.items.length)}
                </MiniAppPill>
              }
            />
            {ticketsState.loading && (
              <p className="tg-mini-app__hint">Загружаем список заявок и билетов...</p>
            )}
            {ticketsState.error && <p className="tg-mini-app__error">{ticketsState.error}</p>}
            {!ticketsState.loading && !ticketsState.error && ticketsState.items.length > 0 && (
              <ul className="tg-mini-app__list">
                {ticketsState.items.map((item, index) => {
                  const bookingRequestId = readBookingRequestId(item?.booking_request_reference);
                  const lifecycleItem =
                    bookingRequestId === null
                      ? null
                      : lifecycleItemByBookingRequestId.get(bookingRequestId) || null;
                  const status =
                    item?.ticket_status_summary?.deterministic_ticket_state ||
                    'ticket_unavailable';
                  const availability = item?.ticket_availability_state || 'unavailable';
                  const presentation = resolveMiniAppBuyerTicketPresentation({
                    status,
                    availability,
                    bookingRequestId,
                    buyerTicketCode: resolveBuyerTicketCode(
                      item?.buyer_ticket_reference_summary
                    ),
                    lifecycleState: lifecycleItem?.lifecycle_state,
                    holdActive: lifecycleItem?.hold_active,
                    requestConfirmed: lifecycleItem?.request_confirmed,
                    requestedPrepaymentAmount: lifecycleItem?.requested_prepayment_amount,
                  });
                  const canOpen = Number.isInteger(Number(bookingRequestId));
                  const requestedTripDate =
                    item?.date_time_summary?.requested_trip_date ||
                    lifecycleItem?.requested_trip_slot_reference?.requested_trip_date ||
                    null;
                  const requestedTimeSlot =
                    item?.date_time_summary?.requested_time_slot ||
                    lifecycleItem?.requested_trip_slot_reference?.requested_time_slot ||
                    null;
                  const requestedSeats =
                    item?.seats_count_summary?.requested_seats ??
                    lifecycleItem?.requested_seats ??
                    null;
                  const pendingPrepaymentFlow = isMiniAppPendingPrepaymentFlow({
                    status,
                    availability,
                    lifecycleState: lifecycleItem?.lifecycle_state,
                  });
                  const dateTimeLabel = formatDateTimeLabel(requestedTripDate, requestedTimeSlot);
                  const countdownSummary = buildMiniAppBuyerCountdownSummary(
                    item?.hold_status_summary?.hold_expires_at_summary?.iso,
                    nowMs
                  );
                  const buyerTicketCode = resolveBuyerTicketCode(
                    item?.buyer_ticket_reference_summary
                  );

                  return (
                    <li
                      key={`my-ticket-${bookingRequestId || index}`}
                      className="tg-mini-app__list-card tg-mini-app__list-card--ticket"
                      data-testid="telegram-mini-app-ticket-list-item"
                      data-availability-state={availability}
                    >
                      <div
                        className={clsx(
                          'tg-mini-app__list-card-main',
                          pendingPrepaymentFlow && 'tg-mini-app__list-card-main--buyer-flow-clean'
                        )}
                      >
                        {pendingPrepaymentFlow ? (
                          <>
                            <div className="tg-mini-app__list-card-status">
                              <MiniAppPill tone={presentation.statusTone}>
                                {presentation.statusLabel}
                              </MiniAppPill>
                            </div>
                            <div className="tg-mini-app__meta-grid tg-mini-app__meta-grid--buyer-flow-clean">
                              <MiniAppMetaItem
                                label="Осталось времени"
                                value={countdownSummary.valueLabel}
                                tone={countdownSummary.tone}
                                className="tg-mini-app__meta-item--centered"
                              />
                              <MiniAppMetaItem
                                label="Дата и время"
                                value={dateTimeLabel}
                                className="tg-mini-app__meta-item--centered"
                              />
                              <MiniAppMetaItem
                                label="Пассажиры"
                                value={formatMiniAppSeatCountLabel(requestedSeats)}
                                className="tg-mini-app__meta-item--centered"
                              />
                            </div>
                          </>
                        ) : (
                          <>
                            <div className="tg-mini-app__list-card-topline">
                              <MiniAppPill tone={presentation.availabilityTone}>
                                {presentation.availabilityLabel}
                              </MiniAppPill>
                              {buyerTicketCode && (
                                <div className="tg-mini-app__list-card-reference">
                                  {formatBuyerTicketReferenceTopline(
                                    item?.buyer_ticket_reference_summary
                                  )}
                                </div>
                              )}
                            </div>
                            <div className="tg-mini-app__list-card-header">
                              <div>
                                <h3 className="tg-mini-app__list-title">{presentation.cardTitle}</h3>
                                <p className="tg-mini-app__list-subtitle">{dateTimeLabel}</p>
                                <p className="tg-mini-app__list-state-copy">
                                  {presentation.description}
                                </p>
                              </div>
                              <MiniAppPill tone={presentation.statusTone}>
                                {presentation.statusLabel}
                              </MiniAppPill>
                            </div>
                            <div className="tg-mini-app__meta-grid">
                              <MiniAppMetaItem
                                label="Пассажиры"
                                value={formatMiniAppSeatCountLabel(requestedSeats)}
                              />
                              <MiniAppMetaItem
                                label="Бронь"
                                value={presentation.holdStatusLabel}
                                tone={presentation.holdTone}
                              />
                              <MiniAppMetaItem
                                label="Предоплата"
                                value={presentation.prepaymentStatusLabel}
                                tone={presentation.prepaymentTone}
                              />
                              <MiniAppMetaItem
                                label="Билет"
                                value={presentation.ticketStatusLabel}
                                tone={presentation.ticketTone}
                              />
                              <MiniAppMetaItem
                                label="Следующий шаг"
                                value={presentation.nextActionLabel}
                                tone={presentation.nextActionTone}
                              />
                            </div>
                          </>
                        )}
                      </div>
                      <div className="tg-mini-app__list-card-actions">
                        <div className="tg-mini-app__button-stack">
                          <button
                            type="button"
                            className={
                              pendingPrepaymentFlow
                                ? 'tg-mini-app__button tg-mini-app__button--ghost'
                                : 'tg-mini-app__button tg-mini-app__button--secondary'
                            }
                            onClick={() => openTicketView(item)}
                            disabled={!canOpen}
                          >
                            {pendingPrepaymentFlow ? 'Открыть заявку' : presentation.actionLabel}
                          </button>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
            {!ticketsState.loading && !ticketsState.error && ticketsState.items.length === 0 && (
              <MiniAppEmptyState
                title="Заявок и билетов пока нет"
                description="После бронирования заявка и билет будут появляться здесь."
              />
            )}
          </section>
        )}

        {activeSection === 'ticket_view' && (
          <section
            className="tg-mini-app__panel tg-mini-app__panel--ticket-view"
            data-testid="telegram-mini-app-ticket-view"
          >
            <MiniAppSectionHeader
              eyebrow={ticketDetailPendingPrepaymentFlow ? null : ticketDetailPresentation.entityLabel}
              title={
                ticketDetailPendingPrepaymentFlow
                  ? ticketDetailPresentation.statusLabel
                  : ticketDetailPresentation.detailTitle
              }
              description={
                ticketDetailPendingPrepaymentFlow
                  ? null
                  : ticketDetailPresentation.detailDescription
              }
              aside={
                ticketDetailPendingPrepaymentFlow ? null : (
                  <MiniAppPill tone={ticketDetailPresentation.statusTone}>
                    {ticketDetailPresentation.statusLabel}
                  </MiniAppPill>
                )
              }
            />
            {ticketDetailState.loading && (
              <p className="tg-mini-app__hint">Загружаем детали билета...</p>
            )}
            {!ticketDetailState.loading && ticketDetailState.error && (
              <p className="tg-mini-app__error">{ticketDetailState.error}</p>
            )}
            {!ticketDetailState.loading &&
              !ticketDetailState.error &&
              ticketDetailViewModel.renderState === 'empty' && (
                <MiniAppEmptyState
                  title="Билет не выбран"
                  description="Откройте билет из списка, чтобы посмотреть его детали."
                />
              )}
            {!ticketDetailState.loading &&
              !ticketDetailState.error &&
              ticketDetailViewModel.renderState !== 'empty' && (
                <>
                  {ticketDetailPendingPrepaymentFlow ? (
                    <div className="tg-mini-app__ticket-view-stack tg-mini-app__ticket-view-stack--pending">
                      <div className="tg-mini-app__subpanel tg-mini-app__subpanel--buyer-flow">
                        <div className="tg-mini-app__buyer-flow-head">
                          <div>
                            <p className="tg-mini-app__section-eyebrow">Что делать сейчас</p>
                            <h3 className="tg-mini-app__subpanel-title">
                              {BUYER_PENDING_FLOW_TITLE}
                            </h3>
                          </div>
                        </div>
                        <MiniAppBuyerFlowSteps />
                        {ticketDetailSellerContact && (
                          <div className="tg-mini-app__meta-grid tg-mini-app__meta-grid--buyer-flow">
                            {ticketDetailSellerContact.sellerName && (
                              <MiniAppMetaItem
                                label="Продавец"
                                value={ticketDetailSellerContact.sellerName}
                                tone="accent"
                              />
                            )}
                            {ticketDetailSellerContact.sellerPhone && (
                              <MiniAppSellerPhoneMetaItem
                                phone={ticketDetailSellerContact.sellerPhone}
                                actionTestId="telegram-mini-app-ticket-view-copy-seller"
                                feedbackTestId="telegram-mini-app-ticket-view-copy-feedback"
                              />
                            )}
                          </div>
                        )}
                      </div>

                      <div className="tg-mini-app__subpanel">
                        <h3 className="tg-mini-app__subpanel-title">Срок брони</h3>
                        <div className="tg-mini-app__info-grid">
                          <MiniAppInfoCard
                            label={
                              ticketDetailViewModel.holdExpiresAtIso
                                ? 'Бронь действует до'
                                : 'Срок брони'
                            }
                            value={
                              formatMiniAppHoldDeadlineLabel(
                                ticketDetailViewModel.holdExpiresAtIso
                              ) || '15 минут'
                            }
                            tone={ticketDetailCountdownSummary.tone}
                          />
                        </div>
                      </div>

                      <div className="tg-mini-app__subpanel tg-mini-app__subpanel--hero">
                        <div className="tg-mini-app__ticket-headline">
                          <div>
                            <p className="tg-mini-app__section-eyebrow">Рейс</p>
                            <h3 className="tg-mini-app__section-title">
                              {formatDateTimeLabel(
                                ticketDetailViewModel.requestedTripDate,
                                ticketDetailViewModel.requestedTimeSlot
                              )}
                            </h3>
                          </div>
                          <div className="tg-mini-app__hero-pills tg-mini-app__hero-pills--detail">
                            <MiniAppPill tone={ticketDetailPresentation.statusTone}>
                              {ticketDetailPresentation.statusLabel}
                            </MiniAppPill>
                          </div>
                        </div>
                        <div className="tg-mini-app__meta-grid">
                          <MiniAppMetaItem
                            label="Пассажиры"
                            value={formatMiniAppSeatCountLabel(ticketDetailViewModel.requestedSeats)}
                          />
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="tg-mini-app__ticket-view-stack">
                      <div className="tg-mini-app__subpanel tg-mini-app__subpanel--hero">
                        <div className="tg-mini-app__ticket-headline">
                          <div>
                            <p className="tg-mini-app__section-eyebrow">Статус заявки</p>
                            <h3 className="tg-mini-app__section-title">
                              {formatDateTimeLabel(
                                ticketDetailViewModel.requestedTripDate,
                                ticketDetailViewModel.requestedTimeSlot
                              )}
                            </h3>
                            {ticketDetailViewModel.buyerTicketCode && (
                              <p className="tg-mini-app__ticket-reference">
                                Код билета {ticketDetailViewModel.buyerTicketCode}
                              </p>
                            )}
                            <p className="tg-mini-app__note">
                              {ticketDetailPresentation.nextActionLabel}
                            </p>
                          </div>
                          <div className="tg-mini-app__hero-pills">
                            <MiniAppPill tone={ticketDetailPresentation.holdTone}>
                              {ticketDetailPresentation.holdStatusLabel}
                            </MiniAppPill>
                            <MiniAppPill tone={ticketDetailPresentation.prepaymentTone}>
                              {ticketDetailPresentation.prepaymentStatusLabel}
                            </MiniAppPill>
                            <MiniAppPill tone={ticketDetailPresentation.ticketTone}>
                              {ticketDetailPresentation.ticketStatusLabel}
                            </MiniAppPill>
                          </div>
                        </div>
                        <div className="tg-mini-app__meta-grid">
                          {ticketDetailViewModel.buyerTicketCode && (
                            <MiniAppMetaItem
                              label="Код билета"
                              value={ticketDetailViewModel.buyerTicketCode}
                              tone="accent"
                            />
                          )}
                          <MiniAppMetaItem
                            label="Пассажиры"
                            value={formatMiniAppSeatCountLabel(ticketDetailViewModel.requestedSeats)}
                          />
                          <MiniAppMetaItem
                            label="Бронь"
                            value={ticketDetailPresentation.holdStatusLabel}
                            tone={ticketDetailPresentation.holdTone}
                          />
                          <MiniAppMetaItem
                            label="Предоплата"
                            value={ticketDetailPresentation.prepaymentStatusLabel}
                            tone={ticketDetailPresentation.prepaymentTone}
                          />
                          <MiniAppMetaItem
                            label="Билет"
                            value={ticketDetailPresentation.ticketStatusLabel}
                            tone={ticketDetailPresentation.ticketTone}
                          />
                          <MiniAppMetaItem
                            label="Оформлено билетов"
                            value={ticketDetailViewModel.linkedTicketCount ?? 'н/д'}
                          />
                          {ticketDetailViewModel.offlineReferenceCode && (
                            <MiniAppMetaItem
                              label="Офлайн-код"
                              value={ticketDetailViewModel.offlineReferenceCode}
                              tone="accent"
                            />
                          )}
                        </div>
                      </div>
                    </div>
                  )}

                  {ticketDetailViewModel.hasBoardingQr && (
                    <MiniAppBoardingQrCard
                      buyerTicketCode={ticketDetailViewModel.buyerTicketCode}
                      qrPayloadText={ticketDetailViewModel.boardingQrPayloadText}
                    />
                  )}

                  {!ticketDetailPendingPrepaymentFlow && ticketDetailViewModel.paymentSummary && (
                    <div className="tg-mini-app__subpanel">
                      <h3 className="tg-mini-app__subpanel-title">Оплата</h3>
                      <div className="tg-mini-app__info-grid">
                        <MiniAppInfoCard
                          label="Оплачено / предоплата"
                          value={formatMoney(
                            ticketDetailViewModel.paymentSummary.prepayment_amount,
                            ticketDetailViewModel.paymentSummary.currency
                          )}
                          tone="accent"
                        />
                        <MiniAppInfoCard
                          label="Итого"
                          value={formatMoney(
                            ticketDetailViewModel.paymentSummary.total_price,
                            ticketDetailViewModel.paymentSummary.currency
                          )}
                        />
                        <MiniAppInfoCard
                          label="Осталось"
                          value={formatMoney(
                            ticketDetailViewModel.paymentSummary.remaining_payment_amount,
                            ticketDetailViewModel.paymentSummary.currency
                          )}
                          tone="warning"
                        />
                      </div>
                    </div>
                  )}

                  {!ticketDetailPendingPrepaymentFlow && ticketDetailViewModel.contactPhone && (
                    <div className="tg-mini-app__subpanel tg-mini-app__subpanel--contact">
                      <span className="tg-mini-app__section-eyebrow">Контакт</span>
                      <a
                        className="tg-mini-app__link tg-mini-app__link--phone"
                        href={ticketDetailViewModel.contactCallHref}
                      >
                        {ticketDetailViewModel.contactPhone}
                      </a>
                    </div>
                  )}
                  {ticketDetailViewModel.fallbackUsed && (
                    <p className="tg-mini-app__hint">
                      Для этого билета используется офлайн-снимок.
                    </p>
                  )}
                  {ticketDetailState.ticketViewErrorMessage && (
                    <p className="tg-mini-app__hint">
                      Причина перехода на офлайн-снимок:{' '}
                      {ticketDetailState.ticketViewErrorMessage}
                    </p>
                  )}
                </>
              )}
            <div className="tg-mini-app__panel-actions tg-mini-app__panel-actions--ticket-view">
              <button
                type="button"
                className="tg-mini-app__button tg-mini-app__button--ghost"
                onClick={() => setActiveSection('my_tickets')}
              >
                Назад к моим заявкам
              </button>
              {ticketDetailCanOpenSavedCopy && (
                <button
                  type="button"
                  className="tg-mini-app__button tg-mini-app__button--secondary"
                  onClick={loadOfflineSnapshotForSelectedTicket}
                  disabled={ticketDetailState.loading}
                >
                  Открыть сохранённую копию
                </button>
              )}
            </div>
          </section>
        )}

        {activeSection === 'useful_content' && (
          <section className="tg-mini-app__panel">
            <MiniAppSectionHeader
              eyebrow="Полезное"
              title={usefulContentViewModel.title}
              description={usefulContentViewModel.body}
              aside={
                <MiniAppPill tone="accent">
                  Погода: {formatStateLabel(usefulContentViewModel.weatherDataState)}
                </MiniAppPill>
              }
            />
            {usefulContentViewModel.renderState === 'loading' && (
              <p className="tg-mini-app__hint">Загружаем полезную информацию...</p>
            )}
            {usefulContentViewModel.renderState === 'error' && (
              <p className="tg-mini-app__error">
                {usefulContentViewModel.errorMessage}
              </p>
            )}
            <div className="tg-mini-app__info-grid">
              <MiniAppInfoCard
                label="Применимость"
                value={formatStateLabel(usefulContentViewModel.tripApplicabilityState)}
              />
              <MiniAppInfoCard
                label="Резервный режим"
                value={usefulContentViewModel.fallbackUsed ? 'Включён' : 'Не используется'}
                tone={usefulContentViewModel.fallbackUsed ? 'warning' : 'success'}
              />
            </div>
            {usefulContentViewModel.reminderStatusLine && (
              <p className="tg-mini-app__hint">
                {usefulContentViewModel.reminderStatusLine}
              </p>
            )}
            {usefulContentViewModel.recommendationLines.length > 0 && (
              <ul className="tg-mini-app__detail-list">
                {usefulContentViewModel.recommendationLines.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            )}
            {usefulContentViewModel.hasUsefulItems && (
              <ul className="tg-mini-app__list">
                {usefulContentViewModel.feedItems.map((item) => (
                  <li
                    key={item.contentReference}
                    className="tg-mini-app__list-card tg-mini-app__list-card--compact"
                  >
                    <div className="tg-mini-app__list-card-main">
                      <div className="tg-mini-app__list-card-header">
                        <div>
                          <h3 className="tg-mini-app__list-title">{item.title}</h3>
                          <p className="tg-mini-app__list-subtitle">{item.shortText}</p>
                        </div>
                        <MiniAppPill tone="neutral">
                          {formatStateLabel(item.contentGrouping)}
                        </MiniAppPill>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {!usefulContentViewModel.hasUsefulItems && (
              <MiniAppEmptyState
                title="Полезной информации пока нет"
                description="Сейчас для этого контекста покупателя нет доступных полезных материалов."
              />
            )}
          </section>
        )}

        {activeSection === 'faq' && (
          <section className="tg-mini-app__panel">
            <MiniAppSectionHeader
              eyebrow="Вопросы"
              title={faqViewModel.title}
              description={faqViewModel.body}
              aside={
                <MiniAppPill tone="neutral">
                  {faqViewModel.questionCount} вопросов
                </MiniAppPill>
              }
            />
            {faqViewModel.renderState === 'loading' && (
              <p className="tg-mini-app__hint">Загружаем вопросы...</p>
            )}
            {faqViewModel.renderState === 'error' && (
              <p className="tg-mini-app__error">{faqViewModel.errorMessage}</p>
            )}
            {faqViewModel.hasFaqItems && (
              <ul className="tg-mini-app__list">
                {faqViewModel.faqItems.map((item) => (
                  <li
                    key={item.faqReference}
                    className="tg-mini-app__list-card tg-mini-app__list-card--compact"
                  >
                    <div className="tg-mini-app__list-card-main">
                      <div className="tg-mini-app__list-card-header">
                        <div>
                          <h3 className="tg-mini-app__list-title">{item.title}</h3>
                          <p className="tg-mini-app__list-subtitle">{item.shortText}</p>
                        </div>
                        <MiniAppPill tone="neutral">
                          {formatStateLabel(item.contentGrouping)}
                        </MiniAppPill>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {!faqViewModel.hasFaqItems && (
              <MiniAppEmptyState
                title="Раздел с вопросами пока пуст"
                description="Сейчас для этого контекста покупателя нет доступных материалов с вопросами и ответами."
              />
            )}
            {faqViewModel.fallbackUsed && (
              <p className="tg-mini-app__hint">РСЃРїРѕР»СЊР·СѓРµС‚СЃСЏ резервный раздел с вопросами.</p>
            )}
          </section>
        )}

        {activeSection === 'contact' && (
          <section className="tg-mini-app__panel">
            <MiniAppSectionHeader
              eyebrow="Связь"
              title={contactViewModel.title}
              description={contactViewModel.body}
              aside={
                <MiniAppPill tone="accent">
                  {formatStateLabel(contactViewModel.applicabilityState)}
                </MiniAppPill>
              }
            />
            {contactViewModel.renderState === 'loading' && (
              <p className="tg-mini-app__hint">Загружаем контакты...</p>
            )}
            {contactViewModel.renderState === 'error' && (
              <p className="tg-mini-app__error">{contactViewModel.errorMessage}</p>
            )}
            {contactViewModel.contactPhone ? (
              <p className="tg-mini-app__note">
                Телефон для связи:{' '}
                <a className="tg-mini-app__link" href={contactViewModel.contactCallHref}>
                  {contactViewModel.contactPhone}
                </a>
              </p>
            ) : (
              <p className="tg-mini-app__hint">
                Для текущего контекста нет доступного контактного телефона.
              </p>
            )}
            {contactViewModel.hasSupportItems && (
              <ul className="tg-mini-app__list">
                {contactViewModel.supportItems.map((item) => (
                  <li
                    key={item.contentReference}
                    className="tg-mini-app__list-card tg-mini-app__list-card--compact"
                  >
                    <div className="tg-mini-app__list-card-main">
                      <div className="tg-mini-app__list-card-header">
                        <div>
                          <h3 className="tg-mini-app__list-title">{item.title}</h3>
                          <p className="tg-mini-app__list-subtitle">{item.shortText}</p>
                        </div>
                        <MiniAppPill tone="neutral">
                          {formatStateLabel(item.contentGrouping)}
                        </MiniAppPill>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {!contactViewModel.hasSupportItems && (
              <MiniAppEmptyState
                title="Подсказок поддержки пока нет"
                description="Сейчас для этого контекста покупателя нет доступных подсказок поддержки."
              />
            )}
            {contactViewModel.fallbackUsed && (
              <p className="tg-mini-app__hint">
                РСЃРїРѕР»СЊР·СѓРµС‚СЃСЏ резервный контактный контент.
              </p>
            )}
          </section>
        )}

        {activeSection !== 'catalog' &&
          activeSection !== 'my_tickets' &&
          activeSection !== 'useful_content' &&
          activeSection !== 'faq' &&
          activeSection !== 'contact' &&
          activeSection !== 'ticket_view' &&
          activeSection !== 'trip_card' &&
          activeSection !== 'booking_form' &&
          activeSection !== 'result' && (
            <section className="tg-mini-app__panel">
              <MiniAppSectionHeader
                eyebrow="Раздел"
                title={placeholderContent.title}
                description={placeholderContent.body}
                aside={
                  placeholderContent.fallback_used ? (
                    <MiniAppPill tone="warning">Резерв</MiniAppPill>
                  ) : null
                }
              />
            </section>
          )}
      </div>
    </div>
  );
}
