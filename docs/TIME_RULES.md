# TIME RULES

## Time Source

- Используется только серверное время.
- Client-time и timezone guessing запрещены.

---

## Cutoff Logic

### `seller_cutoff_minutes`
- `NULL` -> нет cutoff.
- `number` -> закрытие продажи за `N` минут до старта рейса.

### `dispatcher_cutoff_minutes`
- Всегда `>= seller_cutoff_minutes`.
- Может быть `NULL`.

### Formula

- `trip_datetime = datetime(trip_date + trip_time)`
- `seller_cutoff_time = trip_datetime - seller_cutoff_minutes`
- `dispatcher_cutoff_time = trip_datetime - dispatcher_cutoff_minutes`

### Check

- Если `now >= seller_cutoff_time`, роль `SELLER` продавать не может.
- Если `now >= dispatcher_cutoff_time`, роль `DISPATCHER` продавать не может.

---

## Week Rule (ISO)

- Для weekly мотивации используется ISO-формат `YYYY-Www`.
- Границы недели: понедельник ... воскресенье (включительно).
- Неделя может выходить за границы календарного года.
  Пример: `2026-W01` = `2025-12-29` ... `2026-01-04`.

---

## Season Rule

### Current Runtime Rule

- По умолчанию сезон для `season_id=YYYY` считается как:
  `YYYY-01-01` ... `YYYY-12-31` (обе границы включительно).
- В `GET /api/owner/motivation/season` это отражается в
  `meta.season_rule = "calendar_year_jan01_dec31"`.

### Owner Settings (Omni) Boundary Model

- Поддерживаемая модель конфигурации границ сезона:
  `season_start_mmdd` и `season_end_mmdd` в формате `MM-DD`.
- Год сезона всегда определяется выбранным `season_id`.
  Пример для `season_id=2026`:
  `season_start = 2026-<season_start_mmdd>`, `season_end = 2026-<season_end_mmdd>`.
- Правило включения границ: `start` и `end` включительно.
- Сезон считается только в пределах одного календарного года.
  Переход через Новый год не допускается.
- Если настройки не заданы, используется fallback:
  `01-01 ... 12-31`.
