export const BUYER_TICKET_CODE_ALPHABET = Object.freeze(
  Array.from('АБВГДЕЖЗИКЛМНОПРСТУФХЦЧШЭЮЯ')
);

export const BUYER_TICKET_CODE_SEQUENCE_STRATEGY =
  'canonical_presale_id_bijective_cyrillic_v1';
export const DISPATCHER_BOARDING_QR_PAYLOAD_FORMAT = 'boat_ticket_boarding_qr_v1';

const BUYER_TICKET_NUMERIC_SPACE = 99;
const BOARDING_QR_PAYLOAD_PREFIX = 'boat-ticket:v1';

function rejectBuyerTicketReference(message) {
  throw new Error(`[BUYER_TICKET_REFERENCE] ${message}`);
}

function normalizePositiveInteger(value, label) {
  const normalized = Number(value);
  if (!Number.isInteger(normalized) || normalized <= 0) {
    rejectBuyerTicketReference(`${label} must be a positive integer`);
  }
  return normalized;
}

function normalizeOptionalPositiveInteger(value) {
  const normalized = Number(value);
  if (!Number.isInteger(normalized) || normalized <= 0) {
    return null;
  }
  return normalized;
}

function normalizePositiveIntegerList(values = []) {
  if (!Array.isArray(values)) {
    return [];
  }

  return Array.from(
    new Set(
      values
        .map((value) => normalizeOptionalPositiveInteger(value))
        .filter((value) => Number.isInteger(value) && value > 0)
    )
  ).sort((left, right) => left - right);
}

export function encodeBuyerTicketPrefixFromOrdinal(prefixOrdinal) {
  const normalizedOrdinal = normalizePositiveInteger(prefixOrdinal + 1, 'prefixOrdinal');
  const alphabetSize = BUYER_TICKET_CODE_ALPHABET.length;
  let remainder = normalizedOrdinal;
  const chars = [];

  while (remainder > 0) {
    remainder -= 1;
    chars.push(BUYER_TICKET_CODE_ALPHABET[remainder % alphabetSize]);
    remainder = Math.floor(remainder / alphabetSize);
  }

  return chars.reverse().join('');
}

export function buildBuyerTicketCodeFromSequence(sequenceNumber) {
  const normalizedSequence = normalizePositiveInteger(
    sequenceNumber,
    'sequenceNumber'
  );
  const zeroBasedSequence = normalizedSequence - 1;
  const prefixOrdinal = Math.floor(zeroBasedSequence / BUYER_TICKET_NUMERIC_SPACE);
  const numericPart = (zeroBasedSequence % BUYER_TICKET_NUMERIC_SPACE) + 1;

  return `${encodeBuyerTicketPrefixFromOrdinal(prefixOrdinal)}${numericPart}`;
}

export function buildBuyerTicketCodeFromCanonicalPresaleId(canonicalPresaleId) {
  return buildBuyerTicketCodeFromSequence(
    normalizePositiveInteger(canonicalPresaleId, 'canonicalPresaleId')
  );
}

export function buildBuyerTicketReferenceSummary({
  canonicalPresaleId = null,
  canonicalTicketIds = [],
} = {}) {
  const normalizedPresaleId = normalizeOptionalPositiveInteger(canonicalPresaleId);
  if (!normalizedPresaleId) {
    return null;
  }

  const normalizedTicketIds = normalizePositiveIntegerList(canonicalTicketIds);
  const buyerTicketCode = buildBuyerTicketCodeFromCanonicalPresaleId(normalizedPresaleId);

  return Object.freeze({
    code_generation_strategy: BUYER_TICKET_CODE_SEQUENCE_STRATEGY,
    buyer_ticket_code: buyerTicketCode,
    display_title: `Билет ${buyerTicketCode}`,
    canonical_presale_id: normalizedPresaleId,
    canonical_ticket_count: normalizedTicketIds.length,
    canonical_ticket_ids: normalizedTicketIds,
  });
}

export function buildDispatcherBoardingQrPayload({
  canonicalPresaleId = null,
  canonicalTicketIds = [],
} = {}) {
  const normalizedPresaleId = normalizeOptionalPositiveInteger(canonicalPresaleId);
  const normalizedTicketIds = normalizePositiveIntegerList(canonicalTicketIds);

  if (!normalizedPresaleId && normalizedTicketIds.length === 0) {
    return null;
  }

  const segments = [BOARDING_QR_PAYLOAD_PREFIX];
  if (normalizedPresaleId) {
    segments.push(`presale=${normalizedPresaleId}`);
  }
  if (normalizedTicketIds.length > 0) {
    segments.push(`tickets=${normalizedTicketIds.join(',')}`);
  }

  return segments.join('|');
}

export function buildDispatcherBoardingQrSummary({
  canonicalPresaleId = null,
  canonicalTicketIds = [],
  buyerTicketCode = null,
} = {}) {
  const normalizedPresaleId = normalizeOptionalPositiveInteger(canonicalPresaleId);
  const normalizedTicketIds = normalizePositiveIntegerList(canonicalTicketIds);
  const qrPayloadText = buildDispatcherBoardingQrPayload({
    canonicalPresaleId: normalizedPresaleId,
    canonicalTicketIds: normalizedTicketIds,
  });

  if (!qrPayloadText) {
    return null;
  }

  return Object.freeze({
    payload_format: DISPATCHER_BOARDING_QR_PAYLOAD_FORMAT,
    payload_source: 'canonical_presale_id_and_ticket_ids',
    compatibility_target: 'dispatcher_boarding_existing_ids',
    qr_payload_text: qrPayloadText,
    buyer_ticket_code: String(buyerTicketCode || '').trim() || null,
    canonical_presale_reference: normalizedPresaleId
      ? {
          reference_type: 'canonical_presale',
          presale_id: normalizedPresaleId,
        }
      : null,
    canonical_ticket_references: normalizedTicketIds.map((ticketId) =>
      Object.freeze({
        reference_type: 'canonical_ticket',
        ticket_id: ticketId,
      })
    ),
  });
}

export function parseDispatcherBoardingQrPayload(payload) {
  const normalizedPayload = String(payload ?? '').trim();
  if (!normalizedPayload) {
    return null;
  }

  const parts = normalizedPayload.split('|').map((part) => part.trim()).filter(Boolean);
  if (parts[0] !== BOARDING_QR_PAYLOAD_PREFIX) {
    return null;
  }

  const result = {
    payload_format: DISPATCHER_BOARDING_QR_PAYLOAD_FORMAT,
    canonicalPresaleId: null,
    canonicalTicketIds: [],
  };

  for (const segment of parts.slice(1)) {
    const [rawKey, rawValue = ''] = segment.split('=');
    const key = String(rawKey || '').trim();
    const value = String(rawValue || '').trim();

    if (key === 'presale') {
      result.canonicalPresaleId = normalizeOptionalPositiveInteger(value);
      continue;
    }

    if (key === 'tickets') {
      result.canonicalTicketIds = normalizePositiveIntegerList(
        value
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean)
      );
    }
  }

  if (!result.canonicalPresaleId && result.canonicalTicketIds.length === 0) {
    return null;
  }

  return Object.freeze(result);
}
