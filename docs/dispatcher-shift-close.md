# Dispatcher Shift Close — API Contract & Behavior

## 1. Overview

Dispatcher Shift Close — это механизм закрытия смены диспетчера с созданием неизменяемого снимка (snapshot) финансовых данных за business_day.

**Ключевые принципы:**
- Источник истины: `money_ledger` (live) → `shift_closures` (snapshot после close)
- После закрытия все операции заблокированы (409 SHIFT_CLOSED)
- Close идемпотентен (повторный вызов возвращает тот же snapshot)

## 2. Source of Truth

| Состояние | Источник | Таблица | Поле `source` |
|-----------|----------|---------|---------------|
| Live (до close) | money_ledger | `money_ledger` | `'live'` или `'ledger'` |
| Snapshot (после close) | shift_closures | `shift_closures` | `'snapshot'` |

**Правило:** После close все значения берутся из snapshot. Пересчёт запрещён.

## 3. Business Day Rules

- **Формат:** `YYYY-MM-DD` (локальная дата, не UTC)
- **Определение:** `DATE('now', 'localtime')` на сервере
- **Семантика:** День бизнеса, не день поездки (trip_date может отличаться)

## 4. Endpoints

### 4.1 GET /api/dispatcher/shift-ledger/summary

**Auth:** Требуется JWT, role: `dispatcher` или `owner`

**Query params:**
- `business_day` (optional) — дата в формате YYYY-MM-DD, по умолчанию сегодня

**Response (live, до close):**
```json
{
  "ok": true,
  "business_day": "2026-02-20",
  "source": "live",
  "is_closed": false,
  
  "total_revenue": 50000,
  "collected_total": 45000,
  "collected_cash": 30000,
  "collected_card": 15000,
  
  "refund_total": 500,
  "refund_cash": 300,
  "refund_card": 200,
  
  "net_total": 44500,
  "net_cash": 29700,
  "net_card": 14800,
  
  "deposit_cash": 10000,
  "deposit_card": 5000,
  
  "salary_paid_cash": 2000,
  "salary_paid_card": 0,
  "salary_paid_total": 2000,
  
  "sellers": [...],
  "dispatcher": {...},
  
  "all_trips_finished": true,
  "open_trips_count": 0
}
```

**Response (snapshot, после close):**
```json
{
  "ok": true,
  "business_day": "2026-02-20",
  "source": "snapshot",
  "is_closed": true,
  "closed_at": "2026-02-20 18:30:00",
  "closed_by": 5,
  
  // ... те же финансовые поля ...
  
  "cashbox": {
    "cash_in_cashbox": 17700,
    "expected_sellers_cash_due": 18000,
    "deposits_cash_total": 10000,
    "salary_paid_cash": 2000,
    "cash_discrepancy": -300,
    "warnings": []
  },
  "cash_in_cashbox": 17700,
  "expected_sellers_cash_due": 18000,
  "cash_discrepancy": -300,
  "warnings": []
}
```

**Поля ответа:**

| Поле | Описание | Live | Snapshot |
|------|----------|------|----------|
| `source` | Источник данных | `'live'` | `'snapshot'` |
| `is_closed` | Закрыта ли смена | `false` | `true` |
| `closed_at` | Время закрытия | `null` | timestamp |
| `closed_by` | ID закрывшего | `null` | user.id |
| `collected_*` | Собрано денег | из money_ledger | из snapshot |
| `net_*` | Чистая выручка (collected - refunds) | вычисляется | из snapshot |
| `deposit_*` | Сдано owner | из money_ledger | из snapshot |
| `cashbox.*` | Sanity check | отсутствует | из cashbox_json |

### 4.2 POST /api/dispatcher/shift/deposit

**Auth:** Требуется JWT, role: `dispatcher`

**Request body:**
```json
{
  "type": "DEPOSIT_TO_OWNER_CASH",
  "amount": 5000,
  "seller_id": 100,
  "business_day": "2026-02-20"
}
```

**Allowed types:**
- `DEPOSIT_TO_OWNER_CASH` — сдача налички продавца owner
- `DEPOSIT_TO_OWNER_CARD` — сдача терминала продавца owner
- `SALARY_PAYOUT_CASH` — выплата ЗП из кассы
- `SALARY_PAYOUT_CARD` — выплата ЗП на карту

**Responses:**

| Статус | Код | Описание |
|--------|-----|----------|
| 200 | `ok: true` | Операция проведена |
| 400 | `ok: false, error` | Неверные параметры / незавершённые рейсы |
| 401 | `ok: false, error` | Неавторизован |
| 409 | `ok: false, code: 'SHIFT_CLOSED'` | Смена уже закрыта |

### 4.3 POST /api/dispatcher/shift/close

**Auth:** Требуется JWT, role: `dispatcher`

**Request body:**
```json
{
  "business_day": "2026-02-20"
}
```

