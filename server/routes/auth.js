import { Router } from 'express';
import {
  clearSessionCookie,
  findUserById,
  hashPassword,
  publicUser,
  randomTitle,
  rateLimitAuth,
  requireAuth,
  setSessionCookie,
  verifyPassword,
} from '../auth.js';
import { getDb } from '../db.js';
import { usageSummary } from '../usage.js';

const router = Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function validateCredentials(email, password, name) {
  if (!EMAIL_RE.test(String(email || '').trim().toLowerCase())) {
    return 'Please enter a valid email address.';
  }
  if (String(password || '').length < 8) {
    return 'Password must be at least 8 characters.';
  }
  if (name !== undefined && String(name).trim().length > 60) {
    return 'Name is too long.';
  }
  return null;
}

router.get('/me', (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Not signed in', code: 'UNAUTHENTICATED' });
  res.json({ user: publicUser(req.user), usage: usageSummary(req.user) });
});

router.post('/register', rateLimitAuth, (req, res) => {
  const { email, password, name } = req.body || {};
  const problem = validateCredentials(email, password, name);
  if (problem) return res.status(400).json({ error: problem, code: 'INVALID_INPUT' });

  const normalized = String(email).trim().toLowerCase();
  const db = getDb();
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(normalized);
  if (existing) {
    return res.status(409).json({
      error: 'An account with this email already exists. Please sign in instead.',
      code: 'EMAIL_TAKEN',
    });
  }

  const info = db
    .prepare(
      'INSERT INTO users (email, name, password_hash, is_guest) VALUES (?, ?, ?, 0)',
    )
    .run(normalized, String(name || normalized.split('@')[0]).slice(0, 60), hashPassword(password));

  setSessionCookie(res, info.lastInsertRowid);
  const user = findUserById(info.lastInsertRowid);
  res.status(201).json({ user: publicUser(user), usage: usageSummary(user) });
});

router.post('/login', rateLimitAuth, (req, res) => {
  const { email, password } = req.body || {};
  const normalized = String(email || '').trim().toLowerCase();
  if (!normalized || !password) {
    return res.status(400).json({ error: 'Email and password are required.', code: 'INVALID_INPUT' });
  }
  const db = getDb();
  const row = db.prepare('SELECT * FROM users WHERE email = ?').get(normalized);
  // Constant-ish response to avoid user enumeration.
  if (!row || !row.password_hash || !verifyPassword(password, row.password_hash)) {
    return res.status(401).json({ error: 'Incorrect email or password.', code: 'BAD_CREDENTIALS' });
  }
  setSessionCookie(res, row.id);
  res.json({ user: publicUser(row), usage: usageSummary(row) });
});

router.post('/guest', rateLimitAuth, (req, res) => {
  const db = getDb();
  const info = db
    .prepare("INSERT INTO users (email, name, is_guest) VALUES (NULL, ?, 1)")
    .run(`Guest ${Math.floor(1000 + Math.random() * 9000)}`);
  setSessionCookie(res, info.lastInsertRowid);
  const user = findUserById(info.lastInsertRowid);
  res.status(201).json({ user: publicUser(user), usage: usageSummary(user) });
});

router.post('/logout', (req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});

router.patch('/me', requireAuth, (req, res) => {
  const { name, theme, language, settings } = req.body || {};
  const db = getDb();
  const updates = [];
  const values = [];

  if (name !== undefined) {
    const clean = String(name).trim().slice(0, 60);
    if (!clean) return res.status(400).json({ error: 'Name cannot be empty.', code: 'INVALID_INPUT' });
    updates.push('name = ?');
    values.push(clean);
  }
  if (theme !== undefined) {
    if (!['dark', 'light'].includes(theme)) {
      return res.status(400).json({ error: 'Unsupported theme.', code: 'INVALID_INPUT' });
    }
    updates.push('theme = ?');
    values.push(theme);
  }
  if (language !== undefined) {
    updates.push('language = ?');
    values.push(String(language).slice(0, 12));
  }
  if (settings !== undefined) {
    updates.push('settings = ?');
    values.push(JSON.stringify(settings));
  }
  if (updates.length === 0) return res.json({ user: publicUser(req.user) });

  updates.push("updated_at = datetime('now')");
  values.push(req.user.id);
  db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...values);
  const user = findUserById(req.user.id);
  res.json({ user: publicUser(user), usage: usageSummary(user) });
});

router.post('/password', requireAuth, rateLimitAuth, (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (String(newPassword || '').length < 8) {
    return res.status(400).json({ error: 'New password must be at least 8 characters.', code: 'INVALID_INPUT' });
  }
  if (req.user.is_guest) {
    // Guests have no password; create one by attaching an email first.
    return res.status(400).json({
      error: 'Guest accounts have no password. Add an email and password to keep your data.',
      code: 'GUEST_ACCOUNT',
    });
  }
  if (!verifyPassword(currentPassword, req.user.password_hash)) {
    return res.status(401).json({ error: 'Current password is incorrect.', code: 'BAD_CREDENTIALS' });
  }
  getDb().prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(newPassword), req.user.id);
  res.json({ ok: true });
});

router.post('/upgrade', requireAuth, (req, res) => {
  // Plans are enabled explicitly by the operator; no fake billing is pretended here.
  const target = req.body?.plan;
  if (!['free', 'premium'].includes(target)) {
    return res.status(400).json({ error: 'Unknown plan.', code: 'INVALID_INPUT' });
  }
  if (target === 'premium' && process.env.ALLOW_SELF_UPGRADE !== 'true') {
    return res.status(402).json({
      error:
        'Premium activation requires payment confirmation. Configure ALLOW_SELF_UPGRADE=true to enable direct activation on this deployment.',
      code: 'PAYMENT_REQUIRED',
    });
  }
  getDb().prepare('UPDATE users SET plan = ? WHERE id = ?').run(target, req.user.id);
  const user = findUserById(req.user.id);
  res.json({ user: publicUser(user), usage: usageSummary(user) });
});

export default router;
