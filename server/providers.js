import { config } from './config.js';

/**
 * Provider registry.
 *
 * Every entry here talks to a REAL remote API. There is deliberately no mock,
 * sample or "demo" fallback anywhere in this file: if no provider is
 * configured, callers receive a CONFIG_REQUIRED error that the UI surfaces to
 * the user verbatim.
 */

export class AppError extends Error {
  constructor(message, { status = 500, code = 'INTERNAL' } = {}) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function configError(feature) {
  return new AppError(
    `AI service not configured for ${feature}. Add an API key in the app environment (OPENAI_API_KEY, GROQ_API_KEY, ANTHROPIC_API_KEY or GEMINI_API_KEY) to enable it.`,
    { status: 503, code: 'CONFIG_REQUIRED' },
  );
}

export function availableTextProviders() {
  const list = [];
  if (config.providers.openai.apiKey) list.push('openai');
  if (config.providers.groq.apiKey) list.push('groq');
  if (config.providers.anthropic.apiKey) list.push('anthropic');
  if (config.providers.gemini.apiKey) list.push('gemini');
  return list;
}

export function capabilities() {
  const p = config.providers;
  const text = availableTextProviders();
  return {
    text: text.length > 0,
    streaming: text.length > 0,
    images: Boolean(p.openai.apiKey || p.gemini.apiKey),
    tts: Boolean(p.openai.apiKey),
    vision: Boolean(p.openai.apiKey || p.gemini.apiKey || p.anthropic.apiKey),
    speechRecognition: 'browser',
    textProviders: text,
  };
}

export function resolveTextProvider(preferred) {
  const p = config.providers;
  const order = [preferred, 'openai', 'groq', 'gemini', 'anthropic'].filter(Boolean);
  for (const key of order) {
    if (p[key]?.apiKey) return key;
  }
  throw configError('chat');
}

async function fetchJson(url, options, providerLabel) {
  let response;
  try {
    response = await fetch(url, options);
  } catch (error) {
    throw new AppError(
      `Could not reach the ${providerLabel} API: ${error.message}`,
      { status: 502, code: 'PROVIDER_UNREACHABLE' },
    );
  }
  if (!response.ok) {
    const raw = await response.text().catch(() => '');
    let detail = raw.slice(0, 500);
    try {
      const parsed = JSON.parse(raw);
      detail = parsed.error?.message || parsed.message || detail;
    } catch {
      /* keep raw text */
    }
    const status = response.status === 401 || response.status === 403 ? 502 : 502;
    throw new AppError(
      `${providerLabel} API error (${response.status}): ${detail || 'no details returned'}`,
      { status, code: 'PROVIDER_ERROR' },
    );
  }
  return response;
}

/** Split an OpenAI-compatible SSE stream into text deltas. */
async function* readSseDeltas(response, mapDelta) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const payload = trimmed.slice(5).trim();
      if (!payload || payload === '[DONE]') continue;
      try {
        const json = JSON.parse(payload);
        const text = mapDelta(json);
        if (text) yield text;
      } catch {
        /* ignore keep-alives */
      }
    }
  }
}

function toOpenAiMessages(messages) {
  return messages.map((m) => {
    if (m.role === 'assistant') return { role: 'assistant', content: m.content };
    if (Array.isArray(m.attachments) && m.attachments.length > 0) {
      const parts = [];
      if (m.content) parts.push({ type: 'text', text: m.content });
      for (const file of m.attachments) {
        if (file.kind === 'image' && file.dataUrl) {
          parts.push({ type: 'image_url', image_url: { url: file.dataUrl } });
        } else if (file.text) {
          parts.push({
            type: 'text',
            text: `Attached file "${file.name}":\n\n${file.text.slice(0, 20000)}`,
          });
        }
      }
      return { role: 'user', content: parts.length ? parts : m.content || '' };
    }
    return { role: 'user', content: m.content || '' };
  });
}

/**
 * Stream a chat completion. Yields {type:'delta', text} chunks and finally
 * {type:'done', provider, model}. Throws AppError on configuration/API failure.
 */
