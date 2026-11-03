import { Router } from 'express';
import { requireAuth, safeJson } from '../auth.js';
import { getDb } from '../db.js';
import { AppError, availableTextProviders, streamChat } from '../providers.js';
import { CHAT_SYSTEM } from '../prompts.js';
import { consume } from '../usage.js';

const router = Router();
router.use(requireAuth);

const GEMINI_REFUSAL =
  'ADARSH AI could not generate a reply. Please try again, or rephrase your message.';

function loadHistory(conversationId, userId) {
  const db = getDb();
  const conversation = db
    .prepare('SELECT * FROM conversations WHERE id = ? AND user_id = ?')
    .get(conversationId, userId);
  if (!conversation) {
    throw new AppError('Conversation not found.', { status: 404, code: 'NOT_FOUND' });
  }
  const messages = db
    .prepare('SELECT * FROM messages WHERE conversation_id = ? ORDER BY id ASC')
    .all(conversation.id)
    .map((m) => ({
      role: m.role,
      content: m.content,
      attachments: safeJson(m.attachments, []),
    }));
  return { conversation, messages };
}

/**
 * POST /api/chat  { conversationId?, message, attachments?, regenerate?, editMessageId? }
 * Streams Server-Sent Events: {type:'start'|'delta'|'done'|'error'}.
 */
router.post('/', async (req, res, next) => {
  const { conversationId, message, attachments = [], regenerate = false, editMessageId } = req.body || {};

  try {
    if (availableTextProviders().length === 0) {
      throw new AppError(
        'AI chat is not configured on this deployment. Add OPENAI_API_KEY (or GROQ_API_KEY / ANTHROPIC_API_KEY / GEMINI_API_KEY) to the app environment to enable real AI replies.',
        { status: 503, code: 'CONFIG_REQUIRED' },
      );
    }

    const db = getDb();
    let conversation;
    if (conversationId) {
      conversation = db
        .prepare('SELECT * FROM conversations WHERE id = ? AND user_id = ?')
        .get(conversationId, req.user.id);
      if (!conversation) throw new AppError('Conversation not found.', { status: 404, code: 'NOT_FOUND' });
    } else {
      const title = String(message || 'New chat').replace(/\s+/g, ' ').trim().slice(0, 60) || 'New chat';
      const info = db
        .prepare('INSERT INTO conversations (user_id, title, kind) VALUES (?, ?, ?)')
        .run(req.user.id, title, 'chat');
      conversation = db.prepare('SELECT * FROM conversations WHERE id = ?').get(info.lastInsertRowid);
    }

    const cleanAttachments = (Array.isArray(attachments) ? attachments : []).slice(0, 6).map((file) => ({
      name: String(file?.name || 'file').slice(0, 140),
      kind: file?.kind === 'image' ? 'image' : 'text',
      dataUrl: file?.kind === 'image' ? String(file.dataUrl || '') : undefined,
      text: file?.kind === 'image' ? undefined : String(file.text || '').slice(0, 40000),
    }));

    // Message bookkeeping for regenerate / edit.
    if (regenerate) {
      db.prepare(
        `DELETE FROM messages WHERE id IN (
           SELECT id FROM messages WHERE conversation_id = ? AND role = 'assistant' ORDER BY id DESC LIMIT 1
         )`,
      ).run(conversation.id);
    } else if (editMessageId) {
      const target = db
        .prepare("SELECT * FROM messages WHERE id = ? AND conversation_id = ? AND role = 'user'")
        .get(editMessageId, conversation.id);
      if (!target) throw new AppError('Message to edit was not found.', { status: 404, code: 'NOT_FOUND' });
      db.prepare("DELETE FROM messages WHERE conversation_id = ? AND id > ?").run(conversation.id, target.id);
      db.prepare('UPDATE messages SET content = ?, attachments = ? WHERE id = ?').run(
        String(message || '').slice(0, 20000),
        JSON.stringify(cleanAttachments),
        target.id,
      );
    } else if (String(message || '').trim() || cleanAttachments.length) {
      db.prepare(
        'INSERT INTO messages (conversation_id, role, content, attachments) VALUES (?, ?, ?, ?)',
      ).run(conversation.id, 'user', String(message || '').slice(0, 20000), JSON.stringify(cleanAttachments));
    }

    db.prepare("UPDATE conversations SET updated_at = datetime('now') WHERE id = ?").run(conversation.id);

    const { messages } = loadHistory(conversation.id, req.user.id);
    const trimmed = messages.slice(-24).filter((m) => m.content?.trim() || m.attachments?.length);

    if (trimmed.length === 0) {
      throw new AppError('Please type a message first.', { status: 400, code: 'INVALID_INPUT' });
    }

    const quota = consume(req.user, 'chat');

    // --- SSE streaming ---
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    const send = (payload) => {
      if (!res.writableEnded) res.write(`data: ${JSON.stringify(payload)}\n\n`);
    };

    send({ type: 'start', conversationId: conversation.id, title: conversation.title, usage: quota });

    const controller = new AbortController();
    let aborted = false;
    req.on('close', () => {
      if (!res.writableEnded) {
        aborted = true;
        controller.abort();
      }
    });

    let full = '';
    let meta = null;
    try {
      for await (const chunk of streamChat({
        messages: trimmed,
        system: CHAT_SYSTEM,
        signal: controller.signal,
      })) {
        if (chunk.type === 'delta') {
          full += chunk.text;
          send({ type: 'delta', text: chunk.text });
        } else if (chunk.type === 'done') {
          meta = chunk;
        }
      }
    } catch (error) {
      if (aborted || error.name === 'AbortError') {
        // Keep partial text — the user intentionally stopped generation.
      } else {
        throw error;
      }
    }

    const finalText = full.trim() ? full : aborted ? '' : GEMINI_REFUSAL;
    if (finalText) {
      const info = db
        .prepare('INSERT INTO messages (conversation_id, role, content, meta) VALUES (?, ?, ?, ?)')
        .run(conversation.id, 'assistant', finalText, JSON.stringify(meta || {}));
      db.prepare(
        "UPDATE conversations SET updated_at = datetime('now'), title = CASE WHEN title IN ('New chat','Chat') THEN ? ELSE title END WHERE id = ?",
      ).run(String(message || '').replace(/\s+/g, ' ').trim().slice(0, 60) || conversation.title, conversation.id);
      send({ type: 'done', messageId: info.lastInsertRowid, stopped: aborted, ...meta });
    } else {
      send({ type: 'done', stopped: true, empty: true });
    }
    res.end();
  } catch (error) {
    if (res.headersSent) {
      if (!res.writableEnded) {
        res.write(
          `data: ${JSON.stringify({
            type: 'error',
            error: error.message || 'Generation failed.',
            code: error.code || 'INTERNAL',
          })}\n\n`,
        );
        res.end();
      }
      return;
    }
    next(error);
  }
});

export default router;
