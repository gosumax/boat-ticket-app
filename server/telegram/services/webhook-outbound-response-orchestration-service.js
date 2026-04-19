import {
  buildTelegramLatestTimestampSummary,
  freezeTelegramHandoffValue,
  TELEGRAM_GUEST_COMMAND_ACTION_TYPES,
  TELEGRAM_NOTIFICATION_DELIVERY_ADAPTER_CONTRACT_VERSION,
  TELEGRAM_NOTIFICATION_DELIVERY_EXECUTION_STATUSES,
  TELEGRAM_SERVICE_MESSAGE_TYPES,
} from '../../../shared/telegram/index.js';
import { TELEGRAM_NOTIFICATION_DELIVERY_CHANNEL } from './notification-delivery-planning-service.js';

export const TELEGRAM_WEBHOOK_OUTBOUND_RESPONSE_RESULT_VERSION =
  'telegram_webhook_outbound_response_result.v1';

const SERVICE_NAME = 'telegram_webhook_outbound_response_orchestration_service';
const SUPPORTED_ACTION_TYPES = new Set(TELEGRAM_GUEST_COMMAND_ACTION_TYPES);
const MINI_APP_LAUNCH_ACTION_TYPE = 'open_mini_app';
const BUTTON_ACTION_LABELS = Object.freeze({
  open_mini_app: 'Open Mini App',
  open_ticket: 'Ticket',
  open_my_tickets: 'My Requests',
  open_trips: 'Trips',
  open_useful_content: 'Useful',
  open_faq: 'FAQ',
  open_contact: 'Contact',
  cancel_before_prepayment: 'Cancel',
});
const START_ACTION_TO_GUEST_ACTION = Object.freeze({
  view_ticket: 'open_ticket',
  view_current_request: 'open_my_tickets',
  view_trips: 'open_trips',
  create_booking_request: 'open_trips',
  useful_content: 'open_useful_content',
  faq: 'open_faq',
  contact: 'open_contact',
});
const DEFAULT_ACTION_ORDER = Object.freeze([
  'open_trips',
  'open_my_tickets',
  'open_ticket',
  'open_useful_content',
  'open_faq',
  'open_contact',
  'cancel_before_prepayment',
]);
const FALLBACK_NOTIFICATION_TYPE = TELEGRAM_SERVICE_MESSAGE_TYPES.booking_created;

function normalizeString(value) {
  const normalized = String(value ?? '').trim();
  return normalized || null;
}

function sortValue(value) {
  if (Array.isArray(value)) {
    return value.map((item) => sortValue(item));
  }
  if (!value || typeof value !== 'object') {
    return value;
  }

  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortValue(value[key])])
  );
}

function freezeSortedValue(value) {
  return freezeTelegramHandoffValue(sortValue(value));
}

function normalizeBookingRequestId(reference) {
  const bookingRequestId = Number(reference?.booking_request_id);
  if (!Number.isInteger(bookingRequestId) || bookingRequestId <= 0) {
    return null;
  }

  return bookingRequestId;
}

function normalizeVisibilitySummary(visibilitySummary = null) {
  const hasVisibilityObject =
    visibilitySummary && typeof visibilitySummary === 'object' && !Array.isArray(visibilitySummary);
  return freezeSortedValue({
    can_view_trips: hasVisibilityObject
      ? Boolean(visibilitySummary?.can_view_trips)
      : true,
    can_view_ticket: hasVisibilityObject
      ? Boolean(visibilitySummary?.can_view_ticket)
      : false,
    can_contact: hasVisibilityObject ? Boolean(visibilitySummary?.can_contact) : true,
    can_cancel_before_prepayment: hasVisibilityObject
      ? Boolean(visibilitySummary?.can_cancel_before_prepayment)
      : false,
    can_open_useful_content: hasVisibilityObject
      ? Boolean(visibilitySummary?.can_open_useful_content)
      : true,
    can_open_faq: hasVisibilityObject
      ? Boolean(visibilitySummary?.can_open_faq)
      : true,
  });
}

function dedupeActionTypes(actionTypes = []) {
  const deduped = [];
  const seen = new Set();
  for (const actionType of actionTypes) {
    if (!SUPPORTED_ACTION_TYPES.has(actionType) || seen.has(actionType)) {
      continue;
    }
    seen.add(actionType);
    deduped.push(actionType);
  }
  return deduped;
}

