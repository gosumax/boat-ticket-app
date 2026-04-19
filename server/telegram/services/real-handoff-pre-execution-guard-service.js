import {
  buildTelegramRealHandoffPreExecutionDecision,
  freezeTelegramHandoffValue,
  SELLER_SOURCE_FAMILIES,
} from '../../../shared/telegram/index.js';

function asIssue(code, message, details = {}) {
  return freezeTelegramHandoffValue({
    code,
    message,
    details,
  });
}

function appendUniqueIssue(target, issue) {
  const signature = JSON.stringify([
    issue?.code || null,
    issue?.message || null,
    issue?.details || null,
  ]);
  const exists = target.some(
    (existing) =>
      JSON.stringify([
        existing?.code || null,
        existing?.message || null,
        existing?.details || null,
      ]) === signature
  );

  if (!exists) {
    target.push(issue);
  }
}

function mapAdapterIssue(issue, issueSource) {
  return asIssue(issue?.code || 'UNKNOWN_ADAPTER_ISSUE', issue?.message || 'Unknown adapter issue', {
    issue_source: issueSource,
    ...(issue?.details || {}),
  });
}

function hasStrictAdapterNoOpContract(adapterResult) {
  return (
    adapterResult?.dry_run === true &&
    adapterResult?.no_op?.production_presale_created === false &&
    adapterResult?.no_op?.production_seats_reserved === false &&
    adapterResult?.no_op?.money_ledger_written === false &&
    adapterResult?.no_op?.production_routes_invoked === false &&
    adapterResult?.no_op?.production_bot_handlers_invoked === false
  );
}

function hasStrictBridgeNoOpContract(bridgeInput) {
  return (
    bridgeInput?.dry_run_only === true &&
    bridgeInput?.no_op_guards?.production_presale_not_created === true &&
    bridgeInput?.no_op_guards?.seat_reservation_not_applied === true &&
    bridgeInput?.no_op_guards?.money_ledger_not_written === true
  );
}

export class TelegramRealHandoffPreExecutionGuardService {
  constructor({
    handoffExecutionQueryService,
    presaleHandoffAdapterService,
  }) {
    this.handoffExecutionQueryService = handoffExecutionQueryService;
    this.presaleHandoffAdapterService = presaleHandoffAdapterService;
  }

  describe() {
    return Object.freeze({
      serviceName: 'real-handoff-pre-execution-guard-service',
      status: 'guard_ready',
      dependencyKeys: ['handoffExecutionQueryService', 'presaleHandoffAdapterService'],
    });
  }

