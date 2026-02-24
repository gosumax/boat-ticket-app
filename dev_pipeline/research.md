# Research Report

## TASK
Реализовать реальный Stage 1 — Research Engine для orchestrator.

## File Map

### Backend (server/)
- server/admin.mjs
- server/auth.js
- server/auto-complete-trips.mjs
- server/check_schema.js
- server/database.sqlite
- server/database.sqlite.BAK
- server/database.sqlite.RESTORE
- server/DATE
- server/db.js
- server/dispatcher-shift-ledger.mjs
- server/dispatcher-shift.mjs
- server/index.js
- server/migrate-manual-offline.js
- server/migrate-owner-settings.js
- server/migrate-price-column.js
- server/migrate-slots-union.js
- server/migration_add_trip_date.sql
- server/motivation/engine.mjs
- server/owner.mjs
- server/ownerSetup.mjs
- server/query-ledger-tmp.cjs
- server/recalc_all_slots.mjs
- server/sales-transactions.mjs
- server/schedule-template-items.mjs
- server/schedule-templates.mjs
- server/season-stats.mjs
- server/seller-motivation-state.mjs
- server/selling-delete-guard.test.js
- server/selling.mjs
- server/shift-guard.mjs
- server/trip-templates.mjs
- server/utils/money-rounding.mjs

### Frontend (src/)
- src/App.css
- src/App.jsx
- src/assets/react.svg
- src/components/admin/BoatManagement.jsx
- src/components/admin/ClearTripsButton.jsx
- src/components/admin/WorkingZoneMap.jsx
- src/components/DebugButton.jsx
- src/components/dispatcher/ConfirmBoardingModal.jsx
- src/components/dispatcher/ConfirmCancelTripModal.jsx
- src/components/dispatcher/PassengerList.jsx
- src/components/dispatcher/PresaleListView.jsx
- src/components/dispatcher/QuickSaleForm.jsx
- src/components/dispatcher/ScheduleTemplates.jsx
- src/components/dispatcher/SlotManagement.jsx
- src/components/dispatcher/SlotManagementWithSchedule.jsx
- src/components/dispatcher/TicketSellingView.jsx
- src/components/dispatcher/TripListView.jsx
- src/components/dispatcher/TripTemplates.jsx
- src/components/owner/OwnerLoadView.jsx
- src/components/ProtectedRoute.jsx
- src/components/seller/ConfirmationScreen.jsx
- src/components/seller/EarningsScreen.jsx
- src/components/seller/PresaleForm.jsx
- src/components/seller/SalesHistory.jsx
- src/components/seller/SelectBoatType.jsx
- src/components/seller/SelectSeats.jsx
- src/components/seller/SelectTrip.jsx
- src/components/seller/SellTicketScreen.jsx
- src/components/Toast.jsx
- src/contexts/AuthContext.jsx
- src/contexts/OwnerDataContext.jsx
- src/data/mockData.js
- src/data/README.md
- src/index.css
- src/main.jsx
- src/utils/apiClient.js
- src/utils/bugReporter.js
- src/utils/currency.js
- src/utils/dateUtils.js
- src/utils/normalizeSummary.js
- src/utils/slotAvailability.js
- src/views/AdminView.jsx
- src/views/DispatcherShiftClose.jsx
- src/views/DispatcherView.jsx
- src/views/LandingPage.jsx
- src/views/LoginPage.jsx
- src/views/Owner.jsx
- src/views/OwnerBoatsView.jsx
- src/views/OwnerExportView.jsx
- src/views/OwnerLoadView.jsx
- src/views/OwnerMoneyView.jsx
- src/views/OwnerMotivationView.jsx
- src/views/OwnerSellersView.jsx
- src/views/OwnerSettingsView.jsx
- src/views/OwnerView.jsx
- src/views/SellerEarnings.jsx
- src/views/SellerHome.jsx
- src/views/SellerMedia.jsx
- src/views/SellerView.jsx
- src/views/UnauthorizedPage.jsx

