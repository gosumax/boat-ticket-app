import {
  buildTelegramHandoffTimestampSummary,
  buildTelegramLatestTimestampSummary,
  freezeTelegramSourceRegistryValue,
  SELLER_SOURCE_FAMILIES,
  TELEGRAM_SOURCE_FAMILIES,
  TELEGRAM_SOURCE_REGISTRY_FAMILIES,
  TELEGRAM_SOURCE_REGISTRY_ITEM_VERSION,
  TELEGRAM_SOURCE_REGISTRY_LIST_VERSION,
  TELEGRAM_SOURCE_REGISTRY_MUTATION_VERSION,
} from '../../../shared/telegram/index.js';
import {
  classifyTelegramStartSourceTokenForRegistry,
  normalizeTelegramStartSourceTokenForRegistry,
} from './start-source-token-resolution-service.js';

const ERROR_PREFIX = '[TELEGRAM_SOURCE_REGISTRY]';
const SERVICE_NAME = 'telegram_source_registry_service';
const SOURCE_REFERENCE_RE = /^[A-Za-z0-9_-]+$/;

const SOURCE_FAMILY_COMPATIBILITY = Object.freeze({
  seller_source: Object.freeze(SELLER_SOURCE_FAMILIES),
  owner_source: Object.freeze(['owner_source']),
  generic_source: Object.freeze(
    TELEGRAM_SOURCE_FAMILIES.filter(
      (family) =>
        !SELLER_SOURCE_FAMILIES.includes(family) &&
        family !== 'owner_source' &&
        family !== 'promo_qr' &&
        family !== 'point_qr'
    )
  ),
  point_promo_source: Object.freeze(['promo_qr', 'point_qr']),
});

function rejectSourceRegistry(message) {
  throw new Error(`${ERROR_PREFIX} ${message}`);
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeString(value) {
  const normalized = String(value ?? '').trim();
  return normalized || null;
}

function normalizeBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') {
    return Boolean(fallback);
  }
  if (value === true || value === false) return value;
  if (value === 1 || value === 0) return value === 1;
  rejectSourceRegistry('boolean flag is invalid');
}

function normalizePositiveInteger(value, label) {
  const normalized = Number(value);
  if (!Number.isInteger(normalized) || normalized <= 0) {
    rejectSourceRegistry(`${label} must be a positive integer`);
  }
  return normalized;
}

function normalizeSourceFamily(value) {
  const family = normalizeString(value);
  if (!family || !TELEGRAM_SOURCE_REGISTRY_FAMILIES.includes(family)) {
    rejectSourceRegistry(`Unsupported source family: ${family || 'unknown'}`);
  }
  return family;
}

function normalizeSourceType(value) {
  const sourceType = normalizeString(value);
  if (!sourceType) {
    return null;
  }
  if (!TELEGRAM_SOURCE_FAMILIES.includes(sourceType) && sourceType !== 'owner_source') {
    rejectSourceRegistry(`Unsupported source type: ${sourceType}`);
  }
  return sourceType;
}

function normalizeSourceToken(value) {
  const token = normalizeTelegramStartSourceTokenForRegistry(value);
  if (!token) {
    rejectSourceRegistry('source token is required and must be token-compatible');
  }
  return token;
}

function normalizeSourceReference(value) {
  const reference = normalizeString(value);
  if (!reference) {
    return null;
  }
  if (!SOURCE_REFERENCE_RE.test(reference)) {
    rejectSourceRegistry(
      'source reference must contain only letters, numbers, underscores, or hyphens'
    );
  }
  return reference;
}

function normalizeSourcePayload(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  if (!isPlainObject(value)) {
    rejectSourceRegistry('source payload must be an object when provided');
  }
  return freezeTelegramSourceRegistryValue(value);
}

function normalizeSellerId(value, sourceFamily) {
  if (value === null || value === undefined || value === '') {
    if (sourceFamily === 'seller_source') {
      rejectSourceRegistry('seller source requires seller reference');
    }
    return null;
  }

  const sellerId = normalizePositiveInteger(value, 'seller_id');
  if (sourceFamily !== 'seller_source') {
    rejectSourceRegistry('seller reference is allowed only for seller source');
  }
  return sellerId;
}

