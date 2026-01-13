import express from 'express';
import db from './db.js';
import { authenticateToken, isAdmin } from './auth.js';

const router = express.Router();

// Middleware to check if user is admin or owner
const requireAdminRole = (req, res, next) => {
  if (req.user.role !== 'admin' && req.user.role !== 'owner') {
    return res.status(403).json({ 
      error: 'Требуется доступ администратора' 
    });
  }
  next();
};

// GET /api/admin/boats - Get all boats
router.get('/boats', authenticateToken, requireAdminRole, (req, res) => {
  try {
    const showArchived = req.query.showArchived === 'true';
    
    let query;
    let params = [];
    
    if (showArchived) {
      // Show all boats (active and archived)
      query = 'SELECT id, name, type, is_active FROM boats ORDER BY is_active DESC, name';
    } else {
      // Show only active boats by default
      query = 'SELECT id, name, type, is_active FROM boats WHERE is_active = 1 ORDER BY name';
    }
    
    const boats = db.prepare(query).all();
    
    res.json(boats);
  } catch (error) {
    console.error('Error fetching boats:', error);
    res.status(500).json({ error: 'Failed to fetch boats' });
  }
});

// GET /api/admin/boats/:id - Get a specific boat
router.get('/boats/:id', authenticateToken, requireAdminRole, (req, res) => {
  try {
    const { id } = req.params;
    const boat = db.prepare('SELECT id, name, type, is_active FROM boats WHERE id = ?').get(id);
    
    if (!boat) {
      return res.status(404).json({ error: 'Boat not found' });
    }
    
    res.json(boat);
  } catch (error) {
    console.error('Error fetching boat:', error);
    res.status(500).json({ error: 'Failed to fetch boat' });
  }
});

// POST /api/admin/boats - Create a new boat
router.post('/boats', authenticateToken, requireAdminRole, (req, res) => {
  try {
    const { name, type } = req.body;
    
    if (!name || !type) {
      return res.status(400).json({ error: 'Name and type are required' });
    }
    
    // Validate boat type
    const validTypes = ['speed', 'cruise', 'banana'];
    if (!validTypes.includes(type)) {
      return res.status(400).json({ error: 'Invalid boat type. Must be "speed", "cruise", or "banana"' });
    }
    
    const result = db.prepare('INSERT INTO boats (name, type, is_active) VALUES (?, ?, 1)').run(name, type);
    
    const newBoat = db.prepare('SELECT id, name, type, is_active FROM boats WHERE id = ?').get(result.lastInsertRowid);
    
    res.status(201).json({ boat: newBoat });
  } catch (error) {
    console.error('Error creating boat:', error);
    res.status(500).json({ error: 'Failed to create boat' });
  }
});

// PUT /api/admin/boats/:id - Update a boat
router.put('/boats/:id', authenticateToken, requireAdminRole, (req, res) => {
  try {
    const { id } = req.params;
    const { name, type } = req.body;
    
    if (!name || !type) {
      return res.status(400).json({ error: 'Name and type are required' });
    }
    
    // Validate boat type
    const validTypes = ['speed', 'cruise', 'banana'];
    if (!validTypes.includes(type)) {
      return res.status(400).json({ error: 'Invalid boat type. Must be "speed", "cruise", or "banana"' });
    }
    
    const result = db.prepare('UPDATE boats SET name = ?, type = ? WHERE id = ?').run(name, type, id);
    
    if (result.changes === 0) {
      return res.status(404).json({ error: 'Boat not found' });
    }
    
    const updatedBoat = db.prepare('SELECT id, name, type, is_active FROM boats WHERE id = ?').get(id);
    
    res.json({ boat: updatedBoat });
  } catch (error) {
    console.error('Error updating boat:', error);
    res.status(500).json({ error: 'Failed to update boat' });
  }
});

// PATCH /api/admin/boats/:id/active - Toggle boat active status
router.patch('/boats/:id/active', authenticateToken, requireAdminRole, (req, res) => {
  try {
    const { id } = req.params;
    const { is_active } = req.body;
    
    if (typeof is_active !== 'number' || (is_active !== 0 && is_active !== 1)) {
      return res.status(400).json({ error: 'is_active must be 0 or 1' });
    }
    
    const result = db.prepare('UPDATE boats SET is_active = ? WHERE id = ?').run(is_active, id);
    
    if (result.changes === 0) {
      return res.status(404).json({ error: 'Boat not found' });
    }
    
    const updatedBoat = db.prepare('SELECT id, name, type, is_active FROM boats WHERE id = ?').get(id);
    
    res.json({ boat: updatedBoat });
  } catch (error) {
    console.error('Error updating boat status:', error);
    res.status(500).json({ error: 'Failed to update boat status' });
  }
});