export async function* streamChat({
  messages,
  system,
  temperature = 0.7,
  maxTokens = 2048,
  provider: preferred,
  signal,
}) {
  const provider = resolveTextProvider(preferred);
  const conf = config.providers[provider];
  const fullMessages = system
    ? [{ role: 'system', content: system }, ...messages]
    : messages;

  if (provider === 'anthropic') {
    const response = await fetchJson(
      `${conf.baseUrl}/messages`,
      {
        method: 'POST',
        signal,
        headers: {
          'content-type': 'application/json',
          'x-api-key': conf.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: conf.model,
          max_tokens: maxTokens,
          temperature,
          system: system || undefined,
          stream: true,
          messages: messages.map((m) => ({
            role: m.role === 'assistant' ? 'assistant' : 'user',
            content: m.content || '',
          })),
        }),
      },
      conf.label,
    );
    yield* readSseDeltas(response, (json) =>
      json.type === 'content_block_delta' ? json.delta?.text || '' : '',
    );
    yield { type: 'done', provider, model: conf.model };
    return;
  }

  if (provider === 'gemini') {
    const contents = messages.map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content || '' }],
    }));
    const url = `${conf.baseUrl}/models/${conf.model}:streamGenerateContent?alt=sse&key=${conf.apiKey}`;
    const response = await fetchJson(
      url,
      {
        method: 'POST',
        signal,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          contents,
          systemInstruction: system ? { parts: [{ text: system }] } : undefined,
          generationConfig: { temperature, maxOutputTokens: maxTokens },
        }),
      },
      conf.label,
    );
    yield* readSseDeltas(
      response,
      (json) => json.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '',
    );
    yield { type: 'done', provider, model: conf.model };
    return;
  }

  // OpenAI-compatible (covers openai + groq + most gateways)
  const response = await fetchJson(
    `${conf.baseUrl}/chat/completions`,
    {
      method: 'POST',
      signal,
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${conf.apiKey}`,
      },
      body: JSON.stringify({
        model: conf.model,
        messages: toOpenAiMessages(fullMessages),
        temperature,
        max_tokens: maxTokens,
        stream: true,
      }),
    },
    conf.label,
  );
  yield* readSseDeltas(response, (json) => json.choices?.[0]?.delta?.content || '');
  yield { type: 'done', provider, model: conf.model };
}

/** Non-streaming completion (used by tool endpoints that need one block). */
export async function completeChat(options) {
  let text = '';
  let info = null;
  for await (const chunk of streamChat(options)) {
    if (chunk.type === 'delta') text += chunk.text;
    else if (chunk.type === 'done') info = chunk;
  }
  if (!text.trim()) {
    throw new AppError('The AI provider returned an empty response. Please try again.', {
      status: 502,
      code: 'EMPTY_RESPONSE',
    });
  }
  return { text, ...info };
}

/** Real image generation. Returns { buffer, mime, revisedPrompt, provider }. */
export async function generateImage({ prompt, style, size = '1024x1024' }) {
  const confs = [config.providers.openai, config.providers.gemini].filter((c) => c.apiKey);
  if (confs.length === 0) throw configError('image generation');
  const styledPrompt = `${prompt}\n\nStyle: ${style}.`;

  for (const conf of confs) {
    const isOpenAi = conf === config.providers.openai;
    try {
      if (isOpenAi) {
        const response = await fetchJson(
          `${conf.baseUrl}/images/generations`,
          {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              authorization: `Bearer ${conf.apiKey}`,
            },
            body: JSON.stringify({
              model: conf.imageModel,
              prompt: styledPrompt,
              n: 1,
              size,
            }),
          },
          conf.label,
        );
        const json = await response.json();
        const first = json.data?.[0];
        if (first?.b64_json) {
          return {
            buffer: Buffer.from(first.b64_json, 'base64'),
            mime: 'image/png',
            revisedPrompt: first.revised_prompt || '',
            provider: conf.label,
          };
        }
        if (first?.url) {
          const img = await fetch(first.url);
          if (!img.ok) throw new Error(`image download failed (${img.status})`);
          return {
            buffer: Buffer.from(await img.arrayBuffer()),
            mime: img.headers.get('content-type') || 'image/png',
            revisedPrompt: first.revised_prompt || '',
            provider: conf.label,
          };
        }
        throw new AppError('Image provider returned no image data.', {
          status: 502,
          code: 'EMPTY_RESPONSE',
        });
      }
      // Gemini / Imagen
      const response = await fetchJson(
        `${conf.baseUrl}/models/${conf.imageModel}:predict?key=${conf.apiKey}`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            instances: [{ prompt: styledPrompt }],
            parameters: { sampleCount: 1 },
          }),
        },
        conf.label,
      );
      const json = await response.json();
      const b64 = json.predictions?.[0]?.bytesBase64Encoded;
      if (!b64) {
        throw new AppError('Image provider returned no image data.', {
          status: 502,
          code: 'EMPTY_RESPONSE',
        });
      }
      return {
        buffer: Buffer.from(b64, 'base64'),
        mime: json.predictions?.[0]?.mimeType || 'image/png',
        revisedPrompt: '',
        provider: conf.label,
      };
    } catch (error) {
      if (conf === confs[confs.length - 1]) throw error;
      console.warn('[adarsh-ai] image provider failed, trying next:', error.message);
    }
  }
  throw configError('image generation');
}

/** Real neural TTS (OpenAI-compatible). Returns { buffer, mime }. */
export async function synthesizeSpeech({ text, voice = 'nova', speed = 1 }) {
  const conf = config.providers.openai;
  if (!conf.apiKey) throw configError('text to speech');
  const response = await fetchJson(
    `${conf.baseUrl}/audio/speech`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${conf.apiKey}`,
      },
      body: JSON.stringify({
        model: conf.ttsModel,
        voice,
        input: text.slice(0, 4000),
        speed: Math.min(2, Math.max(0.25, Number(speed) || 1)),
        response_format: 'mp3',
      }),
    },
    conf.label,
  );
  const buffer = Buffer.from(await response.arrayBuffer());
  return { buffer, mime: 'audio/mpeg' };
}
