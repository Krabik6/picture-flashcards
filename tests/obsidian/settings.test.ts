import { expect, test } from 'vitest';
import { AiError, type HttpPost } from '../../src/ai/provider';
import { DEFAULT_SETTINGS, resolveProvider, SECRET_IDS } from '../../src/obsidian/settings';

const reply = { candidates: [{ content: { parts: [{ text: JSON.stringify({ kind: 'k', explanation: 'e', example: 'x', scene: 's' }) }] } }] };
const input = { word: 'a', language: 'en', customPrompt: null };

test('uses the key of the chosen backend', async () => {
  const asked: string[] = [];
  const urls: string[] = [];
  const post: HttpPost = async (url) => { urls.push(url); return { status: 200, text: JSON.stringify(reply) }; };
  const settings = { ...DEFAULT_SETTINGS, backend: 'vertex' as const };
  const provider = resolveProvider(() => settings, (id) => { asked.push(id); return 'k'; }, post);
  await provider.generateCardText(input);
  expect(asked).toEqual([SECRET_IDS.vertex]);
  expect(urls[0]).toContain('aiplatform');
});

test('follows a backend change without restarting', async () => {
  const asked: string[] = [];
  const post: HttpPost = async () => ({ status: 200, text: JSON.stringify(reply) });
  const settings = { ...DEFAULT_SETTINGS };
  const provider = resolveProvider(() => settings, (id) => { asked.push(id); return 'k'; }, post);
  await provider.generateCardText(input);
  settings.backend = 'vertex';
  await provider.generateCardText(input);
  expect(asked).toEqual([SECRET_IDS.gemini, SECRET_IDS.vertex]);
});

test('missing key gives no-key error on use', async () => {
  const provider = resolveProvider(() => DEFAULT_SETTINGS, () => null, async () => ({ status: 200, text: '' }));
  const error = await provider.generateCardText(input).catch((e) => e);
  expect(error).toBeInstanceOf(AiError);
  expect(error.kind).toBe('no-key');
});

test('default image style is not tied to anime', () => {
  expect(DEFAULT_SETTINGS.defaultImageStyle.toLowerCase()).not.toContain('anime');
  expect(DEFAULT_SETTINGS.defaultImageStyle.toLowerCase()).not.toContain('аниме');
});
