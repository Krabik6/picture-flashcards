import { expect, test } from 'vitest';
import { createGoogleProvider } from '../../src/ai/google';
import { AiError, type HttpPost } from '../../src/ai/provider';

type Reply = { status: number; text: string };
const json = (value: unknown, status = 200): Reply => ({ status, text: JSON.stringify(value) });
const parts = (...p: unknown[]) => json({ candidates: [{ content: { parts: p } }] });
const textReply = (value: unknown) => parts({ text: JSON.stringify(value) });
const CARD_TEXT = { reading: 'ねこ', kind: '名詞', explanation: 'e', example: 'x', scene: 's' };

function fake(reply: Reply | (() => Reply)) {
  const calls: { url: string; headers: Record<string, string>; body: string }[] = [];
  const post: HttpPost = async (url, headers, body) => {
    calls.push({ url, headers, body });
    return typeof reply === 'function' ? reply() : reply;
  };
  return { post, calls };
}
const provider = (post: HttpPost, backend: 'gemini' | 'vertex' = 'gemini') =>
  createGoogleProvider({ backend, apiKey: 'test-key', post });
const failure = async (p: Promise<unknown>) => p.then(() => { throw new Error('expected failure'); }, (e) => e as AiError);
const textInput = { word: '猫', language: 'Japanese', customPrompt: null };

test('gemini address and key header', async () => {
  const { post, calls } = fake(textReply(CARD_TEXT));
  await provider(post).generateCardText(textInput);
  expect(calls[0].url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent');
  expect(calls[0].headers['x-goog-api-key']).toBe('test-key');
});

test('uses the chosen backend only', async () => {
  const { post, calls } = fake({ status: 500, text: 'boom' });
  await failure(provider(post, 'vertex').generateCardText(textInput));
  expect(calls).toHaveLength(1);
  expect(calls[0].url).toBe('https://aiplatform.googleapis.com/v1/publishers/google/models/gemini-3.8-flash:generateContent');
});

test('text prompt demands target language and no translation', async () => {
  const { post, calls } = fake(textReply(CARD_TEXT));
  await provider(post).generateCardText({ ...textInput, customPrompt: 'the animal, not the jazz fan' });
  const body = calls[0].body;
  expect(body).toContain('Japanese');
  expect(body).toContain('Never translate');
  expect(body).toContain('the animal, not the jazz fan');
  expect(JSON.parse(body).generationConfig.responseMimeType).toBe('application/json');
});

test('card text is parsed, empty reading becomes null', async () => {
  const { post } = fake(textReply({ ...CARD_TEXT, reading: '' }));
  expect(await provider(post).generateCardText(textInput)).toEqual({ ...CARD_TEXT, reading: null });
});

test('image instructions forbid text and carry the style', async () => {
  const { post, calls } = fake(parts({ inlineData: { mimeType: 'image/png', data: btoa('abc') } }));
  await provider(post).generateImage({ scene: 'a cat', style: 'watercolor' });
  expect(calls[0].body).toContain('a cat');
  expect(calls[0].body).toContain('watercolor');
  expect(calls[0].body).toContain('no text');
});

test('image response becomes BinaryFile', async () => {
  const { post } = fake(parts({ text: 'here' }, { inlineData: { mimeType: 'image/png', data: btoa('abc') } }));
  const file = await provider(post).generateImage({ scene: 's', style: '' });
  expect(file.extension).toBe('png');
  expect(new TextDecoder().decode(file.bytes)).toBe('abc');
});

test('speech PCM is wrapped into WAV', async () => {
  const { post } = fake(parts({ inlineData: { mimeType: 'audio/L16;codec=pcm;rate=24000', data: btoa('abcd') } }));
  const file = await provider(post).generateSpeech({ text: 'hi' });
  expect(file.extension).toBe('wav');
  const bytes = new Uint8Array(file.bytes);
  expect(new TextDecoder().decode(bytes.slice(0, 4))).toBe('RIFF');
  expect(new DataView(file.bytes).getUint32(24, true)).toBe(24000);
  expect(bytes.length).toBe(44 + 4);
});

test('speech that is already WAV stays as it is', async () => {
  const { post } = fake(parts({ inlineData: { mimeType: 'audio/wav', data: btoa('RIFFxx') } }));
  const file = await provider(post).generateSpeech({ text: 'hi' });
  expect(file.extension).toBe('wav');
  expect(new TextDecoder().decode(file.bytes)).toBe('RIFFxx');
});

test.each([[401, 'bad-key'], [403, 'bad-key'], [429, 'overloaded'], [503, 'overloaded'], [404, 'bad-response']])(
  'status %i maps to %s', async (status, kind) => {
    const { post } = fake({ status, text: '{"error":{"message":"nope"}}' });
    const e = await failure(provider(post).generateCardText(textInput));
    expect(e).toBeInstanceOf(AiError);
    expect(e.kind).toBe(kind);
  });

test('invalid key reported with status 400 maps to bad-key', async () => {
  const { post } = fake(json({ error: { message: 'API key not valid. Please pass a valid API key.' } }, 400));
  expect((await failure(provider(post).generateCardText(textInput))).kind).toBe('bad-key');
});

test('response without image is bad-response', async () => {
  const { post } = fake(parts({ text: 'sorry' }));
  expect((await failure(provider(post).generateImage({ scene: 's', style: '' }))).kind).toBe('bad-response');
});

test('text that is not valid JSON is bad-response', async () => {
  const { post } = fake(parts({ text: 'not json' }));
  expect((await failure(provider(post).generateCardText(textInput))).kind).toBe('bad-response');
});

test('text without required fields is bad-response', async () => {
  const { post } = fake(textReply({ kind: 'noun' }));
  expect((await failure(provider(post).generateCardText(textInput))).kind).toBe('bad-response');
});

test('safety block maps to blocked', async () => {
  const { post } = fake(json({ promptFeedback: { blockReason: 'SAFETY' } }));
  expect((await failure(provider(post).generateCardText(textInput))).kind).toBe('blocked');
  const { post: post2 } = fake(json({ candidates: [{ finishReason: 'IMAGE_SAFETY' }] }));
  expect((await failure(provider(post2).generateImage({ scene: 's', style: '' }))).kind).toBe('blocked');
});

test('network failure maps to network', async () => {
  const post: HttpPost = async () => { throw new Error('offline'); };
  expect((await failure(provider(post).generateCardText(textInput))).kind).toBe('network');
});
