// Start server
const { spawn } = require('child_process');
const path = require('path');

// Use __dirname which should resolve correctly
const serverPath = path.join(__dirname, 'server', 'index.js');

console.log('Starting server from:', serverPath);

const server = spawn('node', [serverPath], {
  stdio: 'inherit',
  cwd: __dirname
});

server.on('error', (err) => {
  console.error('Failed to start server:', err);
});
