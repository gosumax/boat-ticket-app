import {
  TELEGRAM_EVENT_TYPES,
  TELEGRAM_SOURCE_FAMILIES,
  SELLER_SOURCE_FAMILIES,
} from '../../../shared/telegram/index.js';

const ATTRIBUTION_WINDOW_HOURS = 30;

function toIsoTimestamp(input) {
  const date = input instanceof Date ? input : new Date(input);
  return date.toISOString();
}

function addHours(isoTimestamp, hours) {
  const date = new Date(isoTimestamp);
  date.setHours(date.getHours() + hours);
  return date.toISOString();
}

function normalizeSourceType(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
}

function mapSourceTypeToFamily(sourceType, entryChannel) {
  const normalizedType = normalizeSourceType(sourceType);
  const normalizedChannel = normalizeSourceType(entryChannel);

  const aliases = new Map([
    ['seller_qr', 'seller_qr'],
    ['seller_direct_link', 'seller_direct_link'],
    ['seller_tshirt_qr', 'seller_tshirt_qr'],
    ['promo_qr', 'promo_qr'],
    ['point_qr', 'point_qr'],
    ['generic_qr', 'generic_qr'],
    ['bot_search_entry', 'bot_search_entry'],
    ['messenger_link', 'messenger_link'],
    ['other_campaign', 'other_campaign'],
    ['seller_link', 'seller_direct_link'],
    ['seller_t_shirt_qr', 'seller_tshirt_qr'],
    ['bot_search', 'bot_search_entry'],
    ['search', 'bot_search_entry'],
    ['messenger', 'messenger_link'],
    ['campaign', 'other_campaign'],
  ]);

  if (aliases.has(normalizedType)) {
    return aliases.get(normalizedType);
  }
  if (normalizedChannel === 'bot_search_entry' || normalizedChannel === 'bot_search') {
    return 'bot_search_entry';
  }
  if (normalizedChannel === 'messenger_link' || normalizedChannel === 'messenger') {
    return 'messenger_link';
  }
  return 'other_campaign';
}

function isSellerFamily(sourceFamily) {
  return SELLER_SOURCE_FAMILIES.includes(sourceFamily);
}

export class TelegramSourceAttributionService {
  constructor({
    guestProfiles,
    guestEntries,
    trafficSources,
    sourceQRCodes,
    sellerAttributionSessions,
    analyticsEvents,
    bookingRequests,
    now = () => new Date(),
  }) {
    this.guestProfiles = guestProfiles;
    this.guestEntries = guestEntries;
    this.trafficSources = trafficSources;
    this.sourceQRCodes = sourceQRCodes;
    this.sellerAttributionSessions = sellerAttributionSessions;
    this.analyticsEvents = analyticsEvents;
    this.bookingRequests = bookingRequests;
    this.now = now;
  }

  describe() {
    return Object.freeze({
      serviceName: 'seller-attribution-service',
      status: 'lifecycle_ready',
      dependencyKeys: [
        'guestProfiles',
        'guestEntries',
        'trafficSources',
        'sourceQRCodes',
        'sellerAttributionSessions',
        'analyticsEvents',
        'bookingRequests',
      ],
    });
  }

  nowIso() {
    return toIsoTimestamp(this.now());
  }

  getGuestProfileOrThrow(guestProfileId) {
    const guestProfile = this.guestProfiles.getById(guestProfileId);
    if (!guestProfile) {
      throw new Error(`[TELEGRAM_ATTRIBUTION] Guest profile not found: ${guestProfileId}`);
    }
    return guestProfile;
  }

  getTrafficSourceOrThrow(trafficSourceId) {
    const trafficSource = this.trafficSources.getById(trafficSourceId);
    if (!trafficSource) {
      throw new Error(`[TELEGRAM_ATTRIBUTION] Traffic source not found: ${trafficSourceId}`);
    }
    return trafficSource;
  }

  getSourceQRCodeOrThrow(sourceQRCodeId) {
    const sourceQRCode = this.sourceQRCodes.getById(sourceQRCodeId);
    if (!sourceQRCode) {
      throw new Error(`[TELEGRAM_ATTRIBUTION] Source QR code not found: ${sourceQRCodeId}`);
    }
    return sourceQRCode;
  }

  classifySourceFamily({ sourceType, entryChannel }) {
    const sourceFamily = mapSourceTypeToFamily(sourceType, entryChannel);
    if (!TELEGRAM_SOURCE_FAMILIES.includes(sourceFamily)) {
      throw new Error(`[TELEGRAM_ATTRIBUTION] Unsupported source family: ${sourceFamily}`);
    }
    return sourceFamily;
  }