  evaluateExecutionDecision(
    bookingRequestId,
    {
      slotUid = null,
      paymentMethod = null,
      cashAmount = null,
      cardAmount = null,
    } = {}
  ) {
    let executionSnapshot = null;
    let executionSnapshotError = null;

    try {
      executionSnapshot = this.handoffExecutionQueryService.readExecutionState(bookingRequestId);
    } catch (error) {
      executionSnapshotError = error;
    }

    const adapterResult = this.presaleHandoffAdapterService.validateDryRun(bookingRequestId, {
      slotUid,
      paymentMethod,
      cashAmount,
      cardAmount,
    });
    const hardBlockers = [];
    const manualEscalations = [];
    const softWarnings = [];

    if (executionSnapshotError) {
      appendUniqueIssue(
        hardBlockers,
        asIssue(
          'EXECUTION_SNAPSHOT_UNAVAILABLE',
          executionSnapshotError?.message || 'Execution snapshot is unavailable for guard evaluation',
          {
            booking_request_id: bookingRequestId,
          }
        )
      );
    }

    if (!adapterResult) {
      appendUniqueIssue(
        hardBlockers,
        asIssue(
          'ADAPTER_RESULT_UNAVAILABLE',
          'Dry-run adapter result is unavailable for pre-execution guard evaluation',
          {
            booking_request_id: bookingRequestId,
          }
        )
      );
    } else {
      if (!hasStrictAdapterNoOpContract(adapterResult)) {
        appendUniqueIssue(
          hardBlockers,
          asIssue(
            'ADAPTER_RESULT_NOT_NO_OP',
            'Dry-run adapter result must remain explicitly no-op before any future real bridge is considered',
            {
              adapter_name: adapterResult.adapter_name || null,
              adapter_version: adapterResult.adapter_version || null,
            }
          )
        );
      }

      if (!adapterResult.bridge_input) {
        appendUniqueIssue(
          hardBlockers,
          asIssue(
            'BRIDGE_INPUT_MISSING',
            'Dry-run adapter result did not produce bridge_input for guard evaluation'
          )
        );
      } else if (!hasStrictBridgeNoOpContract(adapterResult.bridge_input)) {
        appendUniqueIssue(
          hardBlockers,
          asIssue(
            'BRIDGE_INPUT_NOT_NO_OP',
            'Bridge input must remain explicitly dry-run-only and no-op for guard evaluation',
            {
              adapter_name: adapterResult.adapter_name || null,
            }
          )
        );
      }

      if (adapterResult.outcome !== 'success') {
        const adapterIssues = [
          ...(adapterResult.validation?.blockers || []),
          ...(adapterResult.validation?.failures || []),
        ];

        if (adapterIssues.length === 0) {
          appendUniqueIssue(
            hardBlockers,
            asIssue(
              'ADAPTER_NOT_READY_FOR_REAL_HANDOFF',
              adapterResult.message ||
                'Dry-run adapter did not reach a success outcome required for future real bridge eligibility',
              {
                adapter_outcome: adapterResult.outcome || null,
                adapter_outcome_code: adapterResult.outcome_code || null,
              }
            )
          );
        } else {
          for (const issue of adapterIssues) {
            appendUniqueIssue(hardBlockers, mapAdapterIssue(issue, 'adapter_result'));
          }
        }
      }

      for (const issue of adapterResult.validation?.warnings || []) {
        appendUniqueIssue(softWarnings, mapAdapterIssue(issue, 'adapter_result'));
      }
    }

    if (executionSnapshot && adapterResult?.bridge_input) {
      const guardContext = adapterResult.bridge_input.telegram_handoff_context || {};
      if (
        guardContext.booking_request_id !== executionSnapshot.booking_request_id ||
        guardContext.handoff_prepared_event_id !== executionSnapshot.handoff_prepared_event_id ||
        guardContext.current_execution_state !== executionSnapshot.current_execution_state
      ) {
        appendUniqueIssue(
          hardBlockers,
          asIssue(
            'SNAPSHOT_ADAPTER_CONTEXT_MISMATCH',
            'Dry-run adapter result does not match the frozen execution snapshot used for guard evaluation',
            {
              expected_booking_request_id: executionSnapshot.booking_request_id,
              actual_booking_request_id: guardContext.booking_request_id ?? null,
              expected_handoff_prepared_event_id: executionSnapshot.handoff_prepared_event_id,
              actual_handoff_prepared_event_id:
                guardContext.handoff_prepared_event_id ?? null,
              expected_execution_state: executionSnapshot.current_execution_state,
              actual_execution_state: guardContext.current_execution_state ?? null,
            }
          )
        );
      }

      const request = adapterResult.bridge_input.presale_create_request || {};
      const sourceFamily = executionSnapshot.attribution_context?.source_family || null;
      const sourceOwnership = executionSnapshot.attribution_context?.source_ownership || null;
      const pathType = executionSnapshot.attribution_context?.path_type || null;
      const prepaymentAmount = Number(request.prepaymentAmount || 0);

      if (String(request.slotUid || '').startsWith('manual:')) {
        appendUniqueIssue(
          softWarnings,
          asIssue(
            'MANUAL_SLOT_UID_RECHECK_RECOMMENDED',
            'Manual slotUid resolution should be rechecked before any future real bridge execution',
            {
              slotUid: request.slotUid,
            }
          )
        );
      }

      if (executionSnapshot.current_execution_state === 'handoff_consumed') {
        appendUniqueIssue(
          manualEscalations,
          asIssue(
            'EXECUTION_ALREADY_CONSUMED_REQUIRES_REVIEW',
            'Already-consumed execution snapshots require manual review before any future real bridge execution',
            {
              current_execution_state: executionSnapshot.current_execution_state,
            }
          )
        );
      }

      if (
        !SELLER_SOURCE_FAMILIES.includes(sourceFamily) ||
        sourceOwnership !== 'seller' ||
        pathType !== 'seller_attributed'
      ) {
        appendUniqueIssue(
          manualEscalations,
          asIssue(
            'NON_SELLER_ATTRIBUTION_REQUIRES_REVIEW',
            'Non-seller attribution snapshots require manual review before any future real bridge execution',
            {
              source_family: sourceFamily,
              source_ownership: sourceOwnership,
              path_type: pathType,
            }
          )
        );
      }

      if (prepaymentAmount > 0 && paymentMethod === null) {
        appendUniqueIssue(
          manualEscalations,
          asIssue(
            'IMPLICIT_PAYMENT_METHOD_REQUIRES_REVIEW',
            'Prepaid requests need an explicit payment method before any future real bridge execution',
            {
              inferred_payment_method: request.payment_method || null,
              prepayment_amount: prepaymentAmount,
            }
          )
        );
      }

      if (request.payment_method === 'MIXED') {
        appendUniqueIssue(
          manualEscalations,
          asIssue(
            'MIXED_PAYMENT_REQUIRES_REVIEW',
            'Mixed payment splits require manual review before any future real bridge execution',
            {
              cash_amount: request.cash_amount,
              card_amount: request.card_amount,
              prepayment_amount: request.prepaymentAmount,
            }
          )
        );
      }
    }

    const decision =
      hardBlockers.length > 0
        ? 'blocked'
        : manualEscalations.length > 0
          ? 'manual_escalation_required'
          : 'eligible';
    const decisionCode =
      hardBlockers[0]?.code ||
      manualEscalations[0]?.code ||
      (softWarnings.length > 0
        ? 'ELIGIBLE_WITH_WARNINGS'
        : 'ELIGIBLE_FOR_FUTURE_REAL_BRIDGE');
    const message =
      decision === 'blocked'
        ? hardBlockers[0].message
        : decision === 'manual_escalation_required'
          ? manualEscalations[0].message
          : softWarnings.length > 0
            ? 'Future real bridge remains eligible, with non-blocking warnings recorded by the guard'
            : 'Future real bridge is eligible based on the frozen execution snapshot and dry-run adapter result';

    return buildTelegramRealHandoffPreExecutionDecision({
      decision,
      decisionCode,
      message,
      executionSnapshot,
      adapterResult,
      hardBlockers,
      manualEscalations,
      softWarnings,
    });
  }
}
