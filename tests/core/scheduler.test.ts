import { expect, test } from 'vitest';
import { createScheduler, nextDueAt, selectDueCards } from '../../src/core/scheduler';
import { card } from '../helpers';

const now = new Date('2026-11-05T12:00:00.000Z');
const later = new Date('2026-11-20T12:00:00.000Z');
const past = '2026-11-01T00:00:00.000Z';
const reviewed = (id: string, due = past, firstReviewedAt = '2026-10-01T00:00:00.000Z') =>
  card({ id, schedule: { due, fsrs: {}, firstReviewedAt } });
const fresh = (id: string) => card({ id, schedule: { due: past, fsrs: {}, firstReviewedAt: null } });

test('easy pushes further than forgot', () => {
  const s = createScheduler();
  const st = s.newState(now);
  expect(new Date(s.grade(st, 'easy', now).due).getTime()).toBeGreaterThan(new Date(s.grade(st, 'forgot', now).due).getTime());
});

test('state survives JSON', () => {
  const s = createScheduler();
  const st = s.grade(s.newState(now), 'hard', now);
  expect(s.grade(JSON.parse(JSON.stringify(st)), 'easy', later)).toEqual(s.grade(st, 'easy', later));
});

test('first grade sets firstReviewedAt once', () => {
  const s = createScheduler();
  const a = s.grade(s.newState(now), 'easy', now);
  expect(a.firstReviewedAt).toBe(now.toISOString());
  expect(s.grade(a, 'easy', later).firstReviewedAt).toBe(now.toISOString());
});

test('new card is due right away', () => {
  expect(createScheduler().newState(now).due).toBe(now.toISOString());
});

test('drafts are never selected', () => {
  expect(selectDueCards([card({ status: 'draft', schedule: fresh('x').schedule })], 20, now)).toEqual([]);
});

test('card without image is never selected', () => {
  const c = card({ schedule: fresh('x').schedule, media: { image: null, wordAudio: null, exampleAudio: null } });
  expect(selectDueCards([c], 20, now)).toEqual([]);
});

test('future cards are not selected', () => {
  expect(selectDueCards([reviewed('x', later.toISOString())], 20, now)).toEqual([]);
});

test('new limit counts cards already started today', () => {
  const started = reviewed('s', later.toISOString(), now.toISOString());
  const result = selectDueCards([started, fresh('a'), fresh('b'), fresh('c')], 2, now);
  expect(result.map((c) => c.id)).toEqual(['a']);
});

test('due reviews go before new cards', () => {
  const result = selectDueCards([fresh('new'), reviewed('old')], 20, now);
  expect(result.map((c) => c.id)).toEqual(['old', 'new']);
});

test('nextDueAt returns earliest future due or null', () => {
  const a = reviewed('a', '2026-11-08T00:00:00.000Z');
  const b = reviewed('b', '2026-11-07T00:00:00.000Z');
  expect(nextDueAt([a, b, reviewed('c')], now)?.toISOString()).toBe('2026-11-07T00:00:00.000Z');
  expect(nextDueAt([], now)).toBeNull();
});

test('preview shows growing intervals without changing the state', () => {
  const s = createScheduler();
  const st = s.grade(s.newState(now), 'easy', now);
  const copy = JSON.parse(JSON.stringify(st));
  const p = s.preview(st, later);
  expect(p.forgot).toBeLessThan(p.easy);
  expect(p.hard).toBeLessThanOrEqual(p.easy);
  expect(p.forgot).toBeGreaterThan(0);
  expect(st).toEqual(copy);
});
