import { Router } from 'express';
import { requireAuth, safeJson } from '../auth.js';
import { config } from '../config.js';
import { getDb } from '../db.js';
import { AppError, capabilities } from '../providers.js';
import { usageSummary, consume } from '../usage.js';

const router = Router();
router.use(requireAuth);

router.get('/status', (req, res) => {
  res.json({ capabilities: capabilities(), usage: usageSummary(req.user) });
});

router.get('/', (req, res) => {
  const kind = String(req.query.kind || 'chat');
  const q = String(req.query.q || '').trim();
  const db = getDb();
  let rows;
  if (q) {
    const like = `%${q.replace(/[%_]/g, (c) => `\\${c}`)}%`;
    rows = db
      .prepare(
        `SELECT DISTINCT c.* FROM conversations c
         LEFT JOIN messages m ON m.conversation_id = c.id
         WHERE c.user_id = ? AND c.kind = ? AND (c.title LIKE ? ESCAPE '\\' OR m.content LIKE ? ESCAPE '\\')
         ORDER BY c.updated_at DESC LIMIT 200`,
      )
      .all(req.user.id, kind, like, like);
  } else {
    rows = db
      .prepare('SELECT * FROM conversations WHERE user_id = ? AND kind = ? ORDER BY updated_at DESC LIMIT 200')
      .all(req.user.id, kind);
  }
  res.json({ conversations: rows.map((r) => ({ ...r, meta: safeJson(r.meta, {}) })) });
});

router.post('/', (req, res) => {
  const { title, kind = 'chat', meta } = req.body || {};
  if (!['chat', 'speaking'].includes(kind)) {
    return res.status(400).json({ error: 'Unsupported conversation type.', code: 'INVALID_INPUT' });
  }
  const db = getDb();
  const info = db
    .prepare('INSERT INTO conversations (user_id, title, kind, meta) VALUES (?, ?, ?, ?)')
    .run(req.user.id, String(title || 'New chat').slice(0, 120), kind, JSON.stringify(meta || {}));
  res.status(201).json({ conversation: { id: info.lastInsertRowid, title: title || 'New chat', kind, meta: meta || {} } });
});

router.get('/:id', (req, res) => {
  const db = getDb();
  const conversation = db
    .prepare('SELECT * FROM conversations WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.user.id);
  if (!conversation) return res.status(404).json({ error: 'Conversation not found.', code: 'NOT_FOUND' });
  const messages = db
    .prepare('SELECT * FROM messages WHERE conversation_id = ? ORDER BY id ASC')
    .all(conversation.id)
    .map((m) => ({
      ...m,
      attachments: safeJson(m.attachments, []),
      meta: safeJson(m.meta, {}),
    }));
  res.json({ conversation: { ...conversation, meta: safeJson(conversation.meta, {}) }, messages });
});

router.patch('/:id', (req, res) => {
  const title = String(req.body?.title ?? '').trim();
  if (!title) return res.status(400).json({ error: 'Title cannot be empty.', code: 'INVALID_INPUT' });
  const db = getDb();
  const info = db
    .prepare("UPDATE conversations SET title = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?")
    .run(title.slice(0, 120), req.params.id, req.user.id);
  if (info.changes === 0) return res.status(404).json({ error: 'Conversation not found.', code: 'NOT_FOUND' });
  res.json({ ok: true, title: title.slice(0, 120) });
});

router.delete('/:id', (req, res) => {
  const db = getDb();
  const info = db
    .prepare('DELETE FROM conversations WHERE id = ? AND user_id = ?')
    .run(req.params.id, req.user.id);
  if (info.changes === 0) return res.status(404).json({ error: 'Conversation not found.', code: 'NOT_FOUND' });
  res.json({ ok: true });
});

router.delete('/', (req, res) => {
  const db = getDb();
  db.prepare('DELETE FROM conversations WHERE user_id = ?').run(req.user.id);
  res.json({ ok: true });
});

/** Delete a single message (used by "edit message" truncation flows). */
router.delete('/:id/messages/:messageId', (req, res) => {
  const db = getDb();
  const owned = db
    .prepare('SELECT id FROM conversations WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.user.id);
  if (!owned) return res.status(404).json({ error: 'Conversation not found.', code: 'NOT_FOUND' });
  db.prepare('DELETE FROM messages WHERE id = ? AND conversation_id = ?').run(
    req.params.messageId,
    owned.id,
  );
  res.json({ ok: true });
});

router.get('/:id/export', (req, res) => {
  const db = getDb();
  const conversation = db
    .prepare('SELECT * FROM conversations WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.user.id);
  if (!conversation) return res.status(404).json({ error: 'Conversation not found.', code: 'NOT_FOUND' });
  const messages = db
    .prepare('SELECT role, content, created_at FROM messages WHERE conversation_id = ? ORDER BY id ASC')
    .all(conversation.id);
  const body = [
    `# ${conversation.title}`,
    '',
    `Exported from ADARSH AI — ${new Date().toISOString()}`,
    '',
    ...messages.map((m) => `**${m.role === 'user' ? 'You' : 'ADARSH AI'}** (${m.created_at})\n\n${m.content}\n`),
  ].join('\n');
  res.setHeader('content-type', 'text/markdown; charset=utf-8');
  res.setHeader('content-disposition', `attachment; filename="adarsh-chat-${conversation.id}.md"`);
  res.send(body);
});

export { consume, AppError, capabilities, config };
export default router;
