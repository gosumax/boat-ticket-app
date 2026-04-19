import {
  buildTelegramHandoffTimestampSummary,
  buildTelegramLatestTimestampSummary,
  freezeTelegramQrExportPayloadValue,
  TELEGRAM_QR_EXPORT_PAYLOAD_ITEM_VERSION,
  TELEGRAM_QR_EXPORT_PAYLOAD_LIST_VERSION,
} from '../../../shared/telegram/index.js';
import {
  classifyTelegramStartSourceTokenForRegistry,
} from './start-source-token-resolution-service.js';

const ERROR_PREFIX = '[TELEGRAM_QR_EXPORT_PAYLOAD]';
const SERVICE_NAME = 'telegram_qr_export_payload_service';

function rejectQrExportPayload(message) {
  throw new Error(`${ERROR_PREFIX} ${message}`);
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeString(value) {
  const normalized = String(value ?? '').trim();
  return normalized || null;
}

function normalizePositiveInteger(value, label) {
  const normalized = Number(value);
  if (!Number.isInteger(normalized) || normalized <= 0) {
    rejectQrExportPayload(`${label} must be a positive integer`);
  }
  return normalized;
}

function sanitizeLabel(value) {
  return String(value || '')
    .trim()
    .replace(/[^A-Za-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();
}

function normalizeSourceReferenceInput(input = {}) {
  if (typeof input === 'number') {
    return freezeTelegramQrExportPayloadValue({
      source_registry_item_id: normalizePositiveInteger(
        input,
        'source_registry_item_id'
      ),
      source_reference: null,
    });
  }
  if (typeof input === 'string') {
    const sourceReference = normalizeString(input);
    if (!sourceReference) {
      rejectQrExportPayload('source reference is required');
    }
    return freezeTelegramQrExportPayloadValue({
      source_registry_item_id: null,
      source_reference: sourceReference,
    });
  }
  if (!isPlainObject(input)) {
    rejectQrExportPayload('source reference is required');
  }
  const sourceRegistryItemIdRaw =
    input.source_registry_item_id ?? input.sourceRegistryItemId;
  const sourceReferenceRaw =
    input.source_reference ??
    input.sourceReference ??
    input.reference;
  if (
    (sourceRegistryItemIdRaw === null ||
      sourceRegistryItemIdRaw === undefined ||
      sourceRegistryItemIdRaw === '') &&
    (sourceReferenceRaw === null ||
      sourceReferenceRaw === undefined ||
      sourceReferenceRaw === '')
  ) {
    rejectQrExportPayload('source reference is required');
  }

  return freezeTelegramQrExportPayloadValue({
    source_registry_item_id:
      sourceRegistryItemIdRaw === null ||
      sourceRegistryItemIdRaw === undefined ||
      sourceRegistryItemIdRaw === ''
        ? null
        : normalizePositiveInteger(sourceRegistryItemIdRaw, 'source_registry_item_id'),
    source_reference:
      sourceReferenceRaw === null ||
      sourceReferenceRaw === undefined ||
      sourceReferenceRaw === ''
        ? null
        : normalizeString(sourceReferenceRaw),
  });
}

function mapResolvedTokenFamilyToRegistryFamily(sourceFamily) {
  if (
    sourceFamily === 'seller_qr' ||
    sourceFamily === 'seller_direct_link' ||
    sourceFamily === 'seller_tshirt_qr'
  ) {
    return 'seller_source';
  }
  if (sourceFamily === 'owner_source') {
    return 'owner_source';
  }
  if (sourceFamily === 'promo_qr' || sourceFamily === 'point_qr') {
    return 'point_promo_source';
  }
  return 'generic_source';
}

function buildSourceReference(row) {
  return freezeTelegramQrExportPayloadValue({
    reference_type: 'telegram_source_registry_item',
    source_registry_item_id: row.source_registry_item_id,
    source_reference: row.source_reference,
  });
}

function buildPayloadSummary(row, classification) {
  const fileNameSafeReference = sanitizeLabel(row.source_reference) || 'telegram_source';
  return freezeTelegramQrExportPayloadValue({
    payload_format: 'telegram_start_source_token_payload.v1',
    qr_payload_text: `telegram_start_source:${row.source_token}`,
    start_command_payload: `/start ${row.source_token}`,
    export_file_name: `${fileNameSafeReference}.telegram-qr.txt`,
    token_resolution_summary: freezeTelegramQrExportPayloadValue({
      resolution_status: classification.resolutionStatus,
      source_family: classification.sourceFamily,
      reason: classification.reason,
    }),
  });
}

function buildDisplayLabelSummary(row) {
  const familyLabel = row.source_family.replace(/_/g, ' ');
  return freezeTelegramQrExportPayloadValue({
    short_label: row.source_reference,
    printable_title: `${familyLabel} - ${row.source_reference}`,
    printable_subtitle: `${row.source_type} / ${row.source_token}`,
  });
}

function buildProjectionItem(row, classification) {
  return freezeTelegramQrExportPayloadValue({
    source_reference: buildSourceReference(row),
    source_type_family_summary: freezeTelegramQrExportPayloadValue({
      source_family: row.source_family,
      source_type: row.source_type,
    }),
    source_token_summary: freezeTelegramQrExportPayloadValue({
      source_token: row.source_token,
      token_prefix: String(row.source_token || '').slice(0, 16) || null,
    }),
    printable_exportable_payload_summary: buildPayloadSummary(row, classification),
    display_label_summary: buildDisplayLabelSummary(row),
    enabled_state_summary: freezeTelegramQrExportPayloadValue({
      enabled: Boolean(row.is_enabled),
    }),
    latest_timestamp_summary: buildTelegramHandoffTimestampSummary(
      row.updated_at || row.created_at
    ),
  });
}

export class TelegramQrExportPayloadService {
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
      status: 'telegram_qr_export_payload_ready',
      dependencyKeys: ['sourceRegistryItems'],
    });
  }

  nowIso() {
    const date = this.now();
    const iso = date instanceof Date ? date.toISOString() : new Date(date).toISOString();
    if (Number.isNaN(Date.parse(iso))) {
      rejectQrExportPayload('qr-export clock returned an unusable timestamp');
    }
    return iso;
  }

  findSourceRegistryRow(referenceInput = {}) {
    const normalized = normalizeSourceReferenceInput(referenceInput);
    if (normalized.source_registry_item_id) {
      const rowById = this.sourceRegistryItems.getById(normalized.source_registry_item_id);
      if (rowById) {
        return rowById;
      }
    }
    if (normalized.source_reference) {
      const rowByReference = this.sourceRegistryItems.findOneBy(
        { source_reference: normalized.source_reference },
        { orderBy: 'source_registry_item_id ASC' }
      );
      if (rowByReference) {
        return rowByReference;
      }
    }
    rejectQrExportPayload('invalid or non-projectable source input');
  }

  classifyAndValidateRow(row) {
    if (!row.source_token) {
      rejectQrExportPayload('source token is required for export payload generation');
    }
    if (!Boolean(row.is_enabled)) {
      rejectQrExportPayload(`source is disabled and cannot be exported: ${row.source_reference}`);
    }
    if (!Boolean(row.is_exportable)) {
      rejectQrExportPayload(
        `source is marked as non-exportable: ${row.source_reference}`
      );
    }

    const classification = classifyTelegramStartSourceTokenForRegistry(row.source_token);
    if (
      classification.resolutionStatus === 'no_source_token' ||
      classification.resolutionStatus === 'unresolved_source_token'
    ) {
      rejectQrExportPayload(
        `source token is incompatible with start-source rules: ${row.source_reference}`
      );
    }
    const compatibleFamily = mapResolvedTokenFamilyToRegistryFamily(
      classification.sourceFamily
    );
    if (compatibleFamily !== row.source_family) {
      rejectQrExportPayload(
        `incompatible source family for export payload: ${row.source_family}/${classification.sourceFamily}`
      );
    }
    return classification;
  }

  buildItemResult(row, classification) {
    return freezeTelegramQrExportPayloadValue({
      response_version: TELEGRAM_QR_EXPORT_PAYLOAD_ITEM_VERSION,
      read_only: true,
      projected_by: SERVICE_NAME,
      qr_export_payload: buildProjectionItem(row, classification),
      latest_timestamp_summary: buildTelegramLatestTimestampSummary(
        this.nowIso(),
        row.updated_at,
        row.created_at
      ),
    });
  }

  buildQrExportPayloadBySourceReference(input = {}) {
    const row = this.findSourceRegistryRow(input);
    const classification = this.classifyAndValidateRow(row);
    return this.buildItemResult(row, classification);
  }

  listQrExportPayloadsForEnabledSources(input = {}) {
    if (!isPlainObject(input) && input !== null && input !== undefined) {
      rejectQrExportPayload('qr export list input must be an object');
    }
    const reportingIso = this.nowIso();
    const rows = this.sourceRegistryItems.listBy(
      { is_enabled: 1, is_exportable: 1 },
      { orderBy: 'source_registry_item_id ASC', limit: 2000 }
    );
    const items = rows.map((row) =>
      buildProjectionItem(row, this.classifyAndValidateRow(row))
    );
    return freezeTelegramQrExportPayloadValue({
      response_version: TELEGRAM_QR_EXPORT_PAYLOAD_LIST_VERSION,
      read_only: true,
      projected_by: SERVICE_NAME,
      item_count: items.length,
      items,
      latest_timestamp_summary: buildTelegramLatestTimestampSummary(
        reportingIso,
        ...items.map((item) => item.latest_timestamp_summary?.iso)
      ),
    });
  }
}
