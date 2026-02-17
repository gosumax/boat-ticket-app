# E2E Testing Implementation Summary

## ✅ Completed

### 1. Playwright Setup
- **File**: `playwright.config.js`
- **Configuration**: Single worker, sequential execution, auto-start dev server
- **Scripts added** to `package.json`:
  - `npm run e2e` - Run all tests
  - `npm run e2e:ui` - Interactive UI mode
  - `npm run e2e:headed` - Run with visible browser

### 2. Test Helpers Created
- **`e2e/helpers/auth.js`**: Login/logout utilities
- **`e2e/helpers/dispatcher.js`**: Dispatcher UI interaction helpers
  - `openTripBySlotUid()` - Navigate and open trip
  - `createPresaleUI()` - Create presale via form
  - `acceptPayment()` - Accept payment on presale
  - `deletePresale()` - Delete presale
  - `transferPresale()` - Transfer presale to another slot
  - `getSeatsLeft()` - Extract seats available

### 3. Test Suite Created
- **`e2e/dispatcher-presale-creation.spec.js`** (Group A: 5 tests)
  - A1: Create presale without seller (defaults to dispatcher)
  - A2: Create presale on behalf of seller
  - A3: Create with prepayment CASH
  - A4: Create with prepayment CARD
  - A5: Create with prepayment MIXED

### 4. Documentation
- **`e2e/README.md`**: Setup instructions, test structure, data-testid catalog

## 📋 TODO: Add data-testid to Components

To make tests stable, add the following `data-testid` attributes (minimal diff):

### QuickSaleForm.jsx (Critical for Group A tests)

```jsx
// Line ~438: Seller select
<select
  id="sellerSelect"
  data-testid="seller-select"  // ADD THIS
  value={selectedSellerId}
  // ... rest of props
>

// Line ~586: Prepayment quick buttons
<button
  data-testid="prepay-500"  // ADD THIS
  onClick={() => handleQuickPrepayment(500)}
  // ... rest of props
>
  500 ₽
</button>

<button
  data-testid="prepay-1000"  // ADD THIS
  onClick={() => handleQuickPrepayment(1000)}
  // ... rest of props
>
  1000 ₽
</button>

<button
  data-testid="prepay-2000"  // ADD THIS
  onClick={() => handleQuickPrepayment(2000)}
  // ... rest of props
>
  2000 ₽
</button>

<button
  data-testid="prepay-full"  // ADD THIS
  onClick={() => handleQuickPrepayment(totalPrice)}
  // ... rest of props
>
  Полная предоплата
</button>

// Line ~634: Payment method buttons (find in prepayment section)
<button
  data-testid="payment-method-cash"  // ADD THIS
  onClick={() => setPrepaymentMethod('cash')}
  // ... rest of props
>
  НАЛ
</button>

<button
  data-testid="payment-method-card"  // ADD THIS
  onClick={() => setPrepaymentMethod('card')}
  // ... rest of props
>
  КАРТА
</button>

<button
  data-testid="payment-method-mixed"  // ADD THIS
  onClick={() => setPrepaymentMethod('mixed')}
  // ... rest of props
>
  КОМБО
</button>

// Cash/card inputs for MIXED method
<input
  data-testid="cash-amount"  // ADD THIS
  value={prepaymentCashStr}
  // ... rest of props
/>

<input
  data-testid="card-amount"  // ADD THIS
  value={prepaymentCardStr}
  // ... rest of props
/>

// Submit button (find near bottom of form)
<button
  data-testid="presale-create-btn"  // ADD THIS
  onClick={handleSubmit}
  disabled={!isFormValid || isSubmitting}
  // ... rest of props
>
  {isSubmitting ? 'Создание...' : 'Создать предзаказ'}
</button>

// Total display (if exists)
<div data-testid="presale-total">
  Итого: {formatRUB(totalPrice)}
</div>
```

### TripListView.jsx (For navigation tests)

```jsx
// Trip card wrapper
<div 
  data-testid={`trip-card-${trip.slot_uid}`}  // ADD THIS
  className="trip-card"
>
  {/* ... card content ... */}
  
  <button
    data-testid={`trip-open-${trip.slot_uid}`}  // ADD THIS
    onClick={() => handleOpenTrip(trip)}
  >
    Открыть
  </button>
</div>
```

### PassengerList.jsx (For presale actions)

```jsx
// "Продать билет" button
<button
  data-testid="trip-sell-btn"  // ADD THIS
  onClick={() => setShowQuickSale(true)}
>
  Продать билет
</button>

// Presale card wrapper
<div
  data-testid={`presale-card-${presale.id}`}  // ADD THIS
  className="presale-card"
>
  {/* ... presale content ... */}
  
  <button
    data-testid={`presale-pay-btn-${presale.id}`}  // ADD THIS
    onClick={() => handleAcceptPayment(presale.id)}
  >
    Принять оплату
  </button>
  
  <button
    data-testid={`presale-delete-btn-${presale.id}`}  // ADD THIS
    onClick={() => handleDelete(presale.id)}
  >
    Удалить билет
  </button>
  
  <button
    data-testid={`presale-transfer-btn-${presale.id}`}  // ADD THIS
    onClick={() => handleTransfer(presale.id)}
  >
    Перенести билет
  </button>
  
  {/* Passengers toggle */}
  <button
    data-testid={`presale-passengers-toggle-${presale.id}`}  // ADD THIS
    onClick={() => togglePassengers(presale.id)}
  >
    {isExpanded ? '▼' : '▶'} Пассажиры
  </button>
</div>

// Individual ticket row
<div
  data-testid={`ticket-row-${ticket.id}`}  // ADD THIS
  className="ticket-row"
>
  {/* ... ticket info ... */}
  
  <button
    data-testid={`ticket-transfer-btn-${ticket.id}`}  // ADD THIS
    onClick={() => handleTransferTicket(ticket.id)}
  >
    Перенести
  </button>
  
  <button
    data-testid={`ticket-delete-btn-${ticket.id}`}  // ADD THIS
    onClick={() => handleDeleteTicket(ticket.id)}
  >
    Удалить
  </button>
</div>
```

## 🚀 Next Steps

1. **Add data-testid attributes** to components (see above)
2. **Install Playwright browsers**: `npx playwright install chromium`
3. **Run initial test suite**: `npm run e2e:headed` (to see what works)
4. **Create remaining test groups**:
   - Group B: Payment acceptance (3 tests)
   - Group C: Deletion (2 tests)
   - Group D: Transfers (4 tests)
   - Group E: Seller → Dispatcher sync (2 tests)
   - Boundary tests (4 tests)

## 📊 Test Coverage Target

- **16+ E2E scenarios** covering all critical dispatcher actions
- **Stable selectors** via data-testid
- **DB-isolated** execution
- **Screenshot on failure** for debugging

## Notes

- All data-testid additions are UI-only changes (no logic modified)
- Tests use production credentials (dispatcher1/password123, sellerA/password123)
- Tests assume dev server runs on `http://localhost:5173`
- Current implementation: **5/16 tests** (Group A only)