function applyVisibilityFilters(actionTypes, visibilitySummary) {
  return actionTypes.filter((actionType) => {
    if (actionType === 'open_ticket') {
      return visibilitySummary.can_view_ticket;
    }
    if (actionType === 'open_trips') {
      return visibilitySummary.can_view_trips;
    }
    if (actionType === 'open_contact') {
      return visibilitySummary.can_contact;
    }
    if (actionType === 'cancel_before_prepayment') {
      return visibilitySummary.can_cancel_before_prepayment;
    }
    if (actionType === 'open_useful_content') {
      return visibilitySummary.can_open_useful_content;
    }
    if (actionType === 'open_faq') {
      return visibilitySummary.can_open_faq;
    }
    return true;
  });
}

function buildCallbackPayload(actionType, bookingRequestReference = null) {
  const bookingRequestId = normalizeBookingRequestId(bookingRequestReference);
  if (bookingRequestId) {
    return `action:${actionType}:${bookingRequestId}`;
  }
  return `action:${actionType}`;
}

function buildButtonPayload(
  actionType,
  bookingRequestReference = null,
  { webAppUrl = null } = {}
) {
  const isMiniAppLaunchAction = actionType === MINI_APP_LAUNCH_ACTION_TYPE;
  return freezeSortedValue({
    action_type: actionType,
    button_text: BUTTON_ACTION_LABELS[actionType] || actionType,
    callback_data: isMiniAppLaunchAction
      ? null
      : buildCallbackPayload(actionType, bookingRequestReference),
    web_app_url: isMiniAppLaunchAction ? normalizeString(webAppUrl) : null,
  });
}

function normalizeMiniAppLaunchSummary(miniAppLaunchSummary = null) {
  const hasObject =
    miniAppLaunchSummary &&
    typeof miniAppLaunchSummary === 'object' &&
    !Array.isArray(miniAppLaunchSummary);
  if (!hasObject) {
    return null;
  }

  const launchReady = Boolean(
    miniAppLaunchSummary.launch_ready ?? miniAppLaunchSummary.launchReady
  );
  const launchUrl = normalizeString(
    miniAppLaunchSummary.launch_url ?? miniAppLaunchSummary.launchUrl
  );
  if (!launchReady || !launchUrl) {
    return null;
  }

  return freezeSortedValue({
    launch_ready: true,
    launch_url: launchUrl,
  });
}

function appendQueryParamToUrl(rawUrl, key, value) {
  const normalizedUrl = normalizeString(rawUrl);
  const normalizedKey = normalizeString(key);
  const normalizedValue = normalizeString(value);
  if (!normalizedUrl || !normalizedKey || !normalizedValue) {
    return normalizedUrl;
  }

  try {
    const parsed = new URL(normalizedUrl);
    parsed.searchParams.set(normalizedKey, normalizedValue);
    return parsed.toString();
  } catch {
    const [basePart, hashPart] = normalizedUrl.split('#', 2);
    const separator = basePart.includes('?') ? '&' : '?';
    const encodedParam = `${encodeURIComponent(normalizedKey)}=${encodeURIComponent(
      normalizedValue
    )}`;
    const withQuery = `${basePart}${separator}${encodedParam}`;
    return hashPart ? `${withQuery}#${hashPart}` : withQuery;
  }
}

function prependMiniAppLaunchButton(buttonPayloads = [], miniAppLaunchSummary = null) {
  const launchSummary = normalizeMiniAppLaunchSummary(miniAppLaunchSummary);
  if (!launchSummary) {
    return buttonPayloads;
  }
  if (
    buttonPayloads.some(
      (button) => normalizeString(button?.action_type) === MINI_APP_LAUNCH_ACTION_TYPE
    )
  ) {
    return buttonPayloads;
  }

  return [
    buildButtonPayload(MINI_APP_LAUNCH_ACTION_TYPE, null, {
      webAppUrl: launchSummary.launch_url,
    }),
    ...buttonPayloads,
  ];
}

function resolveButtonPayloadsForTarget(buttonPayloads = [], targetSummary = null) {
  const telegramUserId = normalizeString(targetSummary?.telegram_user_id);
  if (!telegramUserId) {
    return buttonPayloads;
  }

  return buttonPayloads.map((button) => {
    const webAppUrl = normalizeString(button?.web_app_url);
    if (!webAppUrl) {
      return button;
    }
    return freezeSortedValue({
      ...button,
      web_app_url: appendQueryParamToUrl(
        webAppUrl,
        'telegram_user_id',
        telegramUserId
      ),
    });
  });
}

