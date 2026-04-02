# Comprehensive Full-System Audit Package

Date: 2026-03-30
Branch: feature/next-development
Mode: audit-only (no business-logic refactor)

## Scope Completion Status
- Backend: completed
- Frontend: completed
- Database touchpoints: completed
- API contracts and drift: completed
- Role permissions (seller/dispatcher/owner/admin): completed
- Business and financial flows: completed
- Shift-close deep dive: completed
- Sales attribution chain: completed
- Schedule-template/generated-slot flows: completed
- Date semantics: completed
- Automated verification broad pass: completed

## Evidence Artifacts
- `audit_full_endpoint_inventory.md`: full endpoint list with method/path/module/role/contracts/side-effects/frontend consumers (136 endpoints)
- `audit_endpoint_inventory_enriched.json`: machine-readable endpoint inventory with mount/fullPath/consumer links
- `audit_endpoint_contract_map.json`: static endpoint contract extraction by module (input/output/side effects)
- `audit_api_map.json`: apiClient method -> request path map
- `audit_missing_api_methods.json`: missing apiClient methods with exact consumers
- `audit_contract_drift.json`: endpoint-path mismatch scan
- `audit_test_inventory.json`: all detected automated tests grouped by suite

## Validate Gate Result
- `npm run validate`: PASS (exit code 0)
- Chain executed by validate: `test:owner -> test:seller -> test:dispatcher -> test:orchestrator -> e2e`
- Additional explicit runs in this audit: `npm run test:dispatcher`, `npm run test:orchestrator`, `npm run e2e` all PASS

## PASS / FAILED by Major Audit Area
- Endpoint inventory completeness: PASS
- Screen/component inventory by role: PASS
- UI -> API -> backend -> DB workflow mapping: PASS
- Contract consistency (frontend/backend): FAILED
- Role-gate/authorization correctness: FAILED
- Financial formula traceability: PASS
- Shift-close logic integrity (code + tests): PASS
- Sales attribution chain integrity: PASS (with medium-risk drift points)
- Schedule-template/generated-slot flows: FAILED
- Date semantics consistency: PASS
- Automated test execution (broad): PASS
- Automated coverage sufficiency for all roles/screens: FAILED

## 1) Full Endpoint Inventory by Backend File/Module

Complete per-endpoint inventory is in `audit_full_endpoint_inventory.md`.

Summary by module:

| Module | Total | Mounted | Unmounted |
|---|---:|---:|---:|
| `server/selling.mjs` | 34 | 34 | 0 |
| `server/owner.mjs` | 24 | 24 | 0 |
| `server/admin.mjs` | 17 | 17 | 0 |
| `server/schedule-template-items.mjs` | 7 | 7 | 0 |
| `server/trip-templates.mjs` | 5 | 5 | 0 |
| `server/dispatcher-shift.mjs` | 3 | 3 | 0 |
| `server/dispatcher-shift-ledger.mjs` | 2 | 2 | 0 |
| `server/auth.js` | 2 | 2 | 0 |
| `server/schedule-templates.mjs` | 9 | 0 | 9 |
| `server/.mjs` | 33 | 0 | 33 |

Totals:
- Endpoint count: 136
- Mounted: 94
- Unmounted legacy: 42

Notes:
- `server/schedule-templates.mjs` and `server/.mjs` define active-looking routes but are not mounted in `server/index.js`.
- This is a major drift source and duplicate-logic risk.

## 2) Full Screen/Component Inventory by Role

### Seller
Routes (`src/App.jsx`):
- `/seller/*` -> `src/views/SellerView.jsx`
- `/seller/home` -> `src/views/SellerHome.jsx`
- `/seller/earnings` -> `src/views/SellerEarnings.jsx`
- `/seller/media` -> `src/views/SellerMedia.jsx`

Status:
- Active transactional flow: `SellerView` + seller components (`SelectBoatType`, `SelectTrip`, `SelectSeats`, `ConfirmationScreen`, `SalesHistory`).
- `SellerEarnings` uses sample data and commented backend call.
- `SellerMedia` is placeholder (“page in development”).

### Dispatcher
Route (`src/App.jsx`):
- `/dispatcher/*` -> `src/views/DispatcherView.jsx`
- `/dispatcher/shift-close` -> `src/views/DispatcherShiftClose.jsx`

