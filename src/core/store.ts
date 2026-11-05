import type { BinaryFile } from '../ai/provider';
import type { Card, ParsedDeck } from './types';

export type MediaKind = 'image' | 'word-audio' | 'example-audio';

export interface DeckStore {
  readDeck(deckPath: string): Promise<ParsedDeck>;
  saveCard(deckPath: string, card: Card): Promise<void>;
  /** Atomic read and write of one card. Returns null when the card no longer exists. */
  updateCard(deckPath: string, cardId: string, change: (card: Card) => Card): Promise<Card | null>;
  /** Removes the block and sends the card's files to the trash. */
  deleteCard(deckPath: string, cardId: string): Promise<void>;
  /** Always picks a new file name. Returns the path relative to the deck folder. */
  writeMedia(deckPath: string, cardId: string, kind: MediaKind, file: BinaryFile): Promise<string>;
  removeMedia(deckPath: string, relativePath: string): Promise<void>;
  mediaExists(deckPath: string, relativePath: string): Promise<boolean>;
}
