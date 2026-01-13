import express from 'express';

const app = express();
const PORT = process.env.PORT || 3001;

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ ok: true });
});

app.listen(PORT, 'localhost', () => {
  console.log(`Minimal server listening on http://localhost:${PORT}`);
  console.log('Health endpoint available at /api/health');
});