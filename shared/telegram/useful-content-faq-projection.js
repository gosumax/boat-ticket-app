import { freezeTelegramHandoffValue } from './handoff-readiness.js';

export const TELEGRAM_USEFUL_CONTENT_FEED_VERSION =
  'telegram_useful_content_feed.v1';
export const TELEGRAM_USEFUL_CONTENT_FAQ_LIST_VERSION =
  'telegram_useful_content_faq_list.v1';
export const TELEGRAM_USEFUL_CONTENT_FAQ_ITEM_VERSION =
  'telegram_useful_content_faq_item.v1';
export const TELEGRAM_WEATHER_USEFUL_CONTENT_READ_MODEL_VERSION =
  'telegram_weather_useful_content_read_model.v1';

export const TELEGRAM_WEATHER_DATA_STATES = Object.freeze([
  'available',
  'partial',
  'unavailable',
]);

export const TELEGRAM_USEFUL_CONTENT_GROUPINGS = Object.freeze([
  'useful_places',
  'what_to_take',
  'trip_help',
]);

export const TELEGRAM_FAQ_GROUPINGS = Object.freeze([
  'faq_general',
  'faq_trip_rules',
]);

export const TELEGRAM_USEFUL_CONTENT_TYPES = Object.freeze([
  'info_card',
  'checklist_item',
  'faq_item',
]);

export const TELEGRAM_USEFUL_CONTENT_BASELINE_TIMESTAMP =
  '2026-04-14T00:00:00.000Z';

export const TELEGRAM_USEFUL_CONTENT_FEED_ITEMS = Object.freeze([
  Object.freeze({
    content_reference: 'tg_useful_places_001',
    content_grouping: 'useful_places',
    content_type: 'info_card',
    title: 'Кофе у причала',
    short_text:
      'Небольшая остановка рядом с посадкой, где можно взять кофе, воду и перекус.',
    visibility_action_summary: Object.freeze({
      visibility_state: 'visible',
      action_type: 'open_location_hint',
      action_reference: 'pier_side_coffee_point',
    }),
    latest_content_at: TELEGRAM_USEFUL_CONTENT_BASELINE_TIMESTAMP,
  }),
  Object.freeze({
    content_reference: 'tg_useful_places_002',
    content_grouping: 'useful_places',
    content_type: 'info_card',
    title: 'Ближайшая общественная парковка',
    short_text:
      'Парковка находится в нескольких минутах пешком от главного входа на причал.',
    visibility_action_summary: Object.freeze({
      visibility_state: 'visible',
      action_type: 'open_location_hint',
      action_reference: 'nearest_public_parking',
    }),
    latest_content_at: TELEGRAM_USEFUL_CONTENT_BASELINE_TIMESTAMP,
  }),
  Object.freeze({
    content_reference: 'tg_what_to_take_001',
    content_grouping: 'what_to_take',
    content_type: 'checklist_item',
    title: 'Возьмите питьевую воду',
    short_text: 'Подготовьте воду для каждого пассажира, особенно в тёплую погоду.',
    visibility_action_summary: Object.freeze({
      visibility_state: 'visible',
      action_type: 'mark_checklist',
      action_reference: 'bring_drinking_water',
    }),
    latest_content_at: TELEGRAM_USEFUL_CONTENT_BASELINE_TIMESTAMP,
  }),
  Object.freeze({
    content_reference: 'tg_what_to_take_002',
    content_grouping: 'what_to_take',
    content_type: 'checklist_item',
    title: 'Возьмите защиту от солнца',
    short_text:
      'Для дневных поездок пригодятся головной убор, солнцезащитный крем и очки.',
    visibility_action_summary: Object.freeze({
      visibility_state: 'visible',
      action_type: 'mark_checklist',
      action_reference: 'bring_sun_protection',
    }),
    latest_content_at: TELEGRAM_USEFUL_CONTENT_BASELINE_TIMESTAMP,
  }),
  Object.freeze({
    content_reference: 'tg_trip_help_001',
    content_grouping: 'trip_help',
    content_type: 'info_card',
    title: 'Как связаться с поддержкой',
    short_text:
      'Если планы изменились, заранее свяжитесь с поддержкой и сообщите номер вашей заявки.',
    visibility_action_summary: Object.freeze({
      visibility_state: 'visible',
      action_type: 'open_support_hint',
      action_reference: 'contact_support',
    }),
    latest_content_at: TELEGRAM_USEFUL_CONTENT_BASELINE_TIMESTAMP,
  }),
]);

export const TELEGRAM_FAQ_ITEMS = Object.freeze([
  Object.freeze({
    faq_reference: 'tg_faq_general_001',
    content_grouping: 'faq_general',
    content_type: 'faq_item',
    title: 'Когда нужно приехать перед отправлением?',
    short_text: 'Приезжайте минимум за 15 минут до выбранного времени отправления.',
    visibility_action_summary: Object.freeze({
      visibility_state: 'visible',
      action_type: 'none',
      action_reference: null,
    }),
    latest_content_at: TELEGRAM_USEFUL_CONTENT_BASELINE_TIMESTAMP,
  }),
  Object.freeze({
    faq_reference: 'tg_faq_general_002',
    content_grouping: 'faq_general',
    content_type: 'faq_item',
    title: 'Можно ли изменить контактный телефон?',
    short_text: 'Да, свяжитесь с поддержкой и укажите номер своей заявки.',
    visibility_action_summary: Object.freeze({
      visibility_state: 'visible',
      action_type: 'open_support_hint',
      action_reference: 'contact_support',
    }),
    latest_content_at: TELEGRAM_USEFUL_CONTENT_BASELINE_TIMESTAMP,
  }),
  Object.freeze({
    faq_reference: 'tg_faq_trip_rules_001',
    content_grouping: 'faq_trip_rules',
    content_type: 'faq_item',
    title: 'Выдают ли спасательные жилеты?',
    short_text: 'Да, перед посадкой пассажирам выдают необходимое спасательное снаряжение.',
    visibility_action_summary: Object.freeze({
      visibility_state: 'visible',
      action_type: 'none',
      action_reference: null,
    }),
    latest_content_at: TELEGRAM_USEFUL_CONTENT_BASELINE_TIMESTAMP,
  }),
  Object.freeze({
    faq_reference: 'tg_faq_trip_rules_002',
    content_grouping: 'faq_trip_rules',
    content_type: 'faq_item',
    title: 'Разрешено ли курить во время поездки?',
    short_text: 'Нет, во время пассажирских поездок курение запрещено.',
    visibility_action_summary: Object.freeze({
      visibility_state: 'visible',
      action_type: 'none',
      action_reference: null,
    }),
    latest_content_at: TELEGRAM_USEFUL_CONTENT_BASELINE_TIMESTAMP,
  }),
]);

export function freezeTelegramUsefulContentValue(value) {
  return freezeTelegramHandoffValue(value);
}
