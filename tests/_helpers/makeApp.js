// makeApp.js — creates Express app for testing WITHOUT starting HTTP server
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function makeApp() {
  // Set test DB path BEFORE importing server modules
  const testDbPath = path.join(__dirname, '..', '..', '_testdata', 'test.sqlite');
  process.env.DB_FILE = testDbPath;
  process.env.NODE_ENV = 'test'; // Disable auto-migrations
  
  // Dynamic import to ensure DB_FILE_TEST is set before db.js initializes
  const express = (await import('express')).default;
  const sellingRoutes = (await import('../../server/selling.mjs')).default;
  const authRoutes = (await import('../../server/auth.js')).default;
  const { authenticateToken, canOwnerAccess, canDispatchManageSlots } = await import('../../server/auth.js');
  const tripTemplateRoutes = (await import('../../server/trip-templates.mjs')).default;
  const scheduleTemplateItemRoutes = (await import('../../server/schedule-template-items.mjs')).default;
  const adminRoutes = (await import('../../server/admin.mjs')).default;
  const ownerRouter = (await import('../../server/owner.mjs')).default;
  const dispatcherShiftLedgerRoutes = (await import('../../server/dispatcher-shift-ledger.mjs')).default;
  const dispatcherShiftRouter = (await import('../../server/dispatcher-shift.mjs')).default;
  
  const app = express();
  app.use(express.json());
  
  // Mount routes (same as server/index.js)
  app.use('/api/selling', sellingRoutes);
  app.use('/api/auth', authRoutes);
  app.use('/api/dispatcher', dispatcherShiftLedgerRoutes);
  app.use('/api/dispatcher/shift-ledger', dispatcherShiftLedgerRoutes);
  app.use('/api/dispatcher/shift', authenticateToken, canDispatchManageSlots, dispatcherShiftRouter);
  app.use('/api/selling', tripTemplateRoutes);
  app.use('/api/selling', scheduleTemplateItemRoutes);
  app.use('/api/admin', authenticateToken, adminRoutes);
  app.use('/api/owner', authenticateToken, canOwnerAccess, ownerRouter);
  
  return app;
}
