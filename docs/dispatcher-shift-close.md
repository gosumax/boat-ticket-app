# Dispatcher Shift Close Reference

This file is a focused high-risk reference for shift-close behavior.

## Why It Matters

Shift close is a protected production flow. Tasks that touch it are high risk and normally require strong validation.

## Protected Behavior

- live financial data comes from `money_ledger`
- closed-day snapshot data comes from `shift_closures`
- after close, summary data must come from the snapshot rather than being recomputed
- close must remain idempotent
- post-close protected operations must preserve `SHIFT_CLOSED` behavior

## Invariants

- `net_total = collected_total - refund_total`
- `net_cash = collected_cash - refund_cash`
- `net_card = collected_card - refund_card`
- snapshot data is immutable after close

## Protected Endpoints

- `GET /api/dispatcher/shift-ledger/summary`
- `POST /api/dispatcher/shift/deposit`
- `POST /api/dispatcher/shift/close`

## Practical Rule

If a task touches shift-close logic, ledger/snapshot switching, cashbox calculations, or close protection semantics, treat it as high risk and validate accordingly.
