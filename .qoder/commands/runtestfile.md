---
description: Run a single test file (pass path after the command)
---
set NODE_ENV=test && set DB_FILE=:memory: && npx vitest run {{args}} --reporter=verbose
