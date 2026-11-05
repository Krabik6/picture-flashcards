import { beforeEach, expect, test } from 'vitest';
import type { CreationDeps } from '../../src/core/cardCreation';
import { CreationQueue } from '../../src/core/creationQueue';
import { createScheduler } from '../../src/core/scheduler';
import { FakeProvider } from '../fakes/fakeProvider';
import { MemoryStore } from '../fakes/memoryStore';

let provider: FakeProvider;
let store: MemoryStore;
let deps: CreationDeps;
let id = 0;
const tick = () => new Promise((r) => setTimeout(r, 0));
const settle = async (queue: CreationQueue) => {
  for (let i = 0; i < 200 && queue.items().some((x) => x.state === 'waiting' || x.state === 'working'); i++) await tick();
};

beforeEach(() => {
  provider = new FakeProvider();
  store = new MemoryStore({ language: 'en', imageStyle: '', newCardsPerDay: 20 });
  deps = { store, provider, scheduler: createScheduler(), now: () => new Date(), newId: () => `q${++id}` };
});

test('add returns before generation finishes', async () => {
  provider.gate = new Promise(() => {});
  const queue = new CreationQueue(deps);
  const item = await queue.add('deck', 'cat');
  expect(item.word).toBe('cat');
  expect(['waiting', 'working']).toContain(queue.items()[0].state);
});

test('no more than two run at once', async () => {
  let release = () => {};
  provider.gate = new Promise((resolve) => { release = resolve; });
  const queue = new CreationQueue(deps, 2);
  for (const w of ['a', 'b', 'c', 'd', 'e']) await queue.add('deck', w);
  await tick();
  expect(queue.items().filter((x) => x.state === 'working')).toHaveLength(2);
  release();
  await settle(queue);
  expect(queue.items().every((x) => x.state === 'done')).toBe(true);
});

test('one failure does not stop the rest', async () => {
  const queue = new CreationQueue(deps);
  provider.failOn = 'image';
  await queue.add('deck', 'bad');
  await settle(queue);
  provider.failOn = null;
  await queue.add('deck', 'good');
  await settle(queue);
  const states = Object.fromEntries(queue.items().map((x) => [x.word, x.state]));
  expect(states).toEqual({ bad: 'failed', good: 'done' });
  expect(queue.items().find((x) => x.word === 'bad')?.error).toBeTruthy();
});

test('retry reruns a failed card', async () => {
  const queue = new CreationQueue(deps);
  provider.failOn = 'image';
  const item = await queue.add('deck', 'bad');
  await settle(queue);
  provider.failOn = null;
  queue.retry('deck', item.cardId, 'bad');
  await settle(queue);
  expect(queue.items().find((x) => x.cardId === item.cardId)?.state).toBe('done');
});

test('listeners hear every change and can unsubscribe', async () => {
  const queue = new CreationQueue(deps);
  let heard = 0;
  const off = queue.subscribe(() => { heard++; });
  await queue.add('deck', 'a');
  await settle(queue);
  const before = heard;
  expect(before).toBeGreaterThan(1);
  off();
  await queue.add('deck', 'b');
  await settle(queue);
  expect(heard).toBe(before);
});
