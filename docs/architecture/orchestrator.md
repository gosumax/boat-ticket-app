# Dev Orchestrator Architecture

## Overview

The Dev Orchestrator is an autonomous agent that executes development tasks without human intervention.

## Components

```
orchestrator/
├── orchestrator.js      — Main entry point, lifecycle management
├── config.js            — Configuration (model, testCommand)
├── stages/
│   ├── research.js      — Gather requirements, analyze codebase
│   ├── design.js        — Architectural decisions
│   ├── plan.js          — Implementation plan
│   ├── implement.js     — Code changes via LLM
│   ├── security.js      — Security analysis
│   ├── financial.js     — Financial invariants check
│   ├── concurrency.js   — Concurrency safety
│   ├── regression.js    — Regression test planning
│   └── systemMap.js     — API contract extraction
└── utils/
    ├── testRunner.js    — Test execution (vitest + playwright)
    ├── git.js           — Git operations, snapshots
    ├── lifecycleGuard.js — State machine validation
    └── runArtifacts.js  — Artifact persistence
```

## Lifecycle States

```
INIT → RESEARCH_DONE → DESIGN_DONE → PLAN_DONE → IMPLEMENTED → VALIDATING
                                                                    ↓
                                                          ┌─────────┴─────────┐
                                                          ↓                   ↓
                                                        PASS              RETRYING
                                                                            ↓
                                                                      IMPLEMENTED
```

## Validate Gate

The Validate Gate is MANDATORY and consists of:

1. **Security Stage**: Analyzes for vulnerabilities
2. **Financial Stage**: Checks financial invariants
3. **Concurrency Stage**: Checks thread safety
4. **Regression Stage**: Plans regression tests
5. **Test Runner**: Executes `npm run validate`

### Test Command

```bash
npm run validate
# = npm run test:all
# = npm run test:owner && npm run test:seller && npm run test:dispatcher && npm run e2e
```

### Retry Logic

On failure:
1. Extract root cause from test output
2. Generate feedback for next implementation attempt
3. Rollback to base commit
4. Retry implementation with feedback
5. Repeat until PASS or max-retries reached

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `ORCHESTRATOR_MODEL` | `gpt-4.1-mini` | LLM model for implementation |
| `ORCHESTRATOR_MAX_RETRIES` | `3` | Max retry attempts |
| `META_MODE` | `false` | Enable meta mode |
| `ALLOW_DIRECT` | `false` | Allow direct execution |

## Artifacts

Each run creates artifacts in `dev_pipeline/runs/<runId>/`:

| File | Content |
|------|---------|
| `run_manifest.json` | Run metadata |
| `lifecycle_state.txt` | Final state (PASS/FAILED) |
| `contract_diff.json` | API changes |
| `impact_report.json` | Affected modules |
| `frontend_impact.json` | Affected frontend views |
| `full_contract_snapshot.json` | Complete API state |
| `contract_integrity.json` | Frontend-backend consistency |

## Autonomous Mode (2026-02-24)

As of 2026-02-24, the orchestrator operates in fully autonomous mode:

- No `TASK:` prefix required
- No "ДЕЛАЙ" gate
- No interactive questions
- Automatic retry with root cause analysis
- Automatic architecture doc updates

See `dev_pipeline/AGENTS.md` for current rules.
