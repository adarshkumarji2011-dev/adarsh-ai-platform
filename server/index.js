import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cookieParser from 'cookie-parser';
import { assertProductionSecrets, config } from './config.js';
import { ensureDirs, getDb, storage } from './db.js';
import { attachUser } from './auth.js';
import { availableTextProviders, capabilities } from './providers.js';
import authRoutes from './routes/auth.js';
import conversationRoutes from './routes/conversations.js';
import chatRoutes from './routes/chat.js';
import toolRoutes from './routes/tools.js';
import mediaRoutes from './routes/media.js';
import speakingRoutes from './routes/speaking.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

assertProductionSecrets();

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);

app.use(express.json({ limit: '24mb' }));
app.use(cookieParser());
app.use(attachUser);

if (config.isProduction) {
  app.use((req, res, next) => {
    res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader('referrer-policy', 'no-referrer');
    res.setHeader('x-frame-options', 'SAMEORIGIN');
    res.setHeader('permissions-policy', 'camera=(), geolocation=(), microphone=(self)');
    next();
  });
}

app.get('/api/health', (_req, res) => {
  let dbOk = false;
  try {
    getDb().prepare('SELECT 1').get();
    dbOk = true;
  } catch {
    dbOk = false;
  }
  res.status(dbOk ? 200 : 503).json({
    status: dbOk ? 'ok' : 'degraded',
    brand: 'ADARSH AI',
    storage: { driver: storage.kind, available: dbOk },
    providers: availableTextProviders(),
    capabilities: capabilities(),
  });
});

app.use('/api/auth', authRoutes);
app.use('/api/conversations', conversationRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/tools', toolRoutes);
app.use('/api/media', mediaRoutes);
app.use('/api/speaking', speakingRoutes);

app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'Unknown API endpoint.', code: 'NOT_FOUND' });
});

const distDir = path.join(rootDir, 'dist');
if (fs.existsSync(distDir)) {
  app.use(
    express.static(distDir, {
      index: false,
      setHeaders(res, filePath) {
        if (/\.(js|css|woff2?|png|svg|webp)$/.test(filePath)) {
          res.setHeader('cache-control', 'public, max-age=31536000, immutable');
        }
      },
    }),
  );
  app.get('*', (_req, res) => {
    res.sendFile(path.join(distDir, 'index.html'));
  });
} else {
  app.get('*', (_req, res) => {
    res
      .status(200)
      .type('html')
      .send(
        '<!doctype html><meta charset="utf-8"><title>ADARSH AI</title>' +
          '<body style="font-family:system-ui;background:#05060b;color:#e8eefc;padding:48px">' +
          '<h1>ADARSH AI</h1><p>The frontend bundle is not built yet. Run <code>npm run build</code> ' +
          'and restart, or use <code>npm run dev</code> for the Vite dev server.</p></body>',
      );
  });
}

// Central error handler — always JSON, never an HTML stack trace.
app.use((error, _req, res, _next) => {
  const status = Number(error?.status) || 500;
  if (status >= 500) {
    console.error('[adarsh-ai] request failed:', error?.code || '', error?.message || error);
  }
  const code = error?.code || (status >= 500 ? 'INTERNAL' : 'ERROR');
  if (res.headersSent) return res.end();
  res.status(status).json({
    error:
      status >= 500 && code === 'INTERNAL'
        ? 'Something went wrong on the server. Please try again.'
        : error.message,
    code,
  });
});

ensureDirs();
try {
  getDb();
  console.log('[adarsh-ai] storage ready at', storage.file);
} catch (error) {
  console.error('[adarsh-ai] storage unavailable:', error.message);
}

app.listen(config.port, '0.0.0.0', () => {
  const providers = availableTextProviders();
  console.log(`[adarsh-ai] ADARSH AI listening on 0.0.0.0:${config.port}`);
  console.log(
    providers.length
      ? `[adarsh-ai] text providers: ${providers.join(', ')}`
      : '[adarsh-ai] no AI provider configured — AI endpoints will return CONFIG_REQUIRED (503)',
  );
});

process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT', () => process.exit(0));
