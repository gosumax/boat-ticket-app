// Test environment setup - runs BEFORE each test file
// CRITICAL: This must be the FIRST thing that runs to set DB_FILE
// before any server modules are imported

// Force in-memory database for all tests
process.env.DB_FILE = ':memory:';
process.env.NODE_ENV = 'test';

console.log('[SETUP_ENV] DB_FILE =', process.env.DB_FILE);
console.log('[SETUP_ENV] NODE_ENV =', process.env.NODE_ENV);
