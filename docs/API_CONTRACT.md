# API Contract

This file is the source of truth for protected external behavior that must not change silently.

## Contract Protection

- Existing request and response shapes are compatibility commitments.
- Existing error semantics are compatibility commitments when already used by runtime flows or tests.
- Any intentional contract change must be explicit in the task and documented here.

## Protected Areas

- seller selling flows
- dispatcher flows
- owner motivation and invariants endpoints
- auth and role-gated behavior
- shift-close related endpoints

## Stable Contract Rules

### `slotUid`

- Selling flows use `slotUid` as the trip identifier.
- Supported formats:
  - `manual:<id>`
  - `generated:<id>`

### Delete Decision

- Supported value set for selling delete flows: `REFUND | FUND`

### Time Identifiers

- weekly motivation uses `week=YYYY-Www`
- season motivation uses `season_id=YYYY`
- business-day queries use `YYYY-MM-DD`

## Contract Notes Kept Explicit

- `POST /api/selling/presales` accepts `slotUid` and current selling payload fields.
- delete endpoints preserve `decision=REFUND | FUND` behavior.
- `GET /api/owner/motivation/weekly` preserves ISO week semantics.
- `GET /api/owner/motivation/season` preserves current season identifier semantics.
- `GET /api/owner/invariants` remains the invariants verification surface.

## Deep References

Use these only when a task touches the relevant area:

- `docs/dispatcher-shift-close.md`
- `docs/TIME_RULES.md`
- `docs/BUSINESS_RULES.md`
