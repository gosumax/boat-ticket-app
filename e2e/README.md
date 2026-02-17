# E2E Tests for Boat Ticket App

## Setup

```bash
npm install -D @playwright/test
npx playwright install chromium
```

## Running Tests

```bash
# Run all E2E tests
npm run e2e

# Run with UI mode (interactive)
npm run e2e:ui

# Run in headed mode (see browser)
npm run e2e:headed

# Run specific test file
npx playwright test e2e/dispatcher-presale-creation.spec.js
```

## Test Structure

### Test Groups

- **Group A**: Presale Creation (`dispatcher-presale-creation.spec.js`)
  - A1: Create without seller selection (defaults to dispatcher)
  - A2: Create on behalf of seller
  - A3-A5: Payment methods (CASH, CARD, MIXED)

- **Group B**: Payment Acceptance (planned)
- **Group C**: Deletion (planned)
- **Group D**: Transfers (planned)
- **Group E**: Seller → Dispatcher sync (planned)

### Helpers

- `helpers/auth.js`: Login/logout helpers
- `helpers/dispatcher.js`: Dispatcher UI interaction helpers

## Data Test IDs

Components have been enhanced with `data-testid` attributes for stable selectors:

### TripListView
- `trip-card-{slotUid}`: Trip card container
- `trip-open-{slotUid}`: Button to open trip

### PassengerList
- `trip-sell-btn`: "Продать билет" button
- `presale-card-{presaleId}`: Presale card
- `presale-pay-btn-{presaleId}`: Accept payment button
- `presale-delete-btn-{presaleId}`: Delete presale button
- `presale-transfer-btn-{presaleId}`: Transfer presale button
- `presale-passengers-toggle-{presaleId}`: Toggle passengers list
- `ticket-row-{ticketId}`: Individual ticket row
- `ticket-transfer-btn-{ticketId}`: Transfer ticket button
- `ticket-delete-btn-{ticketId}`: Delete ticket button

### QuickSaleForm
- `seller-select`: Seller dropdown
- `payment-method`: Payment method selector
- `cash-amount`: Cash amount input
- `card-amount`: Card amount input
- `prepay-500`, `prepay-1000`, `prepay-2000`, `prepay-full`: Quick prepayment buttons
- `presale-create-btn`: Submit button
- `presale-total`: Total amount display

## Notes

- Tests run sequentially (`workers: 1`) to avoid DB conflicts
- Dev server is automatically started by Playwright
- Uses production DB in test mode (isolated from main DB)
- Screenshots are captured on failure