**Response (успешное закрытие):**
```json
{
  "ok": true,
  "business_day": "2026-02-20",
  "closed": true,
  "is_closed": true,
  "source": "snapshot",
  "closed_at": "2026-02-20 18:30:00",
  "closed_by": 5,
  "totals": {
    "total_revenue": 50000,
    "collected_total": 45000,
    "collected_cash": 30000,
    "collected_card": 15000,
    "refund_total": 500,
    "net_total": 44500,
    "deposit_cash": 10000,
    "deposit_card": 5000
  },
  "cashbox": {
    "cash_in_cashbox": 17700,
    "expected_sellers_cash_due": 18000,
    "deposits_cash_total": 10000,
    "salary_paid_cash": 2000,
    "cash_discrepancy": -300,
    "warnings": [
      {
        "code": "CASH_DISCREPANCY",
        "amount": -300,
        "message": "В кассе меньше наличных на 300 ₽, чем ожидалось от продавцов"
      }
    ]
  },
  "cash_in_cashbox": 17700,
  "expected_sellers_cash_due": 18000,
  "cash_discrepancy": -300,
  "warnings": [...]
}
```

**Response (идемпотентный, повторный вызов):**
```json
{
  "ok": true,
  "business_day": "2026-02-20",
  "is_closed": true,
  "source": "snapshot",
  "closed_at": "2026-02-20 18:30:00",
  "closed_by": 5
}
```

**Response (ошибка):**

| Статус | Код | Условие |
|--------|-----|---------|
| 400 | `error: "Незавершённые рейсы"` | `all_trips_finished = false` |
| 401 | `error: "Требуется авторизация"` | Нет/неверный JWT |

## 5. Invariants

### 5.1 Net Calculation
```
net_total = collected_total - refund_total
net_cash = collected_cash - refund_cash
net_card = collected_card - refund_card
```

**Важно:** Это вычисляется на сервере. UI не пересчитывает.

### 5.2 Snapshot Immutability
После записи в `shift_closures`:
- Строка не изменяется
- Новые операции в `money_ledger` с тем же `business_day` игнорируются summary
- `source` всегда `'snapshot'`

### 5.3 Idempotency
- Повторный `POST /close` возвращает `200 ok: true`
- Не создаёт дубликатов в `shift_closures`
- Возвращает тот же `closed_at`, `closed_by`

### 5.4 SHIFT_CLOSED Protection
После close:
- `POST /deposit` → `409 SHIFT_CLOSED`
- `POST /close` → `200 ok: true` (идемпотент)
- `GET /summary` → `source: 'snapshot'`

## 6. Cashbox Sanity Check

### 6.1 Определения

```
cash_in_cashbox = net_cash - deposit_cash - salary_paid_cash
expected_sellers_cash_due = sum(max(0, seller.cash_due_to_owner))
cash_discrepancy = cash_in_cashbox - expected_sellers_cash_due
```

### 6.2 Warnings Semantics

| `cash_discrepancy` | Warning | Блокировка |
|--------------------|---------|------------|
| `= 0` | Нет | Нет |
| `> 0` | CASH_DISCREPANCY (лишняя наличка) | Нет (soft) |
| `< 0` | CASH_DISCREPANCY (недостача) | Нет (soft) |

**Правило:** Warnings НЕ блокируют close. Это информационное предупреждение.

### 6.3 Storage

- Snapshot: `shift_closures.cashbox_json` (TEXT, JSON)
- Формат: `{ cash_in_cashbox, expected_sellers_cash_due, deposits_cash_total, salary_paid_cash, cash_discrepancy, warnings[] }`

## 7. UI Expectations

### 7.1 Closed Shift

После close UI должен:
- Отображать `source: 'snapshot'`, `is_closed: true`
- **Отключить** кнопки: deposit, salary payout, close
- Показывать время закрытия `closed_at`

### 7.2 Warnings Display

При `warnings.length > 0`:
- Показать блок с `code: 'CASH_DISCREPANCY'`
- Цвет: жёлтый (cash_discrepancy > 0) или красный (cash_discrepancy < 0)
- Текст: warning.message
- Не блокировать UI, только информировать

### 7.3 Field Normalization

UI использует `normalizeSummary()` для обработки:
- snake_case vs camelCase полей
- Вложенный `cashbox` vs top-level поля
- Fallback при отсутствии серверных значений

## 8. Error Codes Summary

| Код | HTTP | Описание |
|-----|------|----------|
| `SHIFT_CLOSED` | 409 | Смена закрыта, операции запрещены |
| `UNAUTHORIZED` | 401 | Требуется авторизация |
| `FORBIDDEN` | 403 | Недостаточно прав |
| `VALIDATION_ERROR` | 400 | Неверные параметры |
| `OPEN_TRIPS` | 400 | Есть незавершённые рейсы |

## 9. Database Tables

### shift_closures

| Колонка | Тип | Описание |
|---------|-----|----------|
| `id` | INTEGER PK | Автоинкремент |
| `business_day` | TEXT | YYYY-MM-DD, UNIQUE |
| `closed_at` | TEXT | Timestamp закрытия |
| `closed_by` | INTEGER | user.id закрывшего |
| `total_revenue` | INTEGER | Выручка canonical |
| `collected_total/cash/card` | INTEGER | Собрано из money_ledger |
| `refund_total/cash/card` | INTEGER | Возвраты |
| `net_total/cash/card` | INTEGER | Чистая выручка |
| `deposit_cash/card` | INTEGER | Сдано owner |
| `salary_due/paid_*` | INTEGER | Зарплата |
| `sellers_json` | TEXT | JSON с sellers[] |
| `cashbox_json` | TEXT | JSON с cashbox sanity |

## 10. Changelog

- **2026-02-20:** Initial contract (Step 9)
  - Idempotent close
  - 409 SHIFT_CLOSED protection
  - Cashbox sanity check
  - Warnings (soft)
