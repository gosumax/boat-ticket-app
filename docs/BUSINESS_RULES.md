# Business Rules

This file is the business source of truth for protected runtime behavior.

## Protected Runtime Domains

- seller flow
- dispatcher flow
- owner flow
- admin flow where it affects production behavior
- financial logic and reporting

## Core Truths

- `money_ledger` is the financial source of truth.
- Existing seller flow must not be broken by unrelated work.
- Existing dispatcher and owner flows must not be changed silently.
- Manual and generated slots must follow the same business rules unless a documented rule explicitly says otherwise.

## Roles

### Seller

- Seller sales are limited by `seller_cutoff_minutes`.
- If `seller_cutoff_minutes` is `NULL`, there is no seller cutoff.
- Seller cannot override cutoff rules.

### Dispatcher

- Dispatcher sales are limited by `dispatcher_cutoff_minutes`.
- `dispatcher_cutoff_minutes` must not be stricter than seller access when both are configured.
- Dispatcher may retain access after seller access closes when business rules allow it.

### Admin

- Admin configuration work must not silently change protected production behavior.

## Sales And Slots

- Sales are created through `presale` flows.
- Sales are bound to `slotUid`.
- Slot origin (`manual` or `generated`) does not change the business rules by itself.

## Time And Period Semantics

- Weekly motivation uses ISO week semantics.
- Season reporting follows the current production season contract.
- Server time is authoritative for runtime enforcement.

## Funds And Invariants

- Weekly and season fund reporting must remain consistent with `money_ledger`.
- Delete flows with prepayment must preserve the current `REFUND | FUND` business meaning.
- Financial totals, withholds, and invariants must not drift silently.

For exact endpoint compatibility, see `docs/API_CONTRACT.md`.
For shift-close specifics, see `docs/dispatcher-shift-close.md`.
