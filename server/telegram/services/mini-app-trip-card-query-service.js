import { freezeTelegramHandoffValue } from '../../../shared/telegram/index.js';
import {
  freezeMiniAppValue,
  normalizeMiniAppTripSlotReference,
  normalizeString,
  projectMiniAppTripItem,
  readMiniAppTripRowByReference,
} from './mini-app-trip-query-shared.js';

export const TELEGRAM_MINI_APP_TRIP_CARD_RESULT_VERSION =
  'telegram_mini_app_trip_card_query_result.v1';

const ERROR_PREFIX = '[TELEGRAM_MINI_APP_TRIP_CARD]';
const SERVICE_NAME = 'telegram_mini_app_trip_card_query_service';

function rejectTripCard(message) {
  throw new Error(`${ERROR_PREFIX} ${message}`);
}

function buildTripDescriptionSummary(row) {
  const templateItemName = normalizeString(row.template_item_name);
  if (templateItemName) {
    return freezeMiniAppValue({
      summary_type: 'available',
      short_description: templateItemName,
      source: 'schedule_template_items.name',
    });
  }

  const durationMinutes = Number(row.duration_minutes);
  if (Number.isInteger(durationMinutes) && durationMinutes > 0) {
    return freezeMiniAppValue({
      summary_type: 'available',
      short_description: `Duration ${durationMinutes} minutes`,
      source: 'slot.duration_minutes',
    });
  }

  return freezeMiniAppValue({
    summary_type: 'unavailable',
    short_description: null,
    source: null,
  });
}

function buildRouteMeetingPointSummary() {
  return freezeMiniAppValue({
    summary_type: 'unavailable',
    route_summary: null,
    meeting_point_summary: null,
  });
}

function pickTripSlotReferenceInput(input = {}) {
  if (input?.reference_type) {
    return input;
  }

  return (
    input.requested_trip_slot_reference ??
    input.requestedTripSlotReference ??
    input.trip_slot_reference ??
    input.tripSlotReference ??
    input.trip_reference ??
    input.tripReference ??
    input ??
    null
  );
}

export class TelegramMiniAppTripCardQueryService {
  constructor({
    bookingRequests,
    now = () => new Date(),
  }) {
    this.bookingRequests = bookingRequests;
    this.now = now;
  }

  describe() {
    return Object.freeze({
      serviceName: 'mini-app-trip-card-query-service',
      status: 'read_only_mini_app_trip_card_ready',
      dependencyKeys: ['bookingRequests'],
    });
  }

  nowIso() {
    const date = this.now();
    const iso = date instanceof Date ? date.toISOString() : new Date(date).toISOString();
    if (Number.isNaN(Date.parse(iso))) {
      rejectTripCard('trip-card query clock returned an unusable timestamp');
    }

    return iso;
  }

  get db() {
    return this.bookingRequests?.db || null;
  }

  readMiniAppTripCardByTripSlotReference(input = {}) {
    if (!this.db?.prepare) {
      rejectTripCard('Mini App trip-card query requires a SQLite persistence context');
    }

    const nowIso = this.nowIso();
    const tripSlotReference = normalizeMiniAppTripSlotReference(
      pickTripSlotReferenceInput(input),
      rejectTripCard,
      { requireDateTime: false }
    );
    const row = readMiniAppTripRowByReference(this.db, tripSlotReference, rejectTripCard);
    const projectionItem = projectMiniAppTripItem(row, nowIso);

    return freezeTelegramHandoffValue({
      response_version: TELEGRAM_MINI_APP_TRIP_CARD_RESULT_VERSION,
      read_only: true,
      projection_only: true,
      projected_by: SERVICE_NAME,
      trip_slot_reference: projectionItem.trip_slot_reference,
      trip_title_summary: projectionItem.trip_title_summary,
      date_time_summary: projectionItem.date_time_summary,
      trip_type_summary: projectionItem.trip_type_summary,
      seats_availability_summary: projectionItem.seats_availability_summary,
      price_summary: projectionItem.price_summary,
      trip_description_summary: buildTripDescriptionSummary(row),
      route_meeting_point_summary: buildRouteMeetingPointSummary(row),
      booking_availability_state: projectionItem.booking_availability_state,
      latest_timestamp_summary: projectionItem.latest_timestamp_summary,
    });
  }

  readByTripSlotReference(input = {}) {
    return this.readMiniAppTripCardByTripSlotReference(input);
  }
}

