# Project Principles

This file defines the short engineering principles for day-to-day work in this repository.

- Preserve existing behavior unless the task explicitly changes it.
- Prefer minimal diffs over broad cleanup.
- Do not guess business behavior; verify against code or source-of-truth docs.
- Keep errors explicit; avoid silent fallbacks in critical logic.
- Keep manual and generated slot behavior aligned unless a documented rule says otherwise.
- Use `slotUid` as the stable trip identifier in selling flows.
- Put new work in clear module boundaries instead of expanding unrelated legacy files.
- Treat business rules and API contracts as explicit compatibility commitments.