Tabs/components in `DispatcherView`:
- trips -> `TripListView`
- selling -> `TicketSellingView`
- slots -> `SlotManagement`
- maps -> placeholder block
- shiftClose -> `DispatcherShiftClose`

Status:
- Core dispatcher flows active.
- `maps` tab is placeholder.
- `TripTemplates` and `SlotManagementWithSchedule` exist but are not wired from active route shell.

### Owner
Route (`src/App.jsx`):
- `/owner-ui` -> `src/views/OwnerView.jsx`
- `/owner-ui/money` -> `src/views/OwnerMoneyView.jsx`

Owner tabs in `OwnerView`:
- money, compare, boats, sellers, motivation, settings, load, export

Status:
- Owner shell is active and tabbed.
- Duplicate legacy views/components exist (`src/views/Owner.jsx`, `src/views/OwnerLoadView.jsx` and `src/components/owner/OwnerLoadView.jsx`).

### Admin
Route (`src/App.jsx`):
- `/admin/*` -> `src/views/AdminView.jsx`

Tabs in `AdminView`:
- dashboard, boats, zone, users

Status:
- UI exists but several tabs rely on missing `apiClient` methods (`get`, `createUser`, `updateUser`, etc.), causing runtime breaks.

## 3) Full UI -> API -> Backend -> DB Mapping (Important Workflows)

### Workflow A: Seller sale / presale creation
- UI: `src/views/SellerView.jsx` and seller form components
- API: `apiClient.createPresale` -> `POST /api/selling/presales`
- Backend: `server/selling.mjs` (`router.post('/presales'...)`)
- DB touchpoints:
  - reads slot and capacity (`generated_slots` / `boat_slots`)
  - writes `presales`
  - writes/updates `tickets`
  - decrements seat availability
  - writes prepayment ledger (`money_ledger`, `kind='SELLER_SHIFT'`) when paid at create
  - sync/pending logic in `sales_transactions_canonical`

### Workflow B: Dispatcher sale on behalf of seller (attribution chain)
- UI seller selection: `src/components/dispatcher/QuickSaleForm.jsx`
- Payload: includes `sellerId` when dispatcher selected a seller (`src/components/dispatcher/QuickSaleForm.jsx:267-269`)
- API: same `POST /api/selling/presales`
- Backend attribution:
  - validates `sellerId` for dispatcher role (`server/selling.mjs:1216-1239`)
  - computes `effectiveSellerId` (`server/selling.mjs:1713-1716`)
  - stores `presales.seller_id` during insert (`server/selling.mjs:1361-1372`, `1393-1400`, `1419-1426`)
  - ledger rows written for prepayment and accepted payment (`server/selling.mjs:1469-1473`, `2954-2958`)
- Aggregation surfaces:
  - dispatcher shift summary (`/api/dispatcher/summary` + shift close snapshot) (`server/dispatcher-shift-ledger.mjs:204`, `server/dispatcher-shift.mjs:39-58`)
  - owner money/compare/seller analytics (`/api/owner/...` queries against `money_ledger`) (`server/owner.mjs:365`, `1118`, `1322`, `2032`)

### Workflow C: Accept payment / full-payment conversion
- UI: dispatcher presale list/passenger actions
- API: `PATCH /api/selling/presales/:id/accept-payment`
- Backend: `server/selling.mjs`
- DB touchpoints:
  - updates `presales.prepayment_amount` and status progression
  - writes `money_ledger` accepted row
  - kind selection: seller action -> `SELLER_SHIFT`, dispatcher/admin/owner action -> `DISPATCHER_SHIFT`
  - backfills/persists `presales.business_day` when missing

### Workflow D: Presale/ticket transfer
- UI: transfer actions in dispatcher/seller flows
- API:
  - `PATCH/POST /api/selling/presales/:id/transfer`
  - `PATCH/POST /api/selling/tickets/:ticketId/transfer`
- Backend: `server/selling.mjs`
- DB touchpoints:
  - seats adjustments on source/target slots
  - canonical sync: `sales_transactions_canonical.business_day/slot_uid/slot_id`
  - `presales.business_day` reassignment to target trip day
  - expected-payment (`EXPECT_PAYMENT`) ledger recalculation in `money_ledger`

### Workflow E: Dispatcher shift summary and close
- UI: `src/views/DispatcherShiftClose.jsx`
- API:
  - summary: `GET /api/dispatcher/summary` (or alias mount `/api/dispatcher/shift-ledger/summary`)
  - close/deposit actions: `server/dispatcher-shift.mjs` under `/api/dispatcher/shift/*`
