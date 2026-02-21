// test-runner.mjs — Run vitest tests via Node.js API
import { runVitest } from 'vitest/node';

const result = await runVitest({
  command: 'run',
  filter: [
    'tests/owner/20-owner-settings-contract.test.js',
    'tests/owner/21-motivation-day-snapshot.test.js',
    'tests/owner/22-motivation-mode-points-gating.test.js',
    'tests/owner/23-adaptive-recalc-parameters.test.js',
    'tests/owner/24-streak-calibration.test.js'
  ],
  reporter: 'verbose'
});

process.exit(result ? 0 : 1);
