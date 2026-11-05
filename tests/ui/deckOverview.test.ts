import { expect, test } from 'vitest';
import { buildDeckOverview, relativeDue } from '../../src/ui/deckOverview';
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

test('relative due in plain words', () => {
  const today = new Date(2026, 10, 5, 12);
  const at = (day: number, hour = 13) => new Date(2026, 10, day, hour).toISOString();
  expect(relativeDue(at(1), today)).toBe('сегодня');
  expect(relativeDue(at(5, 20), today)).toBe('сегодня');
  expect(relativeDue(at(6), today)).toBe('завтра');
  expect(relativeDue(at(8), today)).toBe('через 3 дня');
  expect(relativeDue(at(15), today)).toBe('через 10 дней');
});