- Backend:
  - live + snapshot branches
  - seller/dispatcher liabilities, salary due, cashbox, reserve adjustments
- DB touchpoints:
  - reads `money_ledger`, `presales`, `generated_slots`, `users`
  - writes `shift_closures`
  - writes withhold rows in `money_ledger`

### Workflow F: Owner money dashboard and compare
- UI: `OwnerMoneyView`, `OwnerComparePeriodsView`, `OwnerMotivationView`
- API: `/api/owner/money*`, `/api/owner/motivation*`, `/api/owner/invariants`
- Backend: `server/owner.mjs`
- DB touchpoints:
  - primary source: `money_ledger` (payment-day semantics)
  - trip-day joins through `presales`, `generated_slots`, `boat_slots`
  - manual overlays (`manual_days`, `manual_boat_stats`, `manual_seller_stats`)
  - motivation/season computations

### Workflow G: Schedule-template items and generation
- UI: `src/components/dispatcher/ScheduleTemplates.jsx` (active in SlotManagement schedule tab)
- API:
  - `GET/POST/PATCH/DELETE /api/selling/schedule-template-items*`
  - `POST /api/selling/schedule-template-items/generate`
- Backend: `server/schedule-template-items.mjs`
- DB touchpoints:
  - `schedule_template_items`
  - `generated_slots` (insert/delete/lookup)
  - `boats` status checks
- Constraints and guards:
  - invalid generated trip values block delete (`server/schedule-template-items.mjs:487-496`)
  - active sold tickets block delete if future trips are not deleted (`server/schedule-template-items.mjs:508-523`)
  - generation checks existing slot uniqueness by `trip_date + time + boat_id` and skips duplicates (`server/schedule-template-items.mjs:617-643`)

### Workflow I: Date semantics map (business_day / trip_date / created_at / closed_at)
- `business_day`:
  - payment-day semantics for owner money and refunds (`server/owner.mjs:391-478`, `803-843`, `1123-1140`)
  - trip-day semantics for pending and transfer synchronization in selling/canonical (`server/selling.mjs:5034-5051`, `5112-5119`, `5126-5135`)
- `trip_date`:
  - physical ride date in `generated_slots.trip_date`, used for slot-day joins and reserve logic (`server/schedule-template-items.mjs:616-620`, `server/owner.mjs:481-505`)
- `created_at`:
  - fallback date source when explicit business/trip day absent (`server/owner.mjs:271-272`, `server/dispatcher-shift-ledger.mjs:90-92`)
- `paid_at`:
  - represented through posted money events in `money_ledger.event_time`/`business_day` rather than standalone `presales.paid_at` field (owner and shift summary queries rely on ledger business day)
- `closed_at`:
  - shift closure timestamp in `shift_closures.closed_at` and snapshot retrieval (`server/dispatcher-shift-ledger.mjs:218`, `229-234`)

### Workflow H: Admin users/boats/zone
- UI: `src/views/AdminView.jsx`, `src/components/admin/*`
- API: mixed calls via missing methods and direct path strings
- Backend intended targets: `server/admin.mjs` + some selling/admin routes
- DB touchpoints (intended): `users`, `boats`, `boat_slots`, zone-related user fields
- Current state: partially broken due frontend client-contract drift

## 4) Full Money / Ledger / Shift-Close Formula Map

### Dispatcher shift-close formulas (`server/dispatcher-shift.mjs`)
- `netCash = collectedCash - refundCash` (`server/dispatcher-shift.mjs:439`)
- `netCard = collectedCard - refundCard` (`server/dispatcher-shift.mjs:440`)
- `netTotal = netCash + netCard` (`server/dispatcher-shift.mjs:441`)
- `cash_in_cashbox = netCash - depositCash - salaryPaidCash` (`server/dispatcher-shift.mjs:579-580`)
- `expected_sellers_cash_due = sum(max(0, seller.cash_due_to_owner))` (`server/dispatcher-shift.mjs:583-586`)
- `cash_discrepancy = cash_in_cashbox - expected_sellers_cash_due` (`server/dispatcher-shift.mjs:598-600`)
- `owner_cash_available = netTotal - salaryDue - sellers_debt_total` (`server/dispatcher-shift.mjs:595`)
- `owner_cash_available_after_future_reserve_cash = owner_cash_available - futureTripsReserve.cash` (`server/dispatcher-shift.mjs:596`)

