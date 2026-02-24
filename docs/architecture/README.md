# Architecture Documentation

This directory contains architectural documentation for the boat-ticket-app project.

## Files

| File | Description |
|------|-------------|
| [CHANGELOG.md](./CHANGELOG.md) | Chronological log of all architectural changes |
| [orchestrator.md](./orchestrator.md) | Dev Orchestrator architecture and autonomous mode |
| [financial-invariants.md](./financial-invariants.md) | Financial system invariants and constraints |

## Purpose

1. **Immutable Record**: All contract/behavior changes are documented here
2. **Audit Trail**: CHANGELOG.md provides chronological history
3. **Reference**: Developers can understand "why" decisions were made

## When to Update

Update this directory when:
- API contracts change (new/removed/modified endpoints)
- Database schema changes
- Business logic changes (especially financial)
- Role permissions change
- New modules are added

## Format

Each architecture document should include:
- **Date**: When the change was made
- **What**: What changed
- **Why**: Rationale for the change
- **Impact**: Which systems/modules are affected
- **Verification**: How to verify the change is correct
