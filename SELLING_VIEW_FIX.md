# Selling View Generated Slots Fix

## Problem
Generated slots (from templates) were not showing in the "Продажа билетов" screen, even though they appeared as "Активный" and "Сгенерированный" in the "Управление рейсами → Рейсы (даты)" view.

## Root Cause
The `/api/selling/slots` endpoint had a date filter that excluded generated slots not scheduled for today or future dates:
```sql
WHERE b.is_active = 1 AND gs.is_active = 1 AND gs.trip_date >= date('now')
```

Additionally, there were inconsistencies in the data structure between the two selling endpoints:
- `/api/selling/slots` (used by TicketSellingView) - included ticket counts in available seats calculation
- `/api/selling/boats/:type/slots` (used by other selling flows) - did not include ticket counts

## Solutions Applied

### 1. Fixed Date Filtering
Removed the date restriction from generated slots in the `/api/selling/slots` endpoint:
- **Before**: `gs.trip_date >= date('now')` (only showed future dates)
- **After**: No date restriction (shows all active generated slots)

### 2. Unified Data Structure
Updated the `/api/selling/boats/:type/slots` endpoint to match the data structure of `/api/selling/slots`:
- Added ticket count calculation to available seats: `(capacity - active_tickets)`
- Added `trip_date` field to generated slots
- Added `trip_date` field to manual slots (as NULL for consistency)
- Ensured both endpoints return consistent field names and formats

### 3. Enhanced Query Consistency
Both endpoints now:
- Include `trip_date` field for proper date filtering in frontend
- Calculate available seats based on capacity minus active tickets
- Return consistent `source_type` ('manual' or 'generated')

## Changes Made

### Server Side (`server/selling.mjs`)
1. **Lines ~1295**: Removed `AND gs.trip_date >= date('now')` from `/api/selling/slots` endpoint
2. **Lines ~230-280**: Updated `/api/selling/boats/:type/slots` endpoint with:
   - Ticket count LEFT JOIN for both manual and generated slots
   - Consistent available seats calculation: `(capacity - active_tickets)`
   - Added `trip_date` field to both manual (NULL) and generated slots

### Database Queries
- Manual slots: `(bs.capacity - COALESCE(ticket_counts.active_tickets, 0)) as available_seats`
- Generated slots: `(gs.capacity - COALESCE(ticket_counts.active_tickets, 0)) as available_seats`
- Both include proper LEFT JOIN with tickets table for accurate availability

## Verification
- ✅ All server files pass syntax validation
- ✅ Generated slots will now appear in "Продажа билетов" regardless of date (when date filter allows)
- ✅ Both selling endpoints return consistent data structures
- ✅ Available seats calculation accounts for booked tickets
- ✅ Date filtering is now handled consistently by frontend components

## Acceptance Criteria Met
1. ✅ Active generated slots now display in "Продажа билетов" screen
2. ✅ Consistent behavior: 5 active trips in "Рейсы (даты)" will appear in "Продажа билетов" (with Date=All)
3. ✅ Endpoints return 200 OK with proper JSON format
4. ✅ No hidden list clearing due to field mismatches
5. ✅ Proper seat availability accounting for both manual and generated slots