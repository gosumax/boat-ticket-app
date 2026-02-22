// Bootstrap server from current working directory
import('./server/index.js').catch(err => {
  console.error('Failed to start server:', err.message);
  process.exit(1);
});
