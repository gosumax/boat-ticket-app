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

export const TELEGRAM_USEFUL_RESORT_CARD_REFERENCES = Object.freeze([
  'tg_useful_places_001',
  'tg_useful_places_002',
  'tg_useful_places_003',
  'tg_useful_places_004',
  'tg_useful_places_005',
]);

export const TELEGRAM_USEFUL_CONTENT_FEED_ITEMS = Object.freeze([
  Object.freeze({
    content_reference: 'tg_useful_places_001',
    content_grouping: 'useful_places',
    content_type: 'info_card',
    title: 'Где поесть',
    short_text:
      'Набережная Архипо-Осиповки и район у устья Вулана: семейные кафе, столовые и точки с рыбой на гриле. В сезон лучше бронировать стол заранее.',
    visibility_action_summary: Object.freeze({
      visibility_state: 'visible',
      action_type: 'open_location_hint',
      action_reference: 'arkhipo_where_to_eat',
    }),
    latest_content_at: TELEGRAM_USEFUL_CONTENT_BASELINE_TIMESTAMP,
  }),
  Object.freeze({
    content_reference: 'tg_useful_places_002',
    content_grouping: 'useful_places',
    content_type: 'info_card',
    title: 'Где спокойно посидеть',
    short_text:
      'Для тихого отдыха подойдёт тенистая часть Приморского бульвара и участки пляжа ближе к окраинам. После 16:00 там обычно заметно спокойнее.',
    visibility_action_summary: Object.freeze({
      visibility_state: 'visible',
      action_type: 'open_location_hint',
      action_reference: 'arkhipo_calm_spots',
    }),
    latest_content_at: TELEGRAM_USEFUL_CONTENT_BASELINE_TIMESTAMP,
  }),
  Object.freeze({
    content_reference: 'tg_useful_places_003',
    content_grouping: 'useful_places',
    content_type: 'info_card',
    title: 'Лучшие места для фото',
    short_text:
      'Закатные кадры лучше делать у набережной и со стороны устья реки Вулан. Утром красиво на тропах к обзорным точкам над Чёрным морем.',
    visibility_action_summary: Object.freeze({
      visibility_state: 'visible',
      action_type: 'open_location_hint',
      action_reference: 'arkhipo_photo_points',
    }),
    latest_content_at: TELEGRAM_USEFUL_CONTENT_BASELINE_TIMESTAMP,
  }),
  Object.freeze({
    content_reference: 'tg_useful_places_004',
    content_grouping: 'useful_places',
    content_type: 'info_card',
    title: 'Куда сходить с детьми',
    short_text:
      'Подойдут аквапарк, дельфинарий, аттракционы на набережной и прогулочные зоны у моря. На вечерние сеансы и выходные лучше приезжать заранее.',
    visibility_action_summary: Object.freeze({
      visibility_state: 'visible',
      action_type: 'open_location_hint',
      action_reference: 'arkhipo_kids_places',
    }),
    latest_content_at: TELEGRAM_USEFUL_CONTENT_BASELINE_TIMESTAMP,
  }),
  Object.freeze({
    content_reference: 'tg_useful_places_005',
    content_grouping: 'useful_places',
    content_type: 'info_card',
    title: 'Куда сходить вечером',
    short_text:
      'Вечером популярны прогулки по набережной, живая музыка в кафе и видовые точки на море. На маршруты к обзорным местам берите фонарик.',
    visibility_action_summary: Object.freeze({
      visibility_state: 'visible',
      action_type: 'open_location_hint',
      action_reference: 'arkhipo_evening_places',
    }),
    latest_content_at: TELEGRAM_USEFUL_CONTENT_BASELINE_TIMESTAMP,
  }),
  Object.freeze({
    content_reference: 'tg_trip_help_001',
    content_grouping: 'trip_help',
    content_type: 'info_card',
    title: 'Связь с поддержкой',
    short_text:
      'Если нужно перенести поездку или уточнить детали, напишите в поддержку и укажите номер заявки.',
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
    title: 'Можно ли с детьми',
    short_text:
      'Да, можно. Для детей выбирайте спокойный формат рейса и держите ребёнка рядом при посадке.',
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
    title: 'Можно ли беременным',
    short_text:
      'Беременным можно только до четвёртого месяца. После четвёртого месяца поездки не рекомендуются.',
    visibility_action_summary: Object.freeze({
      visibility_state: 'visible',
      action_type: 'none',
      action_reference: null,
    }),
    latest_content_at: TELEGRAM_USEFUL_CONTENT_BASELINE_TIMESTAMP,
  }),
  Object.freeze({
    faq_reference: 'tg_faq_general_003',
    content_grouping: 'faq_general',
    content_type: 'faq_item',
    title: 'Можно ли с едой и перекусом',
    short_text:
      'Да, можно взять небольшой перекус и воду по желанию. Это не обязательно.',
    visibility_action_summary: Object.freeze({
      visibility_state: 'visible',
      action_type: 'none',
      action_reference: null,
    }),
    latest_content_at: TELEGRAM_USEFUL_CONTENT_BASELINE_TIMESTAMP,
  }),
  Object.freeze({
    faq_reference: 'tg_faq_general_004',
    content_grouping: 'faq_general',
    content_type: 'faq_item',
    title: 'Можно ли с алкоголем',
    short_text:
      'Лёгкий алкоголь можно в умеренном количестве. Крепкий алкоголь нежелателен.',
    visibility_action_summary: Object.freeze({
      visibility_state: 'visible',
      action_type: 'none',
      action_reference: null,
    }),
    latest_content_at: TELEGRAM_USEFUL_CONTENT_BASELINE_TIMESTAMP,
  }),
  Object.freeze({
    faq_reference: 'tg_faq_general_005',
    content_grouping: 'faq_general',
    content_type: 'faq_item',
    title: 'Можно ли с животными',
    short_text:
      'Можно с маленькими животными, если они не мешают другим пассажирам.',
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
    title: 'Когда приходить',
    short_text:
      'Приходите за 15-20 минут до отправления, чтобы спокойно пройти посадку.',
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
    title: 'Как пройти',
    short_text:
      'Точка посадки находится у устья реки Вулан. В разделе «Связь» есть карта и кнопки маршрута.',
    visibility_action_summary: Object.freeze({
      visibility_state: 'visible',
      action_type: 'none',
      action_reference: null,
    }),
    latest_content_at: TELEGRAM_USEFUL_CONTENT_BASELINE_TIMESTAMP,
  }),
  Object.freeze({
    faq_reference: 'tg_faq_trip_rules_003',
    content_grouping: 'faq_trip_rules',
    content_type: 'faq_item',
    title: 'Что делать, если опаздываю',
    short_text:
      'Сразу напишите или позвоните диспетчеру.',
    visibility_action_summary: Object.freeze({
      visibility_state: 'visible',
      action_type: 'open_support_hint',
      action_reference: 'contact_support',
    }),
    latest_content_at: TELEGRAM_USEFUL_CONTENT_BASELINE_TIMESTAMP,
  }),
  Object.freeze({
    faq_reference: 'tg_faq_trip_rules_004',
    content_grouping: 'faq_trip_rules',
    content_type: 'faq_item',
    title: 'Что взять с собой',
    short_text:
      'Обязательно возьмите полотенце для купания. Головные уборы лучше не брать или убирать: их сдувает, на лодках есть навес.',
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
