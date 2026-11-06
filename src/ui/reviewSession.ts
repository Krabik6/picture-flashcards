import type { Grade } from '../core/scheduler';

export type ReviewAction = 'reveal' | Grade | 'replay' | 'undo';

interface Rated<T> {
  before: T;
  grade: Grade;
  queue: T[];
}

export class ReviewSession<T> {
  private queue: T[];
  private isRevealed = false;
  private saving = false;
  private lastError: string | null = null;
  private history: Rated<T>[] = [];

  /**
   * @param grade saves the answer. May return the saved item: a forgotten card comes back with its new state.
   * @param restore puts an item's saved state back when an answer is undone.
   */
  constructor(
    items: T[],
    private grade: (item: T, grade: Grade) => Promise<T | void>,
    private restore: (before: T) => Promise<void> = async () => {},
  ) {
    this.queue = [...items];
  }

  current(): T | null {
    return this.queue[0] ?? null;
  }
  /** The card that goes after the current one. */
  next(): T | null {
    return this.queue[1] ?? null;
  }
  revealed(): boolean {
    return this.isRevealed;
  }
  remaining(): number {
    return this.queue.length;
  }
  error(): string | null {
    return this.lastError;
  }
  canUndo(): boolean {
    return this.history.length > 0;
  }
  /** Items in the order they were answered, each with its answer. */
  answers(): { item: T; grade: Grade }[] {
    return this.history.map((h) => ({ item: h.before, grade: h.grade }));
  }
  reveal(): void {
    if (this.current() !== null) this.isRevealed = true;
  }
  replaceCurrent(item: T): void {
    if (this.queue.length) this.queue[0] = item;
  }

  async rate(grade: Grade): Promise<void> {
    const item = this.current();
    if (item === null || !this.isRevealed || this.saving) return;
    this.saving = true;
    this.lastError = null;
    try {
      const saved = await this.grade(item, grade);
      this.history.push({ before: item, grade, queue: [...this.queue] });
      this.queue.shift();
      if (grade === 'forgot') this.queue.push(saved ?? item);
      this.isRevealed = false;
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
    } finally {
      this.saving = false;
    }
  }

  /** Takes back the last answer and shows that card again with its answer open. */
  async undo(): Promise<void> {
    const last = this.history[this.history.length - 1];
    if (!last || this.saving) return;
    this.saving = true;
    this.lastError = null;
    try {
      await this.restore(last.before);
      this.history.pop();
      this.queue = last.queue;
      this.isRevealed = true;
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
    } finally {
      this.saving = false;
    }
  }
}

export function keyToAction(key: string, revealed: boolean): ReviewAction | null {
  const lower = key.toLowerCase();
  if (lower === 'z' || lower === 'я') return 'undo';
  if (!revealed) return key === ' ' || key === 'Enter' ? 'reveal' : null;
  switch (lower) {
    case '1': return 'forgot';
    case '2': return 'hard';
    case '3': return 'easy';
    case 'r':
    case 'к': return 'replay';
    default: return null;
  }
}