function buildInlineKeyboardButton(button) {
  const text = normalizeString(button?.button_text) || 'Open';
  const webAppUrl = normalizeString(button?.web_app_url);
  if (webAppUrl) {
    return {
      text,
      web_app: {
        url: webAppUrl,
      },
    };
  }

  return {
    text,
    callback_data: button.callback_data,
  };
}

function buildInlineKeyboard(buttonPayloads = [], rowSize = 2) {
  const normalizedButtons = buttonPayloads.filter((button) => {
    const hasCallbackData = Boolean(normalizeString(button?.callback_data));
    const hasWebAppUrl = Boolean(normalizeString(button?.web_app_url));
    return hasCallbackData || hasWebAppUrl;
  });
  const rows = [];
  if (normalizedButtons.length === 0) {
    return freezeSortedValue({
      inline_keyboard: rows,
    });
  }

  let list = normalizedButtons;
  if (
    normalizeString(normalizedButtons[0]?.action_type) === MINI_APP_LAUNCH_ACTION_TYPE
  ) {
    rows.push([buildInlineKeyboardButton(normalizedButtons[0])]);
    list = normalizedButtons.slice(1);
  }

  let index = 0;
  while (index < list.length) {
    const rowButtons = list
      .slice(index, index + rowSize)
      .map((button) => buildInlineKeyboardButton(button));
    rows.push(rowButtons);
    index += rowSize;
  }
  return freezeSortedValue({
    inline_keyboard: rows,
  });
}

function extractResponseTarget(rawUpdate = {}) {
  const message = rawUpdate?.message || rawUpdate?.callback_query?.message || null;
  const from = rawUpdate?.message?.from || rawUpdate?.callback_query?.from || null;
  const firstName = normalizeString(from?.first_name);
  const lastName = normalizeString(from?.last_name);
  const displayName = normalizeString(
    [firstName, lastName].filter(Boolean).join(' ')
  );

  return freezeSortedValue({
    telegram_update_id:
      Number.isInteger(rawUpdate?.update_id) && rawUpdate.update_id >= 0
        ? rawUpdate.update_id
        : null,
    telegram_user_id: normalizeString(from?.id),
    telegram_chat_id: normalizeString(message?.chat?.id),
    telegram_chat_type: normalizeString(message?.chat?.type),
    display_name: displayName || normalizeString(from?.username) || normalizeString(from?.id),
    username: normalizeString(from?.username),
    language_code: normalizeString(from?.language_code),
  });
}

function normalizeActionStatus(actionStatus) {
  return normalizeString(actionStatus) || 'action_unknown';
}

function summarizeActionBuckets(stateBuckets = {}) {
  const groups = Object.entries(stateBuckets)
    .map(([groupName, items]) => ({
      group_name: groupName,
      count: Array.isArray(items) ? items.length : 0,
    }))
    .sort((left, right) => left.group_name.localeCompare(right.group_name));

  return groups.map((item) => `${item.group_name}:${item.count}`).join(', ');
}

function extractTopTitles(items = [], fieldName, limit = 2) {
  return items
    .slice(0, limit)
    .map((item) => normalizeString(item?.title_short_text_summary?.[fieldName]))
    .filter(Boolean);
}

function extractTopShortTexts(items = [], limit = 2) {
  return items
    .slice(0, limit)
    .map((item) => normalizeString(item?.title_short_text_summary?.short_text))
    .filter(Boolean);
}

function buildStartTextFields(startMode, operationStatus) {
  if (startMode === 'linked_ticket') {
    return freezeSortedValue({
      headline: 'Your ticket is ready',
      body: 'Open your ticket details or review upcoming trip information.',
      status_line: 'Choose an action below.',
      content_source: 'start_mode_content',
    });
  }
  if (startMode === 'active_request') {
    return freezeSortedValue({
      headline: 'You have an active request',
      body: 'Track your request status, view help content, or contact support.',
      status_line: 'Choose an action below.',
      content_source: 'start_mode_content',
    });
  }
  if (startMode === 'completed_guest_without_active_request') {
    return freezeSortedValue({
      headline: 'Welcome back',
      body: 'No active request is open right now. You can explore trips or help content.',
      status_line: 'Choose an action below.',
      content_source: 'start_mode_content',
    });
  }

  return freezeSortedValue({
    headline: 'Welcome to boat tickets',
    body: 'You can explore trips, check support information, or open FAQ.',
    status_line:
      operationStatus === 'processed_with_fallback'
        ? 'Default start content is active.'
        : 'Choose an action below.',
    content_source: 'start_mode_content',
  });
}

