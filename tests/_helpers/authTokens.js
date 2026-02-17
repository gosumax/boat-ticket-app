// authTokens.js — JWT token generation for test users
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';

export function generateToken(user) {
  return jwt.sign(
    {
      id: user.id,
      username: user.username,
      role: user.role
    },
    JWT_SECRET,
    { expiresIn: '24h' }
  );
}

export function makeSellerToken(id, username = 'sellerA') {
  return generateToken({ id, username, role: 'seller' });
}

export function makeDispatcherToken(id, username = 'dispatcher1') {
  return generateToken({ id, username, role: 'dispatcher' });
}

export function makeAdminToken(id, username = 'admin') {
  return generateToken({ id, username, role: 'admin' });
}
