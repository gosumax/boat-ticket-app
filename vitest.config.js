import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.test.js'],
    globals: false,
    environment: 'node',
    testTimeout: 30000,
    hookTimeout: 30000,
    reporters: ['verbose'],
    // Setup files run in each test context BEFORE test files
    setupFiles: ['./tests/setup-env.js'],
    // Ensure each test file runs in isolation (no parallel for SQLite)
    fileParallelism: false,
  },
  // Explicitly set root to current directory
  root: '.',
})
