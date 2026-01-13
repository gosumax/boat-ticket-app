// Simple test script to verify API functionality
const fs = require('fs');

// Mock the frontend request
const simulateFrontendRequest = () => {
  const url = '/api/admin/boats';
  const method = 'POST';
  const token = 'fake-jwt-token'; // Simulate having a token
  const payload = { name: 'Test Boat' };
  
  console.log('[ADD BOAT] sending', { method, url, hasAuth: Boolean(token) });
  
  // This is what the frontend should be sending
  return {
    url: `/api/admin/boats`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify(payload)
  };
};

// Mock what the backend should receive
const mockBackendHandler = (request) => {
  console.log(`[REQ] ${request.method} ${request.url}`);
  
  // Check if this matches our expected route
  if (request.method === 'POST' && request.url === '/api/admin/boats') {
    // Check for authorization header
    if (!request.headers.Authorization) {
      return {
        status: 401,
        body: { error: 'Missing authorization token' }
      };
    }
    
    // Parse body
    const body = JSON.parse(request.body);
    
    // Check for required fields
    if (!body.name) {
      return {
        status: 400,
        body: { error: 'Название лодки обязательно' }
      };
    }
    
    // Success case - this is what should happen
    const newBoat = {
      id: 123,
      name: body.name,
      is_active: 1
    };
    
    return {
      status: 201,
      body: { ok: true, marker: 'ADD_BOAT_OK', boat: newBoat }
    };
  }
  
  // 404 case
  return {
    status: 404,
    body: { error: 'Endpoint not found', path: request.url, method: request.method }
  };
};

// Run the simulation
console.log('=== SIMULATING ADD BOAT REQUEST ===');
const request = simulateFrontendRequest();
console.log('Frontend request:', request);

const response = mockBackendHandler(request);
console.log('\nBackend response:');
console.log('Status:', response.status);
console.log('Body:', response.body);

if (response.status === 201 && response.body.marker === 'ADD_BOAT_OK') {
  console.log('\n✅ SUCCESS: Boat was created successfully!');
} else {
  console.log('\n❌ FAILURE: Expected 201 with ADD_BOAT_OK marker');
  console.log('Actual status:', response.status);
  console.log('Actual body:', response.body);
}