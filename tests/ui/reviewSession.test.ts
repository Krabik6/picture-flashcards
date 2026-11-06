import { expect, test } from 'vitest';
import { keyToAction, ReviewSession } from '../../src/ui/reviewSession';

const session = (items: string[], grade: () => Promise<void> = async () => {}) => new ReviewSession(items, grade);

test('rate before reveal does nothing', async () => {
  let graded = 0;
  const s = session(['a', 'b'], async () => { graded++; });
  await s.rate('easy');
  expect(s.current()).toBe('a');
  expect(graded).toBe(0);
});

test('forgotten card returns in the same session', async () => {
  const s = session(['a', 'b']);
  s.reveal();
  await s.rate('forgot');
  expect(s.current()).toBe('b');
  expect(s.remaining()).toBe(2);
  s.reveal();
  await s.rate('easy');
  expect(s.current()).toBe('a');
});

test('rating moves on and hides the answer', async () => {
  const s = session(['a', 'b']);
  s.reveal();
  await s.rate('easy');
  expect(s.current()).toBe('b');
  expect(s.remaining()).toBe(1);
  expect(s.revealed()).toBe(false);
});

test('session ends with no current card', async () => {
  const s = session(['a']);
  s.reveal();
  await s.rate('hard');
  expect(s.current()).toBeNull();
});

test('double rating is ignored while saving', async () => {
  let graded = 0;
  const s = session(['a', 'b'], async () => { graded++; });
  s.reveal();
  await Promise.all([s.rate('easy'), s.rate('easy')]);
  expect(graded).toBe(1);
  expect(s.current()).toBe('b');
});

test('failed save keeps the card on screen', async () => {
  const s = session(['a'], async () => { throw new Error('disk'); });
  s.reveal();
  await s.rate('easy');
  expect(s.current()).toBe('a');
  expect(s.revealed()).toBe(true);
  expect(s.error()).toBe('disk');
});

test('next shows the card after the current one', async () => {
  const s = session(['a', 'b']);
  expect(s.next()).toBe('b');
  s.reveal();
  await s.rate('easy');
  expect(s.next()).toBeNull();
});

test('forgotten card comes back with its saved state', async () => {
  const s = new ReviewSession(['a', 'b'], async (item) => `${item}-saved`);
  s.reveal();
  await s.rate('forgot');
  s.reveal();
  await s.rate('easy');
  expect(s.current()).toBe('a-saved');
});

test('undo restores the card, the queue and the saved state', async () => {
  const restored: string[] = [];
  const s = new ReviewSession(['a', 'b'], async () => {}, async (before) => { restored.push(before); });
  expect(s.canUndo()).toBe(false);
  s.reveal();
  await s.rate('forgot');
  expect(s.current()).toBe('b');
  await s.undo();
  expect(restored).toEqual(['a']);
  expect(s.current()).toBe('a');
  expect(s.remaining()).toBe(2);
  expect(s.revealed()).toBe(true);
  expect(s.canUndo()).toBe(false);
});

test('undo works after the last card', async () => {
  const s = session(['a']);
  s.reveal();
  await s.rate('easy');
  expect(s.current()).toBeNull();
  await s.undo();
  expect(s.current()).toBe('a');
});

test('failed undo keeps everything as it was', async () => {
  const s = new ReviewSession(['a', 'b'], async () => {}, async () => { throw new Error('disk'); });
  s.reveal();
  await s.rate('easy');
  await s.undo();
  expect(s.current()).toBe('b');
  expect(s.canUndo()).toBe(true);
  expect(s.error()).toBe('disk');
});

test('answers lists what was rated', async () => {
  const s = session(['a', 'b']);
  s.reveal();
  await s.rate('forgot');
  s.reveal();
  await s.rate('easy');
  expect(s.answers()).toEqual([{ item: 'a', grade: 'forgot' }, { item: 'b', grade: 'easy' }]);
});

test('keys', () => {
  expect(keyToAction(' ', false)).toBe('reveal');
  expect(keyToAction('Enter', false)).toBe('reveal');
  expect(keyToAction('z', false)).toBe('undo');
  expect(keyToAction('я', true)).toBe('undo');
  expect(keyToAction(' ', true)).toBeNull();
  expect(keyToAction('1', false)).toBeNull();
  expect(keyToAction('1', true)).toBe('forgot');
  expect(keyToAction('2', true)).toBe('hard');
  expect(keyToAction('3', true)).toBe('easy');
  expect(keyToAction('r', true)).toBe('replay');
  expect(keyToAction('к', true)).toBe('replay');
  expect(keyToAction('x', true)).toBeNull();
});
