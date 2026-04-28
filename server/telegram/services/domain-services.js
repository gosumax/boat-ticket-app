import { TelegramBotStartStateService } from './bot-start-state-service.js';
import { TelegramBridgeAdapterDryRunContractService } from './bridge-adapter-dry-run-contract-service.js';
import { TelegramBridgeLinkageProjectionService } from './bridge-linkage-projection-service.js';
import { TelegramBookingRequestHoldActivationService } from './booking-request-hold-activation-service.js';
import { TelegramBookingRequestGuestCancelBeforePrepaymentService } from './booking-request-guest-cancel-before-prepayment-service.js';
import { TelegramBookingRequestHoldExtensionService } from './booking-request-hold-extension-service.js';
import { TelegramBookingRequestHoldExpiryService } from './booking-request-hold-expiry-service.js';
import { TelegramBookingRequestLifecycleProjectionService } from './booking-request-lifecycle-projection-service.js';
import { TelegramBookingRequestPrepaymentConfirmationService } from './booking-request-prepayment-confirmation-service.js';
import { TelegramBookingRequestCreationService } from './booking-request-creation-service.js';
import { TelegramBookingRequestService } from './booking-request-service.js';
import { TelegramConfirmedPrepaymentTicketRepairService } from './confirmed-prepayment-ticket-repair-service.js';
import { TelegramGuestProfileService } from './guest-profile-service.js';
import { TelegramGuestCommandActionOrchestrationService } from './guest-command-action-orchestration-service.js';
import { TelegramGuestTicketViewProjectionService } from './guest-ticket-view-projection-service.js';
import { TelegramGuestProfileAggregateService } from './guest-profile-aggregate-service.js';
import { TelegramGuestActionStateProjectionService } from './guest-action-state-projection-service.js';
import { TelegramGuestEntryProjectionService } from './guest-entry-projection-service.js';
import { TelegramGuestEntryPersistenceService } from './guest-entry-persistence-service.js';
import { TelegramGuestRoutingDecisionService } from './guest-routing-decision-service.js';
import { TelegramMiniAppBookingSubmitOrchestrationService } from './mini-app-booking-submit-orchestration-service.js';
import { TelegramMiniAppTripCardQueryService } from './mini-app-trip-card-query-service.js';
import { TelegramMiniAppTripsCatalogQueryService } from './mini-app-trips-catalog-query-service.js';
import { TelegramHandoffExecutionQueryService } from './handoff-execution-query-service.js';
import { TelegramHandoffEligibilityProjectionService } from './handoff-eligibility-projection-service.js';
import { TelegramHandoffExecutionService } from './handoff-execution-service.js';
import { TelegramHandoffReadinessQueryService } from './handoff-readiness-query-service.js';
import { TelegramManualFallbackActionService } from './manual-fallback-action-service.js';
import { TelegramManualFallbackQueueService } from './manual-fallback-queue-service.js';
import { TelegramManualFallbackQueueQueryService } from './manual-fallback-queue-query-service.js';
import { TelegramManualFallbackRequestStateProjectionService } from './manual-fallback-request-state-projection-service.js';
import { TelegramNotificationDeliveryAttemptPersistenceService } from './notification-delivery-attempt-persistence-service.js';
import { TelegramNotificationDeliveryAttemptProjectionService } from './notification-delivery-attempt-projection-service.js';
import { TelegramNotificationDeliveryExecutorService } from './notification-delivery-executor-service.js';
import { TelegramNotificationDeliveryRunService } from './notification-delivery-run-service.js';
import { TelegramNotificationDispatchQueueProjectionService } from './notification-dispatch-queue-service.js';
import { TelegramNotificationDeliveryPlanningService } from './notification-delivery-planning-service.js';
import { TelegramNotificationIntentPersistenceService } from './notification-intent-persistence-service.js';
import { TelegramOfflineTicketSnapshotService } from './offline-ticket-snapshot-service.js';
import { TelegramPostTripMessagePlanningService } from './post-trip-message-planning-service.js';
import { TelegramPreTripReminderPlanningService } from './pre-trip-reminder-planning-service.js';
import { TelegramPresaleHandoffService } from './presale-handoff-service.js';
import { TelegramPresaleHandoffAdapterService } from './presale-handoff-adapter-service.js';
import { TelegramPreHandoffValidationService } from './pre-handoff-validation-service.js';
import { TelegramProductionPresaleHandoffAdapterService } from './production-presale-handoff-adapter-service.js';
import { TelegramRealPresaleBridgeExecutionService } from './real-presale-bridge-execution-service.js';
import { TelegramRealHandoffPreExecutionGuardService } from './real-handoff-pre-execution-guard-service.js';
import { TelegramRealPresaleHandoffOrchestrationQueryService } from './real-presale-handoff-orchestration-query-service.js';
import { TelegramRealPresaleHandoffOrchestratorService } from './real-presale-handoff-orchestrator-service.js';
import { TelegramReviewFlowService } from './review-flow-service.js';
import { TelegramInboundStartOrchestrationService } from './inbound-start-orchestration-service.js';
import { TelegramTemplateExecutionOrchestrationService } from './template-execution-orchestration-service.js';
import { TelegramRuntimeEntrypointOrchestrationService } from './runtime-entrypoint-orchestration-service.js';
import { TelegramScheduledMessageRunnerService } from './scheduled-message-runner-service.js';
import { TelegramRuntimeAnalyticsAutoCaptureService } from './runtime-analytics-auto-capture-service.js';
import { TelegramWebhookOutboundResponseOrchestrationService } from './webhook-outbound-response-orchestration-service.js';
import { TelegramSellerWorkQueueService } from './seller-work-queue-service.js';
import { TelegramSellerWorkQueueQueryService } from './seller-work-queue-query-service.js';
import { TelegramSellerActionService } from './seller-action-service.js';
import { TelegramSellerRequestStateProjectionService } from './seller-request-state-projection-service.js';
import { TelegramServiceMessageResolutionService } from './service-message-resolution-service.js';
import { TelegramServiceMessageTemplateManagementService } from './service-message-template-management-service.js';
import { TelegramSellerAttributionProjectionService } from './seller-attribution-projection-service.js';
import { TelegramSellerAttributionSessionStartService } from './seller-attribution-session-start-service.js';
import { TelegramSourceBindingPersistenceService } from './source-binding-persistence-service.js';
import { TelegramSourceRegistryService } from './source-registry-service.js';
import { TelegramSourceAnalyticsReportingService } from './source-analytics-reporting-service.js';
import { TelegramStartSourceTokenResolutionService } from './start-source-token-resolution-service.js';
import { TelegramStartUpdateNormalizationService } from './start-update-normalization-service.js';
import { TelegramAnalyticsFoundationService } from './analytics-foundation-service.js';
import { TelegramQrExportPayloadService } from './qr-export-payload-service.js';
import { TelegramSourceAttributionService } from './source-attribution-service.js';
import { TelegramUsefulContentFaqProjectionService } from './useful-content-faq-projection-service.js';

