import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import sellingRoutes from './selling.mjs';
import authRoutes, { authenticateToken, canOwnerAccess } from './auth.js';
import tripTemplateRoutes from './trip-templates.mjs';
// import scheduleTemplateRoutes from './schedule-templates.mjs';  // Old approach, replaced by schedule-template-items.mjs
import scheduleTemplateItemRoutes from './schedule-template-items.mjs';
import adminRoutes from './admin.mjs';
import ownerRouter from './owner.mjs';
import db from './db.js';
import fs from 'fs';

console.log('=== SERVER ENTRY LOADED ===', import.meta.url);

// Import and run migration script on startup to ensure proper schema
try {
  // Attempt to run migration, but don't crash if it fails
  const migrationPath = '../migrate-schedule-templates.js';
  
  // Check if migration file exists before importing
  import('fs').then(fs => {
    if (fs.existsSync(migrationPath)) {
      import(migrationPath).catch(migrationError => {
        console.warn('Warning: Schedule templates migration failed:', migrationError.message);
        console.warn('Continuing startup without migration...');
      });
    } else {
      console.log('Migration file not found, skipping...');
    }
  }).catch(fsError => {
    console.warn('Warning: Could not check migration file:', fsError.message);
    console.warn('Continuing startup...');
  });
} catch (error) {
  console.warn('Warning: Could not run schedule templates migration:', error.message);
  console.warn('Continuing startup without migration...');
}

