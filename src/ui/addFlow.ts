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

export function progressLabel(card: Card): string {
  if (!card.explanation) return 'Пишу пояснение';
  if (!card.media.image) return 'Рисую картинку';
  return 'Записываю озвучку';
}
