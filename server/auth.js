import jwt from 'jsonwebtoken';
import express from 'express';
import db from './db.js';

// JWT secret: require in production, allow fallback for local dev
const isProd = process.env.NODE_ENV === 'production';
const JWT_SECRET = process.env.JWT_SECRET || (!isProd ? 'boat_ticket_secret_key' : null);
if (!JWT_SECRET) {
  console.error('[AUTH] FATAL: JWT_SECRET environment variable is required in production');
  process.exit(1);
}

// ======================
// Middleware
// ======================
export const authenticateToken = (req, res, next) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) return res.status(401).json({ error: 'Требуется токен доступа' });

    jwt.verify(token, JWT_SECRET, (err, decoded) => {
      if (err || !decoded?.id) return res.status(403).json({ error: 'Недействительный или истекший токен' });

      try {
        const userRecord = db
          .prepare('SELECT id, username, role, is_active FROM users WHERE id = ?')
          .get(decoded.id);

        if (!userRecord || userRecord.is_active !== 1) {
          return res.status(403).json({ error: 'Учетная запись пользователя отключена' });
        }

        req.user = userRecord;
        next();
      } catch (e) {
        console.error('[AUTH] token user lookup failed:', e);
        return res.status(403).json({ error: 'Недействительный токен' });
      }
    });
  } catch (e) {
    console.error('[AUTH] authenticateToken failed:', e);
    return res.status(403).json({ error: 'Недействительный токен' });
  }
};

export const isAdmin = (req, res, next) => {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Требуется доступ администратора' });
  next();
};

export const canSell = (req, res, next) => {
  const r = req.user?.role;
  if (r !== 'seller' && r !== 'dispatcher') {
    return res.status(403).json({ error: 'Требуется доступ продавца или диспетчера' });
  }
  next();
};

export const canDispatchManageSlots = (req, res, next) => {
  const r = req.user?.role;
  // dispatcher, owner, admin can access; primary goal: block seller
  if (r !== 'dispatcher' && r !== 'owner' && r !== 'admin') {
    console.warn(`[AUTH] canDispatchManageSlots blocked: role=${r} path=${req.path}`);
    return res.status(403).json({ ok: false, error: 'Недостаточно прав' });
  }
  next();
};

export const canOwnerAccess = (req, res, next) => {
  const r = req.user?.role;
  // owner + admin allowed (admin panel exists)
  if (r !== 'owner' && r !== 'admin') {
    console.warn(`[AUTH] canOwnerAccess blocked: role=${r} path=${req.path}`);
    return res.status(403).json({ ok: false, error: 'Недостаточно прав' });
  }
  next();
};

export const canOwnerOrAdmin = (req, res, next) => {
  const r = req.user?.role;
  if (r !== 'owner' && r !== 'admin') {
    return res.status(403).json({ error: 'Требуется доступ владельца или администратора' });
  }
  next();
};

export const generateToken = (user) => {
  return jwt.sign({ id: user.id, username: user.username, role: user.role }, JWT_SECRET, { expiresIn: '24h' });
};

// ======================
// Password compare (works even if bcryptjs is not installed)
// ======================
let _bcryptPromise = null;

async function getBcrypt() {
  if (_bcryptPromise) return _bcryptPromise;

  // Prefer native bcrypt (if installed), fallback to bcryptjs.
  _bcryptPromise = import('bcrypt')
    .then((m) => m?.default ?? m)
    .catch(() => null)
    .then((mod) => {
      if (mod?.compare) return mod;
      return import('bcryptjs').then((m) => m?.default ?? m).catch(() => null);
    });

  return _bcryptPromise;
}

async function safeComparePassword(plain, stored) {
  if (typeof plain !== 'string' || typeof stored !== 'string') return false;

  // If DB stores plain passwords (dev), support it:
  if (!stored.startsWith('$2')) return plain === stored;

  // If DB stores bcrypt hashes, try to use bcryptjs if available:
  const bcrypt = await getBcrypt();
  if (!bcrypt?.compare) return false;

  try {
    return await bcrypt.compare(plain, stored);
  } catch (e) {
    console.error('[AUTH] bcrypt.compare failed:', e);
    return false;
  }
}

// ======================
// Router
// ======================
const router = express.Router();

router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body || {};
    
    if (!username || !password) return res.status(400).json({ error: 'Имя пользователя и пароль обязательны' });

    const user = db
      .prepare('SELECT id, username, role, is_active, password_hash FROM users WHERE username = ?')
      .get(username);
    
    if (!user) return res.status(401).json({ error: 'Неверное имя пользователя или пароль' });
    if (user.is_active !== 1) return res.status(401).json({ error: 'Учетная запись пользователя отключена' });

    const ok = await safeComparePassword(password, user.password_hash);
    
    if (!ok) return res.status(401).json({ error: 'Неверное имя пользователя или пароль' });

    const token = generateToken(user);
    return res.json({ token, user: { id: user.id, username: user.username, role: user.role } });
  } catch (e) {
    console.error('[AUTH] /login hardfail:', e);
    // Never return 500 to the client for login; treat as invalid credentials.
    return res.status(401).json({ error: 'Неверное имя пользователя или пароль' });
  }
});

router.get('/me', authenticateToken, (req, res) => {
  try {
    return res.json({ id: req.user.id, username: req.user.username, role: req.user.role });
  } catch (e) {
    console.error('[AUTH] /me failed:', e);
    return res.status(500).json({ error: 'Ошибка сервера при получении данных пользователя' });
  }
});

export default router;