### Shift-ledger summary formulas (`server/dispatcher-shift-ledger.mjs`)
- Seller positive liabilities helper:
  - `sum(max(0,cash_due_to_owner)+max(0,terminal_due_to_owner))` (`server/dispatcher-shift-ledger.mjs:79-84`)
- Per-seller dues:
  - `cash_due_to_owner = prepay_cash - seller_dep_cash` (`server/dispatcher-shift-ledger.mjs:799`)
  - `terminal_due_to_owner = prepay_card - seller_dep_card` (`server/dispatcher-shift-ledger.mjs:800`)
- Owner available cash:
  - `ownerCashAvailable = netTotal - salary_due_total - sellersDebtTotalResponse` (`server/dispatcher-shift-ledger.mjs:1231`)

### Owner money formulas (`server/owner.mjs`)
- Revenue/collection and refunds are computed from `money_ledger` by payment day (`business_day`) with explicit neting (`server/owner.mjs:391-478`, `803-843`, `1123-1140`).
- Future-trip reserve split:
  - reserve cash/card from paid rows where trip day > payment day (`server/owner.mjs:895-905`).
- Funds-withhold series:
  - weekly, season, dispatcher bonus, rounding-to-season, totals and split by cash/card (`server/owner.mjs:980-986`).
- Weekly/season pools:
  - ledger totals, daily sums, drift/diff diagnostics, current totals, payout distribution (`server/owner.mjs:2367-2461`, `2618-2742`).

### Payment mode and attribution sources (`server/selling.mjs`)
- Prepayment at creation writes `SALE_PREPAYMENT_*` to `money_ledger` (`server/selling.mjs:1443-1473`).
- Accepted payment writes `SALE_ACCEPTED_*` with role-dependent `kind` (`server/selling.mjs:2949-2952`, `2954-2958`).
- `business_day` backfilled/persisted for analytics stability (`server/selling.mjs:2919-2927`, `5034-5051`, `5112-5119`).

## 5) Broken Flows, Mismatches, Regressions, Dead Paths, Suspected Root Causes

### Confirmed Findings

1. HIGH - Authorization gap on dispatcher summary endpoint
- Evidence:
  - route definition uses only `authenticateToken` in `server/dispatcher-shift-ledger.mjs` (`server/dispatcher-shift-ledger.mjs:204`)
  - route is mounted at `/api/dispatcher` and `/api/dispatcher/shift-ledger` in `server/index.js` (`server/index.js:29`, `server/index.js:32`)
  - no `canDispatchManageSlots` or owner-only guard at route level
- Risk: any authenticated role can call financial shift summary.

2. HIGH - Runtime bug in schedule-template item delete with future trips
- Evidence:
  - `deleteResult` is `const` inside `if (deleteFutureTrips)` block (`server/schedule-template-items.mjs:499-504`)
  - response uses `deleteResult.changes` outside block (`server/schedule-template-items.mjs:539`)
- Root cause: out-of-scope variable reference leading to runtime error when branch executes.

3. HIGH - Frontend admin contract drift (missing apiClient methods)
- Evidence: `audit_missing_api_methods.json` reports missing methods with active consumers
- Consumer examples:
  - `apiClient.get('/admin/stats')` and `apiClient.get('/users')` in `src/views/AdminView.jsx:54`, `src/views/AdminView.jsx:90`
  - `apiClient.createUser/updateUser/deleteUser/resetPassword` in `src/views/AdminView.jsx:112`, `126`, `154`, `142`
  - boat/zone methods in `src/components/admin/BoatManagement.jsx:68`, `93`, `116`, `135`, `162`, `225`, `255` and `src/components/admin/WorkingZoneMap.jsx:26`, `39`
- Examples: `get`, `createUser`, `updateUser`, `deleteUser`, `createBoat`, `updateBoat`, `deleteBoat`, `getBoatSlots`, `toggleBoatActive`.
- Root cause: API client abstraction incomplete vs UI expectations.

4. MEDIUM - Query-parameter mismatch for schedule-template delete behavior
- Evidence:
  - frontend sends `?delete_future_trips=1` (`src/utils/apiClient.js:352-354`)
  - backend expects `deleteFutureTrips === 'true'` (`server/schedule-template-items.mjs:484`)
