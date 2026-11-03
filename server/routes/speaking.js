import { Router } from 'express';
import { requireAuth, safeJson } from '../auth.js';
import { getDb } from '../db.js';
import { AppError, availableTextProviders, completeChat, configError } from '../providers.js';
import { TUTOR_SYSTEM, tutorFeedbackSystem } from '../prompts.js';
import { consume } from '../usage.js';

const router = Router();
router.use(requireAuth);

const LEVELS = ['beginner', 'intermediate', 'advanced'];

const TOPICS = [
  'Introducing yourself',
  'Daily routine',
  'Ordering food at a restaurant',
  'Job interview practice',
  'Talking about your hometown',
  'Shopping and bargaining',
  'Travel and asking for directions',
  'Describing your favourite hobby',
  'Office small talk',
  'Making a phone call',
  'Discussing the weather and seasons',
  'Storytelling about your weekend',
];

router.get('/meta', (_req, res) => {
  res.json({ levels: LEVELS, topics: TOPICS });
});

/** One conversational turn with the tutor, streamed. */
router.post('/turn', async (req, res, next) => {
  try {
    if (availableTextProviders().length === 0) throw configError('English speaking practice');
    const { level = 'beginner', topic = 'Free talk', transcript } = req.body || {};
    const safeLevel = LEVELS.includes(level) ? level : 'beginner';
    const turns = Array.isArray(transcript) ? transcript.slice(-14) : [];
    if (turns.length === 0) throw new AppError('Say something to begin the practice.', { status: 400, code: 'INVALID_INPUT' });

    consume(req.user, 'speaking');

    const system = `${TUTOR_SYSTEM}\n\nCurrent level: ${safeLevel}. Conversation topic: ${topic}. Keep the learner speaking about this topic.`;
    const messages = turns
      .filter((t) => t && (t.role === 'user' || t.role === 'assistant'))
      .map((t) => ({ role: t.role, content: String(t.text || t.content || '').slice(0, 4000) }));

    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    const send = (p) => {
      if (!res.writableEnded) res.write(`data: ${JSON.stringify(p)}\n\n`);
    };
    send({ type: 'start' });

    const controller = new AbortController();
    req.on('close', () => {
      if (!res.writableEnded) controller.abort();
    });

    let full = '';
    try {
      for await (const chunk of completeStream({ messages, system, signal: controller.signal })) {
        if (chunk.type === 'delta') {
          full += chunk.text;
          send({ type: 'delta', text: chunk.text });
        }
      }
    } catch (error) {
      if (error.name !== 'AbortError') throw error;
    }
    send({ type: 'done', text: full });
    res.end();
  } catch (error) {
    if (res.headersSent) {
      if (!res.writableEnded) {
        res.write(`data: ${JSON.stringify({ type: 'error', error: error.message, code: error.code })}\n\n`);
        res.end();
      }
      return;
    }
    next(error);
  }
});

async function* completeStream(options) {
  const { streamChat } = await import('../providers.js');
  yield* streamChat({ ...options, temperature: 0.6 });
}

