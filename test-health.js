// Test the health endpoint
// Using node's built-in fetch which is available in newer Node.js versions
// For HTTP requests, fetch works the same as for HTTPS

async function testHealth() {
  try {
    // Using node's built-in fetch (available in Node 18+)
    const response = await fetch('http://localhost:3001/api/admin/health');
    const data = await response.json();
    console.log('Health check response:', JSON.stringify(data, null, 2));
  } catch (error) {
    console.error('Error testing health endpoint:', error.message);
  }
}

testHealth();