// DELETE /api/admin/boats/:id - Delete a boat (soft delete by setting is_active to 0)
router.delete('/boats/:id', authenticateToken, requireAdminRole, (req, res) => {
  try {
    const { id } = req.params;
    
    // First check if boat has any dependencies (slots, etc.)
    const boatSlots = db.prepare('SELECT COUNT(*) as count FROM boat_slots WHERE boat_id = ?').get(id);
    const generatedSlots = db.prepare('SELECT COUNT(*) as count FROM generated_slots WHERE boat_id = ?').get(id);
    
    const totalDependencies = boatSlots.count + generatedSlots.count;
    
    if (totalDependencies > 0) {
      // Soft delete: set is_active to 0 instead of removing the boat
      const updateResult = db.prepare('UPDATE boats SET is_active = 0 WHERE id = ?').run(id);
      
      if (updateResult.changes === 0) {
        return res.status(404).json({ error: 'Boat not found' });
      }
      
      return res.json({ 
        ok: true, 
        message: 'Boat archived (dependencies exist)',
        slots: boatSlots.count,
        generated_slots: generatedSlots.count
      });
    } else {
      // Hard delete: remove the boat completely
      const deleteResult = db.prepare('DELETE FROM boats WHERE id = ?').run(id);
      
      if (deleteResult.changes === 0) {
        return res.status(404).json({ error: 'Boat not found' });
      }
      
      res.json({ ok: true });
    }
  } catch (error) {
    console.error('Error deleting boat:', error);
    res.status(500).json({ error: 'Failed to delete boat' });
  }
});

// GET /api/admin/boats/:id/slots - Get all slots for a specific boat
router.get('/boats/:id/slots', authenticateToken, requireAdminRole, (req, res) => {
  try {
    const { id } = req.params;
    
    // Check if boat exists
    const boat = db.prepare('SELECT id FROM boats WHERE id = ?').get(id);
    if (!boat) {
      return res.status(404).json({ error: 'Boat not found' });
    }
    
    const slots = db.prepare(`
      SELECT 
        bs.id,
        bs.boat_id,
        bs.time,
        bs.price,
        bs.capacity,
        bs.is_active,
        bs.duration_minutes,
        bs.price_adult,
        bs.price_child,
        bs.price_teen,
        bs.seats_left
      FROM boat_slots bs
      WHERE bs.boat_id = ?
      ORDER BY bs.time
    `).all(id);
    
    res.json(slots);
  } catch (error) {
    console.error('Error fetching boat slots:', error);
    res.status(500).json({ error: 'Failed to fetch boat slots' });
  }
});

// POST /api/admin/boats/:id/slots - Create a new slot for a boat
router.post('/boats/:id/slots', authenticateToken, requireAdminRole, (req, res) => {
  try {
    const { id: boatId } = req.params;
    const { time, price, capacity, duration_minutes, price_adult, price_child, price_teen } = req.body;
    
    // Check if boat exists
    const boat = db.prepare('SELECT id FROM boats WHERE id = ?').get(boatId);
    if (!boat) {
      return res.status(404).json({ error: 'Boat not found' });
    }
    
    if (!time || !capacity) {
      return res.status(400).json({ error: 'Time and capacity are required' });
    }
    
    // Insert the new slot
    const result = db.prepare(`
      INSERT INTO boat_slots 
      (boat_id, time, price, capacity, duration_minutes, price_adult, price_child, price_teen, seats_left, is_active) 
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
    `).run(
      boatId, 
      time, 
      price || 0, 
      capacity, 
      duration_minutes || 60,
      price_adult || null,
      price_child || null,
      price_teen || null,
      capacity // Initialize seats_left with capacity
    );
    
    const newSlot = db.prepare(`
      SELECT 
        id, boat_id, time, price, capacity, is_active, duration_minutes,
        price_adult, price_child, price_teen, seats_left
      FROM boat_slots 
      WHERE id = ?
    `).get(result.lastInsertRowid);
    
    res.status(201).json(newSlot);
  } catch (error) {
    console.error('Error creating boat slot:', error);
    res.status(500).json({ error: 'Failed to create boat slot' });
  }
});

