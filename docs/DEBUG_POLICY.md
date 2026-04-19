# Debug Policy

This file is an optional operational reference, not a core source of truth.

## Purpose

- allow temporary diagnostics during development
- keep diagnostic data useful without redefining business behavior

## Rules

- Debug output must not silently change runtime behavior.
- Debug-only instrumentation should stay removable and scoped.
- Financial debug views must treat `money_ledger` as the immutable source of truth.
- Recalculated or estimated values are diagnostic only and must not replace control totals.

## Good Diagnostic Data

- `slotUid`
- server time
- cutoff-related timestamps
- role and guard outcomes
- structured error codes
