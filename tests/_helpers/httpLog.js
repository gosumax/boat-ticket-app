// HTTP request logger for integration tests
// Tracks: METHOD PATH status duration

export const httpLog = {
  requests: [],
  
  clear() {
    this.requests = [];
  },
  
  log(method, path, status, duration) {
    this.requests.push({ method, path, status, duration });
  },
  
  getSummary() {
    const endpointStats = {};
    
    this.requests.forEach(req => {
      const key = `${req.method} ${req.path}`;
      if (!endpointStats[key]) {
        endpointStats[key] = {
          calls: 0,
          totalDuration: 0,
          failures: 0,
          statuses: []
        };
      }
      
      endpointStats[key].calls++;
      endpointStats[key].totalDuration += req.duration;
      endpointStats[key].statuses.push(req.status);
      if (req.status >= 400) {
        endpointStats[key].failures++;
      }
    });
    
    const summary = Object.entries(endpointStats).map(([endpoint, stats]) => ({
      endpoint,
      calls: stats.calls,
      avgMs: Math.round(stats.totalDuration / stats.calls),
      failures: stats.failures,
      statuses: [...new Set(stats.statuses)].join(',')
    }));
    
    // Sort by calls descending
    summary.sort((a, b) => b.calls - a.calls);
    
    // Find slowest 10 requests
    const slowest = [...this.requests]
      .sort((a, b) => b.duration - a.duration)
      .slice(0, 10)
      .map(r => ({
        endpoint: `${r.method} ${r.path}`,
        duration: r.duration,
        status: r.status
      }));
    
    return {
      totalRequests: this.requests.length,
      endpoints: summary,
      slowest
    };
  },
  
  printSummary() {
    const summary = this.getSummary();
    
    console.log('\n========================================');
    console.log('ENDPOINT TRACE SUMMARY');
    console.log('========================================');
    console.log(`Total HTTP requests: ${summary.totalRequests}\n`);
    
    console.log('Per-endpoint statistics:');
    console.log('| Endpoint | Calls | Avg ms | Fail count | Statuses |');
    console.log('|----------|-------|--------|------------|----------|');
    summary.endpoints.forEach(e => {
      console.log(`| ${e.endpoint.padEnd(40)} | ${String(e.calls).padEnd(5)} | ${String(e.avgMs).padEnd(6)} | ${String(e.failures).padEnd(10)} | ${e.statuses} |`);
    });
    
    console.log('\nSlowest 10 requests:');
    console.log('| Endpoint | Duration (ms) | Status |');
    console.log('|----------|---------------|--------|');
    summary.slowest.forEach(r => {
      console.log(`| ${r.endpoint.padEnd(40)} | ${String(r.duration).padEnd(13)} | ${r.status} |`);
    });
    
    console.log('========================================\n');
  }
};

// Wrapper for supertest request to add logging
export function loggedRequest(app, method, path) {
  const request = require('supertest');
  const startTime = Date.now();
  
  return request(app)[method.toLowerCase()](path)
    .then(res => {
      const duration = Date.now() - startTime;
      httpLog.log(method, path, res.status, duration);
      return res;
    })
    .catch(err => {
      const duration = Date.now() - startTime;
      const status = err.status || 500;
      httpLog.log(method, path, status, duration);
      throw err;
    });
}
