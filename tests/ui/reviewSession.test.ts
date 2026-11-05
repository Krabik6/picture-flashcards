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

test('keys', () => {
  expect(keyToAction(' ', false)).toBe('reveal');
  expect(keyToAction(' ', true)).toBeNull();
  expect(keyToAction('1', false)).toBeNull();
  expect(keyToAction('1', true)).toBe('forgot');
  expect(keyToAction('2', true)).toBe('hard');
  expect(keyToAction('3', true)).toBe('easy');
  expect(keyToAction('r', true)).toBe('replay');
  expect(keyToAction('к', true)).toBe('replay');
  expect(keyToAction('x', true)).toBeNull();
});
