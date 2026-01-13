import jwt from 'jsonwebtoken';
import db from './db.js';

const JWT_SECRET = process.env.JWT_SECRET || 'boat_ticket_secret_key';

// Middleware to authenticate JWT token
export const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (!token) {
    return res.status(401).json({ error: 'Требуется токен доступа' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Недействительный или истекший токен' });
    }
    
    // Check if user is still active
    const userRecord = db.prepare('SELECT id, username, role, is_active FROM users WHERE id = ?').get(user.id);
    if (!userRecord || userRecord.is_active !== 1) {
      return res.status(403).json({ error: 'Учетная запись пользователя отключена' });
    }
    
    req.user = userRecord;
    next();
  });
};

// Middleware to check if user is admin
export const isAdmin = (req, res, next) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Требуется доступ администратора' });
  }
  next();
};

// Middleware to check if user can sell (seller or dispatcher)
export const canSell = (req, res, next) => {
  if (req.user.role !== 'seller' && req.user.role !== 'dispatcher') {
    return res.status(403).json({ error: 'Требуется доступ продавца или диспетчера' });
  }
  next();
};

// Middleware to check if user is dispatcher (for dispatcher-specific actions)
export const canDispatchManageSlots = (req, res, next) => {
  if (req.user.role !== 'dispatcher') {
    return res.status(403).json({ error: 'Требуется доступ диспетчера' });
  }
  next();
};

// Middleware to check if user is owner
export const canOwnerAccess = (req, res, next) => {
  if (req.user.role !== 'owner') {
    return res.status(403).json({ error: 'Требуется доступ владельца' });
  }
  next();
};

// Middleware to check if user is owner or admin
export const canOwnerOrAdminAccess = (req, res, next) => {
  if (req.user.role !== 'owner' && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Требуется доступ владельца или администратора' });
  }
  next();
};

// Generate JWT token
export const generateToken = (user) => {
  try {
    return jwt.sign(
      { id: user.id, username: user.username, role: user.role },
      JWT_SECRET,
      { expiresIn: '24h' }
    );
  } catch (error) {
    console.error('[AUTH_LOGIN_500] Error generating JWT token:', error);
    throw new Error('Failed to generate authentication token');
  }
};

// Import express and create router
import express from 'express';
const router = express.Router();

// Login route
router.post('/login', async (req, res) => {
  console.log('[AUTH] POST /login hit');
  try {
    const { username, password } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({ error: 'Требуются имя пользователя и пароль' });
    }
    
    // Find user in database
    const user = db.prepare('SELECT id, username, password_hash, role, is_active FROM users WHERE username = ?').get(username);
    
    if (!user) {
      return res.status(401).json({ error: 'Неверное имя пользователя или пароль' });
    }
    
    if (user.is_active !== 1) {
      return res.status(401).json({ error: 'Учетная запись пользователя отключена' });
    }
    
    // Compare passwords
    const bcrypt = await import('bcrypt');
    const validPassword = await bcrypt.default.compare(password, user.password_hash);
    
    if (!validPassword) {
      return res.status(401).json({ error: 'Неверное имя пользователя или пароль' });
    }
    
    // Generate JWT token
    const token = generateToken(user);
    
    // Return user info with token, but don't include password hash
    res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        role: user.role
      }
    });
    
  } catch (error) {
    console.error('[AUTH_LOGIN_500] Login error:', error);
    res.status(500).json({ error: 'Ошибка сервера при входе' });
  }
});

// Get current user route
router.get('/me', authenticateToken, (req, res) => {
  try {
    // Return user info without sensitive data
    res.json({
      id: req.user.id,
      username: req.user.username,
      role: req.user.role
    });
  } catch (error) {
    console.error('[AUTH_ME_500] Get user error:', error);
    res.status(500).json({ error: 'Ошибка сервера при получении данных пользователя' });
  }
});

export default router;