  listGuestEntries(guestProfileId) {
    return this.guestEntries.listBy(
      { guest_profile_id: guestProfileId },
      { orderBy: 'guest_entry_id ASC', limit: 500 }
    );
  }

  listSellerAttributionSessions(guestProfileId) {
    return this.sellerAttributionSessions.listBy(
      { guest_profile_id: guestProfileId },
      { orderBy: 'seller_attribution_session_id ASC', limit: 500 }
    );
  }

  listAnalyticsEvents(guestProfileId) {
    return this.analyticsEvents.listBy(
      { guest_profile_id: guestProfileId },
      { orderBy: 'analytics_event_id ASC', limit: 500 }
    );
  }

  appendAnalyticsEvent({
    eventType,
    guestProfileId = null,
    trafficSourceId = null,
    bookingRequestId = null,
    notificationId = null,
    eventValue = null,
    eventPayload = {},
    eventAt = this.nowIso(),
  }) {
    if (!TELEGRAM_EVENT_TYPES.includes(eventType)) {
      throw new Error(`[TELEGRAM_ATTRIBUTION] Unknown event type: ${eventType}`);
    }

    return this.analyticsEvents.create({
      event_type: eventType,
      event_at: eventAt,
      guest_profile_id: guestProfileId,
      traffic_source_id: trafficSourceId,
      booking_request_id: bookingRequestId,
      notification_id: notificationId,
      event_value: eventValue,
      event_payload: eventPayload,
    });
  }

  hasBookingLock(guestProfileId) {
    return this.bookingRequests.listBy(
      { guest_profile_id: guestProfileId },
      { orderBy: 'booking_request_id DESC', limit: 1 }
    ).length > 0;
  }

  expireAttributionSession(session, expiredAt) {
    const updatedSession = this.sellerAttributionSessions.updateById(session.seller_attribution_session_id, {
      attribution_status: 'EXPIRED',
    });

    this.appendAnalyticsEvent({
      eventType: 'ATTRIBUTION_EXPIRED',
      guestProfileId: session.guest_profile_id,
      trafficSourceId: session.traffic_source_id,
      eventValue: session.seller_attribution_session_id,
      eventPayload: {
        seller_attribution_session_id: session.seller_attribution_session_id,
        expired_at: expiredAt,
      },
      eventAt: expiredAt,
    });

    return updatedSession;
  }

  getActiveSellerAttributionSession(guestProfileId, nowIso = this.nowIso()) {
    const sessions = this.listSellerAttributionSessions(guestProfileId)
      .filter((session) => session.attribution_status === 'ACTIVE')
      .sort((left, right) => {
        if (left.starts_at === right.starts_at) {
          return right.seller_attribution_session_id - left.seller_attribution_session_id;
        }
        return left.starts_at < right.starts_at ? 1 : -1;
      });

    const session = sessions[0] || null;
    if (!session) {
      return null;
    }

    if (new Date(session.expires_at).getTime() <= new Date(nowIso).getTime()) {
      this.expireAttributionSession(session, nowIso);
      return null;
    }

    return session;
  }

  bindFirstSourceIfNeeded({ guestProfileId, trafficSourceId, sourceFamily, sourceQRCodeId, boundAt }) {
    const existingEntries = this.listGuestEntries(guestProfileId);
    if (existingEntries.length > 0) {
      return {
        isFirstSourceBound: false,
        firstEntry: existingEntries[0],
      };
    }

    this.appendAnalyticsEvent({
      eventType: 'SOURCE_BOUND',
      guestProfileId,
      trafficSourceId,
      eventValue: sourceFamily,
      eventPayload: {
        source_family: sourceFamily,
        source_qr_code_id: sourceQRCodeId,
        binding_scope: 'first_source',
      },
      eventAt: boundAt,
    });

    return {
      isFirstSourceBound: true,
      firstEntry: null,
    };
  }

  createSellerAttributionSession({
    guestProfileId,
    trafficSourceId,
    sourceQRCodeId,
    sellerId,
    sourceFamily,
    startsAt,
  }) {
    const session = this.sellerAttributionSessions.create({
      guest_profile_id: guestProfileId,
      traffic_source_id: trafficSourceId,
      source_qr_code_id: sourceQRCodeId,
      seller_id: sellerId,
      starts_at: startsAt,
      expires_at: addHours(startsAt, ATTRIBUTION_WINDOW_HOURS),
      attribution_status: 'ACTIVE',
      binding_reason: sourceFamily,
    });

    this.appendAnalyticsEvent({
      eventType: 'ATTRIBUTION_STARTED',
      guestProfileId,
      trafficSourceId,
      eventValue: session.seller_attribution_session_id,
      eventPayload: {
        seller_attribution_session_id: session.seller_attribution_session_id,
        source_family: sourceFamily,
        seller_id: sellerId,
        expires_at: session.expires_at,
      },
      eventAt: startsAt,
    });

    return session;
  }

