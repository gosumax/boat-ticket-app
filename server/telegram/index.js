import { createTelegramDomainServices } from './services/domain-services.js';
import { createTelegramTicketViewSkeleton } from './dto/telegram-ticket-view.js';
import { telegramDomainModelDefinitions } from './models/domain-models.js';
import { createTelegramRepositories, telegramRepositories, telegramRepositoryDefinitions } from './repositories/domain-repositories.js';
import { ensureTelegramSchema } from './persistence/telegram-schema.js';
import { telegramEntitySchemas, telegramEnumSchemas } from './schemas/domain-schemas.js';
export {
  TELEGRAM_START_UPDATE_NORMALIZED_EVENT_TYPE,
  TelegramStartUpdateNormalizationService,
} from './services/start-update-normalization-service.js';
export {
  classifyTelegramStartSourceTokenForRegistry,
  normalizeTelegramStartSourceTokenForRegistry,
  TELEGRAM_START_SOURCE_RESOLUTION_STATUSES,
  TELEGRAM_START_SOURCE_TOKEN_RESOLUTION_VERSION,
  TelegramStartSourceTokenResolutionService,
} from './services/start-source-token-resolution-service.js';
export {
  TELEGRAM_GUEST_ENTRY_PERSISTENCE_RESULT_VERSION,
  TELEGRAM_GUEST_ENTRY_STATUS_RECORDED,
  TelegramGuestEntryPersistenceService,
} from './services/guest-entry-persistence-service.js';
export {
  TELEGRAM_GUEST_ENTRY_PROJECTION_ITEM_TYPE,
  TELEGRAM_GUEST_ENTRY_PROJECTION_VERSION,
  TelegramGuestEntryProjectionService,
} from './services/guest-entry-projection-service.js';
export {
  TELEGRAM_SOURCE_BINDING_EVENT_TYPE,
  TELEGRAM_SOURCE_BINDING_PERSISTENCE_RESULT_VERSION,
  TELEGRAM_SOURCE_BINDING_STATUSES,
  TelegramSourceBindingPersistenceService,
} from './services/source-binding-persistence-service.js';
export {
  TELEGRAM_SELLER_ATTRIBUTION_SESSION_START_RESULT_VERSION,
  TELEGRAM_SELLER_ATTRIBUTION_SESSION_STARTED_EVENT_TYPE,
  TELEGRAM_SELLER_ATTRIBUTION_SESSION_SKIPPED_EVENT_TYPE,
  TelegramSellerAttributionSessionStartService,
} from './services/seller-attribution-session-start-service.js';
export {
  TelegramInboundStartOrchestrationService,
} from './services/inbound-start-orchestration-service.js';
export {
  TELEGRAM_SELLER_ATTRIBUTION_PROJECTION_STATUSES,
  TELEGRAM_SELLER_ATTRIBUTION_PROJECTION_VERSION,
  TelegramSellerAttributionProjectionService,
} from './services/seller-attribution-projection-service.js';
export {
  TELEGRAM_GUEST_ROUTING_DECISION_VERSION,
  TELEGRAM_GUEST_ROUTING_STATUSES,
  TelegramGuestRoutingDecisionService,
} from './services/guest-routing-decision-service.js';
export {
  TELEGRAM_GUEST_PROFILE_AGGREGATE_VERSION,
  TELEGRAM_GUEST_PROFILE_CANONICAL_ENRICH_VERSION,
  TELEGRAM_GUEST_TIMELINE_PROJECTION_VERSION,
  TelegramGuestProfileAggregateService,
} from './services/guest-profile-aggregate-service.js';
export {
  TelegramBridgeAdapterDryRunContractService,
} from './services/bridge-adapter-dry-run-contract-service.js';
export {
  TelegramBridgeLinkageProjectionService,
} from './services/bridge-linkage-projection-service.js';
export {
  TELEGRAM_BOOKING_REQUEST_CREATION_RESULT_VERSION,
  TelegramBookingRequestCreationService,
} from './services/booking-request-creation-service.js';
export {
  TELEGRAM_BOOKING_REQUEST_HOLD_ACTIVATION_RESULT_VERSION,
  TelegramBookingRequestHoldActivationService,
} from './services/booking-request-hold-activation-service.js';
export {
  TELEGRAM_BOOKING_REQUEST_HOLD_EXTENSION_RESULT_VERSION,
  TelegramBookingRequestHoldExtensionService,
} from './services/booking-request-hold-extension-service.js';
export {
  TELEGRAM_BOOKING_REQUEST_HOLD_EXPIRY_RESULT_VERSION,
  TelegramBookingRequestHoldExpiryService,
} from './services/booking-request-hold-expiry-service.js';
export {
  TelegramGuestTicketViewProjectionService,
} from './services/guest-ticket-view-projection-service.js';
export {
  TelegramOfflineTicketSnapshotService,
} from './services/offline-ticket-snapshot-service.js';
export {
  TelegramPreTripReminderPlanningService,
} from './services/pre-trip-reminder-planning-service.js';
export {
  TelegramPostTripMessagePlanningService,
} from './services/post-trip-message-planning-service.js';
export {
  TelegramReviewFlowService,
} from './services/review-flow-service.js';
export {
  TelegramUsefulContentFaqProjectionService,
} from './services/useful-content-faq-projection-service.js';
export {
  TelegramServiceMessageTemplateManagementService,
} from './services/service-message-template-management-service.js';
export {
  TelegramSourceRegistryService,
} from './services/source-registry-service.js';
export {
  TelegramSourceAnalyticsReportingService,
} from './services/source-analytics-reporting-service.js';
export {
  TelegramQrExportPayloadService,
} from './services/qr-export-payload-service.js';
export {
  TelegramAnalyticsFoundationService,
} from './services/analytics-foundation-service.js';
export {
  TelegramRuntimeAnalyticsAutoCaptureService,
} from './services/runtime-analytics-auto-capture-service.js';
export {
  TelegramTemplateExecutionOrchestrationService,
} from './services/template-execution-orchestration-service.js';
export {
  TelegramRuntimeEntrypointOrchestrationService,
} from './services/runtime-entrypoint-orchestration-service.js';
export {
  TELEGRAM_WEBHOOK_OUTBOUND_RESPONSE_RESULT_VERSION,
  TelegramWebhookOutboundResponseOrchestrationService,
} from './services/webhook-outbound-response-orchestration-service.js';
export {
  TelegramScheduledMessageRunnerService,
} from './services/scheduled-message-runner-service.js';
export {
  TelegramGuestCommandActionOrchestrationService,
} from './services/guest-command-action-orchestration-service.js';
export {
  TELEGRAM_MINI_APP_TRIPS_CATALOG_ITEM_VERSION,
  TELEGRAM_MINI_APP_TRIPS_CATALOG_LIST_VERSION,
  TelegramMiniAppTripsCatalogQueryService,
} from './services/mini-app-trips-catalog-query-service.js';
export {
  TELEGRAM_MINI_APP_TRIP_CARD_RESULT_VERSION,
  TelegramMiniAppTripCardQueryService,
} from './services/mini-app-trip-card-query-service.js';
export {
  TELEGRAM_MINI_APP_BOOKING_SUBMIT_RESULT_VERSION,
  TELEGRAM_MINI_APP_BOOKING_SUBMIT_STATUSES,
  TelegramMiniAppBookingSubmitOrchestrationService,
} from './services/mini-app-booking-submit-orchestration-service.js';
export {
  TELEGRAM_BOOKING_REQUEST_LIFECYCLE_LIST_VERSION,
  TELEGRAM_BOOKING_REQUEST_LIFECYCLE_PROJECTION_ITEM_TYPE,
  TELEGRAM_BOOKING_REQUEST_LIFECYCLE_PROJECTION_VERSION,
  TELEGRAM_BOOKING_REQUEST_LIFECYCLE_STATES,
  TelegramBookingRequestLifecycleProjectionService,
} from './services/booking-request-lifecycle-projection-service.js';
export {
  TelegramSellerWorkQueueQueryService,
} from './services/seller-work-queue-query-service.js';
export {
  TelegramSellerActionService,
} from './services/seller-action-service.js';
export {
  TelegramSellerRequestStateProjectionService,
} from './services/seller-request-state-projection-service.js';
export {
  TelegramManualFallbackQueueQueryService,
} from './services/manual-fallback-queue-query-service.js';
export {
  TelegramManualFallbackActionService,
} from './services/manual-fallback-action-service.js';
export {
  TelegramManualFallbackRequestStateProjectionService,
} from './services/manual-fallback-request-state-projection-service.js';
export {
  TELEGRAM_BOOKING_REQUEST_GUEST_CANCEL_BEFORE_PREPAYMENT_RESULT_VERSION,
  TelegramBookingRequestGuestCancelBeforePrepaymentService,
} from './services/booking-request-guest-cancel-before-prepayment-service.js';
export {
  TelegramHandoffEligibilityProjectionService,
} from './services/handoff-eligibility-projection-service.js';
export {
  TELEGRAM_BOOKING_REQUEST_PREPAYMENT_CONFIRMATION_RESULT_VERSION,
  TelegramBookingRequestPrepaymentConfirmationService,
} from './services/booking-request-prepayment-confirmation-service.js';
export {
  TelegramPreHandoffValidationService,
} from './services/pre-handoff-validation-service.js';
export {
  TelegramProductionPresaleHandoffAdapterService,
} from './services/production-presale-handoff-adapter-service.js';
export {
  TelegramRealPresaleBridgeExecutionService,
} from './services/real-presale-bridge-execution-service.js';
export {
  createTelegramBotApiNotificationDeliveryAdapter,
  createTelegramBotApiSyncTransport,
  TELEGRAM_BOT_API_BASE_URL,
  TELEGRAM_BOT_API_NOTIFICATION_DELIVERY_ADAPTER_NAME,
  TELEGRAM_BOT_API_NOTIFICATION_DELIVERY_ADAPTER_VERSION,
  TelegramBotApiNotificationDeliveryAdapter,
} from './adapters/telegram-bot-api-notification-delivery-adapter.mjs';
export {
  createTelegramBotCommandAdapter,
  TELEGRAM_BOT_COMMAND_ADAPTER_NAME,
  TELEGRAM_BOT_COMMAND_ADAPTER_RESULT_VERSION,
  TelegramBotCommandAdapter,
} from './adapters/telegram-bot-command-adapter.mjs';
export {
  createTelegramBotCallbackAdapter,
  TELEGRAM_BOT_CALLBACK_ADAPTER_NAME,
  TELEGRAM_BOT_CALLBACK_ADAPTER_RESULT_VERSION,
  TelegramBotCallbackAdapter,
} from './adapters/telegram-bot-callback-adapter.mjs';
export {
  createTelegramWebhookRouter,
  TELEGRAM_WEBHOOK_ROUTE_NAME,
  TELEGRAM_WEBHOOK_ROUTE_RESULT_VERSION,
} from './webhook-router.mjs';
export {
  createTelegramMiniAppRouter,
  TELEGRAM_MINI_APP_HTTP_ROUTE_NAME,
  TELEGRAM_MINI_APP_HTTP_ROUTE_RESULT_VERSION,
} from './mini-app-router.mjs';
export {
  createTelegramSellerRouter,
  TELEGRAM_SELLER_HTTP_ROUTE_NAME,
  TELEGRAM_SELLER_HTTP_ROUTE_RESULT_VERSION,
} from './seller-router.mjs';
export {
  createTelegramOwnerRouter,
  TELEGRAM_OWNER_HTTP_ROUTE_NAME,
  TELEGRAM_OWNER_HTTP_ROUTE_RESULT_VERSION,
} from './owner-router.mjs';
export {
  createTelegramAdminRouter,
  TELEGRAM_ADMIN_HTTP_ROUTE_NAME,
  TELEGRAM_ADMIN_HTTP_ROUTE_RESULT_VERSION,
} from './admin-router.mjs';

const telegramServices = createTelegramDomainServices(telegramRepositories);

export function createTelegramPersistenceContext(db, options = {}) {
  ensureTelegramSchema(db);
  const repositories = createTelegramRepositories(db);
  const services = createTelegramDomainServices(repositories, options);

  return Object.freeze({
    repositories,
    services,
  });
}

export {
  createTelegramTicketViewSkeleton,
  createTelegramRepositories,
  ensureTelegramSchema,
  telegramRepositoryDefinitions,
  telegramDomainModelDefinitions,
  telegramEntitySchemas,
  telegramEnumSchemas,
  telegramRepositories,
  telegramServices,
};
