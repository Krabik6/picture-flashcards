import { selectDueCards } from '../core/scheduler';
import type { Card, ParsedDeck } from '../core/types';
import { plural } from './strings';

export interface DeckOverview {
  dueToday: number;
  drafts: Card[];
  needsAttention: Card[];
  ready: Card[];
  brokenBlocks: number;
}

export function buildDeckOverview(deck: ParsedDeck, missing: Set<string>, now: Date): DeckOverview {
  const drafts = deck.cards.filter((c) => c.status === 'draft');
  const finished = deck.cards.filter((c) => c.status === 'ready');
  const ready = finished.filter((c) => !missing.has(c.id));
  return {
    dueToday: selectDueCards(ready, deck.settings.newCardsPerDay, now).length,
    drafts,
    needsAttention: finished.filter((c) => missing.has(c.id)),
    ready,
    brokenBlocks: deck.brokenBlocks,
  };
}

/** The order cards are shown in: unfinished ones first, then the soonest to come back. */
export function orderedCards(overview: DeckOverview): Card[] {
  const soonest = [...overview.ready].sort((a, b) => a.schedule.due.localeCompare(b.schedule.due));
  return [...overview.drafts, ...overview.needsAttention, ...soonest];
}

export function matchesQuery(card: Card, query: string): boolean {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return true;
  return [card.word, card.reading ?? ''].some((text) => text.toLocaleLowerCase().includes(needle));
}

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

export function relativeDue(dueIso: string, now: Date): string {
  const days = Math.round((startOfDay(new Date(dueIso)) - startOfDay(now)) / 86400000);
  if (days <= 0) return 'сегодня';
  if (days === 1) return 'завтра';
  return `через ${days} ${plural(days, 'день', 'дня', 'дней')}`;
}

export function formatInterval(ms: number): string {
  const minutes = Math.max(1, Math.round(ms / 60000));
  if (minutes < 60) return `${minutes} мин`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} ч`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} дн`;
  return `${Math.round(days / 30)} мес`;
}