function buildGuestActionTextFields(mappedActionType, actionResult = {}) {
  const actionStatus = normalizeActionStatus(actionResult.action_status);
  const resolvedData = actionResult.resolved_data_summary || null;

  if (actionStatus === 'action_not_available') {
    return freezeSortedValue({
      headline: 'Action is not available',
      body: 'This action cannot be completed right now. Please choose another one.',
      status_line: 'Try one of the available actions below.',
      content_source: 'default_fallback_content',
    });
  }

  if (actionStatus === 'action_rejected_invalid_input') {
    return freezeSortedValue({
      headline: 'Unable to process this action',
      body: 'The request payload could not be processed. Use another action from the menu.',
      status_line: 'Default fallback content is active.',
      content_source: 'default_fallback_content',
    });
  }

  if (mappedActionType === 'open_ticket') {
    return freezeSortedValue({
      headline: 'Ticket status',
      body: `State: ${
        normalizeString(
          resolvedData?.ticket_status_summary?.deterministic_ticket_state
        ) || 'unknown'
      }.`,
      status_line:
        normalizeString(
          resolvedData?.date_time_summary?.requested_trip_date
        ) && normalizeString(resolvedData?.date_time_summary?.requested_time_slot)
          ? `Trip: ${resolvedData.date_time_summary.requested_trip_date} ${resolvedData.date_time_summary.requested_time_slot}.`
          : 'Ticket details are available in the current view.',
      content_source: 'resolved_action_content',
    });
  }

  if (mappedActionType === 'open_my_tickets') {
    const itemCount = Number(resolvedData?.item_count);
    return freezeSortedValue({
      headline: 'My requests',
      body:
        Number.isInteger(itemCount) && itemCount >= 0
          ? `Found ${itemCount} request(s).`
          : 'Your request list is not available yet.',
      status_line:
        Number.isInteger(itemCount) && itemCount >= 0
          ? 'Open another action for more details.'
          : 'Default fallback content is active.',
      content_source:
        Number.isInteger(itemCount) && itemCount >= 0
          ? 'resolved_action_content'
          : 'default_fallback_content',
    });
  }

  if (mappedActionType === 'open_trips') {
    return freezeSortedValue({
      headline: 'Trips overview',
      body: `Timeline items: ${Number(resolvedData?.trip_timeline_size || 0)}.`,
      status_line: `Buckets: ${summarizeActionBuckets(resolvedData?.state_buckets || {})}.`,
      content_source: 'resolved_action_content',
    });
  }

  if (mappedActionType === 'open_useful_content') {
    const titles = extractTopTitles(resolvedData?.items || [], 'title', 2);
    return freezeSortedValue({
      headline: 'Useful content',
      body: `Items available: ${Number(resolvedData?.item_count || 0)}.`,
      status_line:
        titles.length > 0
          ? `Top: ${titles.join(' | ')}.`
          : 'Default fallback content is active.',
      content_source:
        titles.length > 0 ? 'resolved_action_content' : 'default_fallback_content',
    });
  }

  if (mappedActionType === 'open_faq') {
    const titles = extractTopTitles(resolvedData?.items || [], 'title', 2);
    const shortTexts = extractTopShortTexts(resolvedData?.items || [], 2);
    const hasResolvedFaqContent = titles.length > 0 || shortTexts.length > 0;
    return freezeSortedValue({
      headline: 'Frequently asked questions',
      body:
        shortTexts.length > 0
          ? `Quick answer: ${shortTexts[0]}`
          : `Questions available: ${Number(resolvedData?.item_count || 0)}.`,
      status_line:
        titles.length > 0
          ? `Top questions: ${titles.join(' | ')}.`
          : 'Default fallback content is active.',
      content_source:
        hasResolvedFaqContent
          ? 'resolved_action_content'
          : 'default_fallback_content',
    });
  }

  if (mappedActionType === 'open_contact') {
    const preferredPhone = normalizeString(resolvedData?.preferred_contact_phone_e164);
    const supportItems = resolvedData?.support_content_feed_summary?.items || [];
    const supportTitles = extractTopTitles(supportItems, 'title', 2);
    const supportShortTexts = extractTopShortTexts(supportItems, 1);
    const hasResolvedContactContent =
      Boolean(preferredPhone) ||
      supportTitles.length > 0 ||
      supportShortTexts.length > 0;
    return freezeSortedValue({
      headline: 'Contact support',
      body:
        preferredPhone && supportShortTexts.length > 0
          ? `Preferred contact: ${preferredPhone}. ${supportShortTexts[0]}`
          : preferredPhone
            ? `Preferred contact: ${preferredPhone}.`
            : supportShortTexts.length > 0
              ? supportShortTexts[0]
              : 'Support contact is available from the current request context.',
      status_line:
        supportTitles.length > 0
          ? `Support notes: ${supportTitles.join(' | ')}.`
          : preferredPhone
            ? 'Use this contact for request updates.'
            : 'Default fallback content is active.',
      content_source: hasResolvedContactContent
        ? 'resolved_action_content'
        : 'default_fallback_content',
    });
  }

  if (mappedActionType === 'cancel_before_prepayment') {
    return freezeSortedValue({
      headline:
        actionStatus === 'action_completed'
          ? 'Request cancelled'
          : 'Cancellation is not available',
      body:
        actionStatus === 'action_completed'
          ? 'Cancellation before prepayment has been recorded.'
          : 'The current request cannot be cancelled before prepayment.',
      status_line: 'Choose another action below.',
      content_source:
        actionStatus === 'action_completed'
          ? 'resolved_action_content'
          : 'default_fallback_content',
    });
  }

  return freezeSortedValue({
    headline: 'Action processed',
    body: 'The action has been processed.',
    status_line: 'Choose another action below.',
    content_source: 'default_fallback_content',
  });
}

