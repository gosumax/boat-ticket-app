import { freezeTelegramHandoffValue } from './handoff-readiness.js';

export const TELEGRAM_CONTENT_MANAGEMENT_ITEM_VERSION =
  'telegram_content_management_item.v1';
export const TELEGRAM_CONTENT_MANAGEMENT_LIST_VERSION =
  'telegram_content_management_list.v1';
export const TELEGRAM_CONTENT_MANAGEMENT_MUTATION_VERSION =
  'telegram_content_management_mutation.v1';

export const TELEGRAM_MANAGED_CONTENT_GROUPS = Object.freeze([
  'useful_places',
  'what_to_take',
  'trip_help',
  'faq_general',
  'faq_trip_rules',
  'simple_service_content',
]);

export const TELEGRAM_MANAGED_CONTENT_TYPES = Object.freeze([
  'useful_content_item',
  'faq_item',
  'service_content_block',
]);

export const TELEGRAM_CONTENT_GROUP_TYPE_COMPATIBILITY = Object.freeze({
  useful_places: Object.freeze(['useful_content_item']),
  what_to_take: Object.freeze(['useful_content_item']),
  trip_help: Object.freeze(['useful_content_item']),
  faq_general: Object.freeze(['faq_item']),
  faq_trip_rules: Object.freeze(['faq_item']),
  simple_service_content: Object.freeze(['service_content_block']),
});

export function freezeTelegramContentManagementValue(value) {
  return freezeTelegramHandoffValue(value);
}
