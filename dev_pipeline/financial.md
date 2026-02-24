# Financial Report

## TASK
probe

## Invariant Violations (7)
1. [medium] rounding_missing - server/db.js:1696 - Money arithmetic found without explicit rounding helper
2. [medium] shift_locking_reference_missing - server/db.js:1859 - Shift-related financial flow without visible closed-shift guard
3. [high] negative_balance_risk - server/dispatcher-shift-ledger.mjs:187 - Potential negative balance/salary_due arithmetic without lower-bound clamp
4. [high] negative_balance_risk - server/dispatcher-shift-ledger.mjs:648 - Potential negative balance/salary_due arithmetic without lower-bound clamp
5. [medium] shift_locking_reference_missing - server/dispatcher-shift-ledger.mjs:2 - Shift-related financial flow without visible closed-shift guard
6. [high] net_invariant_missing - server/owner.mjs:181 - Collected/refund usage without explicit net = collected - refund invariant
7. [medium] shift_locking_reference_missing - server/seller-motivation-state.mjs:5 - Shift-related financial flow without visible closed-shift guard

## Overall Severity
- high

## Status
- fail
