# boat-ticket-app System Audit Report

**Date:** 2026-02-19
**Status:** POST-RECOVERY

---

## 1) DB STATE

### Users (9 total)
| id | username | role | is_active |
|----|----------|------|-----------|
| 1 | admin | admin | 1 |
| 2 | 1234 | seller | 0 |
| 3 | Maria | dispatcher | 1 |
| 4 | 1 | seller | 1 |
| 5 | seller1 | seller | 0 |
| 6 | testadmin | admin | 0 |
| 7 | maxim | seller | 1 |
| 8 | owner | owner | 1 |
| 9 | dispatcher1 | dispatcher | 1 |

**Active:** owner(8), dispatcher1(9), Maria(3), maxim(7), 1(4)

### Boats (11 total, 4 active)
| id | name | type | is_active |
|----|------|------|-----------|
| 32 | Ваня | speed | 1 |
| 34 | Бабанос | banana | 1 |
| 36 | Петр | speed | 1 |
| 37 | Люда | cruise | 1 |
| 38 | Катя | cruise | 1 |

**Inactive (7):** Седой, Лютый, Барабулька, Перчик, Маша, Щюка

### Schedule Templates (5 total)
All reference boat_id=32 (Ваня), times: 10:00, 12:00, 14:00, 16:00, 18:00

### Schedule Template Items (7 total)
- 6 items have boat_id assigned
- 1 item has boat_id=NULL (id=12)
- **MISSING:** `schedule_template_id` column not present in production DB

### Generated Slots (166 total)
- Date range: 2026-01-11 to beyond
- Total capacity: varies
- Seats left: some already sold (seats_left < capacity)

### Presales (82 total)
| status | count | total_price | total_prepaid |
|--------|-------|-------------|---------------|
| ACTIVE | 37 | 213,000 | 105,500 |
| CANCELLED | 35 | 9,000 | 0 |
| PAID | 7 | 42,700 | 42,700 |
| USED | 3 | 51,500 | 51,500 |

### Tickets (198 total)
| status | count | total_price |
|--------|-------|-------------|
| ACTIVE | 102 | 242,500 |
| REFUNDED | 91 | 238,700 |
| USED | 5 | 10,700 |

### Money Ledger
**COUNT: 0** ⚠️ EMPTY

### Sales Transactions Canonical (7 total)
| method | status | count | total_amount |
|--------|--------|-------|--------------|
| NULL | VALID | 4 | 9,000 |
| NULL | VOID | 3 | 6,000 |

### Owner Settings
- timezone: Europe/Moscow
- motivation_mode: v1
- currency: RUB

---

## 2) SELLER FLOW

**API Status:**
- `/api/auth/login` → OK (owner tested)
- `/api/selling/slots` → **NOT FOUND** (404)
- `/api/selling/boats/speed/slots` → Needs testing

**Issues:**
- User "1"/password "1" login fails (password mismatch)
- `/api/selling/slots` endpoint not implemented

---

## 3) DISPATCHER FLOW

**API Status:**
- Dispatcher login: Maria/dispatcher1 passwords unknown
- Need to test: quick sale, boarding, cancel trip, shift close

**Test Results (from test suite):**
- 172 tests passed
- 11 tests failed
- Most failures: presale creation returns 400 (validation error)

---

## 4) OWNER FLOW

**API Endpoints Tested:**

| Endpoint | Status | Notes |
|----------|--------|-------|
| `/api/owner/money/summary?preset=today` | ✅ OK | Returns 0 revenue, 3000 pending |
| `/api/owner/boats` | ✅ OK | Returns "Test Speed Boat" (phantom data) |
| `/api/owner/money/compare-days?preset=7d` | ✅ OK | Empty rows (no money_ledger) |

**Anomalies:**
- `/api/owner/boats` returns boat_name "Test Speed Boat" not in actual boats table
- money_ledger is empty despite presales/tickets existing

---

## 5) FINANCE INVARIANTS

### Critical Issue: money_ledger is EMPTY

| Table | Count | Expected |
|-------|-------|----------|
| money_ledger | 0 | Should have entries for each sale |
| sales_transactions_canonical | 7 | Partial data |
| tickets | 198 | Has data |
| presales | 82 | Has data |

### Invariant Check Results:
- **net = collected - refund:** Cannot verify (no money_ledger data)
- **Ticket count matches presale seats:** Partial mismatch expected (cancelled/refunded)
- **Owner dashboard totals:** Show 0 due to missing money_ledger

### Test Failures:
- `tests/finance-stress/money-ledger.test.js` → 400 errors on presale create
- `tests/finance-stress/race.test.js` → 400 errors
- `tests/integration/seller-dispatcher-sync.test.js` → 400 errors

---

## 6) CRITICAL RISKS

| Risk | Severity | Description |
|------|----------|-------------|
| **money_ledger EMPTY** | 🔴 HIGH | No financial transactions recorded |
| **schedule_template_items missing FK column** | 🟡 MEDIUM | `schedule_template_id` column not in production DB |
| **Password unknown for active users** | 🟡 MEDIUM | Maria, dispatcher1, maxim passwords unknown |
| **Phantom boat data in owner/boats** | 🟡 MEDIUM | Returns "Test Speed Boat" not in boats table |
| **Test DB path encoding** | 🟡 MEDIUM | Cyrillic path issues in test infrastructure |

---

## 7) TEST SUMMARY

| Metric | Count |
|--------|-------|
| Test Files | 32 |
| Passed Files | 27 |
| Failed Files | 5 |
| Total Tests | 183 |
| Passed Tests | 172 |
| Failed Tests | 11 |
| Skipped Tests | 0 |
| Duration | 62.21s |

### Failed Test Categories:
1. **Presale creation 400 errors** - Validation failure
2. **Database path issues** - Cyrillic encoding in test file paths
3. **Race condition tests** - Due to presale creation failure

---

## 8) RECOMMENDATIONS

### Immediate Actions (READ-ONLY findings):
1. **Password reset required** for active users: Maria, dispatcher1, maxim, seller "1"
2. **Investigate why money_ledger is empty** - Data was lost or not migrated
3. **Run FK migration** to add `schedule_template_id` column to schedule_template_items
4. **Investigate phantom "Test Speed Boat"** in owner/boats response

### No Code Changes Made
This report is based on read-only analysis only.
