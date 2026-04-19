import {
  freezeTelegramHandoffValue,
  TELEGRAM_SERVICE_MESSAGE_RESOLUTION_VERSION,
  TELEGRAM_SERVICE_MESSAGE_TYPE_NAMES,
} from '../../../shared/telegram/index.js';

export const TELEGRAM_NOTIFICATION_DELIVERY_PLAN_VERSION =
  'telegram_notification_delivery_plan_v1';
export const TELEGRAM_NOTIFICATION_DELIVERY_CHANNEL = 'telegram_bot';
export const TELEGRAM_NOTIFICATION_SEND_TIMING_MODE = 'immediate';

const SUPPORTED_NOTIFICATION_TYPES = new Set(TELEGRAM_SERVICE_MESSAGE_TYPE_NAMES);

const BLOCK_REASONS = Object.freeze({
  unsupportedNotificationType: 'unsupported_notification_type',
  invalidResolutionVersion: 'invalid_service_message_resolution',
  serviceMessageNotReadOnly: 'service_message_not_read_only',
  missingPayloadReference: 'missing_resolved_payload_reference',
  missingDeliveryTarget: 'missing_telegram_delivery_target',
  guestConsentNotGranted: 'guest_consent_not_granted',
  inactiveGuestProfile: 'inactive_guest_profile',
});

function normalizeString(value) {
  const normalized = String(value ?? '').trim();
  return normalized || null;
}

function pickResolution(input = {}) {
  if (input?.service_message_resolution) return input.service_message_resolution;
  if (input?.serviceMessageResolution) return input.serviceMessageResolution;
  if (input?.resolution) return input.resolution;
  if (input?.response_version || input?.message_type || input?.text_payload) return input;

  return null;
}

function getVariables(resolution) {
  return resolution?.text_payload?.variables || {};
}

function buildDeliveryTarget(resolution) {
  const variables = getVariables(resolution);

  return {
    target_type: 'telegram_guest',
    guest_profile_id: variables.guest_profile_id ?? null,
    telegram_user_id: normalizeString(variables.telegram_user_id),
    display_name: normalizeString(variables.guest_display_name),
    username: normalizeString(variables.guest_username),
    language_code: normalizeString(variables.guest_language_code),
    consent_status: normalizeString(variables.guest_consent_status),
    profile_status: normalizeString(variables.guest_profile_status),
    booking_request_id:
      variables.booking_request_id ?? resolution?.requested_booking_request_id ?? null,
  };
}

function buildResolvedPayloadSummaryReference(resolution) {
  const variables = getVariables(resolution);
  const textPayload = resolution?.text_payload || {};
  const fields = textPayload.fields || {};
  const actionButtons = Array.isArray(resolution?.action_buttons)
    ? resolution.action_buttons
    : [];

  return {
    reference_type: 'telegram_service_message_resolution',
    resolution_version: normalizeString(resolution?.response_version),
    message_type: normalizeString(resolution?.message_type),
    message_mode: normalizeString(resolution?.message_mode),
    booking_request_id:
      variables.booking_request_id ?? resolution?.requested_booking_request_id ?? null,
    content_key: normalizeString(textPayload.content_key),
    locale: normalizeString(textPayload.locale),
    field_keys: Object.keys(fields).sort(),
    resolved_text_fields: {
      headline: normalizeString(fields.headline),
      body: normalizeString(fields.body),
      status_line: normalizeString(fields.status_line),
    },
    action_button_ids: actionButtons
      .map((button) => normalizeString(button.button_id || button.action))
      .filter(Boolean),
  };
}

function buildDedupeKey({ notificationType, deliveryTarget, payloadReference }) {
  return [
    'telegram_notification_delivery',
    `channel=${TELEGRAM_NOTIFICATION_DELIVERY_CHANNEL}`,
    `type=${notificationType || 'unknown'}`,
    `guest=${deliveryTarget.guest_profile_id ?? 'unknown'}`,
    `request=${payloadReference.booking_request_id ?? 'none'}`,
    `payload=${payloadReference.content_key || 'none'}`,
    `resolution=${payloadReference.resolution_version || 'none'}`,
  ].join('|');
}

function buildBlockReason(reason, message) {
  return { reason, message };
}

