# Time Rules

This file is a narrow reference for time-related invariants.

## Core Rules

- Use server time for runtime decisions.
- Do not rely on client-side time or timezone guessing for enforcement.
- Cutoff calculations must use server-side trip date/time data.

## Cutoff Rules

- `seller_cutoff_minutes`
  - `NULL` means no seller cutoff.
  - numeric value means seller sales close `N` minutes before trip start.
- `dispatcher_cutoff_minutes`
  - must be greater than or equal to `seller_cutoff_minutes` when both are set.
  - may be `NULL`.

## Weekly Rule

- Weekly motivation uses ISO week format `YYYY-Www`.
- Week boundaries are Monday through Sunday, inclusive.

## Season Rule

- Current production contract uses `season_id=YYYY`.
- Current API contract treats the season as the calendar year unless a future contract explicitly changes that behavior.

For contract details, see `docs/API_CONTRACT.md`.
For business meaning, see `docs/BUSINESS_RULES.md`.
