import { expect, test } from 'vitest';
import { decideAdd, progressLabel } from '../../src/ui/addFlow';
import { card } from '../helpers';

test('blank input is empty', () => expect(decideAdd('   ', []).action).toBe('empty'));
test('trims the word', () => expect(decideAdd(' cat ', [])).toEqual({ action: 'add', word: 'cat' }));
test('finds a duplicate', () => {
  const existing = card({ word: 'Cat' });
  expect(decideAdd('cat', [existing])).toEqual({ action: 'duplicate', existing, word: 'cat' });
});
test('progress follows what the card is missing', () => {
  const none = { image: null, wordAudio: null, exampleAudio: null };
  expect(progressLabel(card({ explanation: '', media: none }))).toBe('Пишу пояснение');
  expect(progressLabel(card({ media: none }))).toBe('Рисую картинку');
  expect(progressLabel(card({ media: { ...none, image: 'i' } }))).toBe('Записываю озвучку');
});