- Effect: intended mode can silently not trigger.

5. MEDIUM - Path/method mismatch for "remove trips for deleted boats"
- Evidence:
  - frontend uses `POST /selling/dispatcher/remove-trips-for-deleted-boats` (`src/utils/apiClient.js:172-175`)
  - backend uses `DELETE /api/selling/trips-for-deleted-boats` (`server/schedule-template-items.mjs:763`)
- Effect: UI action likely 404/contract failure.

6. MEDIUM - Dead/legacy backend modules with duplicate route logic
- Evidence:
  - `server/schedule-templates.mjs` and `server/.mjs` expose 42 unmounted endpoints (full list in `audit_full_endpoint_inventory.md`)
  - `server/index.js` imports/mounts `selling`, `trip-templates`, `schedule-template-items`, but no mount for `schedule-templates.mjs` / `.mjs` (`server/index.js:6-10`, `25`, `37`, `38`)
- Risk: maintenance drift, false assumptions in frontend or future edits.

7. MEDIUM - Legacy/unused frontend modules tied to missing template APIs
- Evidence:
  - `TripTemplates.jsx` and `SlotManagementWithSchedule.jsx` call non-existent apiClient methods
  - not wired in active route shell
- Risk: regressions if reconnected without contract cleanup.

8. LOW - Seller auxiliary screens not backed by real data
- Evidence:
  - `SellerEarnings.jsx` uses sample data, API call commented (`src/views/SellerEarnings.jsx:14-21`, `44`)
  - `SellerMedia.jsx` marked as “in development” placeholder (`src/views/SellerMedia.jsx:36`)
- Impact: non-transactional UX incompleteness.

9. LOW - Stale endpoint wrappers in apiClient
- Evidence:
  - logout wrapper calls `/auth/logout` (`src/utils/apiClient.js:108-110`), while backend auth routes are `/login` and `/me` (`server/auth.js:141`, `167`)
  - `getSlots()` targets `/selling/slots` (`src/utils/apiClient.js:124-126`) with no mounted endpoint
  - `getOwnerDashboard()` targets `/owner/dashboard` (`src/utils/apiClient.js:367-368`), while owner mounted routes are `/money/*` (`server/owner.mjs:365`, `1118`, `1322`, etc.)

### Inferred Risks (needs explicit runtime probe to confirm behavior)

10. HIGH (inferred) - `schedule_template_id` semantic mismatch during generated slot insertion
- Evidence:
  - `generated_slots.schedule_template_id` FK -> `schedule_templates(id)` (`server/db.js:919`)
  - `schedule_template_items` schema has no `schedule_template_id` column (`server/db.js:982-1000`)
  - generator inserts `item.schedule_template_id` from `SELECT sti.*` (`server/schedule-template-items.mjs:582-586`, `661-667`)
- Risk: FK inconsistency, wrong ownership linkage, or broken generation depending on live data shape.

11. MEDIUM (inferred) - Potential role overexposure in `/api/admin` subtree
- Evidence:
  - mounted with `authenticateToken` but no explicit `isAdmin` in `server/index.js`
- Caveat:
  - may be protected inside `server/admin.mjs`; full per-route guard must be reviewed endpoint-by-endpoint before changing.

## 6) Exact Files Participating in Major Workflows

### Seller sales workflow
- Frontend:
  - `src/views/SellerView.jsx`
  - `src/components/seller/SelectBoatType.jsx`
  - `src/components/seller/SelectTrip.jsx`
  - `src/components/seller/SelectSeats.jsx`
  - `src/components/seller/ConfirmationScreen.jsx`
  - `src/components/seller/SalesHistory.jsx`
  - `src/utils/apiClient.js`
- Backend:
  - `server/selling.mjs`
  - `server/shift-guard.mjs`
  - `server/auth.js`
- DB schema/logic:
  - `server/db.js`
  - tables: `presales`, `tickets`, `boat_slots`, `generated_slots`, `money_ledger`, `sales_transactions_canonical`

### Dispatcher sale-on-behalf and shift-close
- Frontend:
  - `src/components/dispatcher/QuickSaleForm.jsx`
  - `src/components/dispatcher/PresaleListView.jsx`
  - `src/views/DispatcherShiftClose.jsx`
  - `src/views/DispatcherView.jsx`
  - `src/utils/normalizeSummary.js`