function pickBookingReferenceFromStart(runtimeResult = {}) {
  const inboundResult = runtimeResult.operation_result_summary || {};
  return (
    runtimeResult.related_booking_request_reference ||
    inboundResult?.bot_start_state_summary?.active_booking_request_summary
      ?.booking_request_reference ||
    null
  );
}

function buildStartActionButtons(runtimeResult = {}) {
  const inboundResult = runtimeResult.operation_result_summary || {};
  const startState = inboundResult.bot_start_state_summary || {};
  const guestActionState = inboundResult.guest_action_state_summary || {};
  const visibilitySummary = normalizeVisibilitySummary(guestActionState);
  const startActions = dedupeActionTypes(
    (startState.recommended_next_actions || [])
      .map((startAction) => START_ACTION_TO_GUEST_ACTION[startAction] || null)
      .filter(Boolean)
  );
  const bookingRequestReference = pickBookingReferenceFromStart(runtimeResult);
  const fallbackActions = ['open_trips', 'open_useful_content', 'open_faq', 'open_contact'];
  const candidateActions = startActions.length > 0 ? startActions : fallbackActions;
  const visibleActions = applyVisibilityFilters(candidateActions, visibilitySummary);
  const actionTypes = dedupeActionTypes(
    visibleActions.length > 0 ? visibleActions : fallbackActions
  );

  if (visibilitySummary.can_cancel_before_prepayment) {
    actionTypes.push('cancel_before_prepayment');
  }

  return dedupeActionTypes(actionTypes).map((actionType) =>
    buildButtonPayload(actionType, bookingRequestReference)
  );
}

function buildGuestActionButtons(mappedActionType, actionResult = {}, relatedBookingReference = null) {
  const visibilitySummary = normalizeVisibilitySummary(
    actionResult.visibility_availability_summary
  );
  const candidateActions = dedupeActionTypes([
    mappedActionType,
    ...DEFAULT_ACTION_ORDER,
  ]);
  const visibleActions = applyVisibilityFilters(candidateActions, visibilitySummary);
  const fallbackActions = ['open_trips', 'open_useful_content', 'open_faq', 'open_contact'];
  const finalActions = dedupeActionTypes(
    visibleActions.length > 0 ? visibleActions : fallbackActions
  );

  return finalActions.map((actionType) =>
    buildButtonPayload(actionType, relatedBookingReference)
  );
}

function pickDeliveryOutcome(rawResult) {
  return normalizeString(
    rawResult?.outcome ??
      rawResult?.delivery_outcome ??
      rawResult?.deliveryOutcome ??
      rawResult?.status ??
      null
  );
}

function mapDeliveryHandoffStatus(outcome) {
  if (outcome === TELEGRAM_NOTIFICATION_DELIVERY_EXECUTION_STATUSES.sent) {
    return 'sent';
  }
  if (outcome === TELEGRAM_NOTIFICATION_DELIVERY_EXECUTION_STATUSES.blocked) {
    return 'blocked';
  }
  if (outcome === TELEGRAM_NOTIFICATION_DELIVERY_EXECUTION_STATUSES.failed) {
    return 'failed';
  }
  return 'failed';
}

