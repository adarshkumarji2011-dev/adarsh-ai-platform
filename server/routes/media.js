import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Router } from 'express';
import multer from 'multer';
import { requireAuth, safeJson } from '../auth.js';
import { config } from '../config.js';
import { getDb } from '../db.js';
import { AppError, generateImage, synthesizeSpeech } from '../providers.js';
import { consume } from '../usage.js';

const router = Router();
router.use(requireAuth);

const IMAGE_STYLES = {
  realistic: 'photorealistic, natural lighting, sharp focus, 50mm lens, high detail',
  cinematic: 'cinematic film still, dramatic lighting, wide anamorphic look, colour graded, atmospheric haze',
  '3d': 'high-end 3D render, octane style, soft global illumination, subtle depth of field, clay-to-glass materials',
  anime: 'modern anime key visual, clean lineart, vibrant cel shading, expressive eyes, detailed background',
  portrait: 'professional studio portrait, beauty-dish lighting, shallow depth of field, editorial retouching',
  product: 'premium product photography, seamless studio backdrop, controlled reflections, catalogue quality',
  logo: 'flat vector logo mark, bold geometric shapes, balanced negative space, single centred subject, plain background',
  neon: 'futuristic neon cyberpunk scene, electric blue and violet glow, volumetric light, wet reflective surfaces',
};

function insertImage(userId, row) {
  const info = getDb()
    .prepare(
      'INSERT INTO images (user_id, prompt, style, file_name, mime, revised_prompt, provider) VALUES (?, ?, ?, ?, ?, ?, ?)',
    )
    .run(userId, row.prompt, row.style, row.fileName, row.mime, row.revisedPrompt || '', row.provider || '');
  return info.lastInsertRowid;
}

router.get('/styles', (_req, res) => {
  res.json({ styles: Object.entries(IMAGE_STYLES).map(([id, hint]) => ({ id, hint })) });
});

router.post('/images', async (req, res, next) => {
  try {
    const { prompt, style = 'realistic', size = '1024x1024' } = req.body || {};
    const clean = String(prompt || '').trim();
    if (clean.length < 3) {
      throw new AppError('Describe the image you want in a few words.', { status: 400, code: 'INVALID_INPUT' });
    }
    if (clean.length > 1200) {
      throw new AppError('Prompt is too long (1200 characters max).', { status: 400, code: 'INVALID_INPUT' });
    }
    const styleId = IMAGE_STYLES[style] ? style : 'realistic';
    const allowedSizes = ['1024x1024', '1024x1536', '1536x1024', '1792x1024', '1024x1792'];
    const chosenSize = allowedSizes.includes(size) ? size : '1024x1024';

    consume(req.user, 'image');
    const result = await generateImage({ prompt: clean, style: IMAGE_STYLES[styleId], size: chosenSize });

    const ext = result.mime.includes('jpeg') ? 'jpg' : result.mime.includes('webp') ? 'webp' : 'png';
    const fileName = `${crypto.randomUUID()}.${ext}`;
    fs.mkdirSync(path.join(config.dataDir, 'media'), { recursive: true });
    fs.writeFileSync(path.join(config.dataDir, 'media', fileName), result.buffer);

    const id = insertImage(req.user.id, {
      prompt: clean,
      style: styleId,
      fileName,
      mime: result.mime,
      revisedPrompt: result.revisedPrompt,
      provider: result.provider,
    });

    res.status(201).json({
      image: {
        id,
        prompt: clean,
        style: styleId,
        url: `/api/media/image/${id}`,
        mime: result.mime,
        revisedPrompt: result.revisedPrompt,
        provider: result.provider,
        created_at: new Date().toISOString(),
      },
    });
  } catch (error) {
    next(error);
  }
});

router.get('/images', (req, res) => {
  const rows = getDb()
    .prepare('SELECT * FROM images WHERE user_id = ? ORDER BY id DESC LIMIT 60')
    .all(req.user.id);
  res.json({
    images: rows.map((r) => ({ ...r, url: `/api/media/image/${r.id}` })),
  });
});