- Backend:
  - `server/selling.mjs`
  - `server/dispatcher-shift-ledger.mjs`
  - `server/dispatcher-shift.mjs`
  - `server/seller-motivation-state.mjs`
- DB/tables:
  - `money_ledger`, `shift_closures`, `presales`, `users`, `generated_slots`

### Owner analytics and motivation
- Frontend:
  - `src/views/OwnerView.jsx`
  - `src/views/OwnerMoneyView.jsx`
  - `src/views/OwnerMotivationView.jsx`
  - `src/views/OwnerBoatsView.jsx`
  - `src/views/OwnerSellersView.jsx`
  - `src/views/OwnerSettingsView.jsx`
  - `src/views/OwnerExportView.jsx`
  - `src/components/owner/OwnerLoadView.jsx`
- Backend:
  - `server/owner.mjs`
  - `server/motivation/engine.mjs`
  - `server/season-stats.mjs`
- DB/tables:
  - `money_ledger`, `manual_days`, `manual_boat_stats`, `manual_seller_stats`, `owner_settings`, motivation tables

### Schedule templates and generated slots
- Frontend:
  - `src/components/dispatcher/ScheduleTemplates.jsx`
  - `src/components/dispatcher/SlotManagement.jsx`
  - `src/utils/apiClient.js`
- Backend:
  - `server/schedule-template-items.mjs`
  - `server/trip-templates.mjs`
  - (legacy/unmounted) `server/schedule-templates.mjs`
- DB/tables:
  - `schedule_template_items`, `generated_slots`, `boats`, `tickets`

### Admin operations
- Frontend:
  - `src/views/AdminView.jsx`
  - `src/components/admin/BoatManagement.jsx`
  - `src/components/admin/WorkingZoneMap.jsx`
  - `src/components/admin/ClearTripsButton.jsx`
- Backend:
  - `server/admin.mjs`
  - `server/selling.mjs` (boats/slots touched by admin UI through shared calls)
- DB/tables:
  - `users`, `boats`, `boat_slots`, related references

## 7) Existing Automated Tests: Coverage and Gaps

Exact discovered inventory: `audit_test_inventory.json`.

Suites present:
- owner: 24 files
- seller: 10 files
- dispatcher: 20 files
- seller-dispatcher-sync: 4 files
- finance-stress: 5 files
- integration: 1 file
- server: 2 files
- ui unit: 1 file
- orchestrator: 1 file
- e2e playwright: 3 specs

Executed in this audit:
- `test:owner` PASS
- `test:seller` PASS
- `test:dispatcher` PASS (138 tests)
- `test:orchestrator` PASS (10 tests)
- `e2e` PASS (8 tests)
- `validate` PASS (full chain)

Not sufficiently covered (gaps):
- AdminView runtime contract (missing apiClient methods) has no dedicated regression test preventing breakage.
- Dispatcher summary authorization for seller-role access has no explicit negative-security test.
- Schedule-template delete path (`deleteFutureTrips=true`) has no direct server test catching the `deleteResult` scope error.
- Placeholder/legacy UI paths (SellerEarnings, SellerMedia, TripTemplates, SlotManagementWithSchedule) are not covered by active e2e and can rot unnoticed.

## 8) Reproduction Scenarios for Important Broken Behaviors

1. Schedule-template delete future trips runtime failure
- Preconditions: existing schedule template item with generated future trips
- Steps:
  1. Open dispatcher schedule templates UI.
  2. Trigger delete with “delete future trips” enabled.
  3. Request sends `DELETE /api/selling/schedule-template-items/:id?delete_future_trips=1`.
- Expected: item deleted + future trips deleted count returned
- Actual risk: backend reads `deleteFutureTrips` (camelCase), then references out-of-scope `deleteResult` in response path.
- Likely outcome: 500 server error / incorrect behavior.

2. Unauthorized role reads dispatcher summary
- Preconditions: authenticated seller token
- Steps:
  1. Call `GET /api/dispatcher/summary`.
- Expected: 403 forbidden for seller
- Actual code path: route guarded only by `authenticateToken`, no dispatch-role middleware.
- Risk outcome: seller can read dispatcher financial summary payload.

3. Admin dashboard users/contracts break
- Preconditions: login as admin, open `/admin`
- Steps:
  1. Dashboard tab triggers `apiClient.get('/admin/stats')`.
  2. Users tab triggers `apiClient.get('/users')`, `createUser`, `updateUser`, etc.