export class TelegramWebhookOutboundResponseOrchestrationService {
  constructor({
    notificationDeliveryExecutorService = null,
    executeTelegramNotificationDelivery = null,
    now = () => new Date(),
  } = {}) {
    this.notificationDeliveryExecutorService = notificationDeliveryExecutorService;
    this.executeTelegramNotificationDelivery = executeTelegramNotificationDelivery;
    this.now = now;
  }

  describe() {
    return Object.freeze({
      serviceName: SERVICE_NAME,
      status: 'telegram_webhook_outbound_response_orchestration_ready',
      dependencyKeys: [
        'notificationDeliveryExecutorService',
        'executeTelegramNotificationDelivery',
      ],
    });
  }

  nowIso() {
    const date = this.now();
    const iso = date instanceof Date ? date.toISOString() : new Date(date).toISOString();
    if (Number.isNaN(Date.parse(iso))) {
      throw new Error('[TELEGRAM_WEBHOOK_OUTBOUND_RESPONSE] invalid clock timestamp');
    }
    return iso;
  }

  resolveDeliveryExecutor() {
    if (typeof this.executeTelegramNotificationDelivery === 'function') {
      return this.executeTelegramNotificationDelivery;
    }

    const deliveryAdapter = this.notificationDeliveryExecutorService?.deliveryAdapter;
    if (typeof deliveryAdapter === 'function') {
      return deliveryAdapter;
    }
    if (typeof deliveryAdapter?.executeTelegramNotificationDelivery === 'function') {
      return deliveryAdapter.executeTelegramNotificationDelivery.bind(deliveryAdapter);
    }
    if (typeof deliveryAdapter?.deliverNotification === 'function') {
      return deliveryAdapter.deliverNotification.bind(deliveryAdapter);
    }
    if (typeof deliveryAdapter?.execute === 'function') {
      return deliveryAdapter.execute.bind(deliveryAdapter);
    }

    return null;
  }

  buildDeliveryAdapterInput({
    adapterType,
    targetSummary,
    buttonPayloads,
    textFields,
    mappedActionType = null,
    operationType = null,
    operationStatus = null,
  }) {
    const dedupeKey = [
      'telegram_webhook_outbound_response',
      `update=${targetSummary.telegram_update_id ?? 'unknown'}`,
      `adapter=${adapterType || 'unknown'}`,
      `action=${mappedActionType || 'none'}`,
      `operation=${operationType || 'none'}`,
      `status=${operationStatus || 'unknown'}`,
      `target=${targetSummary.telegram_chat_id || targetSummary.telegram_user_id || 'unknown'}`,
    ].join('|');
    const replyMarkup =
      buttonPayloads.length > 0 ? buildInlineKeyboard(buttonPayloads) : null;

    return freezeSortedValue({
      adapter_contract_version: TELEGRAM_NOTIFICATION_DELIVERY_ADAPTER_CONTRACT_VERSION,
      delivery_channel: TELEGRAM_NOTIFICATION_DELIVERY_CHANNEL,
      notification_type: FALLBACK_NOTIFICATION_TYPE,
      delivery_target_summary: {
        target_type: 'telegram_guest',
        telegram_user_id: targetSummary.telegram_user_id,
        telegram_chat_id: targetSummary.telegram_chat_id,
        display_name: targetSummary.display_name,
        username: targetSummary.username,
        language_code: targetSummary.language_code,
      },
      dedupe_key: dedupeKey,
      idempotency_key: dedupeKey,
      no_op_guards: {
        telegram_api_called_by_executor: false,
        telegram_message_sent_by_executor: false,
        notification_log_row_created: false,
        bot_handlers_invoked: false,
        mini_app_ui_invoked: false,
        seller_owner_admin_ui_invoked: false,
        production_routes_invoked: false,
        money_ledger_written: false,
      },
      queue_item_reference: {
        reference_type: 'telegram_webhook_outbound_response',
        telegram_update_id: targetSummary.telegram_update_id,
        adapter_type: adapterType || null,
        mapped_action_type: mappedActionType,
        operation_type: operationType,
      },
      requested_by: SERVICE_NAME,
      text_payload: {
        fields: {
          headline: textFields.headline,
          body: textFields.body,
          status_line: textFields.status_line,
        },
      },
      telegram_reply_markup: replyMarkup,
      resolved_payload_summary_reference: {
        reference_type: 'telegram_webhook_outbound_response',
        resolution_version: TELEGRAM_WEBHOOK_OUTBOUND_RESPONSE_RESULT_VERSION,
        message_mode: 'telegram_webhook_runtime_response',
        message_type: FALLBACK_NOTIFICATION_TYPE,
        content_key: 'telegram.webhook.outbound_response',
        field_keys: ['body', 'headline', 'status_line'],
        action_button_ids: buttonPayloads.map((button) => button.action_type),
        resolved_text_fields: {
          headline: textFields.headline,
          body: textFields.body,
          status_line: textFields.status_line,
        },
      },
    });
  }

