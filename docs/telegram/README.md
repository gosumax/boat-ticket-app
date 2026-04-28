# Telegram Development Structure

This directory is the source of truth for all Telegram-related development in `boat-ticket-app`.

## Purpose

Telegram work must stay modular from the first change onward. This directory defines where Telegram documentation, backend code, Mini App frontend code, shared contracts, and tests belong before any runtime implementation starts.

## Source-Of-Truth Docs

- `docs/telegram/README.md` - Telegram structure, file boundaries, and development rules
- `docs/telegram/domain-foundation.md` - Telegram first-version domain entities, statuses, events, and domain boundaries

## Reserved Telegram Paths

Future Telegram work must use these paths:

| Area | Reserved path | Scope |
| --- | --- | --- |
| Telegram docs | `docs/telegram/` | Architecture notes, integration decisions, rollout notes, API mapping, testing notes |
| Telegram backend | `server/telegram/` | Bot logic, webhook handlers, Telegram service layer, backend adapters |
| Telegram Mini App frontend | `src/telegram/` | Mini App screens, hooks, state, components, Telegram WebApp integration |
| Shared Telegram contracts | `shared/telegram/` | Shared schemas, DTOs, payload contracts, constants that must stay aligned across backend and frontend |
| Telegram tests | `tests/telegram/` | Telegram-focused unit, integration, contract, and non-e2e regression tests |

## Current Skeleton

- `server/telegram/index.js` is the backend skeleton entry point.
- `server/telegram/models/` holds domain model definitions.
- `server/telegram/repositories/` holds storage/repository skeletons only.
- `server/telegram/services/` holds service skeletons only.
- `server/telegram/schemas/` holds backend schema metadata only.
- `server/telegram/dto/` holds Telegram-facing delivery view skeletons only.
- `shared/telegram/` holds shared entity names, statuses, and event type constants.

## Folder Rules

### Documentation

- All Telegram-specific documentation must live in `docs/telegram/`.
- Do not create new Telegram design notes in the repository root.
- Do not scatter Telegram docs across unrelated existing docs unless the topic is genuinely shared across the whole system.
- If a document affects system-wide architecture, add a short pointer from the relevant existing doc to `docs/telegram/` instead of duplicating the full content.

### Backend

- All new Telegram backend modules must live under `server/telegram/`.
- Keep Telegram transport and adapter logic isolated from seller, dispatcher, owner, and admin runtime modules.
- Existing legacy files such as `server/index.js`, `server/selling.mjs`, `server/owner.mjs`, or `server/dispatcher-shift*.mjs` must not absorb large Telegram features unless a tiny integration seam is strictly required.
- If a minimal integration seam is needed later, keep the seam thin and delegate real Telegram logic back into `server/telegram/`.

### Frontend Mini App

- All Telegram Mini App frontend code must live under `src/telegram/`.
- Do not place Telegram Mini App screens inside existing seller, dispatcher, owner, or admin view folders unless the UI is truly shared.
- Shared presentational UI that is reusable outside Telegram may stay in existing generic UI folders, but Telegram-specific orchestration must remain in `src/telegram/`.

### Shared Contracts

- Backend/frontend shared Telegram contracts must live under `shared/telegram/`.
- Put schemas, payload definitions, response envelopes, init-data parsing contracts, and Telegram-specific shared constants here.
- Do not duplicate the same Telegram payload shape in `server/` and `src/`; promote it into `shared/telegram/` instead.

### Tests

- Telegram-specific tests must live under `tests/telegram/`.
- Subfolders may be introduced later as needed, for example `tests/telegram/backend/`, `tests/telegram/frontend/`, `tests/telegram/contracts/`, or `tests/telegram/e2e/`.
- Existing seller/dispatcher/owner/admin test suites must remain focused on their own flows unless a future change truly crosses module boundaries.

## Naming Conventions

- Use the `telegram` name explicitly for Telegram-only modules, folders, and docs.
- Prefer kebab-case for documentation files: `docs/telegram/mini-app-routing.md`.
- Prefer kebab-case for backend module files: `server/telegram/webhook-router.mjs`.
- Prefer kebab-case for shared contract files: `shared/telegram/init-data.schema.js`.
- Follow the existing React component naming style for component files inside `src/telegram/`, using PascalCase only for React components and kebab-case for non-component support files.
- Test files must end with `.test.js` unless the repository later standardizes another test suffix for Telegram tooling.

## File Boundary Principles

- One file should own one clear responsibility.
- Split a file when it starts mixing transport, domain rules, data mapping, and UI orchestration.
- Split a file when it becomes difficult to scan in one pass or when unrelated Telegram concerns start sharing the same module.
- Split a file when a module is reused by both bot and Mini App paths but contains transport-specific details.
- Extract shared contracts before copying shapes across backend and frontend.

