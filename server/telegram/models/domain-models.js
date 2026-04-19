import { TELEGRAM_DOMAIN_ENTITIES } from '../../../shared/telegram/index.js';

function indexEntityDefinitions(entities) {
  return Object.freeze(
    Object.fromEntries(entities.map((entity) => [entity.name, Object.freeze({ ...entity })]))
  );
}

export const telegramDomainModelDefinitions = indexEntityDefinitions(TELEGRAM_DOMAIN_ENTITIES);

export function getTelegramDomainModelDefinition(entityName) {
  return telegramDomainModelDefinitions[entityName] || null;
}
