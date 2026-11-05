import { normalizePath, type App, type TFile } from 'obsidian';
import type { BinaryFile } from '../ai/provider';
import { parseDeck, removeCard, upsertCard } from '../core/deckFormat';
import type { DeckStore, MediaKind } from '../core/store';
import type { Card, ParsedDeck } from '../core/types';

const MEDIA_FOLDER = '_media';

export class ObsidianDeckStore implements DeckStore {
  private counter = 0;

  constructor(private app: App) {}

  private note(deckPath: string): TFile {
    const file = this.app.vault.getFileByPath(deckPath);
    if (!file) throw new Error(`Заметка колоды не найдена: ${deckPath}`);
    return file;
  }

  private mediaPath(deckPath: string, relativePath: string): string {
    const folder = this.note(deckPath).parent?.path ?? '';
    return normalizePath(`${folder}/${relativePath}`);
  }

  async readDeck(deckPath: string): Promise<ParsedDeck> {
    return parseDeck(await this.app.vault.read(this.note(deckPath)));
  }

  async saveCard(deckPath: string, card: Card): Promise<void> {
    await this.app.vault.process(this.note(deckPath), (text) => upsertCard(text, card));
  }

  async updateCard(deckPath: string, cardId: string, change: (card: Card) => Card): Promise<Card | null> {
    let result: Card | null = null;
    await this.app.vault.process(this.note(deckPath), (text) => {
      const found = parseDeck(text).cards.find((c) => c.id === cardId);
      if (!found) return text;
      result = change(found);
      return upsertCard(text, result);
    });
    return result;
  }

  async deleteCard(deckPath: string, cardId: string): Promise<void> {
    let media: (string | null)[] = [];
    await this.app.vault.process(this.note(deckPath), (text) => {
      const found = parseDeck(text).cards.find((c) => c.id === cardId);
      if (found) media = [found.media.image, found.media.wordAudio, found.media.exampleAudio];
      return removeCard(text, cardId);
    });
    for (const path of media) if (path) await this.removeMedia(deckPath, path);
  }

  async writeMedia(deckPath: string, cardId: string, kind: MediaKind, file: BinaryFile): Promise<string> {
    const folder = this.mediaPath(deckPath, MEDIA_FOLDER);
    if (!this.app.vault.getFolderByPath(folder)) await this.app.vault.createFolder(folder);
    const relative = `${MEDIA_FOLDER}/${cardId}-${kind}-${Date.now().toString(36)}${(this.counter++).toString(36)}.${file.extension}`;
    await this.app.vault.createBinary(this.mediaPath(deckPath, relative), file.bytes);
    return relative;
  }

  async removeMedia(deckPath: string, relativePath: string): Promise<void> {
    const file = this.app.vault.getFileByPath(this.mediaPath(deckPath, relativePath));
    if (file) await this.app.fileManager.trashFile(file);
  }

  async mediaExists(deckPath: string, relativePath: string): Promise<boolean> {
    return this.resourceUrl(deckPath, relativePath) !== null;
  }

  /** Address for an img or audio tag, null when the file is not there. */
  resourceUrl(deckPath: string, relativePath: string | null): string | null {
    if (!relativePath) return null;
    const file = this.app.vault.getFileByPath(this.mediaPath(deckPath, relativePath));
    return file ? this.app.vault.getResourcePath(file) : null;
  }
}
