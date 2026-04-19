# Execution Policy

This repository uses task-driven execution.

## Input Format

- Expected user format: `TASK: <description>`.
- If a message does not start with `TASK:`, do not make repo changes and reply with:
  `ERROR: Input must start with TASK:`

## Required Working Process

For every valid task, follow this sequence:

1. Research
2. Design
3. Plan
4. Minimal Diff Implementation
5. Appropriate Validation
6. Report

Do not skip the reasoning steps, but keep them proportional to task risk.

## Scope And Safety

- Preserve existing seller, dispatcher, owner, and admin runtime behavior unless the task explicitly changes it.
- Preserve business rules documented in `docs/BUSINESS_RULES.md`.
- Preserve API behavior documented in `docs/API_CONTRACT.md`.
- Keep diffs minimal.
- No speculative refactors.
- No silent behavior changes.
- Do not move or remove Telegram groundwork unless the task explicitly requires it.

## Architectural Guardrails

- `money_ledger` remains the financial source of truth.
- Seller flow is protected.
- Shift-close behavior is high risk.
- Existing DB schema, auth behavior, and production contracts are protected unless a task explicitly changes them.

## Project Docs To Consider

Use these documents when relevant:

- `docs/PROJECT_PRINCIPLES.md`
- `docs/BUSINESS_RULES.md`
- `docs/API_CONTRACT.md`
- `docs/TIME_RULES.md`
- `docs/DEBUG_POLICY.md`
- `docs/dispatcher-shift-close.md`
- `docs/GLOSSARY.md`
- `docs/telegram/README.md` for Telegram structure work

If a reference file is missing, continue without it.

## Risk-Based Validation Policy

Validation must match task risk instead of defaulting to full-system validation.

### Low Risk

Examples:

- docs-only changes
- rules-only changes
- planning-only changes
- structure-only changes
- placeholder-only changes
- non-runtime scaffolding
- Telegram groundwork that does not introduce runtime behavior

Required validation:

- confirm touched files are documentation or placeholders only
- confirm runtime code was not changed
- run a lightweight sanity check only if useful

Not required by default:

- `npm run validate`
- full owner/seller/dispatcher test chain
- Playwright e2e

### Medium Risk

Examples:

- isolated Telegram development
- new modules behind reserved Telegram boundaries
- targeted scaffolding or contracts that do not touch active seller/dispatcher/owner/admin runtime flows
- work that avoids shared financial logic, auth, live API contracts, DB behavior, and shift-close logic

Required validation:

- targeted checks for the files or module being changed
- narrow tests, lint, or build steps only when they directly cover the changed area

Not required by default:

- full `npm run validate`

### High Risk

Examples:

- shared runtime logic
- seller, dispatcher, owner, or admin behavior changes
- financial or ledger logic
- auth or permissions
- API contracts
- DB schema or persistence behavior
- shift-close logic
- cross-module production behavior

Required validation:

- strong validation proportional to risk
- run `npm run validate` when the task touches current production behavior or other high-risk paths

## Validation Gate

- `npm run validate` is mandatory for high-risk changes.
- `npm run validate` is not mandatory for low-risk or medium-risk tasks unless the task explicitly asks for it or the changed area justifies it.
- A task is complete only after the required validation for its risk level has been run and reported.

## Output Expectations

- Report what changed.
- Report what was validated.
- Report any assumptions or limits.
- Keep the response practical; no rigid format is required beyond clarity.