function sanitizeReferenceToken(token) {
  return token.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function buildGeneratedSourceReference({ sourceFamily, sourceToken }) {
  return `tg_source_${sourceFamily}_${sanitizeReferenceToken(sourceToken)}`;
}

function normalizeCreateInput(input = {}) {
  if (!isPlainObject(input)) {
    rejectSourceRegistry('source registry create payload must be an object');
  }

  const sourceFamily = normalizeSourceFamily(
    input.source_family ?? input.sourceFamily
  );
  const sourceToken = normalizeSourceToken(
    input.source_token ?? input.sourceToken ?? input.token
  );
  const tokenClassification = classifyTelegramStartSourceTokenForRegistry(sourceToken);
  if (!tokenClassification) {
    rejectSourceRegistry('invalid source payload: source token is not compatible with start-source rules');
  }
  if (tokenClassification.resolutionStatus === 'no_source_token') {
    rejectSourceRegistry('invalid source payload: source token is required');
  }

  const compatibleSourceTypes = SOURCE_FAMILY_COMPATIBILITY[sourceFamily] || [];
  const compatibleFamilyByToken =
    tokenClassification.resolutionStatus === 'resolved_seller_source'
      ? 'seller_source'
      : tokenClassification.resolutionStatus === 'resolved_owner_source'
        ? 'owner_source'
        : ['promo_qr', 'point_qr'].includes(tokenClassification.sourceFamily)
          ? 'point_promo_source'
          : tokenClassification.resolutionStatus === 'resolved_generic_source'
            ? 'generic_source'
            : null;
  if (compatibleFamilyByToken && sourceFamily !== compatibleFamilyByToken) {
    rejectSourceRegistry(
      `incompatible source payload for token family: ${sourceFamily}/${tokenClassification.sourceFamily}`
    );
  }

  const sourceType =
    normalizeSourceType(input.source_type ?? input.sourceType) ||
    tokenClassification.sourceFamily;
  if (!compatibleSourceTypes.includes(sourceType)) {
    rejectSourceRegistry(`incompatible source payload for type/family: ${sourceType}/${sourceFamily}`);
  }

  const sourceReference =
    normalizeSourceReference(input.source_reference ?? input.sourceReference) ||
    buildGeneratedSourceReference({ sourceFamily, sourceToken });
  const sellerId = normalizeSellerId(
    input.seller_id ?? input.sellerId,
    sourceFamily
  );
  const isEnabled = normalizeBoolean(
    input.is_enabled ?? input.isEnabled ?? input.enabled,
    true
  );
  const exportable = normalizeBoolean(
    input.is_exportable ??
      input.isExportable ??
      input.exportable ??
      input.printable,
    true
  );
  const sourcePayload = normalizeSourcePayload(
    input.source_payload ?? input.sourcePayload ?? null
  );

  return freezeTelegramSourceRegistryValue({
    source_reference: sourceReference,
    source_family: sourceFamily,
    source_type: sourceType,
    source_token: sourceToken,
    seller_id: sellerId,
    is_enabled: isEnabled,
    is_exportable: exportable,
    source_payload: sourcePayload,
    token_classification: freezeTelegramSourceRegistryValue(tokenClassification),
  });
}

function normalizeListInput(input = {}) {
  if (input === null || input === undefined) {
    return freezeTelegramSourceRegistryValue({
      source_family: null,
      enabled: null,
    });
  }
  if (!isPlainObject(input)) {
    rejectSourceRegistry('source registry list input must be an object');
  }
  const sourceFamilyRaw = input.source_family ?? input.sourceFamily;
  const enabledRaw = input.enabled ?? input.is_enabled ?? input.isEnabled;
  return freezeTelegramSourceRegistryValue({
    source_family:
      sourceFamilyRaw === undefined || sourceFamilyRaw === null || sourceFamilyRaw === ''
        ? null
        : normalizeSourceFamily(sourceFamilyRaw),
    enabled:
      enabledRaw === undefined || enabledRaw === null || enabledRaw === ''
        ? null
        : normalizeBoolean(enabledRaw),
  });
}

function normalizeSourceRegistryReference(input = {}) {
  if (typeof input === 'number') {
    return freezeTelegramSourceRegistryValue({
      source_registry_item_id: normalizePositiveInteger(
        input,
        'source_registry_item_id'
      ),
      source_reference: null,
    });
  }
  if (typeof input === 'string') {
    return freezeTelegramSourceRegistryValue({
      source_registry_item_id: null,
      source_reference: normalizeSourceReference(input),
    });
  }
  if (!isPlainObject(input)) {
    rejectSourceRegistry('source registry reference is required');
  }

  const sourceRegistryItemIdRaw =
    input.source_registry_item_id ?? input.sourceRegistryItemId ?? null;
  const sourceReferenceRaw =
    input.source_reference ?? input.sourceReference ?? input.reference ?? null;
  if (
    (sourceRegistryItemIdRaw === null || sourceRegistryItemIdRaw === undefined || sourceRegistryItemIdRaw === '') &&
    (sourceReferenceRaw === null || sourceReferenceRaw === undefined || sourceReferenceRaw === '')
  ) {
    rejectSourceRegistry('source registry reference is required');
  }

  return freezeTelegramSourceRegistryValue({
    source_registry_item_id:
      sourceRegistryItemIdRaw === null || sourceRegistryItemIdRaw === undefined || sourceRegistryItemIdRaw === ''
        ? null
        : normalizePositiveInteger(sourceRegistryItemIdRaw, 'source_registry_item_id'),
    source_reference:
      sourceReferenceRaw === null || sourceReferenceRaw === undefined || sourceReferenceRaw === ''
        ? null
        : normalizeSourceReference(sourceReferenceRaw),
  });
}

function normalizeEnableInput(input = {}, enabledValue = undefined) {
  if (enabledValue !== undefined) {
    return freezeTelegramSourceRegistryValue({
      reference: normalizeSourceRegistryReference(input),
      enabled: normalizeBoolean(enabledValue),
    });
  }
  if (!isPlainObject(input)) {
    rejectSourceRegistry('source registry enable/disable input must be an object');
  }
  return freezeTelegramSourceRegistryValue({
    reference: normalizeSourceRegistryReference(input),
    enabled: normalizeBoolean(input.enabled ?? input.is_enabled ?? input.isEnabled),
  });
}

function hasAnyOwnProperty(target, keys) {
  if (!target || typeof target !== 'object') {
    return false;
  }
  return keys.some((key) => Object.prototype.hasOwnProperty.call(target, key));
}

function buildSourceRegistryReference(row) {
  return freezeTelegramSourceRegistryValue({
    reference_type: 'telegram_source_registry_item',
    source_registry_item_id: row.source_registry_item_id,
    source_reference: row.source_reference,
  });
}

function buildSellerReference(row) {
  if (!row.seller_id) {
    return null;
  }
  return freezeTelegramSourceRegistryValue({
    reference_type: 'seller_user',
    seller_id: row.seller_id,
  });
}

function buildSourceRegistryItem(row) {
  return freezeTelegramSourceRegistryValue({
    source_reference: buildSourceRegistryReference(row),
    source_type_family_summary: freezeTelegramSourceRegistryValue({
      source_family: row.source_family,
      source_type: row.source_type,
    }),
    source_token_summary: freezeTelegramSourceRegistryValue({
      source_token: row.source_token,
      token_prefix: String(row.source_token || '').slice(0, 16) || null,
    }),
    seller_reference: buildSellerReference(row),
    enabled_state_summary: freezeTelegramSourceRegistryValue({
      enabled: Boolean(row.is_enabled),
    }),
    printable_exportable_flag_summary: freezeTelegramSourceRegistryValue({
      printable: Boolean(row.is_exportable),
      exportable: Boolean(row.is_exportable),
    }),
    latest_timestamp_summary: buildTelegramHandoffTimestampSummary(
      row.updated_at || row.created_at
    ),
  });
}

function buildRowSignature(row) {
  return freezeTelegramSourceRegistryValue({
    source_reference: row.source_reference,
    source_family: row.source_family,
    source_type: row.source_type,
    source_token: row.source_token,
    seller_id: row.seller_id || null,
    is_enabled: Boolean(row.is_enabled),
    is_exportable: Boolean(row.is_exportable),
    source_payload: row.source_payload || null,
  });
}

function signaturesEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export class TelegramSourceRegistryService {
  constructor({
    sourceRegistryItems,
    now = () => new Date(),
  }) {
    this.sourceRegistryItems = sourceRegistryItems;
    this.now = now;
  }

  describe() {
    return Object.freeze({
      serviceName: SERVICE_NAME,
      status: 'telegram_source_registry_foundation_ready',
      dependencyKeys: ['sourceRegistryItems'],
    });
  }

  nowIso() {
    const date = this.now();
    const iso = date instanceof Date ? date.toISOString() : new Date(date).toISOString();
    if (Number.isNaN(Date.parse(iso))) {
      rejectSourceRegistry('source-registry clock returned an unusable timestamp');
    }
    return iso;
  }

  findSourceRegistryRow(referenceInput) {
    const reference = normalizeSourceRegistryReference(referenceInput);
    if (reference.source_registry_item_id) {
      const row = this.sourceRegistryItems.getById(reference.source_registry_item_id);
      if (row) return row;
    }
    if (reference.source_reference) {
      const row = this.sourceRegistryItems.findOneBy(
        { source_reference: reference.source_reference },
        { orderBy: 'source_registry_item_id ASC' }
      );
      if (row) return row;
    }
    rejectSourceRegistry('source registry item not found');
  }

  buildItemResult(row, responseVersion = TELEGRAM_SOURCE_REGISTRY_ITEM_VERSION) {
    return freezeTelegramSourceRegistryValue({
      response_version: responseVersion,
      read_only: true,
      projected_by: SERVICE_NAME,
      source_registry_item: buildSourceRegistryItem(row),
      latest_timestamp_summary: buildTelegramLatestTimestampSummary(
        this.nowIso(),
        row.updated_at,
        row.created_at
      ),
    });
  }

  buildMutationResult(row, operation) {
    return freezeTelegramSourceRegistryValue({
      response_version: TELEGRAM_SOURCE_REGISTRY_MUTATION_VERSION,
      persistence_applied: true,
      operation,
      processed_by: SERVICE_NAME,
      source_registry_item: buildSourceRegistryItem(row),
      latest_timestamp_summary: buildTelegramLatestTimestampSummary(
        this.nowIso(),
        row.updated_at,
        row.created_at
      ),
    });
  }

  listSourceRegistryItems(input = {}) {
    const filter = normalizeListInput(input);
    let rows = this.sourceRegistryItems.listBy(
      {},
      { orderBy: 'source_registry_item_id ASC', limit: 1000 }
    );
    if (filter.source_family) {
      rows = rows.filter((row) => row.source_family === filter.source_family);
    }
    if (filter.enabled !== null) {
      rows = rows.filter((row) => Boolean(row.is_enabled) === filter.enabled);
    }
    const items = rows.map((row) => buildSourceRegistryItem(row));
    return freezeTelegramSourceRegistryValue({
      response_version: TELEGRAM_SOURCE_REGISTRY_LIST_VERSION,
      read_only: true,
      projected_by: SERVICE_NAME,
      source_family_summary: filter.source_family,
      enabled_filter_summary: filter.enabled,
      item_count: items.length,
      items,
      latest_timestamp_summary: buildTelegramLatestTimestampSummary(
        this.nowIso(),
        ...items.map((item) => item.latest_timestamp_summary?.iso)
      ),
    });
  }

  readSourceRegistryItemByReference(input = {}) {
    const row = this.findSourceRegistryRow(input);
    return this.buildItemResult(row);
  }

  createSourceRegistryItem(input = {}) {
    const normalized = normalizeCreateInput(input);
    const existingByReference = this.sourceRegistryItems.findOneBy(
      { source_reference: normalized.source_reference },
      { orderBy: 'source_registry_item_id ASC' }
    );
    const existingByToken = this.sourceRegistryItems.findOneBy(
      { source_token: normalized.source_token },
      { orderBy: 'source_registry_item_id ASC' }
    );
    const existing = existingByReference || existingByToken || null;
    const normalizedSignature = buildRowSignature({
      source_reference: normalized.source_reference,
      source_family: normalized.source_family,
      source_type: normalized.source_type,
      source_token: normalized.source_token,
      seller_id: normalized.seller_id,
      is_enabled: normalized.is_enabled,
      is_exportable: normalized.is_exportable,
      source_payload: normalized.source_payload,
    });

    if (existing) {
      const existingSignature = buildRowSignature(existing);
      if (signaturesEqual(existingSignature, normalizedSignature)) {
        return this.buildMutationResult(existing, 'idempotent_create');
      }
      rejectSourceRegistry('duplicate incompatible source payload');
    }

    const nowIso = this.nowIso();
    const created = this.sourceRegistryItems.create({
      source_reference: normalized.source_reference,
      source_family: normalized.source_family,
      source_type: normalized.source_type,
      source_token: normalized.source_token,
      seller_id: normalized.seller_id,
      is_enabled: normalized.is_enabled ? 1 : 0,
      is_exportable: normalized.is_exportable ? 1 : 0,
      source_payload: {
        ...(normalized.source_payload || {}),
        token_classification: normalized.token_classification,
      },
      created_at: nowIso,
      updated_at: nowIso,
    });
    return this.buildMutationResult(created, 'created');
  }

  updateSourceRegistryItem(input = {}) {
    if (!isPlainObject(input)) {
      rejectSourceRegistry('source registry update payload must be an object');
    }

    const referenceInput = hasAnyOwnProperty(input, [
      'reference',
      'source_registry_item_id',
      'sourceRegistryItemId',
      'source_reference',
      'sourceReference',
    ])
      ? input.reference || input
      : null;
    const row = this.findSourceRegistryRow(referenceInput);

    const sourceFamilyDefined = hasAnyOwnProperty(input, ['source_family', 'sourceFamily']);
    const sourceTypeDefined = hasAnyOwnProperty(input, ['source_type', 'sourceType']);
    const sourceTokenDefined = hasAnyOwnProperty(input, ['source_token', 'sourceToken', 'token']);
    const sellerIdDefined = hasAnyOwnProperty(input, ['seller_id', 'sellerId']);
    const enabledDefined = hasAnyOwnProperty(input, ['is_enabled', 'isEnabled', 'enabled']);
    const exportableDefined = hasAnyOwnProperty(input, [
      'is_exportable',
      'isExportable',
      'exportable',
      'printable',
    ]);
    const sourcePayloadDefined = hasAnyOwnProperty(input, ['source_payload', 'sourcePayload']);

    const normalized = normalizeCreateInput({
      source_reference: row.source_reference,
      source_family: sourceFamilyDefined
        ? input.source_family ?? input.sourceFamily
        : row.source_family,
      source_type: sourceTypeDefined
        ? input.source_type ?? input.sourceType
        : row.source_type,
      source_token: sourceTokenDefined
        ? input.source_token ?? input.sourceToken ?? input.token
        : row.source_token,
      seller_id: sellerIdDefined ? input.seller_id ?? input.sellerId : row.seller_id,
      is_enabled: enabledDefined
        ? input.is_enabled ?? input.isEnabled ?? input.enabled
        : Boolean(row.is_enabled),
      is_exportable: exportableDefined
        ? input.is_exportable ??
          input.isExportable ??
          input.exportable ??
          input.printable
        : Boolean(row.is_exportable),
      source_payload: sourcePayloadDefined
        ? input.source_payload ?? input.sourcePayload
        : row.source_payload ?? null,
    });

    const existingByReference = this.sourceRegistryItems.findOneBy(
      { source_reference: normalized.source_reference },
      { orderBy: 'source_registry_item_id ASC' }
    );
    const existingByToken = this.sourceRegistryItems.findOneBy(
      { source_token: normalized.source_token },
      { orderBy: 'source_registry_item_id ASC' }
    );
    const conflictingRow = [existingByReference, existingByToken].find(
      (candidate) =>
        candidate &&
        candidate.source_registry_item_id !== row.source_registry_item_id
    );
    if (conflictingRow) {
      rejectSourceRegistry('duplicate incompatible source payload');
    }

    const normalizedSignature = buildRowSignature({
      source_reference: normalized.source_reference,
      source_family: normalized.source_family,
      source_type: normalized.source_type,
      source_token: normalized.source_token,
      seller_id: normalized.seller_id,
      is_enabled: normalized.is_enabled,
      is_exportable: normalized.is_exportable,
      source_payload: normalized.source_payload,
    });
    const currentSignature = buildRowSignature(row);
    if (signaturesEqual(currentSignature, normalizedSignature)) {
      return this.buildMutationResult(row, 'idempotent_update');
    }

    const updated = this.sourceRegistryItems.updateById(row.source_registry_item_id, {
      source_reference: normalized.source_reference,
      source_family: normalized.source_family,
      source_type: normalized.source_type,
      source_token: normalized.source_token,
      seller_id: normalized.seller_id,
      is_enabled: normalized.is_enabled ? 1 : 0,
      is_exportable: normalized.is_exportable ? 1 : 0,
      source_payload: {
        ...(normalized.source_payload || {}),
        token_classification: normalized.token_classification,
      },
      updated_at: this.nowIso(),
    });
    return this.buildMutationResult(updated, 'updated');
  }

  setSourceRegistryItemEnabledState(input = {}, enabledValue = undefined) {
    const normalized = normalizeEnableInput(input, enabledValue);
    const row = this.findSourceRegistryRow(normalized.reference);
    if (Boolean(row.is_enabled) === normalized.enabled) {
      return this.buildMutationResult(row, 'idempotent_enable_state');
    }
    const updated = this.sourceRegistryItems.updateById(row.source_registry_item_id, {
      is_enabled: normalized.enabled ? 1 : 0,
      updated_at: this.nowIso(),
    });
    return this.buildMutationResult(updated, 'enabled_state_updated');
  }

  enableSourceRegistryItem(input = {}) {
    return this.setSourceRegistryItemEnabledState(input, true);
  }

  disableSourceRegistryItem(input = {}) {
    return this.setSourceRegistryItemEnabledState(input, false);
  }
}