- Expected: load and mutate data via client wrappers
- Actual: methods missing in `apiClient`, causing runtime failures.

4. Delete-trips-for-deleted-boats action mismatch
- Steps:
  1. Trigger cleanup in dispatcher slot UI.
  2. Frontend sends `POST /selling/dispatcher/remove-trips-for-deleted-boats`.
- Expected: cleanup succeeds
- Actual: backend route is different path/method (`DELETE /api/selling/trips-for-deleted-boats`).

5. Owner dashboard wrapper mismatch
- Steps:
  1. Any consumer calls `apiClient.getOwnerDashboard()`.
- Expected: owner dashboard response
- Actual: requests `/owner/dashboard`, no mounted route.

## 9) Severity Classification

### Blocker
- None confirmed in currently validate-covered critical path.

### High
- Authorization gap: dispatcher summary route lacks role gate.
- Schedule-template delete runtime bug (`deleteResult` scope).
- Admin UI contract collapse due missing `apiClient` methods.

### Medium
- Schedule-template delete query parameter mismatch.
- remove-trips-for-deleted-boats path/method mismatch.
- Unmounted legacy route files with duplicated logic (`server/.mjs`, `server/schedule-templates.mjs`).
- Inferred FK/semantic mismatch around `schedule_template_id` generation chain.

### Low
- Placeholder/legacy screens with sample data.
- Stale wrappers (`logout`, `getSlots`, `getOwnerDashboard`) if still referenced.
- Duplicate legacy owner views/components.

## 10) Final Prioritized Repair Backlog (Business Impact + Dependency Order)

1. Lock down dispatcher summary auth
- Add `canDispatchManageSlots` or owner/dispatcher-only guard on `/api/dispatcher/summary` and alias mount.
- Add regression test: seller token must receive 403.

2. Fix schedule-template delete correctness
- Align query flag contract (`deleteFutureTrips` vs `delete_future_trips`) with backward compatibility.
- Fix `deleteResult` scope and response payload.
- Add server tests for both delete modes and for future-trip deletion count.

3. Stabilize admin client contract
- Implement missing `apiClient` methods used by active admin screens or migrate screen code to existing wrappers.
- Add admin smoke tests for dashboard/users/boats/zone tabs.

4. Resolve explicit API drifts in utility client
- Correct/remove stale wrappers: `/auth/logout`, `/selling/slots`, `/owner/dashboard`, remove-trips endpoint mismatch.
- Add client contract test that all `apiClient` request paths map to mounted backend routes (or explicitly marked legacy).

5. Decide and enforce schedule-template canonical model
- Confirm whether `generated_slots.schedule_template_id` should reference template item or template root.
- If template-item ownership is needed, add explicit column and migration; if not, fix insertion mapping.
- Add generation invariants tests for FK and ownership semantics.

6. Decommission or quarantine legacy/unmounted modules
- Mark `server/.mjs` and `server/schedule-templates.mjs` as legacy-only or remove after migration.
- Prevent accidental usage through lint/check script.

7. Clean up dead/placeholder screens and duplicate views
- Either hide behind feature flags or complete data wiring for `SellerEarnings`, `SellerMedia`, legacy dispatcher template components, duplicate owner views.

## Confirmed Facts vs Inferred Risks vs Open Questions

### Confirmed facts
- Full endpoint inventory collected (136 endpoints, 94 mounted, 42 unmounted).
- Full role screen inventory collected.
- Shift-close and money formula lines mapped to concrete backend expressions.
- Validate chain passes end-to-end in current branch.
- Multiple concrete frontend/backend contract mismatches detected and evidenced.

### Inferred risks
- `schedule_template_id` semantic/FK mismatch risk in generation pipeline.
- Potential overexposure inside admin subtree depends on internal per-route middleware in `admin.mjs`.

### Open questions
- Should dispatcher summary be visible to owner/admin only, or strictly dispatcher+owner+admin?
- Canonical ownership for generated slots: template root vs template item?
- Which legacy screens are product-required vs intentionally abandoned?

## What Must Be Fixed First
1. Dispatcher summary authorization gate.
2. Schedule-template delete bug + query contract alignment.
3. Admin frontend client contract restore.
4. API wrapper drift cleanup and contract tests.
5. Schedule-template FK/ownership semantic decision + migration.

