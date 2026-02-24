# Concurrency Report

## TASK
probe

## Race Risks (25)
1. [medium] missing_transaction_wrapper - server/admin.mjs:1 - Multiple mutating DB operations without explicit transaction wrapper
2. [low] idempotency_pattern_missing - server/admin.mjs:60 - Mutating route found without obvious idempotency pattern
3. [low] idempotency_pattern_missing - server/auth.js:141 - Mutating route found without obvious idempotency pattern
4. [medium] missing_transaction_wrapper - server/db.js:1 - Multiple mutating DB operations without explicit transaction wrapper
5. [high] shift_locking_enforcement_missing - server/db.js:1859 - Shift-sensitive write flow without visible shift lock enforcement
6. [medium] missing_transaction_wrapper - server/migrate-price-column.js:1 - Multiple mutating DB operations without explicit transaction wrapper
7. [medium] missing_transaction_wrapper - server/motivation/engine.mjs:1 - Multiple mutating DB operations without explicit transaction wrapper
8. [high] shift_locking_enforcement_missing - server/motivation/engine.mjs:142 - Shift-sensitive write flow without visible shift lock enforcement
9. [medium] missing_transaction_wrapper - server/owner.mjs:1 - Multiple mutating DB operations without explicit transaction wrapper
10. [high] shift_locking_enforcement_missing - server/owner.mjs:52 - Shift-sensitive write flow without visible shift lock enforcement
11. [medium] race_sensitive_file - server/owner.mjs:1 - Race-sensitive module mutates data without clear transaction/lock boundary
12. [medium] missing_transaction_wrapper - server/ownerSetup.mjs:1 - Multiple mutating DB operations without explicit transaction wrapper
13. [medium] race_sensitive_file - server/ownerSetup.mjs:1 - Race-sensitive module mutates data without clear transaction/lock boundary
14. [medium] missing_transaction_wrapper - server/recalc_all_slots.mjs:1 - Multiple mutating DB operations without explicit transaction wrapper
15. [medium] missing_transaction_wrapper - server/schedule-template-items.mjs:1 - Multiple mutating DB operations without explicit transaction wrapper
16. [low] idempotency_pattern_missing - server/schedule-template-items.mjs:127 - Mutating route found without obvious idempotency pattern
17. [medium] missing_transaction_wrapper - server/schedule-templates.mjs:1 - Multiple mutating DB operations without explicit transaction wrapper
18. [low] idempotency_pattern_missing - server/schedule-templates.mjs:99 - Mutating route found without obvious idempotency pattern
19. [medium] missing_transaction_wrapper - server/season-stats.mjs:1 - Multiple mutating DB operations without explicit transaction wrapper
20. [medium] missing_transaction_wrapper - server/seller-motivation-state.mjs:1 - Multiple mutating DB operations without explicit transaction wrapper
21. [high] shift_locking_enforcement_missing - server/seller-motivation-state.mjs:5 - Shift-sensitive write flow without visible shift lock enforcement
22. [medium] missing_transaction_wrapper - server/selling-delete-guard.test.js:1 - Multiple mutating DB operations without explicit transaction wrapper
23. [medium] race_sensitive_file - server/selling-delete-guard.test.js:1 - Race-sensitive module mutates data without clear transaction/lock boundary
24. [medium] missing_transaction_wrapper - server/trip-templates.mjs:1 - Multiple mutating DB operations without explicit transaction wrapper
25. [low] idempotency_pattern_missing - server/trip-templates.mjs:95 - Mutating route found without obvious idempotency pattern

## Overall Severity
- high

## Status
- fail
