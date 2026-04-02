// PATCHED index.js — dispatcher shift deposit route added

import express from 'express';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import sellingRoutes from './selling.mjs';
import authRoutes, { authenticateToken, canOwnerAccess, canDispatchManageSlots } from './auth.js';
import tripTemplateRoutes from './trip-templates.mjs';
import scheduleTemplateItemRoutes from './schedule-template-items.mjs';
import adminRoutes from './admin.mjs';
import ownerRouter from './owner.mjs';
import db from './db.js';
import { startAutoCompleteTrips } from './auto-complete-trips.mjs';
import dispatcherShiftLedgerRoutes from './dispatcher-shift-ledger.mjs';
import dispatcherShiftRouter from './dispatcher-shift.mjs'; // <<< ADDED
import { backfillAllLegacyShiftClosures } from './shift-closure-backfill.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;

app.use(express.json());

app.use('/api/selling', sellingRoutes);
app.use('/api/auth', authRoutes);

// existing dispatcher ledger routes
app.use('/api/dispatcher', dispatcherShiftLedgerRoutes);

// alias mount for UI path: /api/dispatcher/shift-ledger/*
app.use('/api/dispatcher/shift-ledger', dispatcherShiftLedgerRoutes);

// >>> NEW: shift deposit route (dispatcher-only)
app.use('/api/dispatcher/shift', authenticateToken, canDispatchManageSlots, dispatcherShiftRouter);

app.use('/api/selling', tripTemplateRoutes);
app.use('/api/selling', scheduleTemplateItemRoutes);
app.use('/api/admin', authenticateToken, adminRoutes);
app.use('/api/owner', authenticateToken, canOwnerAccess, ownerRouter);

try {
  const backfillResult = backfillAllLegacyShiftClosures(db, {
    snapshotSource: 'snapshot_backfill',
  });
  if (Number(backfillResult?.scanned_days || 0) > 0) {
    console.log(
      `[SHIFT_CLOSURES_BACKFILL] scanned_days=${backfillResult.scanned_days} backfilled_days=${backfillResult.backfilled_days}`
    );
  }
} catch (error) {
  console.error('[SHIFT_CLOSURES_BACKFILL] startup error:', error?.message || error);
}

// Export app for testing (imported without starting server)
export { app };

// Only start server when run directly (not imported)
// Use import.meta.resolve for better Windows compatibility
const isMainModule = process.argv[1] && import.meta.url.includes('server/index.js');
if (isMainModule) {
  app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
    try { startAutoCompleteTrips(); } catch {}
  });
}
