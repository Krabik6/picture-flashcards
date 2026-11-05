import { beforeEach, expect, test } from 'vitest';
import { addDraft, fillCard, regenerateAll, regenerateImage, type CreationDeps } from '../../src/core/cardCreation';
import { createScheduler } from '../../src/core/scheduler';
import { FakeProvider } from '../fakes/fakeProvider';
import { MemoryStore } from '../fakes/memoryStore';

const DECK = 'deck';
let store: MemoryStore;
let provider: FakeProvider;
let deps: CreationDeps;
let nextId: number;

beforeEach(() => {
  store = new MemoryStore({ language: 'Japanese', imageStyle: 'anime', newCardsPerDay: 20 });
  provider = new FakeProvider();
  nextId = 0;
  deps = { store, provider, scheduler: createScheduler(), now: () => new Date('2026-11-05T12:00:00.000Z'), newId: () => `id${++nextId}` };
});
const stored = async (id: string) => (await store.readDeck(DECK)).cards.find((c) => c.id === id);

test('draft is saved before any AI call', async () => {
  provider.gate = new Promise(() => {});
  const card = await addDraft(deps, DECK, '  猫 ');
  expect(provider.textCalls).toHaveLength(0);
  expect((await stored(card.id))?.status).toBe('draft');
  expect((await stored(card.id))?.word).toBe('猫');
});

test('fill makes a ready card', async () => {
  const { id } = await addDraft(deps, DECK, '猫');
  const card = await fillCard(deps, DECK, id);
  expect(card?.status).toBe('ready');
  expect(card?.lastError).toBeNull();
  expect(card?.media.image).toBeTruthy();
  expect(card?.media.wordAudio).toBeTruthy();
  expect(card?.media.exampleAudio).toBeTruthy();
  expect(provider.textCalls[0].language).toBe('Japanese');
  expect(provider.imageCalls[0]).toEqual({ scene: 'scene', style: 'anime' });
});

test('word audio uses the reading when there is one', async () => {
  provider.text = { ...provider.text, reading: 'ねこ' };
  const { id } = await addDraft(deps, DECK, '猫');
  await fillCard(deps, DECK, id);
  expect(provider.speechCalls).toEqual(['ねこ', 'example']);
});

test('failed step keeps what is done', async () => {
  provider.failOn = 'image';
  const { id } = await addDraft(deps, DECK, '猫');
  const card = await fillCard(deps, DECK, id);
  expect(card?.status).toBe('draft');
  expect(card?.explanation).toBe('explain');
  expect(card?.lastError).toBeTruthy();
  expect((await stored(id))?.lastError).toBeTruthy();
});

test('retry does only the missing parts', async () => {
  provider.failOn = 'image';
  const { id } = await addDraft(deps, DECK, '猫');
  await fillCard(deps, DECK, id);
  provider.failOn = null;
  const card = await fillCard(deps, DECK, id);
  expect(provider.textCalls).toHaveLength(1);
  expect(card?.status).toBe('ready');
  expect(card?.lastError).toBeNull();
});

test('card without image never becomes ready', async () => {
  provider.failOn = 'image';
  const { id } = await addDraft(deps, DECK, '猫');
  expect((await fillCard(deps, DECK, id))?.status).toBe('draft');
  expect(provider.speechCalls).toHaveLength(0);
});

test('card deleted during generation does not come back', async () => {
  let release = () => {};
  provider.gate = new Promise((resolve) => { release = resolve; });
  const { id } = await addDraft(deps, DECK, '猫');
  const running = fillCard(deps, DECK, id);
  await store.deleteCard(DECK, id);
  release();
  expect(await running).toBeNull();
  expect(await stored(id)).toBeUndefined();
  expect(store.media.size).toBe(0);
});

test('regenerateImage with prompt replaces scene only', async () => {
  const { id } = await addDraft(deps, DECK, '猫');
  const before = await fillCard(deps, DECK, id);
  const oldImage = before!.media.image!;
  const after = await regenerateImage(deps, DECK, id, 'a green cat');
  expect(provider.imageCalls[1]).toEqual({ scene: 'a green cat', style: 'anime' });
  expect(after.media.image).not.toBe(oldImage);
  expect(after.explanation).toBe(before!.explanation);
  expect(after.media.wordAudio).toBe(before!.media.wordAudio);
  expect(await store.mediaExists(DECK, oldImage)).toBe(false);
  expect(provider.textCalls).toHaveLength(1);
});

test('regenerateImage without prompt reuses the saved scene', async () => {
  const { id } = await addDraft(deps, DECK, '猫');
  await fillCard(deps, DECK, id);
  await regenerateImage(deps, DECK, id, null);
  expect(provider.imageCalls[1].scene).toBe('scene');
});

test('regenerateImage failure keeps the old picture', async () => {
  const { id } = await addDraft(deps, DECK, '猫');
  const before = await fillCard(deps, DECK, id);
  provider.failOn = 'image';
  await expect(regenerateImage(deps, DECK, id, null)).rejects.toThrow();
  expect((await stored(id))?.media.image).toBe(before!.media.image);
  expect(await store.mediaExists(DECK, before!.media.image!)).toBe(true);
});

test('regenerateAll passes prompt to text and keeps schedule', async () => {
  const { id } = await addDraft(deps, DECK, '猫');
  const before = await fillCard(deps, DECK, id);
  const schedule = { ...before!.schedule, firstReviewedAt: '2026-11-01T00:00:00.000Z' };
  await store.updateCard(DECK, id, (c) => ({ ...c, schedule }));
  provider.text = { ...provider.text, explanation: 'second meaning', scene: 'new scene' };
  const after = await regenerateAll(deps, DECK, id, 'the other meaning');
  expect(provider.textCalls[1].customPrompt).toBe('the other meaning');
  expect(provider.imageCalls[1].scene).toBe('new scene');
  expect(after.explanation).toBe('second meaning');
  expect(after.schedule).toEqual(schedule);
  expect(await store.mediaExists(DECK, before!.media.image!)).toBe(false);
  expect(await store.mediaExists(DECK, before!.media.wordAudio!)).toBe(false);
  expect(store.media.size).toBe(3);
});

test('regenerateAll failure leaves old card intact', async () => {
  const { id } = await addDraft(deps, DECK, '猫');
  const before = await fillCard(deps, DECK, id);
  provider.text = { ...provider.text, explanation: 'second meaning' };
  provider.failOn = 'speech';
  await expect(regenerateAll(deps, DECK, id, null)).rejects.toThrow();
  expect(await stored(id)).toEqual(before);
  expect(store.media.size).toBe(3);
});

test('fill does not overwrite a change made to another card', async () => {
  const other = await addDraft(deps, DECK, 'other');
  let release = () => {};
  provider.gate = new Promise((resolve) => { release = resolve; });
  const { id } = await addDraft(deps, DECK, '猫');
  const running = fillCard(deps, DECK, id);
  await store.updateCard(DECK, other.id, (c) => ({ ...c, explanation: 'edited' }));
  release();
  await running;
  expect((await stored(other.id))?.explanation).toBe('edited');
});
