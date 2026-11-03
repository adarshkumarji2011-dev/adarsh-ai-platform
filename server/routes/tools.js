import { Router } from 'express';
import { requireAuth } from '../auth.js';
import { getDb } from '../db.js';
import { AppError, completeChat, configError, availableTextProviders } from '../providers.js';
import {
  CODER_SYSTEM,
  SUMMARIZER_SYSTEM,
  TRANSLATOR_SYSTEM,
  WRITER_SYSTEM,
  coderPrompt,
  summarizerPrompt,
  writerPrompt,
} from '../prompts.js';
import { consume } from '../usage.js';
import { safeJson } from '../auth.js';

const router = Router();
router.use(requireAuth);

function ensureProvider() {
  if (availableTextProviders().length === 0) throw configError('this tool');
}

router.post('/writer', async (req, res, next) => {
  try {
    ensureProvider();
    const { type, topic, tone, length, language, source } = req.body || {};
    if (!String(topic || '').trim() && !String(source || '').trim()) {
      throw new AppError('Add a topic or paste some text to work on.', { status: 400, code: 'INVALID_INPUT' });
    }
    consume(req.user, 'text');
    const { text, provider, model } = await completeChat({
      messages: [{ role: 'user', content: writerPrompt({ type, topic, tone, length, language, source }) }],
      system: WRITER_SYSTEM,
      maxTokens: 2600,
    });
    res.json({ text, provider, model });
  } catch (error) {
    next(error);
  }
});

router.post('/code', async (req, res, next) => {
  try {
    ensureProvider();
    const { task, language, source, mode } = req.body || {};
    if (!String(task || '').trim()) {
      throw new AppError('Describe what the code should do.', { status: 400, code: 'INVALID_INPUT' });
    }
    consume(req.user, 'text');
    const modeLine = mode ? `Mode: ${mode}.` : '';
    const { text, provider, model } = await completeChat({
      messages: [{ role: 'user', content: `${modeLine}\n${coderPrompt({ task, language, source })}` }],
      system: CODER_SYSTEM,
      maxTokens: 3000,
    });
    res.json({ text, provider, model });
  } catch (error) {
    next(error);
  }
});

router.post('/summarize', async (req, res, next) => {
  try {
    ensureProvider();
    const { mode = 'summarize', text: source, length } = req.body || {};
    if (String(source || '').trim().length < 40) {
      throw new AppError('Paste at least a couple of sentences to summarize.', { status: 400, code: 'INVALID_INPUT' });
    }
    consume(req.user, 'text');
    const { text, provider, model } = await completeChat({
      messages: [{ role: 'user', content: summarizerPrompt({ mode, text: String(source).slice(0, 24000), length }) }],
      system: SUMMARIZER_SYSTEM,
      maxTokens: 2000,
    });
    res.json({ text, provider, model });
  } catch (error) {
    next(error);
  }
});

router.post('/translate', async (req, res, next) => {
  try {
    ensureProvider();
    const { text: source, from = 'auto', to = 'Hindi' } = req.body || {};
    if (!String(source || '').trim()) {
      throw new AppError('Enter the text you want translated.', { status: 400, code: 'INVALID_INPUT' });
    }
    consume(req.user, 'text');
    const { text, provider, model } = await completeChat({
      messages: [
        {
          role: 'user',
          content: `Translate from ${from === 'auto' ? 'the detected language' : from} to ${to}.\n\nText:\n"""\n${String(source).slice(0, 12000)}\n"""`,
        },
      ],
      system: TRANSLATOR_SYSTEM,
      maxTokens: 2400,
    });
    res.json({ text, provider, model });
  } catch (error) {
    next(error);
  }
});

/** Speech-to-text fallback for browsers without the Web Speech API. */
router.post('/transcribe', async (req, res, next) => {
  try {
    const { audio, mime = 'audio/webm' } = req.body || {};
    if (!audio) throw new AppError('No audio was received.', { status: 400, code: 'INVALID_INPUT' });
    const key = process.env.OPENAI_API_KEY;
    if (!key) {
      throw new AppError(
        'Server speech recognition is not configured. Use Chrome or Edge, which support on-device speech recognition, or add OPENAI_API_KEY to enable server transcription.',
        { status: 503, code: 'CONFIG_REQUIRED' },
      );
    }
    const buffer = Buffer.from(String(audio).split(',').pop(), 'base64');
    if (buffer.length > 20 * 1024 * 1024) {
      throw new AppError('Audio clip is too long.', { status: 413, code: 'TOO_LARGE' });
    }
    const form = new FormData();
    form.append('file', new Blob([buffer], { type: mime }), 'clip.webm');
    form.append('model', process.env.OPENAI_STT_MODEL || 'whisper-1');
    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { authorization: `Bearer ${key}` },
      body: form,
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new AppError(`Transcription failed (${response.status}). ${detail.slice(0, 200)}`, {
        status: 502,
        code: 'PROVIDER_ERROR',
      });
    }
    const json = await response.json();
    res.json({ text: json.text || '' });
  } catch (error) {
    next(error);
  }
});

router.get('/history', (req, res) => {
  const db = getDb();
  const limit = Math.min(100, Number(req.query.limit) || 30);
  const sessions = db
    .prepare('SELECT * FROM speaking_sessions WHERE user_id = ? ORDER BY id DESC LIMIT ?')
    .all(req.user.id, limit)
    .map((s) => ({
      ...s,
      transcript: safeJson(s.transcript, []),
      feedback: safeJson(s.feedback, {}),
    }));
  res.json({ sessions });
});

export default router;
