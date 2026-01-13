# Mock Data Structure

This directory contains all the mock data used in the application.

## Boats

```javascript
[
  { id: 1, name: 'Speed Boat 1', type: 'speed', seats: 12 },
  { id: 2, name: 'Speed Boat 2', type: 'speed', seats: 12 },
  { id: 3, name: 'Speed Boat 3', type: 'speed', seats: 12 },
  { id: 4, name: 'Cruise Boat 1', type: 'cruise', seats: 12 },
  { id: 5, name: 'Cruise Boat 2', type: 'cruise', seats: 12 },
  { id: 6, name: 'Cruise Boat 3', type: 'cruise', seats: 12 }
]
```

## Trips

```javascript
[
  { 
    id: 1, 
    boatId: 1, 
    time: '10:00', 
    duration: '1h', 
    type: 'speed', 
    price: 50, 
    seatsLeft: 8 
  },
  // ... more trips
]
```

## Sellers

```javascript
[
  { id: 'A', name: 'Seller A' },
  { id: 'B', name: 'Seller B' },
  { id: 'C', name: 'Seller C' }
]
```

## Utility Functions

### generateTicketNumber()

Generates a random ticket number in the format `TKT-XXXX` where XXXX is a random 4-digit number.

### calculateEarnings(tickets)

Calculates earnings based on sold tickets:
- Total sales amount
- Commission (10% of sales)
- Bonus (fixed at $50)