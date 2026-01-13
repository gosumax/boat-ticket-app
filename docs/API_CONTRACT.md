# API CONTRACT — Selling

## slotUid (ОБЯЗАТЕЛЬНО)

Формат:
- manual:<id>
- generated:<id>

Пример:
- manual:12
- generated:44

❗ slotUid — ЕДИНСТВЕННЫЙ допустимый идентификатор рейса  
❌ boatSlotId — ЗАПРЕЩЁН

---

## POST /api/selling/presales

### Request
```json
{
  "slotUid": "generated:44",
  "numberOfSeats": 3,
  "tickets": {
    "adult": 3,
    "teen": 0,
    "child": 0
  },
  "customerName": "Мария",
  "customerPhone": "79785188099",
  "prepaymentAmount": 0
}
