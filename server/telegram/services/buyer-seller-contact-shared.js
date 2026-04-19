import {
  buildTelegramContactPhoneSummary,
  freezeTelegramHandoffValue,
} from '../../../shared/telegram/index.js';

function normalizeString(value) {
  const normalized = String(value ?? '').trim();
  return normalized || null;
}

function normalizePhoneE164(value) {
  const normalized = normalizeString(value);
  if (!normalized || !/^\+[1-9]\d{7,14}$/.test(normalized)) {
    return null;
  }
  return normalized;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readNestedObject(value, keys = []) {
  if (!isPlainObject(value)) {
    return null;
  }

  for (const key of keys) {
    if (isPlainObject(value[key])) {
      return value[key];
    }
  }

  return null;
}

function pickFirstString(candidates = []) {
  for (const candidate of candidates) {
    const normalized = normalizeString(candidate);
    if (normalized) {
      return normalized;
    }
  }
  return null;
}

function pickFirstPhone(candidates = []) {
  for (const candidate of candidates) {
    const normalized = normalizePhoneE164(candidate);
    if (normalized) {
      return normalized;
    }
  }
  return null;
}

function readMetadataName(metadata = null) {
  if (!isPlainObject(metadata)) {
    return null;
  }

  const sellerContact = readNestedObject(metadata, ['seller_contact', 'sellerContact']);
  const seller = readNestedObject(metadata, ['seller']);
  const contact = readNestedObject(metadata, ['contact']);

  return pickFirstString([
    sellerContact?.name,
    sellerContact?.display_name,
    sellerContact?.displayName,
    sellerContact?.title,
    sellerContact?.seller_name,
    sellerContact?.sellerName,
    seller?.name,
    seller?.display_name,
    seller?.displayName,
    seller?.title,
    seller?.seller_name,
    seller?.sellerName,
    contact?.name,
    contact?.display_name,
    contact?.displayName,
    metadata.seller_name,
    metadata.sellerName,
    metadata.seller_display_name,
    metadata.sellerDisplayName,
    metadata.display_name,
    metadata.displayName,
    metadata.contact_name,
    metadata.contactName,
    metadata.title,
  ]);
}

function readMetadataPhone(metadata = null) {
  if (!isPlainObject(metadata)) {
    return null;
  }

  const sellerContact = readNestedObject(metadata, ['seller_contact', 'sellerContact']);
  const seller = readNestedObject(metadata, ['seller']);
  const contact = readNestedObject(metadata, ['contact']);

  return pickFirstPhone([
    sellerContact?.phone_e164,
    sellerContact?.phoneE164,
    sellerContact?.phone,
    seller?.phone_e164,
    seller?.phoneE164,
    seller?.phone,
    contact?.phone_e164,
    contact?.phoneE164,
    contact?.phone,
    metadata.seller_phone_e164,
    metadata.sellerPhoneE164,
    metadata.seller_phone,
    metadata.sellerPhone,
    metadata.contact_phone_e164,
    metadata.contactPhoneE164,
    metadata.contact_phone,
    metadata.contactPhone,
    metadata.phone_e164,
    metadata.phoneE164,
    metadata.phone,
  ]);
}

function listSourceRegistryLookupCandidates({ sourceQRCode = null, trafficSource = null } = {}) {
  const entryContext = isPlainObject(sourceQRCode?.entry_context)
    ? sourceQRCode.entry_context
    : null;

  return [
    {
      type: 'source_token',
      value: normalizeString(sourceQRCode?.qr_token),
    },
    {
      type: 'source_reference',
      value: normalizeString(entryContext?.source_reference),
    },
    {
      type: 'source_reference',
      value: normalizeString(trafficSource?.source_code),
    },
  ].filter((candidate, index, list) => {
    if (!candidate.value) {
      return false;
    }
    return (
      list.findIndex(
        (other) => other.type === candidate.type && other.value === candidate.value
      ) === index
    );
  });
}

function resolveSourceRegistryItem({
  sourceRegistryItems = null,
  sourceQRCode = null,
  trafficSource = null,
}) {
  if (!sourceRegistryItems?.findOneBy) {
    return null;
  }

  const candidates = listSourceRegistryLookupCandidates({
    sourceQRCode,
    trafficSource,
  });
  for (const candidate of candidates) {
    const row = sourceRegistryItems.findOneBy(
      { [candidate.type]: candidate.value },
      { orderBy: 'source_registry_item_id ASC' }
    );
    if (row) {
      return row;
    }
  }

  return null;
}

function resolveSellerUser({ db = null, sellerId = null }) {
  const normalizedSellerId = Number(sellerId);
  if (!db?.prepare || !Number.isInteger(normalizedSellerId) || normalizedSellerId <= 0) {
    return null;
  }

  try {
    const userColumns = new Set(
      db.prepare('PRAGMA table_info(users)').all().map((column) => column.name)
    );
    const selectColumns = ['id'];
    if (userColumns.has('username')) {
      selectColumns.push('username');
    }
    if (userColumns.has('public_display_name')) {
      selectColumns.push('public_display_name');
    }
    if (userColumns.has('public_phone_e164')) {
      selectColumns.push('public_phone_e164');
    }

    return (
      db
        .prepare(
          `
            SELECT ${selectColumns.join(', ')}
            FROM users
            WHERE id = ?
            LIMIT 1
          `
        )
        .get(normalizedSellerId) || null
    );
  } catch {
    return null;
  }
}

export function resolveTelegramBuyerSellerContactSummary({
  db = null,
  sellerAttributionSessions = null,
  trafficSources = null,
  sourceQRCodes = null,
  sourceRegistryItems = null,
  sellerAttributionSessionId = null,
  sellerId = null,
} = {}) {
  const normalizedSessionId = Number(sellerAttributionSessionId);
  const session =
    sellerAttributionSessions?.getById &&
    Number.isInteger(normalizedSessionId) &&
    normalizedSessionId > 0
      ? sellerAttributionSessions.getById(normalizedSessionId)
      : null;
  const resolvedSellerId =
    Number(session?.seller_id) || Number(sellerId) || null;
  const trafficSource =
    trafficSources?.getById && Number(session?.traffic_source_id) > 0
      ? trafficSources.getById(session.traffic_source_id)
      : null;
  const sourceQRCode =
    sourceQRCodes?.getById && Number(session?.source_qr_code_id) > 0
      ? sourceQRCodes.getById(session.source_qr_code_id)
      : null;
  const sourceRegistryItem = resolveSourceRegistryItem({
    sourceRegistryItems,
    sourceQRCode,
    trafficSource,
  });
  const registryPayload = isPlainObject(sourceRegistryItem?.source_payload)
    ? sourceRegistryItem.source_payload
    : null;
  const entryContext = isPlainObject(sourceQRCode?.entry_context)
    ? sourceQRCode.entry_context
    : null;
  const sellerUser = resolveSellerUser({
    db,
    sellerId: resolvedSellerId,
  });
  const sellerPublicDisplayName = normalizeString(sellerUser?.public_display_name);
  const sellerPublicPhoneE164 = normalizePhoneE164(sellerUser?.public_phone_e164);

  const sellerDisplayName = pickFirstString([
    sellerPublicDisplayName,
    readMetadataName(entryContext),
    readMetadataName(registryPayload),
    resolvedSellerId ? 'Продавец' : null,
  ]);
  const sellerPhoneE164 = pickFirstPhone([
    sellerPublicPhoneE164,
    readMetadataPhone(entryContext),
    readMetadataPhone(registryPayload),
  ]);

  if (!resolvedSellerId && !sellerDisplayName && !sellerPhoneE164) {
    return null;
  }

  const sourceMetadataOrigin =
    sellerPublicDisplayName || sellerPublicPhoneE164
      ? 'seller_user_public_profile'
      : sellerPhoneE164
        ? readMetadataPhone(entryContext)
          ? 'source_qr_entry_context'
          : 'source_registry_payload'
        : sellerDisplayName
          ? readMetadataName(entryContext)
            ? 'source_qr_entry_context'
            : readMetadataName(registryPayload)
              ? 'source_registry_payload'
              : 'seller_user_fallback_label'
          : null;

  return freezeTelegramHandoffValue({
    seller_id: resolvedSellerId || null,
    seller_display_name: sellerDisplayName,
    seller_phone_e164: sellerPhoneE164,
    seller_phone_summary: sellerPhoneE164
      ? buildTelegramContactPhoneSummary(sellerPhoneE164)
      : null,
    seller_attribution_session_id:
      Number(session?.seller_attribution_session_id) || null,
    traffic_source_id: Number(trafficSource?.traffic_source_id) || null,
    source_qr_code_id: Number(sourceQRCode?.source_qr_code_id) || null,
    source_registry_item_id: Number(sourceRegistryItem?.source_registry_item_id) || null,
    source_reference: pickFirstString([
      normalizeString(entryContext?.source_reference),
      normalizeString(sourceRegistryItem?.source_reference),
      normalizeString(trafficSource?.source_code),
    ]),
    source_metadata_origin: sourceMetadataOrigin,
  });
}
