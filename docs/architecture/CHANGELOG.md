# Architecture Changelog

All architectural changes are logged here in chronological order.

---

## 2026-02-24 — Orchestrator Autonomous Mode

### What Changed
- Removed `TASK:` prefix requirement from dev_pipeline/AGENTS.md
- Removed "ДЕЛАЙ" and "Proceed?" interactive gates
- Established PROCESS_RULES.md as highest priority policy file
- Added autonomous pipeline: Research → Design → Plan → Implement → Validate → Retry → PASS

### Why
User requested fully autonomous orchestrator that:
- Accepts commands in any format (no special prefix required)
- Never asks for confirmation
- Continues automatically until DONE: PASS
- Self-heals via retry loop with root cause analysis

### Impact
- **Files Changed**:
  - `dev_pipeline/AGENTS.md` — completely rewritten for autonomous mode
  - `docs/architecture/README.md` — new file
  - `docs/architecture/CHANGELOG.md` — new file
  - `docs/architecture/orchestrator.md` — new file

- **Modules Affected**: orchestrator/*

- **Behavior Change**:
  - Before: Orchestrator required `TASK:` prefix and blocked on "ДЕЛАЙ" gate
  - After: Orchestrator accepts any input format, never blocks, runs until PASS

### Verification
1. Check that `dev_pipeline/AGENTS.md` no longer contains "TASK:" requirement
2. Check that `dev_pipeline/PROCESS_RULES.md` says "NO INTERACTIVE QUESTIONS"
3. Run orchestrator with free-text command (no prefix) — should execute without asking

---

## Template for Future Entries

```markdown
## YYYY-MM-DD — [Title]

### What Changed
- Bullet list of changes

### Why
- Rationale for the change

### Impact
- **Files Changed**: list of files
- **Modules Affected**: which modules
- **Behavior Change**: before/after

### Verification
1. Step to verify
2. Step to verify
```
