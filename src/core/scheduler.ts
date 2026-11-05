import { createEmptyCard, fsrs, Rating } from 'ts-fsrs';
import type { Card, ScheduleState } from './types';

export type Grade = 'forgot' | 'hard' | 'easy';

export interface Scheduler {
  newState(now: Date): ScheduleState;
  grade(state: ScheduleState, grade: Grade, now: Date): ScheduleState;
  /** Milliseconds until the next show for each answer. Does not change the state. */
  preview(state: ScheduleState, now: Date): Record<Grade, number>;
}

// With three buttons a plain "I remembered" is Good: Rating.Easy would stretch intervals too fast.
const RATINGS = { forgot: Rating.Again, hard: Rating.Hard, easy: Rating.Good } as const;

const toPlain = (value: unknown) => JSON.parse(JSON.stringify(value)) as Record<string, unknown>;

export function createScheduler(): Scheduler {
  const engine = fsrs({ enable_fuzz: false });
  return {
    newState(now) {
      return { due: now.toISOString(), fsrs: toPlain(createEmptyCard(now)), firstReviewedAt: null };
    },
    grade(state, grade, now) {
      const stored = state.fsrs as unknown as Parameters<typeof engine.next>[0];
      const { card } = engine.next(stored, now, RATINGS[grade]);
      return {
        due: card.due.toISOString(),
        fsrs: toPlain(card),
        firstReviewedAt: state.firstReviewedAt ?? now.toISOString(),
      };
    },
    preview(state, now) {
      const stored = state.fsrs as unknown as Parameters<typeof engine.next>[0];
      const wait = (grade: Grade) => engine.next(stored, now, RATINGS[grade]).card.due.getTime() - now.getTime();
      return { forgot: wait('forgot'), hard: wait('hard'), easy: wait('easy') };
    },
  };
}

const sameLocalDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

const byDue = (a: Card, b: Card) => a.schedule.due.localeCompare(b.schedule.due);

export function selectDueCards(cards: Card[], newPerDay: number, now: Date): Card[] {
  const playable = cards.filter((c) => c.status === 'ready' && c.media.image !== null);
  const reviews = playable
    .filter((c) => c.schedule.firstReviewedAt !== null && new Date(c.schedule.due) <= now)
    .sort(byDue);
  const startedToday = playable.filter(
    (c) => c.schedule.firstReviewedAt !== null && sameLocalDay(new Date(c.schedule.firstReviewedAt), now),
  ).length;
  const fresh = playable
    .filter((c) => c.schedule.firstReviewedAt === null)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .slice(0, Math.max(0, newPerDay - startedToday));
  return [...reviews, ...fresh];
}

export function nextDueAt(cards: Card[], now: Date): Date | null {
  const dates = cards
    .filter((c) => c.status === 'ready')
    .map((c) => new Date(c.schedule.due))
    .filter((d) => d > now)
    .sort((a, b) => a.getTime() - b.getTime());
  return dates[0] ?? null;
}
