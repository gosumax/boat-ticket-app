# Plan Report

## TASK
Реализовать реальный Stage 3 — Plan Engine для orchestrator.

## Phases

### Phase 1 — Impact Analysis
- Files potentially affected (по risk zones):
- server/dispatcher-shift-ledger.mjs
- server/dispatcher-shift.mjs
- server/migrate-owner-settings.js
- server/motivation/engine.mjs
- server/query-ledger-tmp.cjs
- server/seller-motivation-state.mjs
- server/shift-guard.mjs
- Definition of Done:
- Identified impacted files are explicit and bounded.
- Risks are documented per detected risk zone.
- Tests to run:
- npm run test
- Risks:
- Hidden coupling in money/ledger and shift paths.
- Contract drift if guard formatting differs across routes.

### Phase 2 — Controlled Implementation
- Change type: minimal diff
- Guard enforcement
- Role safety check

### Phase 3 — Validation
- Run tests
- Invariant check
- No regression verification

## Definition of Global PASS
- All tests PASS
- No API contract break
- No silent fallback
- No client time usage
- Roles preserved
