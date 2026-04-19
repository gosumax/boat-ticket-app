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
import {
  createTelegramBotApiNotificationDeliveryAdapter,
  createTelegramPersistenceContext,
} from './telegram/index.js';
import { createTelegramWebhookRouter } from './telegram/webhook-router.mjs';
import { createTelegramMiniAppRouter } from './telegram/mini-app-router.mjs';
import { createTelegramMiniAppFrontendRouter } from './telegram/mini-app-frontend-router.mjs';
import { createTelegramSellerRouter } from './telegram/seller-router.mjs';
import { createTelegramOwnerRouter } from './telegram/owner-router.mjs';
import { createTelegramAdminRouter } from './telegram/admin-router.mjs';
import {
  buildTelegramRuntimeStartupValidation,
  resolveTelegramRuntimeConfig,
} from './telegram/runtime-config.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;
const telegramRuntimeConfig = resolveTelegramRuntimeConfig({ env: process.env });
const telegramStartupValidation =
  buildTelegramRuntimeStartupValidation(telegramRuntimeConfig);
if (process.env.NODE_ENV !== 'test') {
  if (telegramStartupValidation.validation_state === 'ready_for_live_test_bot') {
    console.log('[TELEGRAM_RUNTIME] startup validation: ready_for_live_test_bot');
  } else if (
    telegramStartupValidation.validation_state === 'invalid_runtime_config'
  ) {
    console.error(
      `[TELEGRAM_RUNTIME] startup validation: invalid_runtime_config invalid_reasons=${telegramStartupValidation.invalid_reasons.join(
        ','
      ) || 'none'}`
    );
  } else {
    console.warn(
      `[TELEGRAM_RUNTIME] startup validation: not_ready_missing_required_config missing_required=${telegramStartupValidation.missing_required_settings.join(
        ','
      ) || 'none'}`
    );
  }
}
const telegramNotificationDeliveryAdapter =
  createTelegramBotApiNotificationDeliveryAdapter({
    botToken: telegramRuntimeConfig.telegram_bot_token,
  });
const telegramContext = createTelegramPersistenceContext(db, {
  notificationDeliveryAdapter: telegramNotificationDeliveryAdapter,
});

app.use(express.json());
app.use(
  '/api/telegram',
  createTelegramWebhookRouter({
    telegramContext,
    telegramRuntimeConfig,
    telegramWebhookSecretToken: telegramRuntimeConfig.telegram_webhook_secret_token,
  })
);
app.use(
  '/api/telegram',
  createTelegramMiniAppRouter({
    telegramContext,
    telegramRuntimeConfig,
  })
);
app.use(createTelegramMiniAppFrontendRouter());
app.use('/api/telegram/seller', authenticateToken, createTelegramSellerRouter({ telegramContext }));
app.use('/api/telegram/owner', authenticateToken, canOwnerAccess, createTelegramOwnerRouter({ telegramContext }));
app.use('/api/telegram/admin', authenticateToken, createTelegramAdminRouter({ telegramContext }));

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
