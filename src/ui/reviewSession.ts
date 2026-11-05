import type { Grade } from '../core/scheduler';

export type ReviewAction = 'reveal' | Grade | 'replay';

export class ReviewSession<T> {
  private queue: T[];
  private isRevealed = false;
  private saving = false;
  private lastError: string | null = null;

  constructor(items: T[], private grade: (item: T, grade: Grade) => Promise<void>) {
    this.queue = [...items];
  }

  current(): T | null {
    return this.queue[0] ?? null;
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
      await this.grade(item, grade);
      this.queue.shift();
      if (grade === 'forgot') this.queue.push(item);
      this.isRevealed = false;
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
    } finally {
      this.saving = false;
    }
  }
}

export function keyToAction(key: string, revealed: boolean): ReviewAction | null {
  if (!revealed) return key === ' ' ? 'reveal' : null;
  switch (key.toLowerCase()) {
    case '1': return 'forgot';
    case '2': return 'hard';
    case '3': return 'easy';
    case 'r':
    case 'к': return 'replay';
    default: return null;
  }
}
