import { Notice, setIcon, type EventRef } from 'obsidian';
import { regenerateImage } from '../../core/cardCreation';
import type { Card } from '../../core/types';
import { decideAdd, progressLabel } from '../../ui/addFlow';
import { errorText, S } from '../../ui/strings';
import { iconButton, textButton } from '../cardBack';
import type { FlashcardsPopup } from '../popup';

interface Row {
  el: HTMLElement;
  signature: string;
  deckPath: string;
  cardId: string;
}

/** The field for new words and the live list of what is being made. Used on several screens. */
export class AddBar {
  private plugin = this.popup.plugin;
  private input!: HTMLInputElement;
  private select: HTMLSelectElement | null = null;
  private warningEl!: HTMLElement;
  private listEl!: HTMLElement;
  private rows = new Map<string, Row>();
  private busy = new Set<string>();
  private offQueue: (() => void) | null = null;
  private modifyRef: EventRef | null = null;
  private timer: number | null = null;

  constructor(private popup: FlashcardsPopup, private fixedDeck: string | null) {}

  render(parent: HTMLElement): void {
    const box = parent.createDiv({ cls: 'pf-addbar' });
    this.input = box.createEl('input', {
      type: 'text', cls: 'pf-addbar-input', attr: { placeholder: S.wordPlaceholder, 'aria-label': S.wordPlaceholder, autocomplete: 'off', enterkeyhint: 'done' },
    });
    this.input.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' || event.isComposing) return;
      event.preventDefault();
      event.stopPropagation();
      void this.submit();
    });
    if (!this.fixedDeck) {
      const decks = this.plugin.listDecks();
      this.select = box.createEl('select', { cls: 'dropdown pf-addbar-deck', attr: { 'aria-label': S.deck } });
      for (const deck of decks) this.select.createEl('option', { text: deck.name, value: deck.path });
      const last = this.plugin.settings.lastDeckPath;
      if (last && decks.some((d) => d.path === last)) this.select.value = last;
      this.select.addEventListener('change', () => {
        this.plugin.settings.lastDeckPath = this.select?.value ?? null;
        void this.plugin.saveSettings();
        this.warningEl.empty();
        this.input.focus();
      });
    }
    this.warningEl = parent.createDiv();
    this.listEl = parent.createDiv({ cls: 'pf-addlist' });
    this.offQueue = this.plugin.queue.subscribe(() => this.schedule());
    this.modifyRef = this.plugin.app.vault.on('modify', (file) => {
      if ([...this.rows.values()].some((r) => r.deckPath === file.path)) this.schedule();
    });
    void this.refresh();
    window.setTimeout(() => this.input.focus(), 0);
  }

  dispose(): void {
    this.offQueue?.();
    if (this.modifyRef) this.plugin.app.vault.offref(this.modifyRef);
    if (this.timer !== null) window.clearTimeout(this.timer);
  }

  private targetDeck(): string | null {
    return this.fixedDeck ?? this.select?.value ?? null;
  }

  private async submit(forceWord?: string) {
    const deckPath = this.targetDeck();
    if (!deckPath) return;
    // Taken and cleared at once, so the next word can be typed while this one is being saved.
    const typed = this.input.value;
    this.input.value = '';
    this.input.focus();
    this.warningEl.empty();
    let word = forceWord;
    try {
      if (!word) {
        const decision = decideAdd(typed, (await this.plugin.store.readDeck(deckPath)).cards);
        if (decision.action === 'empty') return;
        if (decision.action === 'duplicate') {
          this.showDuplicate(deckPath, decision.existing, decision.word);
          return;
        }
        word = decision.word;
      }
      const item = await this.plugin.queue.add(deckPath, word);
      this.popup.added.add(item.cardId);
      await this.refresh();
    } catch (error) {
      if (!this.input.value) this.input.value = typed;
      new Notice(errorText(error));
    }
  }

  private showDuplicate(deckPath: string, existing: Card, word: string) {
    const box = this.warningEl.createDiv({ cls: 'pf-note' });
    box.createSpan({ text: S.alreadyInDeck(word) });
    const actions = box.createDiv({ cls: 'pf-actions' });
    textButton(actions, S.open, () => this.popup.go({ name: 'card', path: deckPath, id: existing.id }));
    textButton(actions, S.createSecond, () => void this.submit(word));
  }

  private schedule() {
    if (this.timer !== null) return;
    this.timer = window.setTimeout(() => {
      this.timer = null;
      void this.refresh();
    }, 120);
  }

  /** Redraws only rows that changed. */
  private async refresh() {
    if (!this.listEl.isConnected) return;
    const items = this.plugin.queue.items().filter((i) =>
      (!this.fixedDeck || i.deckPath === this.fixedDeck)
      && (this.popup.added.has(i.cardId) || i.state === 'waiting' || i.state === 'working'));
    const decks = new Map<string, Card[]>();
    for (const item of items) {
      if (!decks.has(item.deckPath)) decks.set(item.deckPath, (await this.plugin.store.readDeck(item.deckPath)).cards);
      const card = decks.get(item.deckPath)!.find((c) => c.id === item.cardId);
      let row = this.rows.get(item.cardId);
      if (!card) {
        row?.el.remove();
        this.rows.delete(item.cardId);
        continue;
      }
      if (!row) {
        row = { el: createDiv({ cls: 'pf-addrow' }), signature: '', deckPath: item.deckPath, cardId: item.cardId };
        this.rows.set(item.cardId, row);
        this.listEl.prepend(row.el);
      }
      const working = item.state === 'waiting' || item.state === 'working';
      const signature = JSON.stringify([card.status, card.explanation, card.media, card.lastError, working, this.busy.has(card.id)]);
      if (signature !== row.signature) {
        row.signature = signature;
        this.renderRow(row, card, working);
      }
    }
  }

  private renderRow(row: Row, card: Card, working: boolean) {
    const { el, deckPath } = row;
    el.empty();
    const open = () => this.popup.go({ name: 'card', path: deckPath, id: card.id });
    const main = el.createEl('button', { cls: 'pf-addrow-main' });
    main.addEventListener('click', open);
    const url = this.plugin.store.resourceUrl(deckPath, card.media.image);
    if (url) main.createEl('img', { cls: 'pf-addrow-pic', attr: { src: url, alt: '' } });
    else {
      const placeholder = main.createDiv({ cls: 'pf-addrow-pic pf-addrow-empty' });
      if (!working) setIcon(placeholder, 'image-off');
    }
    const text = main.createDiv({ cls: 'pf-addrow-text' });
    text.createEl('strong', { text: card.word });
    const line = text.createDiv({ cls: 'pf-addrow-status' });
    if (working) {
      line.createSpan({ cls: 'pf-spinner' });
      line.createSpan({ text: progressLabel(card) });
    } else if (card.status === 'draft') {
      line.addClass('pf-error');
      line.setText(card.lastError ?? S.draft);
    } else {
      line.setText(card.explanation);
    }
    if (working) return;
    if (card.status === 'draft') {
      iconButton(el, 'rotate-cw', S.retry, () => this.plugin.queue.retry(deckPath, card.id, card.word));
      return;
    }
    if (this.busy.has(card.id)) {
      el.createSpan({ cls: 'pf-spinner pf-addrow-busy' });
      return;
    }
    iconButton(el, 'refresh-cw', S.otherImage, () => void this.swap(row, card));
  }

  private async swap(row: Row, card: Card) {
    this.busy.add(card.id);
    await this.refresh();
    try {
      await regenerateImage(this.plugin.deps, row.deckPath, card.id, null);
    } catch (error) {
      new Notice(errorText(error));
    }
    this.busy.delete(card.id);
    await this.refresh();
  }
}
