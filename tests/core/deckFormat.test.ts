import { expect, test } from 'vitest';
import { createDeckText, findDuplicate, parseDeck, removeCard, updateSettings, upsertCard } from '../../src/core/deckFormat';
import { card, settings } from '../helpers';

test('round trip', () => {
  const text = upsertCard(createDeckText(settings), card());
  expect(parseDeck(text)).toEqual({ settings, cards: [card()], brokenBlocks: 0 });
});

test('deck note carries the marker property', () => {
  expect(createDeckText(settings).startsWith('---\npicture-flashcards: deck\n---\n')).toBe(true);
});

test('upsert changes only own block', () => {
  const two = upsertCard(upsertCard(createDeckText(settings), card()), card({ id: 'b2', word: 'b' }));
  const changed = upsertCard(two, card({ explanation: 'new' }));
  expect(changed.slice(changed.indexOf('## b'))).toBe(two.slice(two.indexOf('## b')));
  expect(parseDeck(changed).cards[0].explanation).toBe('new');
});

test('tricky text survives', () => {
  const word = 'a "b" ```\nשלום';
  const parsed = parseDeck(upsertCard(createDeckText(settings), card({ word })));
  expect(parsed.cards[0].word).toBe(word);
  expect(parsed.brokenBlocks).toBe(0);
});

test('broken block is counted and kept', () => {
  const text = upsertCard(createDeckText(settings), card()) + '\n## bad\n```picture-flashcard\n{oops\n```\n';
  expect(parseDeck(text).brokenBlocks).toBe(1);
  expect(parseDeck(text).cards).toHaveLength(1);
  expect(upsertCard(text, card({ id: 'c3' }))).toContain('{oops');
});

test('unclosed block is counted as broken', () => {
  const text = createDeckText(settings) + '\n## bad\n```picture-flashcard\n{"id":"x"\n';
  expect(parseDeck(text).brokenBlocks).toBe(1);
});

test('remove keeps others', () => {
  const two = upsertCard(upsertCard(createDeckText(settings), card()), card({ id: 'b2', word: 'b' }));
  const left = removeCard(two, 'a1');
  expect(parseDeck(left).cards.map((c) => c.id)).toEqual(['b2']);
  expect(left).not.toContain('## 猫');
});

test('duplicate ignores case and spaces', () => {
  expect(findDuplicate([card({ word: 'Cat' })], '  cat ')?.id).toBe('a1');
  expect(findDuplicate([card({ word: 'Cat' })], 'dog')).toBeNull();
});

test('hand-edited heading does not break parsing', () => {
  const text = upsertCard(createDeckText(settings), card()).replace('## 猫', '## кот');
  expect(parseDeck(text).cards[0].word).toBe('猫');
});

test('settings can be updated without touching cards', () => {
  const text = upsertCard(createDeckText(settings), card());
  const next = { language: 'en', imageStyle: 'anime', newCardsPerDay: 5 };
  const parsed = parseDeck(updateSettings(text, next));
  expect(parsed.settings).toEqual(next);
  expect(parsed.cards).toEqual([card()]);
});
