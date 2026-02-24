# API CONTRACT — Selling + Owner Motivation

Документ фиксирует текущие поля и допустимые значения без изменения контрактов.

## Common Formats and Enums

### `slotUid`
- Обязательный идентификатор рейса в Selling API.
- Допустимые форматы:
  - `manual:<id>`
  - `generated:<id>`
- `boatSlotId` как входной идентификатор рейса не используется.

### `decision` (delete endpoints)
- Допустимые значения: `REFUND` | `FUND`.
- По умолчанию, если поле не передано: `REFUND`.
- Любое другое значение -> `400` с ошибкой `Invalid decision. Use REFUND or FUND`.

### `week` (weekly motivation)
- Формат: `YYYY-Www` (ISO week).
- Пример: `2026-W07`.
- Невалидный формат или невозможная неделя -> `400`.

### `season_id` (season motivation)
- Формат: `YYYY`.
- Пример: `2026`.
- Невалидный формат -> `400`.

---

## `POST /api/selling/presales`

### Request (current fields)

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
  "customerPhone": "79990000000",
  "prepaymentAmount": 0
}
```

### Notes
- `prepaymentAmount` >= 0.
- `prepaymentAmount` не может превышать рассчитанную стоимость заказа.

---

## `PATCH /api/selling/presales/:id/delete`

### Request (existing)

```json
{
  "decision": "REFUND"
}
```

### Interpretation
- `REFUND`: выполняется удаление/отмена пресейла без перевода предоплаты в сезонный фонд.
- `FUND`: при наличии предоплаты создается ledger-проводка
  `kind='FUND'`, `type='SEASON_PREPAY_DELETE'`, `decision_final='FUND'`.

### Response (existing shape)

```json
{
  "ok": true,
  "id": 123,
  "status": "CANCELLED",
  "seats_freed": 2
}
```

### Behavioral Contract
- При полном удалении пресейла все билеты пресейла переводятся в `REFUNDED`.
- Финансы синхронизируются через reverse-проводки и пересчет полей пресейла до нулевых значений.

---

## `PATCH /api/selling/tickets/:ticketId/delete`

### Request (existing)

```json
{
  "decision": "FUND"
}
```

### Interpretation
- `REFUND`: удаление билета без перевода предоплаты в сезонный фонд.
- `FUND`:
  - если удаляется последний активный билет (полное удаление заказа), предоплата переводится в `SEASON_PREPAY_DELETE`;
  - если удаление частичное (в заказе остаются пассажиры), перевода в фонд нет.

### Response (existing shape)

```json
{
  "success": true,
  "ticket": { "id": 10, "status": "REFUNDED" },
  "presale": { "id": 5, "status": "ACTIVE" }
}
```

### Behavioral Contract
- Частичное удаление: `presale.prepayment_amount` остается в заказе (с ограничением не выше нового `total_price`).
- Полное удаление: `presale.status='CANCELLED'`, `number_of_seats=0`, `total_price=0`, `prepayment_amount=0`.

---

## `GET /api/owner/motivation/weekly?week=YYYY-Www`

### Query
- `week` optional.
- Если не передан, используется текущая ISO-неделя.

### Response fields (existing)
- `data.week_id` — нормализованный ISO week id.
- `data.date_from`, `data.date_to` — границы недели (пн..вс).
- `data.weekly_pool_total_ledger` — сумма `money_ledger` по `WITHHOLD_WEEKLY`.
- `data.weekly_pool_total_daily_sum` — сумма дневных withhold-расчетов по неделе.
- `data.weekly_pool_is_consistent` — флаг консистентности ledger vs daily_sum.
- `data.weekly_pool_total_current` — текущий weekly pool для UI (ledger-based).
- `data.weekly_distribution_current` — текущие доли top-3.

---

## `GET /api/owner/motivation/season?season_id=YYYY`

### Query
- `season_id` optional.
- Если не передан, используется текущий год.

### Response fields (existing)
- `data.season_id`, `data.season_from`, `data.season_to`.
- `data.season_pool_total_ledger` — сумма `money_ledger` по типам:
  `WITHHOLD_SEASON` + `SEASON_PREPAY_DELETE`.
- `data.season_pool_total_daily_sum` — сумма дневных сезонных withhold + ручных переводов delete-prepay.
- `data.season_pool_manual_transfer_total` — сумма только `SEASON_PREPAY_DELETE`.
- `data.season_pool_is_consistent` — флаг консистентности ledger vs daily_sum.
- `data.season_pool_total_current` — текущий season pool для UI (ledger-based).
- `meta.season_rule` — текущее значение: `calendar_year_jan01_dec31`.

---

## `GET /api/owner/invariants`

### Query (existing)
- Требуется хотя бы один параметр:
  - `business_day=YYYY-MM-DD`
  - `week=YYYY-Www`
  - `season_id=YYYY`

### Response (existing)
- `data.day`, `data.weekly`, `data.season` содержат:
  - `ok`
  - `errors[]`
  - пары `ledger_total/daily_sum` и `diff` (для week/season)
- `data.ledger_uniqueness` проверяет дубликаты фондовых withhold-проводок по дню.
