# PROJECT PROMPTS — BOAT TICKET APP

## 🔒 Anti-Hallucination Rules (MANDATORY)

RULES:
- No assumptions.
- No reports.
- No summaries.
- No "already exists", "probably", "seems".
- If unsure → STOP and ask.

## 🧱 Source of Truth

- Single DB: <project-root>/database.sqlite
- Backend entry: server/index.mjs
- DB init: server/db.js
- Only allowed file to change unless stated otherwise.

## ✅ Output Contract

Only one of:
- Exact code diff
- Exact curl output
- Exact console log

Anything else = INVALID.