export class TelegramDomainService {
  constructor(serviceName, dependencies = {}) {
    this.serviceName = serviceName;
    this.dependencies = dependencies;
  }

  describe() {
    return Object.freeze({
      serviceName: this.serviceName,
      status: 'skeleton_only',
      dependencyKeys: Object.keys(this.dependencies),
    });
  }
}

export function createTelegramDomainServices(repositories, options = {}) {
  const attributionService = new TelegramSourceAttributionService({
    guestProfiles: repositories.guestProfiles,
    guestEntries: repositories.guestEntries,
    trafficSources: repositories.trafficSources,
    sourceQRCodes: repositories.sourceQRCodes,
    sellerAttributionSessions: repositories.sellerAttributionSessions,
    analyticsEvents: repositories.analyticsEvents,
    bookingRequests: repositories.bookingRequests,
  });
  const bookingRequestService = new TelegramBookingRequestService({
    bookingRequests: repositories.bookingRequests,
    bookingHolds: repositories.bookingHolds,
    bookingRequestEvents: repositories.bookingRequestEvents,
  });
  const bookingRequestCreationService = new TelegramBookingRequestCreationService({
    guestProfiles: repositories.guestProfiles,
    sellerAttributionSessions: repositories.sellerAttributionSessions,
    bookingRequests: repositories.bookingRequests,
    bookingRequestEvents: repositories.bookingRequestEvents,
    now: options.bookingRequestCreationNow,
  });
  const bookingRequestHoldActivationService =
    new TelegramBookingRequestHoldActivationService({
      bookingRequests: repositories.bookingRequests,
      bookingHolds: repositories.bookingHolds,
      bookingRequestEvents: repositories.bookingRequestEvents,
      now: options.bookingRequestHoldActivationNow,
    });
  const bookingRequestHoldExtensionService =
    new TelegramBookingRequestHoldExtensionService({
      bookingRequests: repositories.bookingRequests,
      bookingHolds: repositories.bookingHolds,
      bookingRequestEvents: repositories.bookingRequestEvents,
      now: options.bookingRequestHoldExtensionNow,
    });
  const bookingRequestHoldExpiryService =
    new TelegramBookingRequestHoldExpiryService({
      bookingRequests: repositories.bookingRequests,
      bookingHolds: repositories.bookingHolds,
      bookingRequestEvents: repositories.bookingRequestEvents,
      now: options.bookingRequestHoldExpiryNow,
    });
  const bookingRequestLifecycleProjectionService =
    new TelegramBookingRequestLifecycleProjectionService({
      guestProfiles: repositories.guestProfiles,
      bookingRequests: repositories.bookingRequests,
      bookingHolds: repositories.bookingHolds,
      bookingRequestEvents: repositories.bookingRequestEvents,
    });
  const bookingRequestGuestCancelBeforePrepaymentService =
    new TelegramBookingRequestGuestCancelBeforePrepaymentService({
      bookingRequests: repositories.bookingRequests,
      bookingHolds: repositories.bookingHolds,
      bookingRequestEvents: repositories.bookingRequestEvents,
      bookingRequestLifecycleProjectionService,
      now: options.bookingRequestGuestCancelBeforePrepaymentNow,
    });
  const bookingRequestPrepaymentConfirmationService =
    new TelegramBookingRequestPrepaymentConfirmationService({
      bookingRequests: repositories.bookingRequests,
      bookingHolds: repositories.bookingHolds,
      bookingRequestEvents: repositories.bookingRequestEvents,
      bookingRequestLifecycleProjectionService,
      now: options.bookingRequestPrepaymentConfirmationNow,
    });
  const sellerWorkQueueService = new TelegramSellerWorkQueueService({
    bookingRequests: repositories.bookingRequests,
    bookingHolds: repositories.bookingHolds,
    bookingRequestEvents: repositories.bookingRequestEvents,
    sellerAttributionSessions: repositories.sellerAttributionSessions,
    guestProfiles: repositories.guestProfiles,
    bookingRequestService,
  });
  const sellerWorkQueueQueryService = new TelegramSellerWorkQueueQueryService({
    guestProfiles: repositories.guestProfiles,
    bookingRequests: repositories.bookingRequests,
    bookingHolds: repositories.bookingHolds,
    sellerAttributionSessions: repositories.sellerAttributionSessions,
    now: options.sellerWorkQueueQueryNow,
  });
  const sellerActionService = new TelegramSellerActionService({
    bookingRequests: repositories.bookingRequests,
    bookingRequestEvents: repositories.bookingRequestEvents,
    sellerAttributionSessions: repositories.sellerAttributionSessions,
    bookingRequestService,
    sellerWorkQueueQueryService,
    now: options.sellerActionNow,
  });
  const presaleHandoffService = new TelegramPresaleHandoffService({
    guestProfiles: repositories.guestProfiles,
    bookingRequests: repositories.bookingRequests,
    bookingHolds: repositories.bookingHolds,
    bookingRequestEvents: repositories.bookingRequestEvents,
    sellerAttributionSessions: repositories.sellerAttributionSessions,
    sellerAttributionSessionStartEvents:
      repositories.sellerAttributionSessionStartEvents,
    trafficSources: repositories.trafficSources,
    sourceQRCodes: repositories.sourceQRCodes,
    attributionService,
    bookingRequestLifecycleProjectionService,
  });
  const handoffReadinessQueryService = new TelegramHandoffReadinessQueryService({
    guestProfiles: repositories.guestProfiles,
    bookingRequests: repositories.bookingRequests,
    bookingRequestEvents: repositories.bookingRequestEvents,
    bookingRequestLifecycleProjectionService,
  });
  const handoffExecutionQueryService = new TelegramHandoffExecutionQueryService({
    bookingRequestEvents: repositories.bookingRequestEvents,
    handoffReadinessQueryService,
  });
  const bridgeAdapterDryRunContractService =
    new TelegramBridgeAdapterDryRunContractService();
  const handoffExecutionService = new TelegramHandoffExecutionService({
    bookingRequests: repositories.bookingRequests,
    bookingHolds: repositories.bookingHolds,
    bookingRequestEvents: repositories.bookingRequestEvents,
    handoffReadinessQueryService,
    handoffExecutionQueryService,
  });
  const preHandoffValidationService = new TelegramPreHandoffValidationService({
    handoffReadinessQueryService,
    handoffExecutionQueryService,
    bridgeAdapterDryRunContractService,
  });
  const handoffEligibilityProjectionService =
    new TelegramHandoffEligibilityProjectionService({
      handoffReadinessQueryService,
      handoffExecutionQueryService,
      preHandoffValidationService,
    });
  const manualFallbackQueueQueryService =
    new TelegramManualFallbackQueueQueryService({
      guestProfiles: repositories.guestProfiles,
      bookingRequests: repositories.bookingRequests,
      bookingHolds: repositories.bookingHolds,
      bookingRequestEvents: repositories.bookingRequestEvents,
      sellerAttributionSessions: repositories.sellerAttributionSessions,
      trafficSources: repositories.trafficSources,
      sourceQRCodes: repositories.sourceQRCodes,
      guestEntrySourceBindingEvents: repositories.guestEntrySourceBindingEvents,
      attributionService,
      now: options.manualFallbackQueueQueryNow,
    });
  const manualFallbackActionService = new TelegramManualFallbackActionService({
    bookingRequests: repositories.bookingRequests,
    bookingHolds: repositories.bookingHolds,
    bookingRequestEvents: repositories.bookingRequestEvents,
    sellerAttributionSessions: repositories.sellerAttributionSessions,
    attributionService,
    bookingRequestService,
    manualFallbackQueueQueryService,
    now: options.manualFallbackActionNow,
  });
  const manualFallbackQueueService = new TelegramManualFallbackQueueService({
    bookingRequests: repositories.bookingRequests,
    bookingHolds: repositories.bookingHolds,
    bookingRequestEvents: repositories.bookingRequestEvents,
    sellerAttributionSessions: repositories.sellerAttributionSessions,
    trafficSources: repositories.trafficSources,
    sourceQRCodes: repositories.sourceQRCodes,
    attributionService,
    bookingRequestService,
    presaleHandoffService,
    handoffReadinessQueryService,
    handoffExecutionQueryService,
    handoffExecutionService,
  });
  const presaleHandoffAdapterService = new TelegramPresaleHandoffAdapterService({
    handoffExecutionQueryService,
  });
  const productionPresaleHandoffAdapterService =
    new TelegramProductionPresaleHandoffAdapterService({
      bookingRequests: repositories.bookingRequests,
      bookingRequestEvents: repositories.bookingRequestEvents,
    });
  const realHandoffPreExecutionGuardService = new TelegramRealHandoffPreExecutionGuardService({
    handoffExecutionQueryService,
    presaleHandoffAdapterService,
  });
  const realPresaleBridgeExecutionService =
    new TelegramRealPresaleBridgeExecutionService({
      bookingRequests: repositories.bookingRequests,
      handoffReadinessQueryService,
      handoffExecutionQueryService,
      realHandoffPreExecutionGuardService,
      productionPresaleHandoffAdapterService,
    });
  const realPresaleHandoffOrchestrationQueryService =
    new TelegramRealPresaleHandoffOrchestrationQueryService({
      bookingRequestEvents: repositories.bookingRequestEvents,
      handoffExecutionQueryService,
    });
  const bridgeLinkageProjectionService = new TelegramBridgeLinkageProjectionService({
    bookingRequests: repositories.bookingRequests,
    handoffReadinessQueryService,
    handoffExecutionQueryService,
    realPresaleHandoffOrchestrationQueryService,
  });
  const manualFallbackRequestStateProjectionService =
    new TelegramManualFallbackRequestStateProjectionService({
      bookingRequests: repositories.bookingRequests,
      bookingRequestEvents: repositories.bookingRequestEvents,
      sellerAttributionSessions: repositories.sellerAttributionSessions,
      manualFallbackQueueQueryService,
      bridgeLinkageProjectionService,
    });
  const sellerRequestStateProjectionService =
    new TelegramSellerRequestStateProjectionService({
      bookingRequestEvents: repositories.bookingRequestEvents,
      sellerWorkQueueQueryService,
      bridgeLinkageProjectionService,
    });
  const guestProfileService = new TelegramGuestProfileService({
    guestProfiles: repositories.guestProfiles,
    guestEntries: repositories.guestEntries,
    trafficSources: repositories.trafficSources,
    sourceQRCodes: repositories.sourceQRCodes,
    sellerAttributionSessions: repositories.sellerAttributionSessions,
    bookingRequests: repositories.bookingRequests,
    bookingHolds: repositories.bookingHolds,
    bookingRequestEvents: repositories.bookingRequestEvents,
    handoffReadinessQueryService,
    handoffExecutionQueryService,
    realPresaleHandoffOrchestrationQueryService,
  });
  const guestTicketViewProjectionService =
    new TelegramGuestTicketViewProjectionService({
      guestProfiles: repositories.guestProfiles,
      bookingRequests: repositories.bookingRequests,
      bookingHolds: repositories.bookingHolds,
      bookingRequestEvents: repositories.bookingRequestEvents,
      sellerAttributionSessions: repositories.sellerAttributionSessions,
      trafficSources: repositories.trafficSources,
      sourceQRCodes: repositories.sourceQRCodes,
      sourceRegistryItems: repositories.sourceRegistryItems,
      guestProfileService,
    });
  const offlineTicketSnapshotService = new TelegramOfflineTicketSnapshotService({
    guestTicketViewProjectionService,
    now: options.offlineTicketSnapshotNow,
  });
  const preTripReminderPlanningService =
    new TelegramPreTripReminderPlanningService({
      guestProfiles: repositories.guestProfiles,
      bookingRequests: repositories.bookingRequests,
      guestTicketViewProjectionService,
      now: options.preTripReminderPlanningNow,
    });
  const postTripMessagePlanningService =
    new TelegramPostTripMessagePlanningService({
      guestProfiles: repositories.guestProfiles,
      bookingRequests: repositories.bookingRequests,
      postTripMessages: repositories.postTripMessages,
      reviewSubmissions: repositories.reviewSubmissions,
      guestTicketViewProjectionService,
      now: options.postTripMessagePlanningNow,
    });
  const reviewFlowService = new TelegramReviewFlowService({
    bookingRequests: repositories.bookingRequests,
    bookingRequestEvents: repositories.bookingRequestEvents,
    guestProfiles: repositories.guestProfiles,
    reviewSubmissions: repositories.reviewSubmissions,
    guestTicketViewProjectionService,
    now: options.reviewFlowNow,
  });
  const usefulContentFaqProjectionService =
    new TelegramUsefulContentFaqProjectionService({
      guestProfiles: repositories.guestProfiles,
      bookingRequests: repositories.bookingRequests,
      managedContentItems: repositories.managedContentItems,
      resolveWeatherSnapshot:
        options.telegramWeatherSnapshotResolver ??
        options.resolveTelegramWeatherSnapshot ??
        null,
      now: options.usefulContentFaqProjectionNow,
    });
  const serviceMessageTemplateManagementService =
    new TelegramServiceMessageTemplateManagementService({
      managedContentItems: repositories.managedContentItems,
      now: options.serviceMessageTemplateManagementNow,
    });
  const sourceRegistryService = new TelegramSourceRegistryService({
    sourceRegistryItems: repositories.sourceRegistryItems,
    now: options.sourceRegistryNow,
  });
  const sourceAnalyticsReportingService =
    new TelegramSourceAnalyticsReportingService({
      analyticsCaptureEvents: repositories.analyticsCaptureEvents,
      sourceRegistryItems: repositories.sourceRegistryItems,
      now: options.sourceAnalyticsReportingNow,
    });
  const qrExportPayloadService = new TelegramQrExportPayloadService({
    sourceRegistryItems: repositories.sourceRegistryItems,
    now: options.qrExportPayloadNow,
  });
  const analyticsFoundationService = new TelegramAnalyticsFoundationService({
    analyticsCaptureEvents: repositories.analyticsCaptureEvents,
    guestProfiles: repositories.guestProfiles,
    bookingRequests: repositories.bookingRequests,
    sourceRegistryItems: repositories.sourceRegistryItems,
    trafficSources: repositories.trafficSources,
    now: options.analyticsFoundationNow,
  });
  const botStartStateService = new TelegramBotStartStateService({
    guestProfileService,
  });
  const guestActionStateProjectionService =
    new TelegramGuestActionStateProjectionService({
      botStartStateService,
    });
  const startUpdateNormalizationService = new TelegramStartUpdateNormalizationService();
  const startSourceTokenResolutionService =
    new TelegramStartSourceTokenResolutionService();
  const guestEntryPersistenceService = new TelegramGuestEntryPersistenceService({
    guestEntryEvents: repositories.guestEntryEvents,
  });
  const guestEntryProjectionService = new TelegramGuestEntryProjectionService({
    guestEntryEvents: repositories.guestEntryEvents,
  });
  const sourceBindingPersistenceService =
    new TelegramSourceBindingPersistenceService({
      guestEntryEvents: repositories.guestEntryEvents,
      guestEntrySourceBindingEvents: repositories.guestEntrySourceBindingEvents,
      now: options.sourceBindingNow,
    });
  const sellerAttributionSessionStartService =
    new TelegramSellerAttributionSessionStartService({
      guestProfiles: repositories.guestProfiles,
      trafficSources: repositories.trafficSources,
      sourceQRCodes: repositories.sourceQRCodes,
      sourceRegistryItems: repositories.sourceRegistryItems,
      sellerAttributionSessions: repositories.sellerAttributionSessions,
      sellerAttributionSessionStartEvents:
        repositories.sellerAttributionSessionStartEvents,
      guestEntrySourceBindingEvents: repositories.guestEntrySourceBindingEvents,
      now: options.sellerAttributionSessionStartNow,
    });
  const sellerAttributionProjectionService =
    new TelegramSellerAttributionProjectionService({
      sellerAttributionSessionStartEvents:
        repositories.sellerAttributionSessionStartEvents,
      guestEntrySourceBindingEvents: repositories.guestEntrySourceBindingEvents,
      now: options.sellerAttributionProjectionNow,
    });
  const guestRoutingDecisionService =
    new TelegramGuestRoutingDecisionService({
      guestEntryProjectionService,
      sellerAttributionProjectionService,
      guestEntrySourceBindingEvents: repositories.guestEntrySourceBindingEvents,
    });
  const miniAppTripsCatalogQueryService = new TelegramMiniAppTripsCatalogQueryService({
    guestProfiles: repositories.guestProfiles,
    bookingRequests: repositories.bookingRequests,
    now: options.miniAppTripsCatalogQueryNow,
  });
  const miniAppTripCardQueryService = new TelegramMiniAppTripCardQueryService({
    bookingRequests: repositories.bookingRequests,
    now: options.miniAppTripCardQueryNow,
  });
  const miniAppBookingSubmitOrchestrationService =
    new TelegramMiniAppBookingSubmitOrchestrationService({
      guestProfiles: repositories.guestProfiles,
      sellerAttributionSessions: repositories.sellerAttributionSessions,
      trafficSources: repositories.trafficSources,
      sourceQRCodes: repositories.sourceQRCodes,
      sourceRegistryItems: repositories.sourceRegistryItems,
      guestRoutingDecisionService,
      bookingRequestCreationService,
      bookingRequestHoldActivationService,
      miniAppTripCardQueryService,
      now: options.miniAppBookingSubmitNow,
    });
  const guestProfileAggregateService = new TelegramGuestProfileAggregateService({
    guestEntrySourceBindingEvents: repositories.guestEntrySourceBindingEvents,
    sellerAttributionSessionStartEvents:
      repositories.sellerAttributionSessionStartEvents,
    guestProfileService,
    guestRoutingDecisionService,
  });
  const serviceMessageResolutionService = new TelegramServiceMessageResolutionService({
    guestProfileService,
    botStartStateService,
  });
  const notificationDeliveryPlanningService =
    new TelegramNotificationDeliveryPlanningService();
  const notificationIntentPersistenceService =
    new TelegramNotificationIntentPersistenceService({
      bookingRequests: repositories.bookingRequests,
      bookingHolds: repositories.bookingHolds,
      bookingRequestEvents: repositories.bookingRequestEvents,
    });
  const notificationDispatchQueueProjectionService =
    new TelegramNotificationDispatchQueueProjectionService({
      bookingRequestEvents: repositories.bookingRequestEvents,
    });
  const notificationDeliveryAttemptPersistenceService =
    new TelegramNotificationDeliveryAttemptPersistenceService({
      bookingRequests: repositories.bookingRequests,
      bookingHolds: repositories.bookingHolds,
      bookingRequestEvents: repositories.bookingRequestEvents,
    });
  const notificationDeliveryAttemptProjectionService =
    new TelegramNotificationDeliveryAttemptProjectionService({
      bookingRequestEvents: repositories.bookingRequestEvents,
    });
  const notificationDeliveryExecutorService =
    new TelegramNotificationDeliveryExecutorService({
      notificationDeliveryAttemptPersistenceService,
      executeTelegramNotificationDelivery: options.executeTelegramNotificationDelivery,
      deliveryAdapter: options.notificationDeliveryAdapter,
    });
  const notificationDeliveryRunService =
    new TelegramNotificationDeliveryRunService({
      notificationDispatchQueueProjectionService,
      notificationDeliveryExecutorService,
      notificationDeliveryAttemptProjectionService,
    });
  const webhookOutboundResponseOrchestrationService =
    new TelegramWebhookOutboundResponseOrchestrationService({
      notificationDeliveryExecutorService,
      now: options.webhookOutboundResponseOrchestrationNow,
    });
  const executeRealPresaleHandoff =
    typeof options.executeRealPresaleHandoff === 'function'
      ? options.executeRealPresaleHandoff
      : typeof options.createRealPresaleHandoffExecutor === 'function'
        ? options.createRealPresaleHandoffExecutor({
            repositories,
            services: {
              realPresaleBridgeExecutionService,
              productionPresaleHandoffAdapterService,
            },
          })
        : (payload = {}) =>
            realPresaleBridgeExecutionService.execute(
              payload.bookingRequestId,
              payload.requestInput || {}
            );
  const realPresaleHandoffOrchestratorService =
    new TelegramRealPresaleHandoffOrchestratorService({
      bookingRequests: repositories.bookingRequests,
      bookingHolds: repositories.bookingHolds,
      bookingRequestEvents: repositories.bookingRequestEvents,
      handoffReadinessQueryService,
      handoffExecutionService,
      handoffExecutionQueryService,
      handoffEligibilityProjectionService,
      bridgeAdapterDryRunContractService,
      realHandoffPreExecutionGuardService,
      realPresaleHandoffOrchestrationQueryService,
      executeRealPresaleHandoff,
    });
  const confirmedPrepaymentTicketRepairService =
    new TelegramConfirmedPrepaymentTicketRepairService({
      bookingRequests: repositories.bookingRequests,
      bookingHolds: repositories.bookingHolds,
      bookingRequestEvents: repositories.bookingRequestEvents,
      presaleHandoffService,
      realPresaleHandoffOrchestratorService,
      now: options.confirmedPrepaymentTicketRepairNow,
    });
  sellerWorkQueueService.setPrepaymentBridgeServices({
    presaleHandoffService,
    realPresaleHandoffOrchestratorService,
  });
  const runtimeAnalyticsAutoCaptureService =
    new TelegramRuntimeAnalyticsAutoCaptureService({
      analyticsFoundationService,
      bookingRequestCreationService,
      bookingRequestHoldActivationService,
      bookingRequestHoldExtensionService,
      bookingRequestHoldExpiryService,
      bookingRequestGuestCancelBeforePrepaymentService,
      bookingRequestPrepaymentConfirmationService,
      realPresaleHandoffOrchestratorService,
      reviewFlowService,
      autoCaptureEnabled:
        options.runtimeAnalyticsAutoCaptureEnabled ??
        options.telegramRuntimeAutoCaptureEnabled ??
        true,
      now: options.runtimeAnalyticsAutoCaptureNow,
    });
  const inboundStartOrchestrationService =
    new TelegramInboundStartOrchestrationService({
      guestProfiles: repositories.guestProfiles,
      startUpdateNormalizationService,
      startSourceTokenResolutionService,
      guestEntryPersistenceService,
      sourceBindingPersistenceService,
      sellerAttributionSessionStartService,
      botStartStateService,
      guestActionStateProjectionService,
      runtimeAnalyticsAutoCaptureService,
      now: options.inboundStartOrchestrationNow,
    });
  const templateExecutionOrchestrationService =
    new TelegramTemplateExecutionOrchestrationService({
      guestProfileService,
      serviceMessageResolutionService,
      serviceMessageTemplateManagementService,
      usefulContentFaqProjectionService,
      preTripReminderPlanningService,
      postTripMessagePlanningService,
      notificationDeliveryPlanningService,
      notificationIntentPersistenceService,
      notificationDeliveryRunService,
      runtimeAnalyticsAutoCaptureService,
      now: options.templateExecutionOrchestrationNow,
    });
  const guestCommandActionOrchestrationService =
    new TelegramGuestCommandActionOrchestrationService({
      guestActionStateProjectionService,
      guestTicketViewProjectionService,
      guestProfileService,
      bookingRequestLifecycleProjectionService,
      usefulContentFaqProjectionService,
      bookingRequestGuestCancelBeforePrepaymentService,
      now: options.guestCommandActionOrchestrationNow,
    });
  const runtimeEntrypointOrchestrationService =
    new TelegramRuntimeEntrypointOrchestrationService({
      inboundStartOrchestrationService,
      guestCommandActionOrchestrationService,
      templateExecutionOrchestrationService,
      now: options.runtimeEntrypointOrchestrationNow,
    });
  const scheduledMessageRunnerService =
    new TelegramScheduledMessageRunnerService({
      bookingRequests: repositories.bookingRequests,
      preTripReminderPlanningService,
      postTripMessagePlanningService,
      templateExecutionOrchestrationService,
      now: options.scheduledMessageRunnerNow,
    });

  return Object.freeze({
    inboundStartOrchestrationService,
    templateExecutionOrchestrationService,
    runtimeEntrypointOrchestrationService,
    scheduledMessageRunnerService,
    guestCommandActionOrchestrationService,
    runtimeAnalyticsAutoCaptureService,
    guestActionStateProjectionService,
    serviceMessageResolutionService,
    notificationDeliveryPlanningService,
    notificationIntentPersistenceService,
    notificationDispatchQueueProjectionService,
    notificationDeliveryAttemptPersistenceService,
    notificationDeliveryAttemptProjectionService,
    notificationDeliveryExecutorService,
    notificationDeliveryRunService,
    webhookOutboundResponseOrchestrationService,
    startUpdateNormalizationService,
    startSourceTokenResolutionService,
    guestEntryPersistenceService,
    guestEntryProjectionService,
    sourceBindingPersistenceService,
    sellerAttributionSessionStartService,
    sellerAttributionProjectionService,
    guestRoutingDecisionService,
    miniAppTripsCatalogQueryService,
    miniAppTripCardQueryService,
    miniAppBookingSubmitOrchestrationService,
    guestProfileAggregateService,
    botStartStateService,
    guestProfileService,
    guestTicketViewProjectionService,
    offlineTicketSnapshotService,
    preTripReminderPlanningService,
    postTripMessagePlanningService,
    reviewFlowService,
    usefulContentFaqProjectionService,
    serviceMessageTemplateManagementService,
    sourceRegistryService,
    sourceAnalyticsReportingService,
    qrExportPayloadService,
    analyticsFoundationService,
    attributionService,
    bookingRequestCreationService,
    bookingRequestHoldActivationService,
    bookingRequestHoldExtensionService,
    bookingRequestHoldExpiryService,
    bookingRequestLifecycleProjectionService,
    bookingRequestGuestCancelBeforePrepaymentService,
    bookingRequestPrepaymentConfirmationService,
    bookingRequestService,
    sellerWorkQueueService,
    sellerWorkQueueQueryService,
    sellerActionService,
    sellerRequestStateProjectionService,
    manualFallbackQueueQueryService,
    manualFallbackActionService,
    manualFallbackRequestStateProjectionService,
    presaleHandoffService,
    handoffReadinessQueryService,
    handoffExecutionQueryService,
    bridgeAdapterDryRunContractService,
    preHandoffValidationService,
    handoffEligibilityProjectionService,
    manualFallbackQueueService,
    handoffExecutionService,
    presaleHandoffAdapterService,
    productionPresaleHandoffAdapterService,
    realPresaleBridgeExecutionService,
    realHandoffPreExecutionGuardService,
    realPresaleHandoffOrchestrationQueryService,
    bridgeLinkageProjectionService,
    realPresaleHandoffOrchestratorService,
    confirmedPrepaymentTicketRepairService,
    notificationService: new TelegramDomainService('telegram-notification-service', {
      telegramNotifications: repositories.telegramNotifications,
      telegramContentBlocks: repositories.telegramContentBlocks,
      telegramTicketViews: repositories.telegramTicketViews,
    }),
    postTripService: new TelegramDomainService('post-trip-service', {
      postTripMessages: repositories.postTripMessages,
      postTripOffers: repositories.postTripOffers,
      reviewSubmissions: repositories.reviewSubmissions,
      analyticsEvents: repositories.analyticsEvents,
    }),
  });
}
