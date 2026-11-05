import { MODELS } from './models';
import { AiError, type AiProvider, type BinaryFile, type CardText, type HttpPost } from './provider';
import { pcmToWav } from './wav';

const BASE_URLS = {
  gemini: 'https://generativelanguage.googleapis.com/v1beta/models',
  vertex: 'https://aiplatform.googleapis.com/v1/publishers/google/models',
};
const EXTENSIONS: Record<string, string> = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp',
  'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/mpeg': 'mp3', 'audio/mp3': 'mp3',
};
const BLOCK_REASONS = new Set(['SAFETY', 'IMAGE_SAFETY', 'PROHIBITED_CONTENT', 'BLOCKLIST', 'RECITATION']);
const VOICE = 'Kore';

interface Part {
  text?: string;
  thought?: boolean;
  inlineData?: { mimeType: string; data: string };
}
interface GoogleResponse {
  candidates?: { content?: { parts?: Part[] }; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
}

function decodeBase64(data: string): Uint8Array {
  const raw = atob(data);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

const toBuffer = (bytes: Uint8Array) => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;

function errorDetail(text: string): string {
  try {
    return JSON.parse(text)?.error?.message ?? text.slice(0, 300);
  } catch {
    return text.slice(0, 300);
  }
}

function cardTextPrompt(word: string, language: string, customPrompt: string | null): string {
  const note = customPrompt ? `\nThe author's note about the meaning or the picture, follow it: ${JSON.stringify(customPrompt)}` : '';
  return `You write one flashcard for a person who learns through pictures, without any translation.
Word or phrase: ${JSON.stringify(word)}
Card language: ${language}${note}

Write "kind", "explanation" and "example" entirely in ${language}. Never translate into another language and never mention another language.
Take the most common meaning unless the author's note says otherwise.

Return JSON with exactly these fields:
- "reading": how to read the word, only if the writing system of the card language needs it (kana for Japanese kanji, pinyin for Chinese). Otherwise an empty string.
- "kind": the type of the word in the card language, for example noun, verb, set phrase.
- "explanation": one or two simple sentences that explain the meaning.
- "example": one natural sentence that uses the word.
- "scene": in English, a description of one picture for an illustrator. It must be deliberately obvious, so that a person looking at it thinks of exactly this word and not of a near synonym. For an abstract word, describe a small situation where this word fits. The scene must not rely on any written text.`;
}

function imagePrompt(scene: string, style: string): string {
  const styleLine = style ? `\nStyle: ${style}` : '';
  return `${scene}\n\nMake the picture deliberately obvious: one clear subject, understood at a glance. Absolutely no text, letters, numbers, signs or captions anywhere in the image.${styleLine}`;
}

export function createGoogleProvider(opts: { backend: 'gemini' | 'vertex'; apiKey: string; post: HttpPost }): AiProvider {
  async function call(model: string, parts: Part[], generationConfig: Record<string, unknown>): Promise<GoogleResponse> {
    const url = `${BASE_URLS[opts.backend]}/${model}:generateContent`;
    const headers = { 'Content-Type': 'application/json', 'x-goog-api-key': opts.apiKey };
    let res: { status: number; text: string };
    try {
      res = await opts.post(url, headers, JSON.stringify({ contents: [{ role: 'user', parts }], generationConfig }));
    } catch (e) {
      throw new AiError('network', String(e));
    }
    if (res.status === 401 || res.status === 403 || (res.status === 400 && /api.?key/i.test(res.text))) {
      throw new AiError('bad-key', errorDetail(res.text));
    }
    if (res.status === 429 || res.status >= 500) throw new AiError('overloaded', errorDetail(res.text));
    if (res.status !== 200) throw new AiError('bad-response', `${res.status}: ${errorDetail(res.text)}`);
    let data: GoogleResponse;
    try {
      data = JSON.parse(res.text);
    } catch {
      throw new AiError('bad-response', res.text.slice(0, 300));
    }
    const finish = data.candidates?.[0]?.finishReason;
    if (data.promptFeedback?.blockReason || (finish && BLOCK_REASONS.has(finish))) {
      throw new AiError('blocked', data.promptFeedback?.blockReason ?? finish ?? '');
    }
    return data;
  }

  const partsOf = (data: GoogleResponse) => data.candidates?.[0]?.content?.parts ?? [];

  function inlineFile(data: GoogleResponse, prefix: string): { mime: string; bytes: Uint8Array } {
    const found = partsOf(data).find((p) => p.inlineData?.mimeType.startsWith(prefix));
    if (!found?.inlineData) throw new AiError('bad-response', `В ответе нет файла ${prefix}`);
    return { mime: found.inlineData.mimeType, bytes: decodeBase64(found.inlineData.data) };
  }

  return {
    async generateCardText({ word, language, customPrompt }) {
      const data = await call(MODELS.text, [{ text: cardTextPrompt(word, language, customPrompt) }], { responseMimeType: 'application/json' });
      const raw = partsOf(data).filter((p) => !p.thought).map((p) => p.text ?? '').join('');
      let value: Partial<CardText>;
      try {
        value = JSON.parse(raw);
      } catch {
        throw new AiError('bad-response', raw.slice(0, 300));
      }
      const { reading, kind, explanation, example, scene } = value;
      if (!kind || !explanation || !example || !scene) throw new AiError('bad-response', raw.slice(0, 300));
      return { reading: reading || null, kind, explanation, example, scene };
    },

    async generateImage({ scene, style }): Promise<BinaryFile> {
      const data = await call(MODELS.image, [{ text: imagePrompt(scene, style) }], {
        responseModalities: ['TEXT', 'IMAGE'],
        imageConfig: { aspectRatio: '4:3' },
      });
      const { mime, bytes } = inlineFile(data, 'image/');
      return { bytes: toBuffer(bytes), extension: EXTENSIONS[mime] ?? 'png' };
    },

    async generateSpeech({ text }): Promise<BinaryFile> {
      const data = await call(MODELS.speech, [{ text }], {
        responseModalities: ['AUDIO'],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: VOICE } } },
      });
      const { mime, bytes } = inlineFile(data, 'audio/');
      if (/L16|pcm/i.test(mime)) {
        const rate = Number(/rate=(\d+)/.exec(mime)?.[1] ?? 24000);
        return { bytes: pcmToWav(bytes, rate), extension: 'wav' };
      }
      return { bytes: toBuffer(bytes), extension: EXTENSIONS[mime.split(';')[0]] ?? 'wav' };
    },
  };
}
