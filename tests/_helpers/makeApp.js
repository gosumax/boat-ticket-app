// makeApp.js — creates Express app for testing WITHOUT starting HTTP server
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function makeApp() {
  // Set test DB path BEFORE importing server modules
  const testDbPath = process.env.TEST_DB_FILE || path.join(__dirname, '..', '..', '_testdata', 'test.sqlite');
  process.env.DB_FILE = testDbPath;
  process.env.NODE_ENV = 'test'; // Disable auto-migrations
  
  // Dynamic import to ensure DB_FILE is set before db.js initializes
  const express = (await import('express')).default;
  const sellingRoutes = (await import('../../server/selling.mjs')).default;
  const authRoutes = (await import('../../server/auth.js')).default;
  const { authenticateToken, canOwnerAccess, canDispatchManageSlots } = await import('../../server/auth.js');
  const tripTemplateRoutes = (await import('../../server/trip-templates.mjs')).default;
  const scheduleTemplateItemRoutes = (await import('../../server/schedule-template-items.mjs')).default;
  const adminRoutes = (await import('../../server/admin.mjs')).default;
  const ownerRouter = (await import('../../server/owner.mjs')).default;
  const db = (await import('../../server/db.js')).default;
  const {
    createTelegramBotApiNotificationDeliveryAdapter,
    createTelegramPersistenceContext,
  } = await import('../../server/telegram/index.js');
  const { createTelegramWebhookRouter } = await import('../../server/telegram/webhook-router.mjs');
  const { createTelegramMiniAppRouter } = await import('../../server/telegram/mini-app-router.mjs');
  const {
    createTelegramMiniAppFrontendRouter,
  } = await import('../../server/telegram/mini-app-frontend-router.mjs');
  const { createTelegramSellerRouter } = await import('../../server/telegram/seller-router.mjs');
  const { createTelegramOwnerRouter } = await import('../../server/telegram/owner-router.mjs');
  const {
    resolveTelegramRuntimeConfig,
  } = await import('../../server/telegram/runtime-config.mjs');
  const dispatcherShiftLedgerRoutes = (await import('../../server/dispatcher-shift-ledger.mjs')).default;
  const dispatcherShiftRouter = (await import('../../server/dispatcher-shift.mjs')).default;
  const telegramRuntimeConfig = resolveTelegramRuntimeConfig({ env: process.env });
  const telegramNotificationDeliveryAdapter =
    createTelegramBotApiNotificationDeliveryAdapter({
      botToken: telegramRuntimeConfig.telegram_bot_token,
    });
  const telegramContext = createTelegramPersistenceContext(db, {
    notificationDeliveryAdapter: telegramNotificationDeliveryAdapter,
  });
  
  const app = express();
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