  executeDeliveryHandoff(deliveryInput) {
    const deliveryExecutor = this.resolveDeliveryExecutor();
    if (!deliveryExecutor) {
      return freezeSortedValue({
        handoff_status: 'handoff_not_configured',
        adapter_outcome: null,
        blocked_reason: null,
        failed_reason: 'delivery_adapter_not_configured',
        provider_result_reference: null,
      });
    }

    try {
      const rawResult = deliveryExecutor(deliveryInput);
      if (rawResult && typeof rawResult.then === 'function') {
        throw new Error('delivery adapter returned async result');
      }
      const adapterOutcome = pickDeliveryOutcome(rawResult);
      const handoffStatus = mapDeliveryHandoffStatus(adapterOutcome);
      return freezeSortedValue({
        handoff_status: handoffStatus,
        adapter_outcome: adapterOutcome,
        blocked_reason:
          normalizeString(rawResult?.blocked_reason ?? rawResult?.blockedReason) || null,
        failed_reason:
          normalizeString(rawResult?.failed_reason ?? rawResult?.failedReason) || null,
        provider_result_reference: rawResult?.provider_result_reference || null,
      });
    } catch (error) {
      return freezeSortedValue({
        handoff_status: 'failed',
        adapter_outcome: TELEGRAM_NOTIFICATION_DELIVERY_EXECUTION_STATUSES.failed,
        blocked_reason: null,
        failed_reason:
          normalizeString(error?.message) || 'delivery_adapter_execution_failed',
        provider_result_reference: null,
      });
    }
  }

  buildStartResponseMapping(adapterResult, { miniAppLaunchSummary = null } = {}) {
    const runtimeResult = adapterResult.operation_result_summary || {};
    const inboundResult = runtimeResult.operation_result_summary || {};
    const startState = inboundResult.bot_start_state_summary || {};
    const textFields = buildStartTextFields(
      normalizeString(startState.start_mode),
      normalizeString(adapterResult.operation_status)
    );
    const buttonPayloads = prependMiniAppLaunchButton(
      buildStartActionButtons(runtimeResult),
      miniAppLaunchSummary
    );

    return freezeSortedValue({
      outbound_mapping_status: 'mapped_start_response',
      mapped_action_type: null,
      text_fields: textFields,
      button_payloads: buttonPayloads,
    });
  }

  buildGuestActionResponseMapping(adapterResult, { miniAppLaunchSummary = null } = {}) {
    const actionResult = adapterResult.operation_result_summary || {};
    const mappedActionType = normalizeString(adapterResult.mapped_action_type);
    const relatedBookingReference =
      adapterResult.related_booking_request_reference ||
      actionResult.related_booking_request_reference ||
      null;
    const textFields = buildGuestActionTextFields(mappedActionType, actionResult);
    const buttonPayloads = prependMiniAppLaunchButton(
      buildGuestActionButtons(
        mappedActionType,
        actionResult,
        relatedBookingReference
      ),
      miniAppLaunchSummary
    );

    return freezeSortedValue({
      outbound_mapping_status:
        textFields.content_source === 'default_fallback_content'
          ? 'mapped_guest_action_response_with_fallback'
          : 'mapped_guest_action_response',
      mapped_action_type: mappedActionType,
      text_fields: textFields,
      button_payloads: buttonPayloads,
    });
  }

  buildSkippedResult({
    adapterType = null,
    adapterResult = null,
    targetSummary = null,
    reason = 'skipped',
    nowIso,
  }) {
    return freezeSortedValue({
      response_version: TELEGRAM_WEBHOOK_OUTBOUND_RESPONSE_RESULT_VERSION,
      orchestrated_by: SERVICE_NAME,
      adapter_type: adapterType,
      outbound_mapping_status: reason,
      mapped_action_type: normalizeString(adapterResult?.mapped_action_type),
      mapped_operation_type: normalizeString(adapterResult?.operation_type),
      mapped_operation_status: normalizeString(adapterResult?.operation_status),
      response_text_fields: null,
      button_payloads: [],
      telegram_target_summary: targetSummary,
      delivery_handoff_summary: {
        handoff_status: 'skipped',
        adapter_outcome: null,
        blocked_reason: null,
        failed_reason: null,
        provider_result_reference: null,
      },
      latest_timestamp_summary: buildTelegramLatestTimestampSummary(nowIso),
    });
  }

