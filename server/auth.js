import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { config } from './config.js';
import { getDb } from './db.js';

const TOKEN_PURPOSE = 'adarsh-session';

export function hashPassword(password) {
  return bcrypt.hashSync(password, 11);
}

export function verifyPassword(password, hash) {
  if (!hash) return false;
  return bcrypt.compareSync(password, hash);
}

export function signSession(userId) {
  return jwt.sign({ sub: String(userId), purpose: TOKEN_PURPOSE }, config.jwtSecret, {
    expiresIn: `${config.sessionDays}d`,
  });
}

export function verifySession(token) {
  try {
    const payload = jwt.verify(token, config.jwtSecret);
    if (payload.purpose !== TOKEN_PURPOSE) return null;
    return { userId: Number(payload.sub) };
  } catch {
    return null;
  }
}

export function publicUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    isGuest: Boolean(row.is_guest),
    plan: row.plan,
    theme: row.theme,
    language: row.language,
    settings: safeJson(row.settings, {}),
    createdAt: row.created_at,
  };
}

export function safeJson(value, fallback) {
  try {
    const parsed = JSON.parse(value);
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

export function setSessionCookie(res, userId) {
  res.cookie(config.cookieName, signSession(userId), {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.isProduction,
    maxAge: config.sessionDays * 24 * 60 * 60 * 1000,
    path: '/',
  });
}

export function clearSessionCookie(res) {
  res.clearCookie(config.cookieName, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.isProduction,
    path: '/',
  });
}

export function findUserById(id) {
  return getDb().prepare('SELECT * FROM users WHERE id = ?').get(id);
}

export function requireAuth(req, res, next) {
  const token = req.cookies?.[config.cookieName];
  const session = token ? verifySession(token) : null;
  if (!session) {
    return res.status(401).json({ error: 'Please sign in to continue.', code: 'UNAUTHENTICATED' });
  }
  const user = findUserById(session.userId);
  if (!user) {
    clearSessionCookie(res);
    return res.status(401).json({ error: 'Session expired. Please sign in again.', code: 'UNAUTHENTICATED' });
  }
  req.user = user;
  next();
}

export function attachUser(req, _res, next) {
  const token = req.cookies?.[config.cookieName];
  const session = token ? verifySession(token) : null;
  if (session) {
    req.user = findUserById(session.userId) || undefined;
  }
  next();
}

/** Brute-force damping for auth endpoints (in-memory, per process). */
const attempts = new Map();
export function rateLimitAuth(req, res, next) {
  const key = req.ip || 'unknown';
  const now = Date.now();
  const windowMs = 10 * 60 * 1000;
  const entry = attempts.get(key);
  if (!entry || now - entry.start > windowMs) {
    attempts.set(key, { start: now, count: 1 });
    return next();
  }
  entry.count += 1;
  if (entry.count > 25) {
    return res.status(429).json({
      error: 'Too many attempts. Please wait a few minutes and try again.',
      code: 'RATE_LIMITED',
    });
  }
  next();
}

export function randomTitle() {
  return `Chat • ${new Date().toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })}`;
}

export function newGuestName() {
  return `Guest ${crypto.randomInt(1000, 9999)}`;
}