function collectBlockReasons({ resolution, notificationType, deliveryTarget, payloadReference }) {
  const blockReasons = [];

  if (!SUPPORTED_NOTIFICATION_TYPES.has(notificationType)) {
    blockReasons.push(
      buildBlockReason(
        BLOCK_REASONS.unsupportedNotificationType,
        'Notification type is not in the Telegram service-message delivery allowlist.'
      )
    );
  }

  if (resolution?.response_version !== TELEGRAM_SERVICE_MESSAGE_RESOLUTION_VERSION) {
    blockReasons.push(
      buildBlockReason(
        BLOCK_REASONS.invalidResolutionVersion,
        'Service-message resolution version is not supported for delivery planning.'
      )
    );
  }

  if (resolution?.read_only !== true) {
    blockReasons.push(
      buildBlockReason(
        BLOCK_REASONS.serviceMessageNotReadOnly,
        'Service-message resolution must be read-only before delivery planning.'
      )
    );
  }

  if (!payloadReference.content_key || !payloadReference.resolution_version) {
    blockReasons.push(
      buildBlockReason(
        BLOCK_REASONS.missingPayloadReference,
        'Resolved payload summary reference is incomplete.'
      )
    );
  }

  if (!deliveryTarget.telegram_user_id) {
    blockReasons.push(
      buildBlockReason(
        BLOCK_REASONS.missingDeliveryTarget,
        'Telegram delivery target identity is missing.'
      )
    );
  }

  if (deliveryTarget.consent_status !== 'granted') {
    blockReasons.push(
      buildBlockReason(
        BLOCK_REASONS.guestConsentNotGranted,
        'Guest consent does not allow Telegram bot delivery planning.'
      )
    );
  }

  if (deliveryTarget.profile_status && deliveryTarget.profile_status !== 'active') {
    blockReasons.push(
      buildBlockReason(
        BLOCK_REASONS.inactiveGuestProfile,
        'Guest profile is not active for Telegram bot delivery planning.'
      )
    );
  }

  return blockReasons;
}

function buildSendDecision(blockReasons) {
  const primaryBlockReason = blockReasons[0] || null;

  return {
    should_send: blockReasons.length === 0,
    send_allowed: blockReasons.length === 0,
    suppression_reason: primaryBlockReason?.reason || null,
    block_reason: primaryBlockReason?.reason || null,
    safe_block_reasons: blockReasons,
  };
}

export class TelegramNotificationDeliveryPlanningService {
  describe() {
    return Object.freeze({
      serviceName: 'notification-delivery-planning-service',
      status: 'read_only_delivery_planning_ready',
      dependencyKeys: [],
    });
  }

  planNotificationDelivery(input = {}) {
    const resolution = pickResolution(input);
    if (!resolution) {
      throw new Error(
        '[TELEGRAM_NOTIFICATION_DELIVERY_PLAN] service_message_resolution is required'
      );
    }

    const notificationType = normalizeString(resolution.message_type) || 'unknown';
    const deliveryTarget = buildDeliveryTarget(resolution);
    const payloadReference = buildResolvedPayloadSummaryReference(resolution);
    const blockReasons = collectBlockReasons({
      resolution,
      notificationType,
      deliveryTarget,
      payloadReference,
    });
    const dedupeKey = buildDedupeKey({
      notificationType,
      deliveryTarget,
      payloadReference,
    });

    return freezeTelegramHandoffValue({
      response_version: TELEGRAM_NOTIFICATION_DELIVERY_PLAN_VERSION,
      read_only: true,
      planning_only: true,
      notification_type: notificationType,
      delivery_channel: TELEGRAM_NOTIFICATION_DELIVERY_CHANNEL,
      delivery_target: deliveryTarget,
      dedupe_key: dedupeKey,
      idempotency_key: dedupeKey,
      send_timing_mode: TELEGRAM_NOTIFICATION_SEND_TIMING_MODE,
      resolved_payload_summary_reference: payloadReference,
      send_decision: buildSendDecision(blockReasons),
      no_op_guards: {
        telegram_message_sent: false,
        notification_log_row_created: false,
        bot_handlers_invoked: false,
        mini_app_ui_invoked: false,
        seller_owner_admin_ui_invoked: false,
        production_routes_invoked: false,
        money_ledger_written: false,
      },
      planned_by: 'telegram_notification_delivery_planning_service',
    });
  }
}
