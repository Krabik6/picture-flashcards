import { expect, test } from 'vitest';
import { buildDeckOverview, formatInterval, matchesQuery, orderedCards, relativeDue } from '../../src/ui/deckOverview';
import { card, settings } from '../helpers';

const now = new Date('2026-11-05T12:00:00.000Z');
const due = (id: string, when: string) => card({ id, schedule: { due: when, fsrs: {}, firstReviewedAt: '2026-10-01T00:00:00.000Z' } });

test('splits cards by state', () => {
  const draft = card({ id: 'd', status: 'draft' });
  const o = buildDeckOverview({ settings, cards: [draft, due('p', '2026-11-01T00:00:00.000Z'), due('f', '2026-12-01T00:00:00.000Z')], brokenBlocks: 0 }, new Set(), now);
  expect(o.dueToday).toBe(1);
  expect(o.drafts.map((c) => c.id)).toEqual(['d']);
  expect(o.ready.map((c) => c.id)).toEqual(['p', 'f']);
});

test('missing image goes to needsAttention, not due', () => {
  const c = due('p', '2026-11-01T00:00:00.000Z');
  const o = buildDeckOverview({ settings, cards: [c], brokenBlocks: 0 }, new Set(['p']), now);
  expect(o.dueToday).toBe(0);
  expect(o.needsAttention.map((x) => x.id)).toEqual(['p']);
  expect(o.ready).toEqual([]);
});

test('broken blocks are passed through', () => {
  expect(buildDeckOverview({ settings, cards: [], brokenBlocks: 2 }, new Set(), now).brokenBlocks).toBe(2);
});

test('cards go in order: drafts, missing files, then soonest first', () => {
  const draft = card({ id: 'd', status: 'draft' });
  const late = due('late', '2026-12-01T00:00:00.000Z');
  const soon = due('soon', '2026-11-01T00:00:00.000Z');
  const gone = due('gone', '2026-11-02T00:00:00.000Z');
  const o = buildDeckOverview({ settings, cards: [late, soon, gone, draft], brokenBlocks: 0 }, new Set(['gone']), now);
  expect(orderedCards(o).map((c) => c.id)).toEqual(['d', 'gone', 'soon', 'late']);
});

test('search looks in the word and its reading, ignoring case', () => {
  const c = card({ word: 'Umbrella', reading: 'ˈʌmbrelə' });
  expect(matchesQuery(c, ' umb ')).toBe(true);
  expect(matchesQuery(c, 'ʌm')).toBe(true);
  expect(matchesQuery(c, '')).toBe(true);
  expect(matchesQuery(c, 'rain')).toBe(false);
  expect(matchesQuery(card({ word: '猫', reading: null }), 'ねこ')).toBe(false);
});

test('relative due in plain words', () => {
  const today = new Date(2026, 10, 5, 12);
  const at = (day: number, hour = 13) => new Date(2026, 10, day, hour).toISOString();
  expect(relativeDue(at(1), today)).toBe('сегодня');
  expect(relativeDue(at(5, 20), today)).toBe('сегодня');
  expect(relativeDue(at(6), today)).toBe('завтра');
  expect(relativeDue(at(8), today)).toBe('через 3 дня');
  expect(relativeDue(at(15), today)).toBe('через 10 дней');
});

test('intervals in plain short words', () => {
  const MIN = 60000;
  expect(formatInterval(30000)).toBe('1 мин');
  expect(formatInterval(10 * MIN)).toBe('10 мин');
  expect(formatInterval(5 * 60 * MIN)).toBe('5 ч');
  expect(formatInterval(3 * 24 * 60 * MIN)).toBe('3 дн');
  expect(formatInterval(60 * 24 * 60 * MIN)).toBe('2 мес');
});