// Startup health-check and auto-repair
try {
  console.log('Running startup health-check and auto-repair...');
  
  // Count bad generated slots
  const badGeneratedSlots = db.prepare(
    'SELECT id, schedule_template_id, price_adult, price_child, price_teen, capacity, duration_minutes FROM generated_slots WHERE price_adult <= 0 OR capacity <= 0 OR duration_minutes <= 0'
  ).all();
  
  let fixedCount = 0;
  
  if (badGeneratedSlots.length > 0) {
    console.log(`Found ${badGeneratedSlots.length} bad generated slots, attempting auto-repair...`);
    
    for (const slot of badGeneratedSlots) {
      if (slot.schedule_template_id) {
        // Try to backfill from the template
        const template = db.prepare(
          'SELECT price_adult, price_child, price_teen, capacity, duration_minutes FROM schedule_template_items WHERE id = ?'
        ).get(slot.schedule_template_id);
        
        if (template) {
          // Update the slot with template data
          db.prepare(
            `UPDATE generated_slots 
             SET price_adult = ?, price_child = ?, price_teen = ?, capacity = ?, duration_minutes = ? 
             WHERE id = ?`
          ).run(
            template.price_adult, template.price_child, template.price_teen,
            template.capacity, template.duration_minutes, slot.id
          );
          fixedCount++;
          console.log(`Fixed slot ${slot.id} with template data`);
        }
      }
    }
    
    console.log(`Auto-repair completed: ${fixedCount} slots fixed`);
  } else {
    console.log('No bad generated slots found');
  }
  
  // Also check for bad manual slots
  const badManualSlots = db.prepare(
    'SELECT id, price_adult, price_child, price_teen, capacity, duration_minutes FROM boat_slots WHERE (price_adult IS NOT NULL AND price_adult <= 0) OR capacity <= 0 OR duration_minutes <= 0'
  ).all();
  
  if (badManualSlots.length > 0) {
    console.log(`Found ${badManualSlots.length} bad manual slots (these require manual intervention)`);
    badManualSlots.forEach(slot => {
      console.log(`  Slot ${slot.id}: price_adult=${slot.price_adult}, capacity=${slot.capacity}, duration=${slot.duration_minutes}`);
    });
  } else {
    console.log('No bad manual slots found');
  }
  
  console.log('Startup health-check completed');
} catch (error) {
  console.error('Startup health-check failed:', error.message);
  console.warn('Continuing startup, but database may have integrity issues');
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(express.json());

// Routes
app.use('/api/selling', sellingRoutes);
console.log('[ROUTES] Mounted selling routes at /api/selling');

app.use('/api/auth', authRoutes);
console.log('[ROUTES] Mounted auth routes at /api/auth');

app.use('/api/selling', tripTemplateRoutes);
console.log('[ROUTES] Mounted trip template routes at /api/selling');

// app.use('/api/selling', scheduleTemplateRoutes);  // Old approach, replaced by schedule-template-items.mjs
// console.log('[ROUTES] Mounted schedule template routes at /api/selling');

app.use('/api/selling', scheduleTemplateItemRoutes);
console.log('[ROUTES] Mounted schedule template items routes at /api/selling');

// Admin routes
// IMPORTANT:
// Admin panel expects GET /api/users?role=seller
// This is an alias for admin-only user listing.
// Do NOT remove without updating frontend.

app.use('/api/admin', authenticateToken, adminRoutes);
console.log('[ROUTES] Mounted admin routes at /api/admin');

// Owner routes - accessible only at /api/owner/*
app.use('/api/owner', ownerRouter);
console.log('[ROUTES] Mounted owner routes at /api/owner');

// Alias used by admin panel frontend: GET /api/users?role=seller
app.get('/api/users', authenticateToken, (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Access denied' });
    }

    const role = req.query.role;

    let sql = `
      SELECT id,
             username,
             username AS login,
             role,
             is_active
      FROM users
      WHERE is_active = 1
    `;

    const params = [];

    if (role) {
      sql += ' AND role = ?';
      params.push(role);
    }

    sql += ' ORDER BY role, username';

    const users = db.prepare(sql).all(...params);
    res.json(users);

  } catch (e) {
    console.error('[API] /api/users failed:', e);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// PATCH /api/users/:id - Update user (specifically for toggling is_active)
app.patch('/api/users/:id', authenticateToken, (req, res) => {
  try {
    // Check if user has admin role
    if (req.user.role !== 'admin') {
      return res.status(403).json({ 
        error: 'Недостаточно прав' 
      });
    }
    
    const { id } = req.params;
    const { is_active } = req.body;
    
    // Validate the is_active field
    if (typeof is_active !== 'number' || (is_active !== 0 && is_active !== 1)) {
      return res.status(400).json({ error: 'is_active must be 0 or 1' });
    }
    
    // Update the user's is_active status
    const result = db.prepare('UPDATE users SET is_active = ? WHERE id = ?').run(is_active, id);
    
    if (result.changes === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Return the updated user
    const updatedUser = db.prepare('SELECT id, username, role, is_active FROM users WHERE id = ?').get(id);
    
    res.json(updatedUser);
  } catch (error) {
    console.error('Error updating user:', error);
    res.status(500).json({ error: 'Failed to update user' });
  }
});

console.log('[ROUTES] Mounted PATCH /api/users/:id for user updates');
console.log('[ROUTES] Mounted users alias at /api/users');

// Clear all trips route (legacy route for backward compatibility)
app.post('/api/admin/trips/clear-all', authenticateToken, (req, res) => {
  try {
    // Check if user has admin role
    if (req.user.role !== 'admin') {
      return res.status(403).json({ 
        ok: false, 
        error: 'Access denied. Admin or owner role required.' 
      });
    }
    
    // Wrap in transaction for safety
    const transaction = db.transaction(() => {
      // Count trips before deletion
      const ticketsCount = db.prepare('SELECT COUNT(*) as count FROM tickets').get().count;
      const presalesCount = db.prepare('SELECT COUNT(*) as count FROM presales').get().count;
      const generatedSlotsCount = db.prepare('SELECT COUNT(*) as count FROM generated_slots').get().count;
      const boatSlotsCount = db.prepare('SELECT COUNT(*) as count FROM boat_slots').get().count;
      
      // Delete in correct order to respect foreign key constraints
      // 1. Delete tickets first (they reference both presales and boat_slots)
      const ticketsDeleteResult = db.prepare('DELETE FROM tickets').run();
      
      // 2. Delete presales (they reference boat_slots)
      const presalesDeleteResult = db.prepare('DELETE FROM presales').run();
      
      // 3. Delete generated slots (they reference boats and schedule_templates)
      const generatedDeleteResult = db.prepare('DELETE FROM generated_slots').run();
      
      // 4. Delete manual boat slots (they reference boats)
      const boatSlotsDeleteResult = db.prepare('DELETE FROM boat_slots').run();
      
      return {
        tickets_deleted: ticketsDeleteResult.changes,
        presales_deleted: presalesDeleteResult.changes,
        generated_slots_deleted: generatedDeleteResult.changes,
        boat_slots_deleted: boatSlotsDeleteResult.changes
      };
    });
    
    const result = transaction();
    
    res.json({
      ok: true,
      deleted: {
        tickets: result.tickets_deleted,
        presales: result.presales_deleted,
        generated_slots: result.generated_slots_deleted,
        boat_slots: result.boat_slots_deleted
      }
    });
    
  } catch (error) {
    console.error('Clear all trips error:', error);
    res.status(500).json({ ok: false, error: 'Failed to clear trips' });
  }
});

// Health check route
app.get('/api/admin/health', (req, res) => {
  try {
    // Count total generated slots
    const generatedSlotsTotal = db.prepare('SELECT COUNT(*) as count FROM generated_slots').get().count;
    
    // Count bad generated slots
    const generatedSlotsBad = db.prepare(
      'SELECT COUNT(*) as count FROM generated_slots WHERE price_adult <= 0 OR capacity <= 0 OR duration_minutes <= 0'
    ).get().count;
    
    // Count total manual slots
    const boatSlotsTotal = db.prepare('SELECT COUNT(*) as count FROM boat_slots').get().count;
    
    // Count bad manual slots
    const boatSlotsBad = db.prepare(
      'SELECT COUNT(*) as count FROM boat_slots WHERE (price_adult IS NOT NULL AND price_adult <= 0) OR capacity <= 0 OR duration_minutes <= 0'
    ).get().count;
    
    const healthStatus = {
      ok: generatedSlotsBad === 0 && boatSlotsBad === 0,
      dbFile: db.name || 'database.sqlite',
      counts: {
        generated_slots_total: generatedSlotsTotal,
        generated_slots_bad: generatedSlotsBad,
        boat_slots_total: boatSlotsTotal,
        boat_slots_bad: boatSlotsBad
      },
      lastRepair: {
        ranAt: new Date().toISOString(),
        fixedCount: 0, // This would be tracked in a real implementation
        remainingBadCount: generatedSlotsBad + boatSlotsBad
      }
    };
    
    res.json(healthStatus);
  } catch (error) {
    console.error('Health check error:', error);
    res.status(500).json({ ok: false, error: 'Health check failed' });
  }
});

// Test route
app.get('/api/test', (req, res) => {
  res.json({ message: 'Server is running', timestamp: new Date().toISOString() });
});

// Start server
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
  console.log(`Database file: ${db.name || 'database.sqlite'}`);
  console.log('Available endpoints:');
  console.log('  GET  /api/test - Test endpoint');
  console.log('  All /api/selling routes from selling.mjs');
  console.log('  All /api/auth routes from auth.js');
  console.log('  All /api/admin routes from admin.mjs (admin/owner role required)');
  console.log('  All /api/selling/trip-templates routes from trip-templates.mjs');
  console.log('  All /api/selling/schedule-templates routes from schedule-templates.mjs');
  console.log('  All /api/selling/schedule-template-items routes from schedule-template-items.mjs');
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down gracefully...');
  db.close();
  process.exit(0);
});
