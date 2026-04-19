import { freezeTelegramHandoffValue } from './handoff-readiness.js';

export const TELEGRAM_SOURCE_REGISTRY_ITEM_VERSION =
  'telegram_source_registry_item.v1';
export const TELEGRAM_SOURCE_REGISTRY_LIST_VERSION =
  'telegram_source_registry_list.v1';
export const TELEGRAM_SOURCE_REGISTRY_MUTATION_VERSION =
  'telegram_source_registry_mutation.v1';

export const TELEGRAM_SOURCE_REGISTRY_FAMILIES = Object.freeze([
  'seller_source',
  'owner_source',
  'generic_source',
  'point_promo_source',
]);

export function freezeTelegramSourceRegistryValue(value) {
  return freezeTelegramHandoffValue(value);
}
