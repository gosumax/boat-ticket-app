---
trigger: always_on
---
CODER RULES — boat-ticket-app (STRICT MODE + TEST ZONE)

0) GLOBAL MODE
- Default mode: READ-ONLY.
- No changes unless user explicitly says: "ДЕЛАЙ".
- If something is unclear → ask, do not guess.

-------------------------------------------------------
1) ZONE SEPARATION (CRITICAL)
-------------------------------------------------------

There are ONLY two zones:

A) TEST ZONE (FULL FREEDOM)
Includes:
- tests/*
- _testdata/*
- vitest config
- supertest setup
- test helpers
- isolated test database
- any test-only utilities

In TEST ZONE you MAY:
- change payloads
- change expectations (expect)
- rewrite tests
- add helpers
- mock differently
- adjust setup/teardown
- create test fixtures
- modify test DB structure (only test DB)

Goal of test zone:
→ Tests must adapt to real production API.
→ Tests must reflect actual business logic.
→ Production code must NOT be changed to satisfy tests.

B) PRODUCTION ZONE (STRICT CONTROL)
Includes:
- server/*
- src/*
- root/database.sqlite
- API routes
- business logic
- auth
- middleware
- schema
- migrations

In PRODUCTION ZONE you MUST:
- Use minimal diff only
- Change only what is explicitly requested
- Preserve existing behavior
- Not refactor
- Not restructure
- Not rename
- Not move files
- Not clean up “for beauty”
- Not change API contracts
- Not change DB schema unless explicitly ordered

-------------------------------------------------------
2) ABSOLUTE PROHIBITIONS (HARD STOP)
-------------------------------------------------------

- Do NOT modify production logic to make tests pass.
- Do NOT touch root/database.sqlite.
- Do NOT add dependencies unless explicitly requested.
- Do NOT modify auth/JWT/roles unless explicitly requested.
- Do NOT change working endpoints format.
- Do NOT introduce new architecture.
- Do NOT “improve consistency”.
- Do NOT run wide formatting across files.

If tempted to:
"I'll refactor this to be cleaner"
→ STOP.

-------------------------------------------------------
3) CURRENT PHASE RULE
-------------------------------------------------------

We are in: FULL BACKEND + SELLER FLOW TESTING PHASE.

If a seller-flow test fails:
1) Assume payload mismatch first.
2) Verify real contract in server/selling.mjs.
3) Fix the TEST, not production code.

-------------------------------------------------------
4) ONE ISSUE RULE
-------------------------------------------------------

- One problem → one fix.
- One layer at a time.
- One minimal patch per step.

-------------------------------------------------------
5) CHANGE WORKFLOW (MANDATORY)
-------------------------------------------------------

Before ANY production change:

A) DIAGNOSE
- Show exact failing endpoint
- Show request payload
- Show response
- Show relevant code snippet

B) PLAN
- Describe smallest possible change

C) APPLY
- Minimal lines only

D) VERIFY
- Re-run only relevant tests

-------------------------------------------------------
6) DATABASE SAFETY
-------------------------------------------------------

Production DB:
- Never reset
- Never seed
- Never migrate
- Never vacuum
- Never delete

Tests:
- Only isolated test DB allowed
- No WAL
- Sequential execution

-------------------------------------------------------
7) OUTPUT RULES
-------------------------------------------------------

- Prompts/commands → code block only
- Explanations → short, factual
- Logs → include error + stack
- No unsolicited terminal commands
- No restart suggestions unless explicitly asked

-------------------------------------------------------
CORE PRINCIPLE
-------------------------------------------------------

Production code is source of truth.
Tests must adapt to production.
Minimal diff.
No imagination.
No architecture creativity.
Only controlled, precise changes.
“Любые изменения в PRODUCTION ZONE только после слова ДЕЛАЙ”.