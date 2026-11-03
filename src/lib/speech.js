/**
 * Browser speech helpers: recognition (input) + speechSynthesis (output).
 * All of this runs client-side; no audio leaves the device for recognition
 * unless the browser vendor's own service is used (Chrome does this).
 */

const RecognitionCtor =
  typeof window !== 'undefined'
    ? window.SpeechRecognition || window.webkitSpeechRecognition
    : undefined;

export function recognitionAvailable() {
  return Boolean(RecognitionCtor);
}

export function speechSynthesisAvailable() {
  return typeof window !== 'undefined' && 'speechSynthesis' in window;
}

/**
 * Starts dictation. Returns a handle with stop()/abort().
 * onFinal(text) fires once per recognised phrase.
 */
export function listen({
  lang = 'en-IN',
  continuous = false,
  interim = true,
  onFinal,
  onPartial,
  onError,
  onEnd,
} = {}) {
  if (!RecognitionCtor) {
    onError?.(new Error('Speech recognition is not supported in this browser.'));
    return { stop() {}, abort() {} };
  }
  const recognition = new RecognitionCtor();
  recognition.lang = lang;
  recognition.continuous = continuous;
  recognition.interimResults = interim;
  recognition.maxAlternatives = 1;

  let stopped = false;

  recognition.onresult = (event) => {
    let finalText = '';
    let partial = '';
    for (let i = event.resultIndex; i < event.results.length; i += 1) {
      const result = event.results[i];
      if (result.isFinal) finalText += result[0].transcript;
      else partial += result[0].transcript;
    }
    if (finalText) onFinal?.(finalText.trim());
    if (partial) onPartial?.(partial.trim());
  };
  recognition.onerror = (event) => {
    if (event.error === 'aborted' || event.error === 'no-speech') return;
    onError?.(new Error(messageForRecognitionError(event.error)));
  };
  recognition.onend = () => {
    if (!stopped) onEnd?.();
  };

  try {
    recognition.start();
  } catch (error) {
    onError?.(error);
  }

  return {
    stop() {
      stopped = true;
      try {
        recognition.stop();
      } catch {
        /* noop */
      }
    },
    abort() {
      stopped = true;
      try {
        recognition.abort();
      } catch {
        /* noop */
      }
    },
  };
}

function messageForRecognitionError(code) {
  switch (code) {
    case 'not-allowed':
    case 'service-not-allowed':
      return 'Microphone access was blocked. Allow microphone permission in your browser to use voice input.';
    case 'audio-capture':
      return 'No microphone was found. Connect a microphone and try again.';
    case 'network':
      return 'The browser could not reach its speech service. Check your connection.';
    default:
      return 'Voice input stopped unexpectedly. Please try again.';
  }
}

/* ---------------- speech synthesis (output) ---------------- */

export function listVoices() {
  if (!speechSynthesisAvailable()) return [];
  return window.speechSynthesis.getVoices();
}

/** Voices load asynchronously in most browsers. */
export function onVoicesChanged(callback) {
  if (!speechSynthesisAvailable()) return () => {};
  const handler = () => callback(window.speechSynthesis.getVoices());
  window.speechSynthesis.addEventListener('voiceschanged', handler);
  return () => window.speechSynthesis.removeEventListener('voiceschanged', handler);
}

const INDIAN_HINTS = [/en[-_]IN/i, /hindi/i, /india/i];

/** Best-effort Indian English voice, falling back to any English voice. */
export function pickIndianEnglishVoice(voices = listVoices()) {
  const indian = voices.find(
    (v) => INDIAN_HINTS.some((re) => re.test(v.lang) || re.test(v.name)) && /^en/i.test(v.lang),
  );
  if (indian) return indian;
  return voices.find((v) => /^en/i.test(v.lang)) || voices[0] || null;
}

/** Splits long text so mobile browsers do not silently drop the tail. */
function chunkText(text, max = 220) {
  const sentences = String(text).replace(/\s+/g, ' ').trim().split(/(?<=[.!?।])\s+/);
  const chunks = [];
  let current = '';
  for (const sentence of sentences) {
    if ((current + ' ' + sentence).trim().length > max && current) {
      chunks.push(current.trim());
      current = sentence;
    } else {
      current = `${current} ${sentence}`.trim();
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks.length ? chunks : [String(text)];
}

/**
 * Speaks text with the browser engine.
 * Returns { promise, stop } — stop() halts playback immediately.
 */
export function speak(text, { rate = 1, pitch = 1, lang = 'en-IN', voiceName } = {}) {
  if (!speechSynthesisAvailable()) {
    return { promise: Promise.reject(new Error('This browser cannot play speech.')), stop() {} };
  }
  const synth = window.speechSynthesis;
  synth.cancel();

  const voices = listVoices();
  const voice =
    (voiceName && voices.find((v) => v.name === voiceName)) ||
    (lang === 'en-IN' ? pickIndianEnglishVoice(voices) : voices.find((v) => v.lang === lang)) ||
    pickIndianEnglishVoice(voices);

  const chunks = chunkText(text);
  let cancelled = false;

  const promise = new Promise((resolve, reject) => {
    let index = 0;
    const next = () => {
      if (cancelled) return resolve();
      if (index >= chunks.length) return resolve();
      const utterance = new SpeechSynthesisUtterance(chunks[index]);
      index += 1;
      utterance.rate = Math.min(2, Math.max(0.5, Number(rate) || 1));
      utterance.pitch = Math.min(2, Math.max(0.5, Number(pitch) || 1));
      if (voice) {
        utterance.voice = voice;
        utterance.lang = voice.lang || lang;
      } else {
        utterance.lang = lang;
      }
      utterance.onend = next;
      utterance.onerror = (event) => {
        if (event.error === 'interrupted' || cancelled) return resolve();
        reject(new Error('Speech playback failed.'));
      };
      synth.speak(utterance);
    };
    next();
  });

  return {
    promise,
    stop() {
      cancelled = true;
      synth.cancel();
    },
  };
}

export function stopSpeaking() {
  if (speechSynthesisAvailable()) window.speechSynthesis.cancel();
}
