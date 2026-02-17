---
description: Run full backend test suite (Vitest + in-memory DB)
---
set NODE_ENV=test && set DB_FILE=:memory: && npx vitest run --reporter=verbose

