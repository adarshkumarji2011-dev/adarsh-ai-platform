const JSON_HEADERS = { 'content-type': 'application/json' };

export class ApiError extends Error {
  constructor(message, { status = 0, code = 'NETWORK' } = {}) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export async function api(path, { method = 'GET', body, signal } = {}) {
  let response;
  try {
    response = await fetch(`/api${path}`, {
      method,
      credentials: 'same-origin',
      headers: body ? JSON_HEADERS : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal,
    });
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    throw new ApiError('Cannot reach the ADARSH AI server. Check your connection and try again.');
  }

  const text = await response.text();
  let payload = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
  }
  if (!response.ok) {
    throw new ApiError(payload?.error || `Request failed (${response.status}).`, {
      status: response.status,
      code: payload?.code || 'HTTP_ERROR',
    });
  }
  return payload;
}

export const get = (path, options) => api(path, options);
export const post = (path, body, options) => api(path, { ...options, method: 'POST', body });
export const patch = (path, body, options) => api(path, { ...options, method: 'PATCH', body });
export const del = (path, options) => api(path, { ...options, method: 'DELETE' });

/**
 * Streams a chat completion over SSE.
 * Calls onEvent({type:'start'|'delta'|'done'|'error', ...}).
 */
export async function streamChat(payload, { signal, onEvent }) {
  const response = await fetch('/api/chat', {
    method: 'POST',
    credentials: 'same-origin',
    headers: JSON_HEADERS,
    body: JSON.stringify(payload),
    signal,
  });

  if (!response.ok) {
    const raw = await response.text();
    let parsed = null;
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = null;
    }
    throw new ApiError(parsed?.error || `Chat failed (${response.status}).`, {
      status: response.status,
      code: parsed?.code || 'HTTP_ERROR',
    });
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  const emit = (data) => {
    try {
      onEvent(JSON.parse(data));
    } catch {
      /* ignore malformed frames */
    }
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split('\n\n');
    buffer = frames.pop() || '';
    for (const frame of frames) {
      const line = frame.split('\n').find((l) => l.startsWith('data:'));
      if (line) emit(line.slice(5).trim());
    }
  }
  if (buffer.trim().startsWith('data:')) emit(buffer.trim().slice(5).trim());
}

/** Same protocol for the speaking tutor. */
export async function streamSpeakingTurn(payload, { signal, onEvent }) {
  const response = await fetch('/api/speaking/turn', {
    method: 'POST',
    credentials: 'same-origin',
    headers: JSON_HEADERS,
    body: JSON.stringify(payload),
    signal,
  });
  if (!response.ok) {
    const raw = await response.text();
    let parsed = null;
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = null;
    }
    throw new ApiError(parsed?.error || `Practice failed (${response.status}).`, {
      status: response.status,
      code: parsed?.code || 'HTTP_ERROR',
    });
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split('\n\n');
    buffer = frames.pop() || '';
    for (const frame of frames) {
      const line = frame.split('\n').find((l) => l.startsWith('data:'));
      if (line) {
        try {
          onEvent(JSON.parse(line.slice(5).trim()));
        } catch {
          /* ignore */
        }
      }
    }
  }
}

/** Reads a local file into {kind, name, dataUrl|text}. */
export function readAttachment(file) {
  return new Promise((resolve, reject) => {
    const isImage = file.type.startsWith('image/');
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`Could not read ${file.name}.`));
    reader.onload = () =>
      resolve(
        isImage
          ? { kind: 'image', name: file.name, dataUrl: String(reader.result) }
          : { kind: 'text', name: file.name, text: String(reader.result).slice(0, 60000) },
      );
    if (isImage) reader.readAsDataURL(file);
    else reader.readAsText(file);
  });
}

export function downloadBlobUrl(url, filename) {
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement('textarea');
    area.value = text;
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    return ok;
  }
}
