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

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

export function relativeDue(dueIso: string, now: Date): string {
  const days = Math.round((startOfDay(new Date(dueIso)) - startOfDay(now)) / 86400000);
  if (days <= 0) return 'сегодня';
  if (days === 1) return 'завтра';
  return `через ${days} ${plural(days, 'день', 'дня', 'дней')}`;
}
