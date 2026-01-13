// Simple script to trigger database migrations
import('./server/db.js').then(() => {
  console.log('Database initialized successfully');
  process.exit(0);
}).catch((error) => {
  console.error('Database initialization failed:', error);
  process.exit(1);
});