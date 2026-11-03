import path from 'node:path';

const env = process.env;

export const config = {
  port: Number(env.PORT || 3000),
  nodeEnv: env.NODE_ENV || 'development',
  isProduction: (env.NODE_ENV || 'development') === 'production',
  dataDir: env.DATA_DIR ? path.resolve(env.DATA_DIR) : path.resolve('data'),
  jwtSecret:
    env.JWT_SECRET ||
    (env.NODE_ENV === 'production' ? '' : 'dev-only-insecure-secret-change-me'),
  sessionDays: Number(env.SESSION_DAYS || 30),
  maxUploadBytes: Number(env.MAX_UPLOAD_BYTES || 12 * 1024 * 1024),
  cookieName: 'adarsh_session',

  // Limits per plan / day. Enforced server-side; never trust the client.
  limits: {
    free: { chat: 80, image: 12, tts: 40, text: 120, speaking: 40 },
    premium: { chat: 1000, image: 200, tts: 400, text: 1200, speaking: 400 },
  },

  providers: {
    // Any OpenAI-compatible endpoint (OpenAI, Groq, Together, OpenRouter, ...)
    openai: {
      apiKey: env.OPENAI_API_KEY || '',
      baseUrl: (env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, ''),
      model: env.OPENAI_MODEL || 'gpt-4o-mini',
      imageModel: env.OPENAI_IMAGE_MODEL || 'gpt-image-1',
      ttsModel: env.OPENAI_TTS_MODEL || 'tts-1',
      label: env.OPENAI_PROVIDER_LABEL || 'OpenAI-compatible',
    },
    groq: {
      apiKey: env.GROQ_API_KEY || '',
      baseUrl: 'https://api.groq.com/openai/v1',
      model: env.GROQ_MODEL || 'llama-3.3-70b-versatile',
      label: 'Groq (OpenAI-compatible)',
    },
    anthropic: {
      apiKey: env.ANTHROPIC_API_KEY || '',
      baseUrl: (env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com/v1').replace(/\/$/, ''),
      model: env.ANTHROPIC_MODEL || 'claude-3-5-sonnet-latest',
      label: 'Anthropic',
    },
    gemini: {
      apiKey: env.GEMINI_API_KEY || env.GOOGLE_API_KEY || '',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
      model: env.GEMINI_MODEL || 'gemini-2.0-flash',
      imageModel: env.GEMINI_IMAGE_MODEL || 'imagen-3.0-generate-002',
      label: 'Google Gemini',
    },
  },
};

export function assertProductionSecrets() {
  if (config.isProduction && !process.env.JWT_SECRET) {
    // Fail loudly instead of shipping a guessable session secret.
    console.error(
      '[adarsh-ai] FATAL: JWT_SECRET is required in production. Set it in the app environment.',
    );
    process.exit(1);
  }
}
