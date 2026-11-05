import { expect, test } from 'vitest';
import { ScreenStack } from '../../src/ui/screenStack';

test('starts on the first screen and cannot go back', () => {
  const s = new ScreenStack('home');
  expect(s.current()).toBe('home');
  expect(s.canGoBack()).toBe(false);
  expect(s.back()).toBe(false);
  expect(s.current()).toBe('home');
});

test('push and back walk through screens', () => {
  const s = new ScreenStack('home');
  s.push('deck');
  s.push('card');
  expect(s.current()).toBe('card');
  expect(s.back()).toBe(true);
  expect(s.current()).toBe('deck');
});

test('replace swaps the current screen only', () => {
  const s = new ScreenStack('home');
  s.push('new');
  s.replace('deck');
  expect(s.current()).toBe('deck');
  s.back();
  expect(s.current()).toBe('home');
});