  resolveActivePath(guestProfileId) {
    const nowIso = this.nowIso();
    const activeSession = this.getActiveSellerAttributionSession(guestProfileId, nowIso);

    if (activeSession) {
      return Object.freeze({
        pathType: 'seller_attributed',
        sourceOwnership: 'seller',
        classification: 'seller_attributed',
        sellerAttributionSession: activeSession,
        expiresAt: activeSession.expires_at,
      });
    }

    return Object.freeze({
      pathType: 'owner_manual',
      sourceOwnership: 'owner_manual',
      classification: 'manual_owner_handling',
      sellerAttributionSession: null,
      expiresAt: null,
    });
  }

  registerGuestEntryFromSource({
    guest_profile_id,
    traffic_source_id,
    source_qr_code_id,
    entry_channel,
    entry_payload = {},
    actor_type = 'guest',
    actor_id = null,
  }) {
    const guestProfile = this.getGuestProfileOrThrow(guest_profile_id);
    const trafficSource = this.getTrafficSourceOrThrow(traffic_source_id);
    const sourceQRCode = this.getSourceQRCodeOrThrow(source_qr_code_id);

    if (sourceQRCode.traffic_source_id !== trafficSource.traffic_source_id) {
      throw new Error('[TELEGRAM_ATTRIBUTION] Source QR code is not linked to the provided traffic source');
    }

    const registeredAt = this.nowIso();
    const sourceFamily = this.classifySourceFamily({
      sourceType: trafficSource.source_type,
      entryChannel: entry_channel,
    });
    const firstBinding = this.bindFirstSourceIfNeeded({
      guestProfileId: guest_profile_id,
      trafficSourceId: traffic_source_id,
      sourceFamily,
      sourceQRCodeId: source_qr_code_id,
      boundAt: registeredAt,
    });

    const guestEntry = this.guestEntries.create({
      guest_profile_id,
      entry_at: registeredAt,
      entry_channel,
      traffic_source_id,
      source_qr_code_id,
      entry_payload: {
        ...entry_payload,
        actor_type,
        actor_id,
        source_family: sourceFamily,
      },
      entry_status: 'RECORDED',
    });

    this.guestProfiles.updateById(guestProfile.guest_profile_id, {
      last_seen_at: registeredAt,
    });

    this.appendAnalyticsEvent({
      eventType: 'SOURCE_ENTRY',
      guestProfileId: guest_profile_id,
      trafficSourceId: traffic_source_id,
      eventValue: sourceFamily,
      eventPayload: {
        source_family: sourceFamily,
        source_qr_code_id: source_qr_code_id,
        guest_entry_id: guestEntry.guest_entry_id,
      },
      eventAt: registeredAt,
    });

    const activeSession = this.getActiveSellerAttributionSession(guest_profile_id, registeredAt);
    const bookingLocked = this.hasBookingLock(guest_profile_id);
    let sellerAttributionSession = activeSession;
    let attributionOutcome = activeSession ? 'preserved_existing' : 'not_applicable';

    if (isSellerFamily(sourceFamily)) {
      if (activeSession) {
        attributionOutcome = 'preserved_existing';
      } else if (!bookingLocked) {
        sellerAttributionSession = this.createSellerAttributionSession({
          guestProfileId: guest_profile_id,
          trafficSourceId: traffic_source_id,
          sourceQRCodeId: source_qr_code_id,
          sellerId: sourceQRCode.seller_id || trafficSource.default_seller_id || null,
          sourceFamily,
          startsAt: registeredAt,
        });
        attributionOutcome = firstBinding.isFirstSourceBound ? 'started_new' : 'seller_override_before_booking';
      } else {
        attributionOutcome = 'blocked_by_booking_lock';
      }
    }

    return Object.freeze({
      guestEntry,
      sourceFamily,
      sellerAttributionSession,
      attributionOutcome,
      activePath: this.resolveActivePath(guest_profile_id),
      isFirstSourceBound: firstBinding.isFirstSourceBound,
    });
  }
}
