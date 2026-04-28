import clsx from 'clsx';
import QRCode from 'qrcode';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
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
  fetchMiniAppTicketViewByCanonicalPresale,
  fetchMiniAppTripCard,
  submitMiniAppBookingRequest,
} from './mini-app-api.js';
import {
  buildMiniAppContactViewModel,
  buildMiniAppFaqViewModel,
} from './faq-contact-view-model.js';
import { buildMiniAppHoldResultViewModel } from './hold-result-view-model.js';
import {
  formatMiniAppBusinessHoldDeadlineLabel,
  normalizeMiniAppHoldExpiresAtIso,
} from './hold-deadline-format.js';
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
import buyerBoardingReferenceImage from './assets/buyer-boarding-reference.png';

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
});
const BUYER_BOARDING_DESTINATION_SEAM = Object.freeze({
  sourceMapsShortUrl: 'https://maps.app.goo.gl/RhLswd6CSBT8GApt9',
  latitude: 44.358359,
  longitude: 38.525406,
});
const BUYER_BOARDING_REFERENCE_IMAGE_SEAM = buyerBoardingReferenceImage;
const BUYER_BOARDING_GUIDE_TEXT_SEAM =
  'Ориентир: точка посадки у устья реки Вулан.';
const BUYER_BOARDING_DESTINATION_LABEL = [
  BUYER_BOARDING_DESTINATION_SEAM.latitude,
  BUYER_BOARDING_DESTINATION_SEAM.longitude,
].join(',');
const BUYER_BOARDING_MAP_LINKS = Object.freeze({
  yandex: `https://yandex.ru/maps/?rtext=~${BUYER_BOARDING_DESTINATION_LABEL}&rtt=auto`,
  google: `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(
    BUYER_BOARDING_DESTINATION_LABEL
  )}`,
  apple: `https://maps.apple.com/?daddr=${encodeURIComponent(BUYER_BOARDING_DESTINATION_LABEL)}&dirflg=d`,
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

function readInitialCanonicalPresaleId() {
  const value = Number(readQueryParam('canonical_presale_id'));
  return Number.isInteger(value) && value > 0 ? value : null;
}

function readInitialBuyerTicketCode() {
  return normalizeString(readQueryParam('buyer_ticket_code'));
}

function readInitialSourceToken() {
  return normalizeString(readQueryParam('source_token'));
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

function parseBuyerTripLocalStartMs(item) {
  const requestedTripDate = normalizeString(item?.date_time_summary?.requested_trip_date);
  const requestedTimeSlot = normalizeString(item?.date_time_summary?.requested_time_slot);
  if (!requestedTripDate || !requestedTimeSlot) {
    return null;
  }

  const parsedMs = Date.parse(`${requestedTripDate}T${requestedTimeSlot}:00`);
  return Number.isFinite(parsedMs) ? parsedMs : null;
}

export function isBuyerCatalogItemUpcoming(item, nowMs = Date.now()) {
  const tripStartMs = parseBuyerTripLocalStartMs(item);
  if (tripStartMs === null) {
    return true;
  }
  return tripStartMs > Number(nowMs);
}

export function filterBuyerCatalogItems(items, selectedTripType = 'all', nowMs = Date.now()) {
  const resolvedTripType = resolveBuyerCatalogTripTypeFilter(selectedTripType);
  if (!Array.isArray(items) || items.length === 0) {
    return [];
  }

  return items.filter((item) => {
    if (!isBuyerVisibleCatalogItem(item)) {
      return false;
    }
    if (!isBuyerCatalogItemUpcoming(item, nowMs)) {
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
      message: 'Имя должно содержать минимум 2 символа.',
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
function formatUsefulTemperature(value) {
  const normalized = Number(value);
  if (!Number.isFinite(normalized)) {
    return '—';
  }
  const rounded = Math.round(normalized * 10) / 10;
  return `${rounded.toLocaleString('ru-RU')}°C`;
}

function formatUsefulSunsetTime({
  sunsetTimeIso = null,
  sunsetTimeLocal = null,
} = {}) {
  const normalizedIso = normalizeString(sunsetTimeIso);
  if (normalizedIso) {
    const parsed = new Date(normalizedIso);
    if (!Number.isNaN(parsed.getTime())) {
      return new Intl.DateTimeFormat('ru-RU', {
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
        timeZone: 'Europe/Moscow',
      }).format(parsed);
    }
  }

  const normalizedLocal = normalizeString(sunsetTimeLocal);
  if (!normalizedLocal) {
    return '—';
  }
  const match = normalizedLocal.match(/(\d{2}:\d{2})/);
  return match ? match[1] : normalizedLocal;
}

function formatUsefulConditionLabel({
  conditionLabel = null,
  weatherDataState = null,
} = {}) {
  const normalizedCondition = normalizeString(conditionLabel);
  if (normalizedCondition) {
    return normalizedCondition;
  }
  return weatherDataState === 'unavailable'
    ? MINI_APP_WEATHER_UNAVAILABLE_MESSAGE
    : 'Без описания';
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

export function findMiniAppTicketItemByBookingRequestId(items, bookingRequestId) {
  const normalizedBookingRequestId = Number(bookingRequestId);
  if (!Number.isInteger(normalizedBookingRequestId) || normalizedBookingRequestId <= 0) {
    return null;
  }

  const ticketItems = Array.isArray(items) ? items : [];
  return (
    ticketItems.find(
      (item) =>
        readBookingRequestId(item?.booking_request_reference) === normalizedBookingRequestId
    ) || null
  );
}

function resolveMiniAppFriendlyLoadErrorMessage(
  error,
  fallbackMessage = 'Не удалось загрузить данные. Попробуйте обновить.'
) {
  const fallback =
    normalizeString(fallbackMessage) || 'Не удалось загрузить данные. Попробуйте обновить.';
  const rawMessage = normalizeString(error?.message);
  if (!rawMessage) {
    return fallback;
  }

  const lowered = rawMessage.toLowerCase();
  if (
    lowered.includes('timeout') ||
    lowered.includes('timed out') ||
    lowered.includes('networkerror') ||
    lowered.includes('network error') ||
    lowered.includes('failed to fetch') ||
    lowered.includes('aborterror')
  ) {
    return fallback;
  }

  return rawMessage;
}

export function buildMiniAppTicketDetailSeedState({
  ticketItem = null,
  bookingRequestId = null,
} = {}) {
  const normalizedBookingRequestId = Number(bookingRequestId);
  if (!Number.isInteger(normalizedBookingRequestId) || normalizedBookingRequestId <= 0) {
    return null;
  }

  if (!ticketItem || typeof ticketItem !== 'object') {
    return null;
  }

  const projectionBookingRequestId = readBookingRequestId(ticketItem?.booking_request_reference);
  if (projectionBookingRequestId !== normalizedBookingRequestId) {
    return null;
  }

  return {
    loading: false,
    error: null,
    selectedBookingRequestId: normalizedBookingRequestId,
    ticketView: ticketItem,
    offlineSnapshot: null,
    fallbackUsed: false,
    ticketViewErrorMessage: null,
  };
}

export function resolveMiniAppCanonicalHoldExpiresAtIso({
  bookingRequestId,
  ticketItems = [],
  fallbackHoldExpiresAtIso = null,
}) {
  const ticketItem = findMiniAppTicketItemByBookingRequestId(ticketItems, bookingRequestId);
  const canonicalHoldExpiresAtIso = normalizeString(
    ticketItem?.hold_status_summary?.hold_expires_at_summary?.iso
  );
  return (
    normalizeMiniAppHoldExpiresAtIso(canonicalHoldExpiresAtIso) ||
    normalizeMiniAppHoldExpiresAtIso(fallbackHoldExpiresAtIso)
  );
}

export function buildMiniAppPolledTicketDetailState({
  previousState,
  selectedBookingRequestId,
  refreshedTicketView = null,
  ticketItems = [],
  hasRefreshFailure = false,
  refreshFailureMessage = 'Не удалось загрузить данные. Попробуйте обновить.',
}) {
  const normalizedSelectedBookingRequestId = Number(selectedBookingRequestId);
  if (
    !Number.isInteger(normalizedSelectedBookingRequestId) ||
    normalizedSelectedBookingRequestId <= 0
  ) {
    return previousState;
  }

  if (
    Number(previousState?.selectedBookingRequestId) !==
    normalizedSelectedBookingRequestId
  ) {
    return previousState;
  }

  const listProjection = findMiniAppTicketItemByBookingRequestId(
    ticketItems,
    normalizedSelectedBookingRequestId
  );
  if (listProjection) {
    return {
      loading: false,
      error: null,
      selectedBookingRequestId: normalizedSelectedBookingRequestId,
      ticketView: listProjection,
      offlineSnapshot: null,
      fallbackUsed: false,
      ticketViewErrorMessage: null,
    };
  }

  if (refreshedTicketView) {
    return {
      loading: false,
      error: null,
      selectedBookingRequestId: normalizedSelectedBookingRequestId,
      ticketView: refreshedTicketView.ticketView,
      offlineSnapshot: refreshedTicketView.offlineSnapshot,
      fallbackUsed: refreshedTicketView.fallbackUsed,
      ticketViewErrorMessage: refreshedTicketView.ticketViewErrorMessage,
    };
  }

  if (hasRefreshFailure && previousState?.loading) {
    return {
      loading: false,
      error:
        normalizeString(refreshFailureMessage) ||
        'Не удалось загрузить данные. Попробуйте обновить.',
      selectedBookingRequestId: normalizedSelectedBookingRequestId,
      ticketView: previousState?.ticketView || null,
      offlineSnapshot: previousState?.offlineSnapshot || null,
      fallbackUsed: Boolean(previousState?.fallbackUsed),
      ticketViewErrorMessage: normalizeString(previousState?.ticketViewErrorMessage),
    };
  }

  return previousState;
}

export function shouldShowMiniAppCurrentTicketContext({
  hasCurrentTicketContext,
  selectedBookingRequestId,
  ticketItems = [],
}) {
  if (!hasCurrentTicketContext) {
    return false;
  }

  const normalizedSelectedBookingRequestId = Number(selectedBookingRequestId);
  if (
    !Number.isInteger(normalizedSelectedBookingRequestId) ||
    normalizedSelectedBookingRequestId <= 0
  ) {
    return true;
  }

  return !findMiniAppTicketItemByBookingRequestId(
    ticketItems,
    normalizedSelectedBookingRequestId
  );
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
  const normalized = normalizeMiniAppHoldExpiresAtIso(value);
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

export function formatMiniAppHoldDeadlineLabel(isoValue) {
  return formatMiniAppBusinessHoldDeadlineLabel(isoValue);
}

export function buildMiniAppBuyerCountdownSummary(holdExpiresAtIso, nowMs = Date.now()) {
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
      className="tg-mini-app__subpanel tg-mini-app__subpanel--boarding-qr tg-mini-app__subpanel--ticket-centered"
      data-testid="telegram-mini-app-ticket-qr"
    >
      <div className="tg-mini-app__boarding-qr-head">
        <div>
          <p className="tg-mini-app__section-eyebrow">Посадка</p>
          <p className="tg-mini-app__note">
            Покажите этот QR диспетчеру при посадке на рейс.
          </p>
          {normalizedBuyerTicketCode ? (
            <p className="tg-mini-app__ticket-reference">
              Номер билета {normalizedBuyerTicketCode}
            </p>
          ) : null}
        </div>
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

export function buildMiniAppPostCreateActiveRequestDeadlineViewModel({
  bookingRequestId,
  ticketItems = [],
  submitHoldExpiresAtIso = null,
  nowMs = Date.now(),
}) {
  const ticketItem = findMiniAppTicketItemByBookingRequestId(
    ticketItems,
    bookingRequestId
  );
  const rawTicketHoldExpiresAtIso = normalizeString(
    ticketItem?.hold_status_summary?.hold_expires_at_summary?.iso
  );
  const rawSubmitHoldExpiresAtIso = normalizeString(submitHoldExpiresAtIso);
  const rawHoldExpiresAtIso = rawTicketHoldExpiresAtIso || rawSubmitHoldExpiresAtIso;
  const holdExpiresAtIso = resolveMiniAppCanonicalHoldExpiresAtIso({
    bookingRequestId,
    ticketItems,
    fallbackHoldExpiresAtIso: rawSubmitHoldExpiresAtIso,
  });

  return Object.freeze({
    rawHoldExpiresAtIso,
    rawTicketHoldExpiresAtIso,
    rawSubmitHoldExpiresAtIso,
    holdExpiresAtIso,
    holdDeadlineLabel: formatMiniAppHoldDeadlineLabel(holdExpiresAtIso),
    countdownSummary: buildMiniAppBuyerCountdownSummary(holdExpiresAtIso, nowMs),
  });
}

function MiniAppHowToGetThereCard({
  collapsible = true,
  testId = 'telegram-mini-app-ticket-how-to-get',
}) {
  const [isImageLightboxOpen, setIsImageLightboxOpen] = useState(false);
  const lightboxContentRef = useRef(null);

  useEffect(() => {
    if (typeof Image === 'undefined') {
      return;
    }
    const preloadImage = new Image();
    preloadImage.decoding = 'async';
    preloadImage.src = BUYER_BOARDING_REFERENCE_IMAGE_SEAM;
    if (typeof preloadImage.decode === 'function') {
      preloadImage.decode().catch(() => {});
    }
  }, []);

  useEffect(() => {
    if (!isImageLightboxOpen || typeof window === 'undefined') {
      return undefined;
    }
    const scrollY = window.scrollY || window.pageYOffset || 0;
    const bodyStyle = document.body.style;
    const previousOverflow = bodyStyle.overflow;
    const previousPosition = bodyStyle.position;
    const previousTop = bodyStyle.top;
    const previousWidth = bodyStyle.width;

    bodyStyle.overflow = 'hidden';
    bodyStyle.position = 'fixed';
    bodyStyle.top = `-${scrollY}px`;
    bodyStyle.width = '100%';

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        setIsImageLightboxOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    window.requestAnimationFrame(() => {
      lightboxContentRef.current?.focus();
    });
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      bodyStyle.overflow = previousOverflow;
      bodyStyle.position = previousPosition;
      bodyStyle.top = previousTop;
      bodyStyle.width = previousWidth;
      window.scrollTo(0, scrollY);
    };
  }, [isImageLightboxOpen]);

  const contentClassName = clsx(
    'tg-mini-app__how-to-get-content',
    !collapsible && 'tg-mini-app__how-to-get-content--standalone'
  );

  const howToGetContent = (
    <div className={contentClassName}>
      <button
        type="button"
        className="tg-mini-app__how-to-get-image-button"
        onClick={() => setIsImageLightboxOpen(true)}
        aria-label="Открыть изображение карты на весь экран"
      >
        <img
          className="tg-mini-app__how-to-get-image"
          src={BUYER_BOARDING_REFERENCE_IMAGE_SEAM}
          alt="Точка посадки на карте"
          loading="eager"
          decoding="async"
          fetchPriority="high"
          width="2048"
          height="725"
        />
      </button>
      <p className="tg-mini-app__note tg-mini-app__how-to-get-note">{BUYER_BOARDING_GUIDE_TEXT_SEAM}</p>
      <div className="tg-mini-app__how-to-get-actions">
        <a
          className="tg-mini-app__button tg-mini-app__button--secondary tg-mini-app__how-to-get-link"
          href={BUYER_BOARDING_MAP_LINKS.yandex}
          target="_blank"
          rel="noreferrer noopener"
        >
          Открыть в Яндекс Картах
        </a>
        <a
          className="tg-mini-app__button tg-mini-app__button--secondary tg-mini-app__how-to-get-link"
          href={BUYER_BOARDING_MAP_LINKS.google}
          target="_blank"
          rel="noreferrer noopener"
        >
          Открыть в Google Maps
        </a>
        <a
          className="tg-mini-app__button tg-mini-app__button--secondary tg-mini-app__how-to-get-link"
          href={BUYER_BOARDING_MAP_LINKS.apple}
          target="_blank"
          rel="noreferrer noopener"
        >
          Открыть в Apple Maps
        </a>
      </div>
    </div>
  );

  return (
    <>
      {collapsible ? (
        <details
          className="tg-mini-app__subpanel tg-mini-app__subpanel--how-to-get tg-mini-app__subpanel--ticket-centered"
          data-testid={testId}
        >
          <summary className="tg-mini-app__how-to-get-summary">
            <div className="tg-mini-app__how-to-get-head">
              <h3 className="tg-mini-app__subpanel-title">Как добраться</h3>
              <p className="tg-mini-app__how-to-get-hint">
                Нажмите на изображение, чтобы увеличить
              </p>
            </div>
            <span className="tg-mini-app__how-to-get-trigger">Открыть</span>
          </summary>
          {howToGetContent}
        </details>
      ) : (
        <div
          className="tg-mini-app__subpanel tg-mini-app__subpanel--how-to-get tg-mini-app__subpanel--how-to-get-standalone tg-mini-app__subpanel--ticket-centered"
          data-testid={testId}
        >
          <h3 className="tg-mini-app__subpanel-title">Как добраться</h3>
          <p className="tg-mini-app__how-to-get-hint">
            Нажмите на изображение, чтобы увеличить
          </p>
          {howToGetContent}
        </div>
      )}
      {isImageLightboxOpen && typeof document !== 'undefined'
        ? createPortal(
            <div
              className="tg-mini-app__image-lightbox"
              role="dialog"
              aria-modal="true"
              aria-label="Просмотр карты"
              onClick={() => setIsImageLightboxOpen(false)}
            >
              <div
                className="tg-mini-app__image-lightbox-content"
                onClick={(event) => event.stopPropagation()}
                ref={lightboxContentRef}
                tabIndex={-1}
              >
                <button
                  type="button"
                  className="tg-mini-app__image-lightbox-close"
                  onClick={() => setIsImageLightboxOpen(false)}
                  aria-label="Закрыть просмотр карты"
                >
                  ×
                </button>
                <img
                  className="tg-mini-app__image-lightbox-image"
                  src={BUYER_BOARDING_REFERENCE_IMAGE_SEAM}
                  alt="Точка посадки на карте"
                  loading="eager"
                  decoding="async"
                  fetchPriority="high"
                  width="2048"
                  height="725"
                />
              </div>
            </div>,
            document.body
          )
        : null}
    </>
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
          <strong>Duration (ms):</strong> {formatDiagnosticValue(diagnostic.durationMs)}
        </li>
        <li>
          <strong>Timed out:</strong> {formatDiagnosticFlag(diagnostic.timedOut)}
        </li>
        <li>
          <strong>Request failed:</strong> {formatDiagnosticFlag(diagnostic.requestFailed)}
        </li>
        <li>
          <strong>Retried:</strong> {formatDiagnosticFlag(diagnostic.retryAttempted)}
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
const MINI_APP_SINGLE_INSTANCE_LOCK_KEY = 'telegram_mini_app_single_instance_lock_v1';
const MINI_APP_SINGLE_INSTANCE_HEARTBEAT_MS = 1500;
const MINI_APP_SINGLE_INSTANCE_STALE_MS = 10000;
const MINI_APP_GENERIC_LOAD_ERROR = 'Не удалось загрузить данные. Попробуйте обновить.';
const MINI_APP_WEATHER_UNAVAILABLE_MESSAGE = 'Погода временно недоступна.';

function resolveMiniAppLocalStorage() {
  if (typeof window === 'undefined') {
    return null;
  }
  try {
    return window.localStorage || null;
  } catch {
    return null;
  }
}

function readMiniAppSingleInstanceLock(storage) {
  if (!storage) {
    return null;
  }
  try {
    const raw = normalizeString(storage.getItem(MINI_APP_SINGLE_INSTANCE_LOCK_KEY));
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw);
    const instanceId = normalizeString(parsed?.instance_id);
    const heartbeatAtMs = Number(parsed?.heartbeat_at_ms);
    if (
      !instanceId ||
      !Number.isInteger(Math.trunc(heartbeatAtMs)) ||
      heartbeatAtMs <= 0
    ) {
      return null;
    }
    return Object.freeze({
      instanceId,
      heartbeatAtMs: Math.trunc(heartbeatAtMs),
    });
  } catch {
    return null;
  }
}

function writeMiniAppSingleInstanceLock(storage, instanceId, heartbeatAtMs) {
  if (!storage) {
    return false;
  }
  const normalizedInstanceId = normalizeString(instanceId);
  const normalizedHeartbeatAtMs = Math.trunc(Number(heartbeatAtMs));
  if (!normalizedInstanceId || normalizedHeartbeatAtMs <= 0) {
    return false;
  }
  try {
    storage.setItem(
      MINI_APP_SINGLE_INSTANCE_LOCK_KEY,
      JSON.stringify({
        instance_id: normalizedInstanceId,
        heartbeat_at_ms: normalizedHeartbeatAtMs,
      })
    );
    return true;
  } catch {
    return false;
  }
}

function releaseMiniAppSingleInstanceLockIfOwner(storage, instanceId) {
  if (!storage) {
    return false;
  }
  const normalizedInstanceId = normalizeString(instanceId);
  if (!normalizedInstanceId) {
    return false;
  }
  const currentLock = readMiniAppSingleInstanceLock(storage);
  if (currentLock?.instanceId !== normalizedInstanceId) {
    return false;
  }
  try {
    storage.removeItem(MINI_APP_SINGLE_INSTANCE_LOCK_KEY);
    return true;
  } catch {
    return false;
  }
}

function isMiniAppSingleInstanceLockActive(lockSummary, nowMs) {
  if (!lockSummary) {
    return false;
  }
  const normalizedNowMs = Math.trunc(Number(nowMs));
  if (normalizedNowMs <= 0) {
    return false;
  }
  return normalizedNowMs - lockSummary.heartbeatAtMs < MINI_APP_SINGLE_INSTANCE_STALE_MS;
}

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
  const [initialCanonicalPresaleId] = useState(readInitialCanonicalPresaleId);
  const [initialBuyerTicketCode] = useState(readInitialBuyerTicketCode);
  const [initialSourceToken] = useState(readInitialSourceToken);
  const [initialMiniAppSection] = useState(() =>
    resolveInitialMiniAppSection(readWindowPathname())
  );
  const [deepLinkMyTicketsOpened, setDeepLinkMyTicketsOpened] = useState(false);
  const deepLinkTicketViewOpenedRef = useRef(false);
  const ticketDetailRequestSeqRef = useRef(0);
  const miniAppInstanceIdRef = useRef(
    `mini-app-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
  );
  const [miniAppInstanceMode, setMiniAppInstanceMode] = useState('pending');
  const [miniAppActiveInstanceId, setMiniAppActiveInstanceId] = useState(null);
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
  const resultSellerContact = useMemo(
    () => resolveMiniAppSellerContact(holdResultViewModel.sellerContact),
    [holdResultViewModel.sellerContact]
  );
  const lifecycleItemByBookingRequestId = useMemo(
    () => buildLifecycleItemMap(myRequestsState.readModel),
    [myRequestsState.readModel]
  );
  const resultBookingRequestId = useMemo(
    () => readBookingRequestId(submitResult?.booking_request_reference),
    [submitResult]
  );
  const resultLifecycleItem = useMemo(() => {
    return Number.isInteger(resultBookingRequestId) && resultBookingRequestId > 0
      ? lifecycleItemByBookingRequestId.get(resultBookingRequestId) || null
      : null;
  }, [resultBookingRequestId, lifecycleItemByBookingRequestId]);
  const resultTicketItem = useMemo(() => {
    if (!Number.isInteger(resultBookingRequestId) || resultBookingRequestId <= 0) {
      return null;
    }

    const ticketItems = Array.isArray(ticketsState.items) ? ticketsState.items : [];
    return (
      ticketItems.find((item) => {
        const bookingRequestId = readBookingRequestId(item?.booking_request_reference);
        return bookingRequestId === resultBookingRequestId;
      }) || null
    );
  }, [resultBookingRequestId, ticketsState.items]);
  const resultDeadlineViewModel = useMemo(
    () =>
      buildMiniAppPostCreateActiveRequestDeadlineViewModel({
        bookingRequestId: resultBookingRequestId,
        ticketItems: ticketsState.items,
        submitHoldExpiresAtIso: holdResultViewModel.holdExpiresAtIso,
        nowMs,
      }),
    [
      holdResultViewModel.holdExpiresAtIso,
      nowMs,
      resultBookingRequestId,
      ticketsState.items,
    ]
  );
  const resultHoldExpiresAtIso = resultDeadlineViewModel.holdExpiresAtIso;
  const resultCountdownSummary = useMemo(
    () => resultDeadlineViewModel.countdownSummary,
    [resultDeadlineViewModel]
  );
  const resultPresentation = useMemo(
    () =>
      resolveMiniAppBuyerTicketPresentation({
        status:
          resultTicketItem?.ticket_status_summary?.deterministic_ticket_state ||
          'request_created',
        availability: resultTicketItem?.ticket_availability_state || 'not_available_yet',
        bookingRequestId: resultBookingRequestId,
        buyerTicketCode: resolveBuyerTicketCode(resultTicketItem?.buyer_ticket_reference_summary),
        lifecycleState: resultLifecycleItem?.lifecycle_state,
        holdActive: resultLifecycleItem?.hold_active,
        requestConfirmed: resultLifecycleItem?.request_confirmed,
        requestedPrepaymentAmount: resultLifecycleItem?.requested_prepayment_amount,
        holdExpiresAtIso: resultHoldExpiresAtIso,
      }),
    [
      resultBookingRequestId,
      resultHoldExpiresAtIso,
      resultLifecycleItem,
      resultTicketItem,
    ]
  );
  const resultPendingPrepaymentFlow = useMemo(
    () =>
      isMiniAppPendingPrepaymentFlow({
        status: resultTicketItem?.ticket_status_summary?.deterministic_ticket_state || 'request_created',
        availability: resultTicketItem?.ticket_availability_state || 'not_available_yet',
        lifecycleState: resultLifecycleItem?.lifecycle_state,
      }),
    [resultLifecycleItem?.lifecycle_state, resultTicketItem]
  );
  const resultHeaderTitle =
    holdResultViewModel.isSuccess && !resultPendingPrepaymentFlow
      ? resultPresentation.statusLabel
      : holdResultViewModel.headline;
  const resultHeaderDescription =
    holdResultViewModel.isSuccess && !resultPendingPrepaymentFlow
      ? resultPresentation.description
      : holdResultViewModel.primaryText;
  const resultShowsPendingFlow =
    holdResultViewModel.isSuccess && resultPendingPrepaymentFlow;
  const resultCanOpenTicketView = Boolean(
    holdResultViewModel.isSuccess &&
      !resultPendingPrepaymentFlow &&
      Number.isInteger(resultBookingRequestId) &&
      resultBookingRequestId > 0
  );
  const resultOpenTicketTarget = resultCanOpenTicketView
    ? resultTicketItem || {
        booking_request_reference: {
          booking_request_id: resultBookingRequestId,
        },
      }
    : null;
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
        holdExpiresAtIso: resolveMiniAppCanonicalHoldExpiresAtIso({
          bookingRequestId:
            ticketDetailViewModel.bookingRequestId ??
            ticketDetailState.selectedBookingRequestId,
          ticketItems: ticketsState.items,
          fallbackHoldExpiresAtIso: ticketDetailViewModel.holdExpiresAtIso,
        }),
      }),
    [
      ticketDetailState.selectedBookingRequestId,
      ticketDetailViewModel.availability,
      ticketDetailViewModel.bookingRequestId,
      ticketDetailViewModel.buyerTicketCode,
      ticketDetailViewModel.holdExpiresAtIso,
      ticketDetailViewModel.status,
      ticketDetailLifecycleItem,
      ticketsState.items,
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
    () =>
      buildMiniAppBuyerCountdownSummary(
        resolveMiniAppCanonicalHoldExpiresAtIso({
          bookingRequestId:
            ticketDetailViewModel.bookingRequestId ??
            ticketDetailState.selectedBookingRequestId,
          ticketItems: ticketsState.items,
          fallbackHoldExpiresAtIso: ticketDetailViewModel.holdExpiresAtIso,
        }),
        nowMs
      ),
    [
      nowMs,
      ticketDetailState.selectedBookingRequestId,
      ticketDetailViewModel.bookingRequestId,
      ticketDetailViewModel.holdExpiresAtIso,
      ticketsState.items,
    ]
  );
  const ticketDetailSellerContact = useMemo(
    () =>
      resolveMiniAppSellerContact({
        sellerName: ticketDetailViewModel.sellerName,
        sellerPhone: ticketDetailViewModel.sellerPhone,
      }),
    [ticketDetailViewModel.sellerName, ticketDetailViewModel.sellerPhone]
  );
  const hasCurrentTicketContext =
    !ticketDetailState.loading &&
    !ticketDetailState.error &&
    ticketDetailViewModel.renderState !== 'empty';
  const showCurrentTicketContext = useMemo(
    () =>
      shouldShowMiniAppCurrentTicketContext({
        hasCurrentTicketContext,
        selectedBookingRequestId:
          ticketDetailViewModel.bookingRequestId ??
          ticketDetailState.selectedBookingRequestId,
        ticketItems: ticketsState.items,
      }),
    [
      hasCurrentTicketContext,
      ticketDetailState.selectedBookingRequestId,
      ticketDetailViewModel.bookingRequestId,
      ticketsState.items,
    ]
  );
  const currentTicketContextDateTimeLabel = formatDateTimeLabel(
    ticketDetailViewModel.requestedTripDate,
    ticketDetailViewModel.requestedTimeSlot
  );
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
  const contactDispatcherPhone =
    ticketDetailSellerContact?.sellerPhone || contactViewModel.contactPhone || null;
  const contactDispatcherCallHref = contactDispatcherPhone
    ? `tel:${contactDispatcherPhone}`
    : null;
  const isMiniAppDebugMode = isMiniAppApiDiagnosticsEnabled();
  const showMiniAppApiDiagnostics = isMiniAppDebugMode;
  const activeNavSection = resolveActiveNavSection(activeSection);
  const catalogDatePresets = useMemo(() => createCatalogDatePresets(), []);
  const visibleCatalogItems = useMemo(
    () => filterBuyerCatalogItems(catalogState.items, 'all', nowMs),
    [catalogState.items, nowMs]
  );
  const filteredCatalogItems = useMemo(
    () =>
      catalogTripType
        ? filterBuyerCatalogItems(catalogState.items, catalogTripType, nowMs)
        : [],
    [catalogState.items, catalogTripType, nowMs]
  );
  const catalogTypeSelectionCards = useMemo(
    () =>
      BUYER_CATALOG_TYPE_SELECTION_OPTIONS.map((selectionOption) => ({
        ...selectionOption,
        tripCount: filterBuyerCatalogItems(
          catalogState.items,
          selectionOption.key,
          nowMs
        ).length,
      })),
    [catalogState.items, nowMs]
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
  const selectedTripIsUpcoming = selectedTripCard
    ? isBuyerCatalogItemUpcoming(selectedTripCard, nowMs)
    : true;
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
    selectedTripIsUpcoming &&
    bookingRequiredFieldsFilled;
  const bookingSubmitButtonLabel = !bookingRequiredFieldsFilled
    ? 'Заполните имя и телефон'
    : bookingTicketSelection.totalSeats <= 0
      ? 'Выберите хотя бы один билет'
      : bookingCapacityExceeded
        ? 'Недостаточно мест'
        : !selectedTripIsUpcoming
          ? 'Рейс уже отправился'
          : 'Отправить заявку';

  const resolvedBookingSubmitButtonLabel =
    bookingTicketSelection.totalSeats <= 0
      ? 'Выберите хотя бы один билет'
      : bookingCapacityExceeded
        ? 'Недостаточно мест'
        : !selectedTripIsUpcoming
          ? 'Рейс уже отправился'
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
        : !selectedTripIsUpcoming
          ? 'Этот рейс уже отправился. Выберите другой рейс в каталоге.'
          : !bookingNameValidation.isValid && !bookingPhoneValidation.isValid
            ? 'Чтобы отправить заявку, укажите имя от 2 символов и телефон в формате +7XXXXXXXXXX или 8XXXXXXXXXX.'
            : !bookingNameValidation.isValid
              ? bookingNameValidation.message
              : !bookingPhoneValidation.isValid
                ? bookingPhoneValidation.message
                : null;
  const isPrimaryMiniAppInstance = miniAppInstanceMode === 'primary';

  useEffect(() => {
    const storage = resolveMiniAppLocalStorage();
    const currentInstanceId = miniAppInstanceIdRef.current;
    if (!storage) {
      setMiniAppInstanceMode('primary');
      setMiniAppActiveInstanceId(null);
      return undefined;
    }

    const now = Date.now();
    const currentLock = readMiniAppSingleInstanceLock(storage);
    if (
      isMiniAppSingleInstanceLockActive(currentLock, now) &&
      currentLock.instanceId !== currentInstanceId
    ) {
      setMiniAppInstanceMode('secondary');
      setMiniAppActiveInstanceId(currentLock.instanceId);
      return undefined;
    }

    writeMiniAppSingleInstanceLock(storage, currentInstanceId, now);
    setMiniAppInstanceMode('primary');
    setMiniAppActiveInstanceId(null);
    return undefined;
  }, []);

  useEffect(() => {
    if (!isPrimaryMiniAppInstance) {
      return undefined;
    }

    const storage = resolveMiniAppLocalStorage();
    const currentInstanceId = miniAppInstanceIdRef.current;
    if (!storage) {
      return undefined;
    }

    const syncLockOwnership = () => {
      const now = Date.now();
      const currentLock = readMiniAppSingleInstanceLock(storage);
      if (
        isMiniAppSingleInstanceLockActive(currentLock, now) &&
        currentLock.instanceId !== currentInstanceId
      ) {
        setMiniAppInstanceMode('secondary');
        setMiniAppActiveInstanceId(currentLock.instanceId);
        return;
      }
      writeMiniAppSingleInstanceLock(storage, currentInstanceId, now);
    };

    const releaseLock = () => {
      releaseMiniAppSingleInstanceLockIfOwner(storage, currentInstanceId);
    };

    syncLockOwnership();
    const intervalId = setInterval(
      syncLockOwnership,
      MINI_APP_SINGLE_INSTANCE_HEARTBEAT_MS
    );
    if (typeof window !== 'undefined') {
      window.addEventListener('beforeunload', releaseLock);
      window.addEventListener('pagehide', releaseLock);
    }

    return () => {
      clearInterval(intervalId);
      if (typeof window !== 'undefined') {
        window.removeEventListener('beforeunload', releaseLock);
        window.removeEventListener('pagehide', releaseLock);
      }
      releaseLock();
    };
  }, [isPrimaryMiniAppInstance]);

  function handleMiniAppTakeover() {
    const storage = resolveMiniAppLocalStorage();
    if (storage) {
      writeMiniAppSingleInstanceLock(
        storage,
        miniAppInstanceIdRef.current,
        Date.now()
      );
    }
    setMiniAppInstanceMode('primary');
    setMiniAppActiveInstanceId(null);
  }

  useEffect(() => {
    const intervalId = setInterval(() => {
      setNowMs(Date.now());
    }, 1000);

    return () => {
      clearInterval(intervalId);
    };
  }, []);

  useEffect(() => {
    if (!isPrimaryMiniAppInstance) {
      return;
    }

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
  }, [isPrimaryMiniAppInstance]);

  useEffect(() => subscribeMiniAppApiDiagnostics(setApiDiagnostics), []);

  useEffect(() => {
    if (!isPrimaryMiniAppInstance) {
      return undefined;
    }

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
  }, [isPrimaryMiniAppInstance, telegramUserId]);

  useEffect(() => {
    if (!isPrimaryMiniAppInstance) {
      return undefined;
    }

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
  }, [isPrimaryMiniAppInstance, telegramUserId, catalogDate]);

  useEffect(() => {
    if (!isPrimaryMiniAppInstance) {
      return undefined;
    }

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
  }, [isPrimaryMiniAppInstance, telegramUserId]);

  useEffect(() => {
    if (!isPrimaryMiniAppInstance) {
      return undefined;
    }

    const normalizedTelegramUserId = normalizeString(telegramUserId);
    const hasRuntimeInitData = Boolean(readTelegramMiniAppInitDataRaw());
    const selectedTicketViewBookingRequestId = Number(
      ticketDetailState.selectedBookingRequestId
    );
    const shouldRefreshTicketView =
      activeSection === 'ticket_view' &&
      Number.isInteger(selectedTicketViewBookingRequestId) &&
      selectedTicketViewBookingRequestId > 0;
    const canReadBuyerState = Boolean(
      ((activeSection === 'result' &&
        holdResultViewModel.isSuccess &&
        Number.isInteger(resultBookingRequestId) &&
        resultBookingRequestId > 0) ||
        activeSection === 'my_tickets' ||
        shouldRefreshTicketView) &&
        (normalizedTelegramUserId || hasRuntimeInitData)
    );
    if (!canReadBuyerState) {
      return undefined;
    }

    let isAlive = true;
    let refreshInFlight = false;

    const refreshBuyerState = async () => {
      if (refreshInFlight) {
        return;
      }
      refreshInFlight = true;
      try {
        const [readModelResult, ticketListResult, refreshedTicketViewResult] =
          await Promise.allSettled([
            fetchMiniAppMyRequests({
              telegramUserId: normalizedTelegramUserId,
            }),
            fetchMiniAppMyTickets({
              telegramUserId: normalizedTelegramUserId,
            }),
            shouldRefreshTicketView
              ? fetchMiniAppTicketViewWithOfflineFallback({
                  telegramUserId: normalizedTelegramUserId,
                  bookingRequestId: selectedTicketViewBookingRequestId,
                })
              : Promise.resolve(null),
          ]);
        if (!isAlive) {
          return;
        }

        if (readModelResult.status === 'fulfilled') {
          setMyRequestsState({
            loading: false,
            error: null,
            readModel: readModelResult.value,
          });
        } else {
          const refreshErrorMessage = resolveMiniAppFriendlyLoadErrorMessage(
            readModelResult.reason
          );
          setMyRequestsState((prev) => {
            if (!prev.loading) {
              return prev;
            }
            return {
              loading: false,
              error: refreshErrorMessage,
              readModel: prev.readModel,
            };
          });
        }

        const nextTicketItems =
          ticketListResult.status === 'fulfilled' && Array.isArray(ticketListResult.value?.items)
            ? ticketListResult.value.items
            : null;
        if (nextTicketItems) {
          setTicketsState({
            loading: false,
            error: null,
            items: nextTicketItems,
          });
        } else {
          const refreshErrorMessage = resolveMiniAppFriendlyLoadErrorMessage(
            ticketListResult.reason
          );
          setTicketsState((prev) => {
            if (!prev.loading) {
              return prev;
            }
            return {
              loading: false,
              error: refreshErrorMessage,
              items: Array.isArray(prev.items) ? prev.items : [],
            };
          });
        }

        const refreshedTicketView =
          refreshedTicketViewResult.status === 'fulfilled'
            ? refreshedTicketViewResult.value
            : null;
        const ticketRefreshFailed =
          shouldRefreshTicketView && refreshedTicketViewResult.status === 'rejected';
        const ticketRefreshFailureMessage = ticketRefreshFailed
          ? resolveMiniAppFriendlyLoadErrorMessage(refreshedTicketViewResult.reason)
          : null;
        if (shouldRefreshTicketView && (refreshedTicketView || nextTicketItems || ticketRefreshFailed)) {
          setTicketDetailState((prev) => {
            return buildMiniAppPolledTicketDetailState({
              previousState: prev,
              selectedBookingRequestId: selectedTicketViewBookingRequestId,
              refreshedTicketView,
              ticketItems: nextTicketItems || [],
              hasRefreshFailure: ticketRefreshFailed,
              refreshFailureMessage: ticketRefreshFailureMessage,
            });
          });
        }
      } finally {
        refreshInFlight = false;
      }
    };

    refreshBuyerState();
    const intervalId = setInterval(refreshBuyerState, 4000);

    return () => {
      isAlive = false;
      clearInterval(intervalId);
    };
  }, [
    isPrimaryMiniAppInstance,
    activeSection,
    holdResultViewModel.isSuccess,
    resultBookingRequestId,
    ticketDetailState.selectedBookingRequestId,
    telegramUserId,
  ]);

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

  async function openTripCard(catalogItem) {
    const reference = catalogItem?.trip_slot_reference || null;
    if (!reference?.slot_uid) {
      setTripCardError('Выбранный рейс не содержит корректной ссылки на слот.');
      return;
    }
    if (!isBuyerCatalogItemUpcoming(catalogItem, Date.now())) {
      setTripCardError('Этот рейс уже отправился. Выберите другой рейс.');
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
    if (!isPrimaryMiniAppInstance) {
      return;
    }

    if (entrypointKey === 'catalog') {
      resetToCatalog();
      return;
    }
    if (entrypointKey === 'my_tickets') {
      const normalizedTelegramUserId = normalizeString(telegramUserId);
      const hasRuntimeInitData = Boolean(readTelegramMiniAppInitDataRaw());
      setActiveSection('my_tickets');
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
          error: resolveMiniAppFriendlyLoadErrorMessage(error, MINI_APP_GENERIC_LOAD_ERROR),
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
        content: usefulContentState.content || USEFUL_CONTENT_FALLBACK,
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
          error: resolveMiniAppFriendlyLoadErrorMessage(error, MINI_APP_GENERIC_LOAD_ERROR),
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
          error: resolveMiniAppFriendlyLoadErrorMessage(error, MINI_APP_GENERIC_LOAD_ERROR),
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
          error: resolveMiniAppFriendlyLoadErrorMessage(error, MINI_APP_GENERIC_LOAD_ERROR),
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
    if (!isPrimaryMiniAppInstance) {
      return;
    }
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
    isPrimaryMiniAppInstance,
    deepLinkMyTicketsOpened,
    initialMiniAppSection,
    telegramUserId,
  ]);
  /* eslint-enable react-hooks/exhaustive-deps */

  useEffect(() => {
    if (!isPrimaryMiniAppInstance) {
      return undefined;
    }
    if (!initialCanonicalPresaleId || deepLinkTicketViewOpenedRef.current) {
      return undefined;
    }
    const hasRuntimeIdentity = Boolean(
      normalizeString(telegramUserId) || readTelegramMiniAppInitDataRaw()
    );
    if (!hasRuntimeIdentity) {
      return undefined;
    }

    let disposed = false;
    deepLinkTicketViewOpenedRef.current = true;
    setActiveSection('ticket_view');
    setTicketDetailState({
      loading: true,
      error: null,
      selectedBookingRequestId: null,
      ticketView: null,
      offlineSnapshot: null,
      fallbackUsed: false,
      ticketViewErrorMessage: null,
    });

    fetchMiniAppTicketViewByCanonicalPresale({
      telegramUserId,
      canonicalPresaleId: initialCanonicalPresaleId,
      buyerTicketCode: initialBuyerTicketCode,
      sourceToken: initialSourceToken,
    })
      .then((ticketView) => {
        if (disposed) {
          return;
        }
        const bookingRequestId = readBookingRequestId(ticketView?.booking_request_reference);
        setTicketDetailState({
          loading: false,
          error: null,
          selectedBookingRequestId: bookingRequestId,
          ticketView,
          offlineSnapshot: null,
          fallbackUsed: false,
          ticketViewErrorMessage: null,
        });
      })
      .catch((error) => {
        if (disposed) {
          return;
        }
        setTicketDetailState({
          loading: false,
          error: resolveMiniAppFriendlyLoadErrorMessage(error, MINI_APP_GENERIC_LOAD_ERROR),
          selectedBookingRequestId: null,
          ticketView: null,
          offlineSnapshot: null,
          fallbackUsed: false,
          ticketViewErrorMessage: null,
        });
      });

    return () => {
      disposed = true;
    };
  }, [
    isPrimaryMiniAppInstance,
    initialBuyerTicketCode,
    initialCanonicalPresaleId,
    initialSourceToken,
    telegramUserId,
  ]);

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

    const requestSeq = ticketDetailRequestSeqRef.current + 1;
    ticketDetailRequestSeqRef.current = requestSeq;
    setActiveSection('ticket_view');
    const listProjection =
      buildMiniAppTicketDetailSeedState({
        ticketItem,
        bookingRequestId,
      })?.ticketView || findMiniAppTicketItemByBookingRequestId(ticketsState.items, bookingRequestId);
    const seededState = buildMiniAppTicketDetailSeedState({
      ticketItem: listProjection,
      bookingRequestId,
    });
    if (seededState) {
      setTicketDetailState(seededState);
    } else {
      setTicketDetailState({
        loading: true,
        error: null,
        selectedBookingRequestId: bookingRequestId,
        ticketView: null,
        offlineSnapshot: null,
        fallbackUsed: false,
        ticketViewErrorMessage: null,
      });
    }

    try {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        if (seededState) {
          return;
        }
        const offlineSnapshot = await fetchMiniAppOfflineTicketSnapshot({
          telegramUserId,
          bookingRequestId,
        });
        if (requestSeq !== ticketDetailRequestSeqRef.current) {
          return;
        }
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
      if (requestSeq !== ticketDetailRequestSeqRef.current) {
        return;
      }
      setTicketDetailState((prev) => {
        if (Number(prev?.selectedBookingRequestId) !== bookingRequestId) {
          return prev;
        }
        return {
          loading: false,
          error: null,
          selectedBookingRequestId: bookingRequestId,
          ticketView: result.ticketView || prev.ticketView || null,
          offlineSnapshot: result.offlineSnapshot || prev.offlineSnapshot || null,
          fallbackUsed: result.fallbackUsed || Boolean(prev.fallbackUsed),
          ticketViewErrorMessage: result.ticketViewErrorMessage || null,
        };
      });
    } catch (error) {
      if (requestSeq !== ticketDetailRequestSeqRef.current) {
        return;
      }
      const friendlyMessage = resolveMiniAppFriendlyLoadErrorMessage(
        error,
        MINI_APP_GENERIC_LOAD_ERROR
      );
      setTicketDetailState((prev) => {
        if (Number(prev?.selectedBookingRequestId) !== bookingRequestId) {
          return prev;
        }
        const hasAnyProjection = Boolean(prev?.ticketView || prev?.offlineSnapshot);
        return {
          loading: false,
          error: hasAnyProjection ? null : friendlyMessage,
          selectedBookingRequestId: bookingRequestId,
          ticketView: prev?.ticketView || null,
          offlineSnapshot: prev?.offlineSnapshot || null,
          fallbackUsed: Boolean(prev?.fallbackUsed),
          ticketViewErrorMessage: friendlyMessage,
        };
      });
    }
  }

  function retryCurrentTicketDetailLoad() {
    const bookingRequestId = Number(ticketDetailState.selectedBookingRequestId);
    if (!Number.isInteger(bookingRequestId) || bookingRequestId <= 0) {
      return;
    }
    const ticketItem =
      findMiniAppTicketItemByBookingRequestId(ticketsState.items, bookingRequestId) || {
        booking_request_reference: {
          booking_request_id: bookingRequestId,
        },
      };
    openTicketView(ticketItem);
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
    if (!selectedTripIsUpcoming) {
      setBookingFormError('Этот рейс уже отправился. Выберите другой рейс в каталоге.');
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

  if (miniAppInstanceMode === 'pending') {
    return (
      <div className="tg-mini-app">
        <div className="tg-mini-app__shell">
          <section className="tg-mini-app__panel tg-mini-app__panel--hero-subtle">
            <MiniAppSectionHeader
              eyebrow="Mini App"
              title="Подключаем приложение"
              description="Проверяем активное окно Mini App..."
            />
          </section>
        </div>
      </div>
    );
  }

  if (!isPrimaryMiniAppInstance) {
    return (
      <div className="tg-mini-app">
        <div className="tg-mini-app__shell">
          <section className="tg-mini-app__panel tg-mini-app__panel--hero-subtle">
            <MiniAppSectionHeader
              eyebrow="Mini App"
              title="Приложение уже открыто"
              description="У вас уже открыто другое окно Mini App. Вернитесь в него или продолжите здесь."
            />
            <div className="tg-mini-app__button-stack">
              <button
                type="button"
                className="tg-mini-app__button tg-mini-app__button--primary"
                onClick={handleMiniAppTakeover}
              >
                Продолжить здесь
              </button>
            </div>
            {miniAppActiveInstanceId && (
              <p className="tg-mini-app__hint">
                Активное окно: {miniAppActiveInstanceId}
              </p>
            )}
          </section>
        </div>
      </div>
    );
  }

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
                <span>Имя</span>
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
                <div className="tg-mini-app__metric-label">Итого</div>
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
              title={resultHeaderTitle}
              description={resultHeaderDescription}
              aside={
                holdResultViewModel.isSuccess && !resultPendingPrepaymentFlow ? (
                  <MiniAppPill tone={resultPresentation.statusTone}>
                    {resultPresentation.statusLabel}
                  </MiniAppPill>
                ) : holdResultViewModel.isSuccess ? null : (
                  <MiniAppPill tone="warning">
                    {holdResultViewModel.statusLabel}
                  </MiniAppPill>
                )
              }
            />
            {holdResultViewModel.secondaryText && (
              <p className="tg-mini-app__note">{holdResultViewModel.secondaryText}</p>
            )}
            {resultShowsPendingFlow && (
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
                        label={'Осталось времени'}
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
            {holdResultViewModel.isSuccess && !resultPendingPrepaymentFlow && (
              <>
                <div className="tg-mini-app__subpanel">
                  <h3 className="tg-mini-app__subpanel-title">{resultPresentation.statusLabel}</h3>
                  <p className="tg-mini-app__note">{resultPresentation.nextActionLabel}</p>
                  <div className="tg-mini-app__meta-grid">
                    <MiniAppMetaItem
                      label="Бронь"
                      value={resultPresentation.holdStatusLabel}
                      tone={resultPresentation.holdTone}
                    />
                    <MiniAppMetaItem
                      label="Предоплата"
                      value={resultPresentation.prepaymentStatusLabel}
                      tone={resultPresentation.prepaymentTone}
                    />
                    <MiniAppMetaItem
                      label="Билет"
                      value={resultPresentation.ticketStatusLabel}
                      tone={resultPresentation.ticketTone}
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
                onClick={() => {
                  if (resultCanOpenTicketView && resultOpenTicketTarget) {
                    openTicketView(resultOpenTicketTarget);
                    return;
                  }
                  openEntrypoint('my_tickets');
                }}
              >
                {resultCanOpenTicketView ? resultPresentation.actionLabel : 'Открыть мои заявки'}
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
            {showCurrentTicketContext && (
              <div
                className="tg-mini-app__subpanel tg-mini-app__subpanel--ticket-centered"
                data-testid="telegram-mini-app-current-ticket-context"
              >
                <div className="tg-mini-app__list-card-topline">
                  <MiniAppPill tone={ticketDetailPresentation.statusTone}>
                    {ticketDetailPresentation.statusLabel}
                  </MiniAppPill>
                  {ticketDetailViewModel.buyerTicketCode && (
                    <div className="tg-mini-app__list-card-reference">
                      {formatBuyerTicketReferenceTopline({
                        buyer_ticket_code: ticketDetailViewModel.buyerTicketCode,
                      })}
                    </div>
                  )}
                </div>
                <h3 className="tg-mini-app__list-title">{ticketDetailPresentation.cardTitle}</h3>
                <p className="tg-mini-app__list-subtitle">{currentTicketContextDateTimeLabel}</p>
                <p className="tg-mini-app__note">{ticketDetailPresentation.description}</p>
                <div className="tg-mini-app__panel-actions">
                  <button
                    type="button"
                    className="tg-mini-app__button tg-mini-app__button--secondary"
                    onClick={() => setActiveSection('ticket_view')}
                  >
                    {ticketDetailPresentation.actionLabel}
                  </button>
                </div>
              </div>
            )}
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
                    holdExpiresAtIso:
                      item?.hold_status_summary?.hold_expires_at_summary?.iso,
                  });
                  const canOpen = Number.isInteger(bookingRequestId) && bookingRequestId > 0;
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
                  const readyTicketFlow =
                    !pendingPrepaymentFlow &&
                    (status === 'linked_ticket_ready' || availability === 'available');

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
                        ) : readyTicketFlow ? (
                          <>
                            <div className="tg-mini-app__list-card-header tg-mini-app__list-card-header--ready-ticket">
                              <div>
                                <p className="tg-mini-app__list-subtitle">{dateTimeLabel}</p>
                                {buyerTicketCode ? (
                                  <h3 className="tg-mini-app__list-title">
                                    Номер билета {buyerTicketCode}
                                  </h3>
                                ) : null}
                              </div>
                              <MiniAppPill tone={presentation.statusTone}>
                                {presentation.statusLabel}
                              </MiniAppPill>
                            </div>
                            <div className="tg-mini-app__meta-grid tg-mini-app__meta-grid--single">
                              <MiniAppMetaItem
                                label="Следующий шаг"
                                value={presentation.nextActionLabel}
                                tone={presentation.nextActionTone}
                                className="tg-mini-app__meta-item--centered tg-mini-app__meta-item--next-step"
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
              title={ticketDetailPendingPrepaymentFlow ? ticketDetailPresentation.statusLabel : 'Мой билет'}
              className={ticketDetailPendingPrepaymentFlow ? '' : 'tg-mini-app__section-header--centered'}
            />
            {ticketDetailState.loading && (
              <p className="tg-mini-app__hint">Загружаем детали билета...</p>
            )}
            {!ticketDetailState.loading && ticketDetailState.error && (
              <div className="tg-mini-app__panel-actions">
                <p className="tg-mini-app__error">{ticketDetailState.error}</p>
                <button
                  type="button"
                  className="tg-mini-app__button tg-mini-app__button--secondary"
                  onClick={retryCurrentTicketDetailLoad}
                >
                  Повторить
                </button>
              </div>
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
                        <div className="tg-mini-app__buyer-flow-head tg-mini-app__buyer-flow-head--with-timer">
                          <div>
                            <p className="tg-mini-app__section-eyebrow">Что делать сейчас</p>
                            <h3 className="tg-mini-app__subpanel-title">
                              {BUYER_PENDING_FLOW_TITLE}
                            </h3>
                          </div>
                          <div
                            className="tg-mini-app__buyer-flow-timer"
                            data-testid="telegram-mini-app-ticket-view-timer"
                          >
                            <MiniAppInfoCard
                              label="Осталось времени"
                              value={ticketDetailCountdownSummary.valueLabel}
                              tone={ticketDetailCountdownSummary.tone}
                              className="tg-mini-app__buyer-flow-timer-card tg-mini-app__info-card--centered"
                            />
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
                      <div className="tg-mini-app__subpanel tg-mini-app__subpanel--ticket-centered tg-mini-app__subpanel--ticket-datetime">
                        <h3 className="tg-mini-app__subpanel-title">
                          {formatDateTimeLabel(
                            ticketDetailViewModel.requestedTripDate,
                            ticketDetailViewModel.requestedTimeSlot
                          )}
                        </h3>
                      </div>
                    </div>
                  )}

                  {!ticketDetailPendingPrepaymentFlow && <MiniAppHowToGetThereCard />}

                  {ticketDetailViewModel.hasBoardingQr && (
                    <MiniAppBoardingQrCard
                      buyerTicketCode={ticketDetailViewModel.buyerTicketCode}
                      qrPayloadText={ticketDetailViewModel.boardingQrPayloadText}
                    />
                  )}

                  {!ticketDetailPendingPrepaymentFlow && ticketDetailViewModel.paymentSummary && (
                    <div className="tg-mini-app__subpanel tg-mini-app__subpanel--ticket-centered">
                      <h3 className="tg-mini-app__subpanel-title">Оплата</h3>
                      <div className="tg-mini-app__info-grid">
                        <MiniAppInfoCard
                          label="Оплачено / предоплата"
                          value={formatMoney(
                            ticketDetailViewModel.paymentSummary.prepayment_amount,
                            ticketDetailViewModel.paymentSummary.currency
                          )}
                          tone="accent"
                          className="tg-mini-app__info-card--centered"
                        />
                        <MiniAppInfoCard
                          label="Итого"
                          value={formatMoney(
                            ticketDetailViewModel.paymentSummary.total_price,
                            ticketDetailViewModel.paymentSummary.currency
                          )}
                          className="tg-mini-app__info-card--centered"
                        />
                        <MiniAppInfoCard
                          label="Осталось"
                          value={formatMoney(
                            ticketDetailViewModel.paymentSummary.remaining_payment_amount,
                            ticketDetailViewModel.paymentSummary.currency
                          )}
                          tone="warning"
                          className="tg-mini-app__info-card--centered"
                        />
                      </div>
                    </div>
                  )}

                  {!ticketDetailPendingPrepaymentFlow && ticketDetailSellerContact?.sellerPhone && (
                    <div className="tg-mini-app__subpanel tg-mini-app__subpanel--contact tg-mini-app__subpanel--ticket-centered">
                      <span className="tg-mini-app__section-eyebrow">Контакт диспетчера</span>
                      <a
                        className="tg-mini-app__link tg-mini-app__link--phone"
                        href={`tel:${ticketDetailSellerContact.sellerPhone}`}
                      >
                        {ticketDetailSellerContact.sellerPhone}
                      </a>
                    </div>
                  )}
                  {showMiniAppApiDiagnostics && ticketDetailViewModel.fallbackUsed && (
                    <p className="tg-mini-app__hint">
                      Для этого билета используется офлайн-снимок.
                    </p>
                  )}
                  {showMiniAppApiDiagnostics && ticketDetailState.ticketViewErrorMessage && (
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
            </div>
          </section>
        )}

        {activeSection === 'useful_content' && (
          <section className="tg-mini-app__panel tg-mini-app__panel--useful">
            <MiniAppSectionHeader
              title={usefulContentViewModel.title}
              description={usefulContentViewModel.body}
            />
            {usefulContentViewModel.renderState === 'loading' && (
              <p className="tg-mini-app__hint">Обновляем данные по погоде и курорту...</p>
            )}
            {usefulContentViewModel.renderState === 'error' && (
              <p className="tg-mini-app__error">{usefulContentViewModel.errorMessage}</p>
            )}

            <div className="tg-mini-app__weather-grid">
              <article className="tg-mini-app__weather-card tg-mini-app__weather-card--accent">
                <p className="tg-mini-app__weather-label">Погода</p>
                <p className="tg-mini-app__weather-value">
                  {formatUsefulConditionLabel({
                    conditionLabel: usefulContentViewModel.weatherConditionLabel,
                    weatherDataState: usefulContentViewModel.weatherDataState,
                  })}
                </p>
              </article>
              <article className="tg-mini-app__weather-card">
                <p className="tg-mini-app__weather-label">Температура воздуха</p>
                <p className="tg-mini-app__weather-value">
                  {formatUsefulTemperature(usefulContentViewModel.airTemperatureC)}
                </p>
              </article>
              <article className="tg-mini-app__weather-card">
                <p className="tg-mini-app__weather-label">Температура воды</p>
                <p className="tg-mini-app__weather-value">
                  {formatUsefulTemperature(usefulContentViewModel.waterTemperatureC)}
                </p>
              </article>
              <article className="tg-mini-app__weather-card">
                <p className="tg-mini-app__weather-label">Закат</p>
                <p className="tg-mini-app__weather-value">
                  {formatUsefulSunsetTime({
                    sunsetTimeIso: usefulContentViewModel.sunsetTimeIso,
                    sunsetTimeLocal: usefulContentViewModel.sunsetTimeLocal,
                  })}
                </p>
              </article>
            </div>

            <p className="tg-mini-app__hint tg-mini-app__hint--useful-location">
              {usefulContentViewModel.locationSummary.country}, {usefulContentViewModel.locationSummary.region},{' '}
              {usefulContentViewModel.locationSummary.locality} · {usefulContentViewModel.locationSummary.waterBody}
            </p>

            <ul className="tg-mini-app__useful-cards">
              {usefulContentViewModel.resortCards.map((item) => (
                <li key={item.contentReference} className="tg-mini-app__useful-card">
                  <h3 className="tg-mini-app__list-title">{item.title}</h3>
                  <p className="tg-mini-app__list-subtitle">{item.shortText}</p>
                </li>
              ))}
            </ul>
          </section>
        )}

        {activeSection === 'faq' && (
          <section className="tg-mini-app__panel tg-mini-app__panel--faq">
            <MiniAppSectionHeader
              title={faqViewModel.title}
              description={faqViewModel.body}
            />
            {faqViewModel.renderState === 'loading' && (
              <p className="tg-mini-app__hint">Загружаем вопросы...</p>
            )}
            {faqViewModel.hasFaqItems && (
              <ul className="tg-mini-app__faq-list">
                {faqViewModel.faqItems.map((item) => (
                  <li key={item.faqReference}>
                    <details className="tg-mini-app__faq-item">
                      <summary className="tg-mini-app__faq-summary">
                        <h3 className="tg-mini-app__faq-question">{item.title}</h3>
                        <span className="tg-mini-app__faq-toggle" aria-hidden="true">
                          +
                        </span>
                      </summary>
                      <p className="tg-mini-app__faq-answer">{item.shortText}</p>
                    </details>
                  </li>
                ))}
              </ul>
            )}
            {!faqViewModel.hasFaqItems && faqViewModel.renderState !== 'loading' && (
              <MiniAppEmptyState
                title="Скоро добавим ответы"
                description="Раздел временно обновляется. Попробуйте открыть его чуть позже."
              />
            )}
          </section>
        )}

        {activeSection === 'contact' && (
          <section className="tg-mini-app__panel tg-mini-app__panel--contact">
            <MiniAppSectionHeader
              className="tg-mini-app__section-header--centered"
              eyebrow="Связь"
              title="Контакты и маршрут"
              description="Куда идти, где построить маршрут и как связаться с диспетчером."
            />
            {contactViewModel.renderState === 'loading' && (
              <p className="tg-mini-app__hint">Загружаем контакты...</p>
            )}
            {contactViewModel.renderState === 'error' && (
              <p className="tg-mini-app__error">{MINI_APP_GENERIC_LOAD_ERROR}</p>
            )}
            <MiniAppHowToGetThereCard
              collapsible={false}
              testId="telegram-mini-app-contact-how-to-get"
            />
            {contactDispatcherPhone ? (
              <div className="tg-mini-app__subpanel tg-mini-app__subpanel--contact tg-mini-app__subpanel--ticket-centered">
                <span className="tg-mini-app__section-eyebrow">Телефон диспетчера</span>
                <a className="tg-mini-app__link tg-mini-app__link--phone" href={contactDispatcherCallHref}>
                  {contactDispatcherPhone}
                </a>
              </div>
            ) : (
              <div className="tg-mini-app__subpanel tg-mini-app__subpanel--ticket-centered">
                <p className="tg-mini-app__note">
                  Телефон диспетчера появится после подтверждения заявки.
                </p>
              </div>
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