/** Detailed pronunciation / grammar report for a finished session. */
router.post('/feedback', async (req, res, next) => {
  try {
    if (availableTextProviders().length === 0) throw configError('English speaking practice');
    const { level = 'beginner', topic = 'Free talk', transcript } = req.body || {};
    const turns = Array.isArray(transcript) ? transcript : [];
    const learnerText = turns
      .filter((t) => t.role === 'user')
      .map((t) => t.text || t.content)
      .join('\n')
      .trim();
    if (learnerText.length < 15) {
      throw new AppError('Practise at least a couple of sentences before requesting feedback.', {
        status: 400,
        code: 'INVALID_INPUT',
      });
    }

    consume(req.user, 'text');
    const { text } = await completeChat({
      messages: [
        {
          role: 'user',
          content: `Level: ${level}\nTopic: ${topic}\nLearner transcript (speech-recognised, so small recognition errors are possible):\n"""\n${learnerText.slice(0, 12000)}\n"""`,
        },
      ],
      system: tutorFeedbackSystem(level),
      temperature: 0.3,
      maxTokens: 1200,
    });

    const report = parseReport(text);
    const db = getDb();
    const info = db
      .prepare(
        'INSERT INTO speaking_sessions (user_id, level, topic, transcript, feedback, score) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(req.user.id, level, topic, JSON.stringify(turns), JSON.stringify(report), report.overall || 0);

    res.json({ sessionId: info.lastInsertRowid, report });
  } catch (error) {
    next(error);
  }
});

function parseReport(raw) {
  const cleaned = raw.replace(/```json/gi, '').replace(/```/g, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  const candidate = start >= 0 && end > start ? cleaned.slice(start, end + 1) : '';
  try {
    const parsed = JSON.parse(candidate);
    return {
      overall: clamp(parsed.overall),
      pronunciation: clamp(parsed.pronunciation),
      grammar: clamp(parsed.grammar),
      vocabulary: clamp(parsed.vocabulary),
      fluency: clamp(parsed.fluency),
      grammarFixes: Array.isArray(parsed.grammarFixes) ? parsed.grammarFixes.slice(0, 8) : [],
      pronunciationTips: Array.isArray(parsed.pronunciationTips) ? parsed.pronunciationTips.slice(0, 6) : [],
      betterVocabulary: Array.isArray(parsed.betterVocabulary) ? parsed.betterVocabulary.slice(0, 8) : [],
      summary: String(parsed.summary || ''),
      nextStep: String(parsed.nextStep || ''),
    };
  } catch {
    // The model did not return JSON: keep the prose rather than inventing scores.
    return {
      overall: 0,
      pronunciation: 0,
      grammar: 0,
      vocabulary: 0,
      fluency: 0,
      grammarFixes: [],
      pronunciationTips: [],
      betterVocabulary: [],
      summary: raw.trim().slice(0, 2000),
      nextStep: '',
      unparsed: true,
    };
  }
}

function clamp(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

/** Progress dashboard: per-level averages from stored sessions. */
router.get('/progress', (req, res) => {
  const db = getDb();
  const sessions = db
    .prepare('SELECT * FROM speaking_sessions WHERE user_id = ? ORDER BY id DESC LIMIT 50')
    .all(req.user.id)
    .map((s) => ({ ...s, feedback: safeJson(s.feedback, {}) }));

  const byLevel = {};
  for (const s of sessions) {
    const bucket = (byLevel[s.level] ||= { sessions: 0, total: 0 });
    bucket.sessions += 1;
    bucket.total += s.score || 0;
  }
  const levels = Object.fromEntries(
    Object.entries(byLevel).map(([level, v]) => [level, { sessions: v.sessions, average: Math.round(v.total / v.sessions) }]),
  );
  const days = new Set(sessions.map((s) => (s.created_at || '').slice(0, 10)));
  res.json({
    sessions: sessions.slice(0, 10),
    levels,
    totalSessions: sessions.length,
    practiceDays: days.size,
    streak: computeStreak(sessions),
  });
});

function computeStreak(sessions) {
  const days = new Set(sessions.map((s) => (s.created_at || '').slice(0, 10)));
  let streak = 0;
  const cursor = new Date();
  for (let i = 0; i < 365; i += 1) {
    const key = cursor.toISOString().slice(0, 10);
    if (days.has(key)) {
      streak += 1;
      cursor.setDate(cursor.getDate() - 1);
    } else if (i === 0) {
      cursor.setDate(cursor.getDate() - 1); // today may not be practised yet
    } else {
      break;
    }
  }
  return streak;
}

router.delete('/sessions/:id', (req, res) => {
  const info = getDb()
    .prepare('DELETE FROM speaking_sessions WHERE id = ? AND user_id = ?')
    .run(req.params.id, req.user.id);
  if (info.changes === 0) return res.status(404).json({ error: 'Session not found.', code: 'NOT_FOUND' });
  res.json({ ok: true });
});

export default router;