### Tests (tests/)
- tests/_helpers/authTokens.js
- tests/_helpers/bug-investigation.test.js
- tests/_helpers/dbReset.js
- tests/_helpers/httpLog.js
- tests/_helpers/loadSeedData.js
- tests/_helpers/login-api-diagnostic.test.js
- tests/_helpers/makeApp.js
- tests/_helpers/schema_prod.sql
- tests/_helpers/seedBasic.js
- tests/_helpers/testDates.js
- tests/dispatcher/10-shift-summary-motivation-withhold.test.js
- tests/dispatcher/11-shift-close-withhold-ledger.test.js
- tests/dispatcher/12-shift-close-race-guard.test.js
- tests/dispatcher/dispatcher.delete.test.js
- tests/dispatcher/dispatcher.logic.test.js
- tests/dispatcher/dispatcher.sales.test.js
- tests/dispatcher/dispatcher.transfer.test.js
- tests/dispatcher/seat-sync-seller-vs-dispatcher.test.js
- tests/dispatcher/shift-close-cash-attribution.test.js
- tests/dispatcher/shift-close-cashbox-sanity.test.js
- tests/dispatcher/shift-close-contract-regression.test.js
- tests/dispatcher/shift-close-hard-lock.test.js
- tests/dispatcher/shift-close-locks-deposits.test.js
- tests/dispatcher/shift-close-trips-gate.test.js
- tests/dispatcher/shift-close.test.js
- tests/dispatcher/shift-diagnose.test.js
- tests/dispatcher/shift-ledger-summary-contract.test.js
- tests/dispatcher/shift-salary-payout.test.js
- tests/dispatcher/test-setup.js
- tests/finance-stress/cash-discipline.test.js
- tests/finance-stress/dispatcher-owner-money-sync.e2e.test.js
- tests/finance-stress/load.test.js
- tests/finance-stress/money-ledger.test.js
- tests/finance-stress/race.test.js
- tests/finance-stress/test-setup.js
- tests/integration/seller-dispatcher-sync.test.js
- tests/owner/00-date-consistency.test.js
- tests/owner/01-owner-money-invariants.test.js
- tests/owner/02-owner-money-refunds-net.test.js
- tests/owner/03-owner-money-period-refunds-net.test.js
- tests/owner/20-owner-settings-contract.test.js
- tests/owner/21-motivation-day-snapshot.test.js
- tests/owner/22-motivation-mode-points-gating.test.js
- tests/owner/23-adaptive-recalc-parameters.test.js
- tests/owner/24-streak-calibration.test.js
- tests/owner/25-motivation-withhold.test.js
- tests/owner/26-weekly-season-ledger-aggregate.test.js
- tests/owner/27-weekly-season-consistency.test.js
- tests/owner/28-invariants-endpoint.test.js
- tests/owner/29-immutability-soft-lock.test.js
- tests/owner/owner-compare-sync.test.js
- tests/owner/owner-edgecases.test.js
- tests/owner/owner-entities-invariant.test.js
- tests/owner/owner-invariant.test.js
- tests/owner/owner-weekly.test.js
- tests/seller-dispatcher-sync/sync.delete.test.js
- tests/seller-dispatcher-sync/sync.presale.test.js
- tests/seller-dispatcher-sync/sync.sales.test.js
- tests/seller-dispatcher-sync/sync.transfer.test.js
- tests/seller-dispatcher-sync/test-setup.js
- tests/seller/01-auth-and-me.test.js
- tests/seller/02-slots-and-boats.test.js
- tests/seller/03-presale-create.test.js
- tests/seller/04-presale-payment-update.test.js
- tests/seller/05-presale-cancel.test.js
- tests/seller/06-presale-transfer.test.js
- tests/seller/07-presale-tickets.test.js
- tests/seller/08-ownership-security.test.js
- tests/seller/09-idempotency-and-negative.test.js
- tests/seller/10-seller-ui-scenarios-pricing.test.js
- tests/server/selling-delete-guard.test.js
- tests/server/shift-guard.test.js
- tests/setup-env.js
- tests/setup.js
- tests/ui/dispatcher-shift-close-normalize.test.js

### package.json
- package.json

## Detected Test Command
- npm run test

## Total File Count
- 406

## Timestamp (server time)
- 2026-02-23T03:32:03.287Z