## Forbidden Patterns

- Do not dump Telegram work into unrelated legacy runtime files for convenience.
- Do not add root-level Telegram markdown files.
- Do not mix Bot backend handlers and Mini App frontend code in the same directory.
- Do not place Telegram-only schemas in generic folders when their scope is Telegram-specific.
- Do not create oversized mixed files that combine routing, validation, business logic, remote API calls, and formatting in one module.
- Do not treat Telegram as an extension of seller, dispatcher, owner, or admin folders unless a future task explicitly requires a bounded integration point.

## Change Policy For Future Telegram Tasks

- Prefer additive changes inside the reserved Telegram paths.
- Keep diffs minimal and avoid restructuring unrelated legacy modules.
- Any future runtime integration must preserve existing seller, dispatcher, owner, and admin flows.
- Financial logic remains governed by existing project invariants; Telegram transport must adapt to current domain rules, not redefine them.

## Current Status

- This task establishes structure and rules only.
- No Telegram runtime behavior, routes, bot handlers, UI screens, migrations, or DB changes are introduced here.

## Local Live Test-Bot Tunnel (Cloudflare Named Tunnel)

Use this only for local Telegram webhook and Mini App live testing. This is a developer/operator helper flow and does not change runtime Telegram business logic.

Recommended one-command flow:

1. Install `cloudflared` once on Windows:
   - `winget install --id Cloudflare.cloudflared`
   - or download `cloudflared-windows-amd64.exe` and point `CLOUDFLARED_EXE` at it in `start-telegram-miniapp-live.bat`
2. Create and bind a named tunnel once:
   - `cloudflared tunnel create boat-ticket-miniapp`
   - `cloudflared tunnel route dns boat-ticket-miniapp miniapp.domain.com`
3. Use named tunnel config (template in repo):
   - `docs/telegram/cloudflared-named-tunnel.example.yml`
4. Set stable values in `start-telegram-miniapp-live.bat`:
   - `CLOUDFLARE_TUNNEL_MODE=named`
   - `CLOUDFLARE_TUNNEL_NAME=boat-ticket-miniapp`
   - `TELEGRAM_PUBLIC_BASE_URL=https://miniapp.domain.com`
   - optional `CLOUDFLARE_TUNNEL_CONFIG=<path-to-config.yml>`
5. Run:
   - `start-telegram-miniapp-live.bat`
6. The launcher now:
   - starts named tunnel `cloudflared tunnel run <name>`
   - builds the app
   - starts `server/index.js` with stable `TELEGRAM_PUBLIC_BASE_URL`
   - prints the final buyer Mini App URL for desktop/iPhone live checks

Quick tunnel fallback (dev-only, non-persistent):

1. Start the backend on port `3001`.
2. Start Cloudflare Quick Tunnel:
   - `cloudflared tunnel --url http://127.0.0.1:3001 --edge-ip-version 4 --no-autoupdate`
3. Copy the public HTTPS base URL from Cloudflare (example: `https://example-name.trycloudflare.com`).
4. Run the helper if you want the exact derived URLs printed:
   - `node scripts/telegram-ngrok-helper.mjs https://example-name.trycloudflare.com`
5. Set the `.env` value exactly as the helper prints:
   - `TELEGRAM_PUBLIC_BASE_URL=https://example-name.trycloudflare.com`

Important:

- This tunnel path does not rely on the free-ngrok warning-page flow.
- `TELEGRAM_PUBLIC_BASE_URL` must be the base URL only.
- Do not append `/api/telegram/webhook` to `TELEGRAM_PUBLIC_BASE_URL`.
- The runtime expects webhook URL as:
  - `<TELEGRAM_PUBLIC_BASE_URL>/api/telegram/webhook`
- For Mini App launch checks, runtime derives:
  - `<TELEGRAM_PUBLIC_BASE_URL>/telegram/mini-app`

## Local Webhook Registration/Check Helper

Use this helper after the public tunnel is running and `TELEGRAM_PUBLIC_BASE_URL` is known.

1. Print exact webhook registration inputs (no API call):
   - `npm run telegram:webhook:helper`
2. Optionally override base URL just for one run:
   - `npm run telegram:webhook:helper -- https://miniapp.domain.com`
3. Register webhook in Telegram:
   - `npm run telegram:webhook:helper -- --register`
4. Register and immediately check status:
   - `npm run telegram:webhook:helper -- --register --check`
5. Check current webhook status only:
   - `npm run telegram:webhook:helper -- --check`

Notes:

- Helper registration target is always `<TELEGRAM_PUBLIC_BASE_URL>/api/telegram/webhook`.
- Helper uses `TELEGRAM_WEBHOOK_SECRET_TOKEN` as `secret_token` in `setWebhook`.
- Add `--drop-pending-updates` only when you intentionally want Telegram to discard queued updates during registration.