  orchestrateOutboundResponse({
    adapter_type: adapterType = null,
    raw_update: rawUpdate = {},
    adapter_result_summary: adapterResult = null,
    mini_app_launch_summary: miniAppLaunchSummaryInput = null,
  } = {}) {
    const nowIso = this.nowIso();
    const miniAppLaunchSummary = normalizeMiniAppLaunchSummary(
      miniAppLaunchSummaryInput
    );
    const targetSummary = extractResponseTarget(rawUpdate);
    if (!adapterResult || typeof adapterResult !== 'object') {
      return this.buildSkippedResult({
        adapterType,
        adapterResult,
        targetSummary,
        reason: 'skipped_invalid_adapter_result',
        nowIso,
      });
    }

    const mappingStatus = normalizeString(adapterResult.mapping_status);
    let responseMapping = null;
    if (mappingStatus === 'mapped_start_command') {
      responseMapping = this.buildStartResponseMapping(adapterResult, {
        miniAppLaunchSummary,
      });
    } else if (
      mappingStatus === 'mapped_guest_action_command' ||
      mappingStatus === 'mapped_guest_action_callback'
    ) {
      responseMapping = this.buildGuestActionResponseMapping(adapterResult, {
        miniAppLaunchSummary,
      });
    } else {
      return this.buildSkippedResult({
        adapterType,
        adapterResult,
        targetSummary,
        reason: 'skipped_non_response_mapping',
        nowIso,
      });
    }
    const resolvedButtonPayloads = resolveButtonPayloadsForTarget(
      responseMapping.button_payloads,
      targetSummary
    );

    if (!targetSummary.telegram_chat_id && !targetSummary.telegram_user_id) {
      return freezeSortedValue({
        response_version: TELEGRAM_WEBHOOK_OUTBOUND_RESPONSE_RESULT_VERSION,
        orchestrated_by: SERVICE_NAME,
        adapter_type: adapterType,
        outbound_mapping_status: responseMapping.outbound_mapping_status,
        mapped_action_type: responseMapping.mapped_action_type,
        mapped_operation_type: normalizeString(adapterResult.operation_type),
        mapped_operation_status: normalizeString(adapterResult.operation_status),
        response_text_fields: responseMapping.text_fields,
        button_payloads: resolvedButtonPayloads,
        telegram_target_summary: targetSummary,
        delivery_handoff_summary: {
          handoff_status: 'failed',
          adapter_outcome: TELEGRAM_NOTIFICATION_DELIVERY_EXECUTION_STATUSES.failed,
          blocked_reason: null,
          failed_reason: 'missing_telegram_target',
          provider_result_reference: null,
        },
        latest_timestamp_summary: buildTelegramLatestTimestampSummary(nowIso),
      });
    }

    const deliveryInput = this.buildDeliveryAdapterInput({
      adapterType,
      targetSummary,
      buttonPayloads: resolvedButtonPayloads,
      textFields: responseMapping.text_fields,
      mappedActionType: responseMapping.mapped_action_type,
      operationType: normalizeString(adapterResult.operation_type),
      operationStatus: normalizeString(adapterResult.operation_status),
    });
    const deliveryHandoffSummary = this.executeDeliveryHandoff(deliveryInput);

    return freezeSortedValue({
      response_version: TELEGRAM_WEBHOOK_OUTBOUND_RESPONSE_RESULT_VERSION,
      orchestrated_by: SERVICE_NAME,
      adapter_type: adapterType,
      outbound_mapping_status: responseMapping.outbound_mapping_status,
      mapped_action_type: responseMapping.mapped_action_type,
      mapped_operation_type: normalizeString(adapterResult.operation_type),
      mapped_operation_status: normalizeString(adapterResult.operation_status),
      response_text_fields: responseMapping.text_fields,
      button_payloads: resolvedButtonPayloads,
      telegram_target_summary: targetSummary,
      delivery_handoff_summary: deliveryHandoffSummary,
      latest_timestamp_summary: buildTelegramLatestTimestampSummary(nowIso),
    });
  }
}
