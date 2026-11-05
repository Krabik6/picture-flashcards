import { createDeckText, parseDeck, removeCard, upsertCard } from '../../src/core/deckFormat';
import type { DeckStore, MediaKind } from '../../src/core/store';
import type { BinaryFile } from '../../src/ai/provider';
import type { Card, DeckSettings } from '../../src/core/types';

export class MemoryStore implements DeckStore {
  decks = new Map<string, string>();
  media = new Map<string, BinaryFile>();
  private counter = 0;

  constructor(settings: DeckSettings, path = 'deck') {
    this.decks.set(path, createDeckText(settings));
  }
  async readDeck(deckPath: string) {
    return parseDeck(this.decks.get(deckPath)!);
  }
  async saveCard(deckPath: string, card: Card) {
    this.decks.set(deckPath, upsertCard(this.decks.get(deckPath)!, card));
  }
  async updateCard(deckPath: string, cardId: string, change: (card: Card) => Card) {
    const found = parseDeck(this.decks.get(deckPath)!).cards.find((c) => c.id === cardId);
    if (!found) return null;
    const next = change(found);
    await this.saveCard(deckPath, next);
    return next;
  }
  async deleteCard(deckPath: string, cardId: string) {
    this.decks.set(deckPath, removeCard(this.decks.get(deckPath)!, cardId));
  }
  async writeMedia(_deckPath: string, cardId: string, kind: MediaKind, file: BinaryFile) {
    const path = `_media/${cardId}-${kind}-${++this.counter}.${file.extension}`;
    this.media.set(path, file);
    return path;
  }
  async removeMedia(_deckPath: string, relativePath: string) {
    this.media.delete(relativePath);
  }
  async mediaExists(_deckPath: string, relativePath: string) {
    return this.media.has(relativePath);
  }
}
