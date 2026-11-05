import { addDraft, fillCard, type CreationDeps } from './cardCreation';
import { errorText } from '../ui/strings';

export interface QueueItem {
  deckPath: string;
  cardId: string;
  word: string;
  state: 'waiting' | 'working' | 'done' | 'failed';
  error: string | null;
}

/** Lives in the plugin, not in a window: closing the window does not stop the work. */
export class CreationQueue {
  private all: QueueItem[] = [];
  private running = 0;
  private listeners = new Set<() => void>();

  constructor(private deps: CreationDeps, private maxParallel = 2) {}

  async add(deckPath: string, word: string): Promise<QueueItem> {
    const card = await addDraft(this.deps, deckPath, word);
    const item: QueueItem = { deckPath, cardId: card.id, word: card.word, state: 'waiting', error: null };
    this.all.push(item);
    this.changed();
    this.pump();
    return item;
  }

  retry(deckPath: string, cardId: string, word: string): void {
    let item = this.all.find((x) => x.cardId === cardId);
    if (item?.state === 'waiting' || item?.state === 'working') return;
    if (!item) {
      item = { deckPath, cardId, word, state: 'waiting', error: null };
      this.all.push(item);
    }
    item.state = 'waiting';
    item.error = null;
    this.changed();
    this.pump();
  }

  items(): QueueItem[] {
    return [...this.all];
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private changed() {
    for (const listener of this.listeners) listener();
  }

  private pump() {
    while (this.running < this.maxParallel) {
      const next = this.all.find((x) => x.state === 'waiting');
      if (!next) return;
      this.running++;
      next.state = 'working';
      void this.run(next);
    }
    this.changed();
  }

  private async run(item: QueueItem) {
    this.changed();
    try {
      const card = await fillCard(this.deps, item.deckPath, item.cardId);
      if (!card) {
        this.all = this.all.filter((x) => x !== item);
      } else {
        item.state = card.status === 'ready' ? 'done' : 'failed';
        item.error = card.lastError;
      }
    } catch (error) {
      item.state = 'failed';
      item.error = errorText(error);
    }
    this.running--;
    this.changed();
    this.pump();
  }
}
