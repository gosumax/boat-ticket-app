// Run dispatcher tests using vitest/node API with explicit path
import { runVitest } from 'vitest/node';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Set environment before any imports
process.env.NODE_ENV = 'test';
process.env.DB_FILE = ':memory:';

async function main() {
  const result = await runVitest({
    root: __dirname,
    include: ['tests/dispatcher/**/*.test.js'],
    reporters: ['verbose'],
  });
  
  process.exit(result ? 0 : 1);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