// GET /api/admin/users - Get all users
router.get('/users', authenticateToken, requireAdminRole, (req, res) => {
  try {
    const roleFilter = req.query.role;
    
    let query;
    let params = [];
    
    if (roleFilter) {
      query = 'SELECT id, username, role, is_active FROM users WHERE role = ? ORDER BY username';
      params = [roleFilter];
    } else {
      query = 'SELECT id, username, role, is_active FROM users ORDER BY role, username';
    }
    
    const users = db.prepare(query).all(...params);
    
    res.json(users);
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// POST /api/admin/users - Create a new user
router.post('/users', authenticateToken, requireAdminRole, async (req, res) => {
  try {
    const { username, password, role } = req.body;
    
    if (!username || !password || !role) {
      return res.status(400).json({ error: 'Username, password, and role are required' });
    }
    
    // Check if user already exists
    const existingUser = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
    if (existingUser) {
      return res.status(409).json({ error: 'User already exists' });
    }
    
    // Validate role
    const validRoles = ['seller', 'dispatcher', 'admin'];
    if (!validRoles.includes(role)) {
      return res.status(400).json({ error: 'Invalid role. Must be "seller", "dispatcher", or "admin"' });
    }
    
    // Hash password
    const bcrypt = await import('bcrypt');
    const saltRounds = 10;
    const hashedPassword = await bcrypt.default.hash(password, saltRounds);
    
    const result = db.prepare('INSERT INTO users (username, password_hash, role, is_active) VALUES (?, ?, ?, 1)').run(
      username, 
      hashedPassword, 
      role
    );
    
    const newUser = db.prepare('SELECT id, username, role, is_active FROM users WHERE id = ?').get(result.lastInsertRowid);
    
    res.status(201).json(newUser);
  } catch (error) {
    console.error('Error creating user:', error);
    res.status(500).json({ error: 'Failed to create user' });
  }
});

// PATCH /api/admin/users/:id - Update a user
router.patch('/users/:id', authenticateToken, requireAdminRole, (req, res) => {
  try {
    const { id } = req.params;
    const { is_active } = req.body;
    
    if (typeof is_active !== 'number' || (is_active !== 0 && is_active !== 1)) {
      return res.status(400).json({ error: 'is_active must be 0 or 1' });
    }
    
    const result = db.prepare('UPDATE users SET is_active = ? WHERE id = ?').run(is_active, id);
    
    if (result.changes === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const updatedUser = db.prepare('SELECT id, username, role, is_active FROM users WHERE id = ?').get(id);
    
    res.json(updatedUser);
  } catch (error) {
    console.error('Error updating user:', error);
    res.status(500).json({ error: 'Failed to update user' });
  }
});
// Reset user password (admin/owner only)
router.post('/users/:id/reset-password', authenticateToken, requireAdminRole, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { password } = req.body || {};

    if (!Number.isFinite(id)) {
      return res.status(400).json({ error: 'Некорректный id' });
    }
    if (!password || typeof password !== 'string' || password.length < 4) {
      return res.status(400).json({ error: 'Некорректный пароль' });
    }

    // optional: forbid resetting yourself? (можно убрать)
    // if (req.user?.id === id) return res.status(400).json({ error: 'Нельзя менять свой пароль здесь' });

    // Hash password using bcrypt same as login
    const bcrypt = await import('bcrypt');
    const saltRounds = 10;
    const hashedPassword = await bcrypt.default.hash(password, saltRounds);

    const r = db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashedPassword, id);

    if (r.changes === 0) {
      return res.status(404).json({ error: 'Пользователь не найден' });
    }

    return res.json({ ok: true, userId: id });
  } catch (error) {
    console.error('Error resetting password:', error);
    res.status(500).json({ error: 'Failed to reset password' });
  }
});

// DELETE /api/admin/users/:id - Soft delete user (set is_active to 0)
router.delete('/users/:id', authenticateToken, requireAdminRole, (req, res) => {
  try {
    const id = Number(req.params.id);

    if (!Number.isFinite(id)) {
      return res.status(400).json({ ok: false, error: 'Invalid user id' });
    }

    if (req.user.id === id) {
      return res.status(400).json({ ok: false, error: 'Cannot delete yourself' });
    }

    const result = db.prepare(
      'UPDATE users SET is_active = 0 WHERE id = ?'
    ).run(id);

    if (result.changes === 0) {
      return res.status(404).json({ ok: false, error: 'User not found' });
    }

    res.json({ ok: true, userId: id });
  } catch (error) {
    console.error('Error deleting user:', error);
    res.status(500).json({ ok: false, error: 'Failed to delete user' });
  }
});


// GET /api/admin/stats - Get dashboard statistics
router.get('/stats', authenticateToken, requireAdminRole, (req, res) => {
  try {
    // Get today's date for filtering
    const today = new Date().toISOString().split('T')[0];
    
    // Calculate total revenue from tickets sold today
    const revenueResult = db.prepare(`
      SELECT SUM(t.price) as total_revenue
      FROM tickets t
      LEFT JOIN boat_slots bs ON t.boat_slot_id = bs.id
      LEFT JOIN generated_slots gs ON t.boat_slot_id = gs.id
      WHERE DATE(t.created_at) = ? AND t.status IN ('ACTIVE', 'USED')
    `).get(today);
    
    const totalRevenue = revenueResult.total_revenue || 0;
    
    // Calculate total tickets sold today
    const ticketsSoldResult = db.prepare(`
      SELECT COUNT(*) as total_tickets
      FROM tickets t
      WHERE DATE(t.created_at) = ? AND t.status IN ('ACTIVE', 'USED')
    `).get(today);
    
    const totalTicketsSold = ticketsSoldResult.total_tickets || 0;
    
    // Calculate speed and cruise trip counts
    const speedTripsResult = db.prepare(`
      SELECT COUNT(*) as count
      FROM boat_slots bs
      JOIN boats b ON bs.boat_id = b.id
      WHERE b.type = 'speed' AND bs.time > ?
    `).get(today + ' 00:00:00');
    
    const cruiseTripsResult = db.prepare(`
      SELECT COUNT(*) as count
      FROM boat_slots bs
      JOIN boats b ON bs.boat_id = b.id
      WHERE b.type = 'cruise' AND bs.time > ?
    `).get(today + ' 00:00:00');
    
    const speedTrips = speedTripsResult.count || 0;
    const cruiseTrips = cruiseTripsResult.count || 0;
    
    res.json({
      totalRevenue,
      totalTicketsSold,
      speedTrips,
      cruiseTrips
    });
  } catch (error) {
    console.error('Error fetching stats:', error);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

// GET /api/admin/work-zone - Get current work zone configuration
router.get('/work-zone', authenticateToken, requireAdminRole, (req, res) => {
  try {
    // Try to get the work zone configuration
    const workZone = db.prepare('SELECT * FROM settings WHERE key = ?').get('work_zone');
    
    if (workZone) {
      try {
        const zoneData = JSON.parse(workZone.value);
        res.json(zoneData);
      } catch (parseError) {
        // If JSON parsing fails, return empty object
        res.json({});
      }
    } else {
      // Return empty object if not set
      res.json({});
    }
  } catch (error) {
    console.error('Error fetching work zone:', error);
    res.status(500).json({ error: 'Failed to fetch work zone' });
  }
});

// GET /api/admin/settings/working-zone - Legacy endpoint for compatibility
router.get('/settings/working-zone', authenticateToken, requireAdminRole, (req, res) => {
  try {
    // Try to get the work zone configuration
    const workZone = db.prepare('SELECT * FROM settings WHERE key = ?').get('work_zone');
    
    if (workZone) {
      try {
        const zoneData = JSON.parse(workZone.value);
        res.json(zoneData);
      } catch (parseError) {
        // If JSON parsing fails, return empty object
        res.json({});
      }
    } else {
      // Return empty object if not set
      res.json({});
    }
  } catch (error) {
    console.error('Error fetching work zone:', error);
    res.status(500).json({ error: 'Failed to fetch work zone' });
  }
});

// PUT /api/admin/settings/working-zone - Update work zone configuration
router.put('/settings/working-zone', authenticateToken, requireAdminRole, async (req, res) => {
  try {
    const { coordinates, geometry } = req.body;
    
    if (!geometry) {
      return res.status(400).json({ error: 'Geometry data is required' });
    }
    
    const zoneData = JSON.stringify({ coordinates, geometry });
    
    // Insert or update the work zone setting
    const existing = db.prepare('SELECT id FROM settings WHERE key = ?').get('work_zone');
    
    if (existing) {
      db.prepare('UPDATE settings SET value = ? WHERE key = ?').run(zoneData, 'work_zone');
    } else {
      db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('work_zone', zoneData);
    }
    
    res.json({ ok: true, coordinates, geometry });
  } catch (error) {
    console.error('Error saving work zone:', error);
    res.status(500).json({ error: 'Failed to save work zone' });
  }
});

export default router;