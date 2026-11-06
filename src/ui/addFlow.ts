import { findDuplicate } from '../core/deckFormat';
import type { Card } from '../core/types';

export type AddDecision =
  | { action: 'empty' }
  | { action: 'duplicate'; existing: Card; word: string }
  | { action: 'add'; word: string };

export function decideAdd(input: string, cards: Card[]): AddDecision {
  const word = input.trim();
  if (!word) return { action: 'empty' };
  const existing = findDuplicate(cards, word);
  return existing ? { action: 'duplicate', existing, word } : { action: 'add', word };
}

/** How many of the three steps of making a card are finished: text, picture, voice. */
export function progressStep(card: Card): number {
  if (!card.explanation) return 0;
  return card.media.image ? 2 : 1;
}

export function progressLabel(card: Card): string {
  if (!card.explanation) return 'Пишу пояснение';
  if (!card.media.image) return 'Рисую картинку';
  return 'Записываю озвучку';
}