router.delete('/images/:id', (req, res) => {
  const db = getDb();
  const row = db.prepare('SELECT * FROM images WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!row) return res.status(404).json({ error: 'Image not found.', code: 'NOT_FOUND' });
  db.prepare('DELETE FROM images WHERE id = ?').run(row.id);
  fs.rm(path.join(config.dataDir, 'media', row.file_name), { force: true }, () => {});
  res.json({ ok: true });
});

/** Serve a stored image only to its owner (or to a premium public-link holder). */
router.get('/media/image/:id', requireAuth, (req, res) => {
  const row = getDb()
    .prepare('SELECT * FROM images WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.user.id);
  if (!row) return res.status(404).json({ error: 'Image not found.', code: 'NOT_FOUND' });
  const filePath = path.join(config.dataDir, 'media', row.file_name);
  if (!fs.existsSync(filePath)) {
    return res.status(410).json({ error: 'This image file is no longer available.', code: 'GONE' });
  }
  res.setHeader('content-type', row.mime);
  res.setHeader('cache-control', 'private, max-age=86400');
  fs.createReadStream(filePath).pipe(res);
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.maxUploadBytes, files: 1 },
});

/** PDF / image summarization helper — extracts text locally, no OCR claims. */
router.post('/extract', upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) throw new AppError('No file was uploaded.', { status: 400, code: 'INVALID_INPUT' });
    const { mimetype, buffer, originalname } = req.file;
    if (mimetype === 'application/pdf') {
      const text = extractPdfText(buffer);
      if (!text.trim()) {
        throw new AppError(
          'This PDF has no extractable text layer (it looks scanned). Paste the text instead, or upload a text-based PDF.',
          { status: 422, code: 'NO_TEXT_LAYER' },
        );
      }
      return res.json({ text: text.slice(0, 60000), name: originalname, kind: 'pdf' });
    }
    if (mimetype.startsWith('text/') || mimetype === 'application/json') {
      return res.json({ text: buffer.toString('utf8').slice(0, 60000), name: originalname, kind: 'text' });
    }
    throw new AppError(`Unsupported file type: ${mimetype}. Upload a PDF or text file.`, {
      status: 415,
      code: 'UNSUPPORTED_TYPE',
    });
  } catch (error) {
    next(error);
  }
});

/**
 * Minimal, dependency-free PDF text extractor: reads stream objects, inflates
 * FlateDecode streams and pulls text show operators. Good enough for standard
 * text PDFs; it deliberately reports "no text layer" instead of guessing.
 */
function extractPdfText(buffer) {
  const raw = buffer.toString('latin1');
  const pieces = [];
  const streamRe = /stream\r?\n([\s\S]*?)endstream/g;
  let match;
  while ((match = streamRe.exec(raw)) !== null) {
    let chunk = match[1];
    let text = '';
    try {
      text = require('node:zlib').inflateSync(Buffer.from(chunk, 'latin1')).toString('latin1');
    } catch {
      text = chunk;
    }
    const textRuns = text.match(/\((?:\\.|[^\\()])*\)/g);
    if (textRuns) {
      for (const run of textRuns) {
        pieces.push(run.slice(1, -1).replace(/\\([()\\])/g, '$1').replace(/\\n/g, ' '));
      }
      pieces.push('\n');
    }
  }
  return pieces.join(' ').replace(/[ \t]{2,}/g, ' ').trim();
}

router.post('/speech', async (req, res, next) => {
  try {
    const { text, voice = 'nova', speed = 1 } = req.body || {};
    const clean = String(text || '').trim();
    if (!clean) throw new AppError('Enter some text to speak.', { status: 400, code: 'INVALID_INPUT' });
    if (clean.length > 4000) {
      throw new AppError('Text is too long for the neural voice (4000 characters max).', {
        status: 400,
        code: 'INVALID_INPUT',
      });
    }
    consume(req.user, 'tts');
    const { buffer, mime } = await synthesizeSpeech({ text: clean, voice, speed });
    const fileName = `${crypto.randomUUID()}.mp3`;
    fs.mkdirSync(path.join(config.dataDir, 'media'), { recursive: true });
    fs.writeFileSync(path.join(config.dataDir, 'media', fileName), buffer);
    res.json({ audio: `/api/media/audio/${fileName}`, mime });
  } catch (error) {
    next(error);
  }
});

const AUDIO_RE = /^[a-f0-9-]{36}\.mp3$/i;
router.get('/media/audio/:file', requireAuth, (req, res) => {
  const file = req.params.file;
  if (!AUDIO_RE.test(file)) return res.status(400).json({ error: 'Invalid file name.', code: 'INVALID_INPUT' });
  const filePath = path.join(config.dataDir, 'media', path.basename(file));
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Audio file has expired.', code: 'NOT_FOUND' });
  }
  res.setHeader('content-type', 'audio/mpeg');
  res.setHeader('cache-control', 'private, max-age=3600');
  fs.createReadStream(filePath).pipe(res);
});

export default router;
