import { DropdownComponent, Modal, Notice, Setting, type EventRef } from 'obsidian';
import { regenerateAll, regenerateImage } from '../core/cardCreation';
import type { Card } from '../core/types';
import type PictureFlashcardsPlugin from '../main';
import { decideAdd, progressLabel } from '../ui/addFlow';
import { errorText, S } from '../ui/strings';
import { textButton } from './cardBack';
import { CardModal } from './cardModal';

const NEW_DECK = '__new__';

interface Row {
  deckPath: string;
  cardId: string;
  el: HTMLElement;
  signature: string;
  prompt: string;
}

export class AddModal extends Modal {
  private deckPath: string | null;
  private rows: Row[] = [];
  private busy = new Map<string, 'image' | 'all'>();
  private wordInput!: HTMLInputElement;
  private warningEl!: HTMLElement;
  private listEl!: HTMLElement;
  private formEl!: HTMLElement;
  private inputBox!: HTMLElement;
  private offQueue: (() => void) | null = null;
  private refreshTimer: number | null = null;
  private modifyRef: EventRef | null = null;

  constructor(private plugin: PictureFlashcardsPlugin, deckPath?: string) {
    super(plugin.app);
    this.deckPath = deckPath ?? plugin.settings.lastDeckPath;
    this.modalEl.addClass('pf-add-modal');
  }

  onOpen(): void {
    const { contentEl } = this;
    this.titleEl.setText(S.newCard);
    const decks = this.plugin.listDecks();
    if (!decks.some((d) => d.path === this.deckPath)) this.deckPath = decks[0]?.path ?? null;

    new Setting(contentEl).setName(S.deck).addDropdown((dropdown: DropdownComponent) => {
      for (const d of decks) dropdown.addOption(d.path, d.name);
      dropdown.addOption(NEW_DECK, `${S.newDeck}...`);
      dropdown.setValue(this.deckPath ?? NEW_DECK);
      dropdown.onChange((value) => this.chooseDeck(value === NEW_DECK ? null : value));
    });
    this.formEl = contentEl.createDiv();
    this.inputBox = contentEl.createDiv({ cls: 'pf-add-box' });
    this.wordInput = this.inputBox.createEl('input', {
      type: 'text', cls: 'pf-add-input', attr: { placeholder: S.wordPlaceholder, 'aria-label': S.wordPlaceholder, autocomplete: 'off' },
    });
    this.wordInput.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' || event.isComposing) return;
      event.preventDefault();
      void this.submit();
    });
    this.warningEl = contentEl.createDiv();
    this.listEl = contentEl.createDiv({ cls: 'pf-queue' });
    this.offQueue = this.plugin.queue.subscribe(() => this.scheduleRefresh());
    this.modifyRef = this.app.vault.on('modify', (file) => {
      if (this.rows.some((r) => r.deckPath === file.path)) this.scheduleRefresh();
    });
    this.chooseDeck(this.deckPath);
  }

  onClose(): void {
    this.offQueue?.();
    if (this.modifyRef) this.app.vault.offref(this.modifyRef);
    if (this.refreshTimer !== null) window.clearTimeout(this.refreshTimer);
    this.contentEl.empty();
  }

  private chooseDeck(path: string | null) {
    this.deckPath = path;
    this.warningEl.empty();
    this.formEl.empty();
    this.inputBox.toggleClass('pf-hidden', path === null);
    if (path === null) {
      this.renderDeckForm();
      return;
    }
    this.plugin.settings.lastDeckPath = path;
    void this.plugin.saveSettings();
    window.setTimeout(() => this.wordInput.focus(), 0);
  }

  private renderDeckForm() {
    const draft = { name: '', language: '', style: this.plugin.settings.defaultImageStyle };
    new Setting(this.formEl).setName(S.deckName).setDesc(S.deckNameHint).addText((t) => t.onChange((v) => { draft.name = v.trim(); }));
    new Setting(this.formEl).setName(S.language).setDesc(S.languageHint).addText((t) => t.onChange((v) => { draft.language = v.trim(); }));
    new Setting(this.formEl).setName(S.imageStyle).addTextArea((t) => t.setValue(draft.style).onChange((v) => { draft.style = v; }));
    new Setting(this.formEl).addButton((b) => b.setButtonText(S.createDeck).setCta().onClick(async () => {
      if (!draft.name || !draft.language) {
        new Notice(`Заполните поля «${S.deckName}» и «${S.language}»`);
        return;
      }
      try {
        const path = await this.plugin.createDeck(draft.name, draft.language, draft.style);
        this.reopen(path);
      } catch (error) {
        new Notice(errorText(error));
      }
    }));
  }

  private reopen(path: string) {
    this.close();
    new AddModal(this.plugin, path).open();
  }

  private async submit(forceWord?: string) {
    const deckPath = this.deckPath;
    if (!deckPath) return;
    // Taken and cleared at once, so the next word can be typed while this one is being saved.
    const typed = this.wordInput.value;
    this.wordInput.value = '';
    this.wordInput.focus();
    this.warningEl.empty();
    let word = forceWord;
    try {
      if (!word) {
        const decision = decideAdd(typed, (await this.plugin.store.readDeck(deckPath)).cards);
        if (decision.action === 'empty') return;
        if (decision.action === 'duplicate') {
          if (!this.wordInput.value) this.wordInput.value = typed;
          this.showDuplicate(deckPath, decision.existing, decision.word);
          return;
        }
        word = decision.word;
      }
      const item = await this.plugin.queue.add(deckPath, word);
      this.rows.unshift({ deckPath, cardId: item.cardId, el: this.listEl.createDiv({ cls: 'pf-queue-row' }), signature: '', prompt: '' });
      this.listEl.prepend(this.rows[0].el);
      await this.refresh();
    } catch (error) {
      if (!this.wordInput.value) this.wordInput.value = typed;
      new Notice(errorText(error));
    }
  }

  private showDuplicate(deckPath: string, existing: Card, word: string) {
    const box = this.warningEl.createDiv({ cls: 'pf-warning' });
    box.createSpan({ text: S.alreadyInDeck(word) });
    const actions = box.createDiv({ cls: 'pf-actions' });
    textButton(actions, S.open, () => new CardModal(this.plugin, deckPath, existing.id).open());
    textButton(actions, S.createSecond, () => {
      this.wordInput.value = '';
      void this.submit(word);
    });
  }

  private scheduleRefresh() {
    if (this.refreshTimer !== null) return;
    this.refreshTimer = window.setTimeout(() => {
      this.refreshTimer = null;
      void this.refresh();
    }, 120);
  }

  /** Redraws only rows that changed, so a half-typed prompt in another row stays. */
  private async refresh() {
    const decks = new Map<string, Card[]>();
    for (const row of this.rows) {
      if (!decks.has(row.deckPath)) decks.set(row.deckPath, (await this.plugin.store.readDeck(row.deckPath)).cards);
      const card = decks.get(row.deckPath)!.find((c) => c.id === row.cardId);
      const item = this.plugin.queue.items().find((x) => x.cardId === row.cardId);
      const working = item?.state === 'waiting' || item?.state === 'working';
      const signature = JSON.stringify([card?.status, card?.explanation, card?.media, card?.lastError, working, this.busy.get(row.cardId)]);
      if (signature === row.signature) continue;
      row.signature = signature;
      if (!card) {
        row.el.remove();
        continue;
      }
      this.renderRow(row, card, working);
    }
    this.rows = this.rows.filter((r) => r.el.isConnected);
  }

  private renderRow(row: Row, card: Card, working: boolean) {
    const { el } = row;
    el.empty();
    const url = this.plugin.store.resourceUrl(row.deckPath, card.media.image);
    if (url) {
      const img = el.createEl('img', { cls: 'pf-row-picture', attr: { src: url, alt: '' } });
      img.addEventListener('click', () => new CardModal(this.plugin, row.deckPath, card.id).open());
    } else {
      el.createDiv({ cls: 'pf-draft-picture pf-row-picture', text: working ? '' : S.noImage });
    }
    const body = el.createDiv({ cls: 'pf-row-body' });
    body.createEl('strong', { text: card.word });
    if (working) {
      const progress = body.createDiv({ cls: 'pf-progress' });
      progress.createSpan({ cls: 'pf-spinner' });
      progress.createSpan({ text: progressLabel(card) });
      return;
    }
    if (card.status === 'draft') {
      body.createEl('p', { cls: 'pf-error', text: card.lastError ?? S.draft });
      textButton(body, S.retry, () => this.plugin.queue.retry(row.deckPath, card.id, card.word));
      return;
    }
    body.createEl('p', { cls: 'pf-muted', text: card.explanation });
    const input = body.createEl('input', { type: 'text', cls: 'pf-row-prompt', attr: { placeholder: S.ownPrompt, 'aria-label': S.ownPrompt } });
    input.value = row.prompt;
    input.addEventListener('input', () => { row.prompt = input.value; });
    const actions = body.createDiv({ cls: 'pf-actions' });
    const busy = this.busy.get(card.id);
    const prompt = () => row.prompt.trim() || null;
    const image = textButton(actions, busy === 'image' ? 'Рисую...' : S.otherImage, () =>
      void this.regenerate(card.id, 'image', () => regenerateImage(this.plugin.deps, row.deckPath, card.id, prompt())));
    const all = textButton(actions, busy === 'all' ? 'Пересоздаю...' : S.remakeAll, () =>
      void this.regenerate(card.id, 'all', () => regenerateAll(this.plugin.deps, row.deckPath, card.id, prompt())));
    image.disabled = all.disabled = busy !== undefined;
  }

  private async regenerate(cardId: string, kind: 'image' | 'all', work: () => Promise<unknown>) {
    this.busy.set(cardId, kind);
    await this.refresh();
    try {
      await work();
    } catch (error) {
      new Notice(errorText(error));
    }
    this.busy.delete(cardId);
    await this.refresh();
  }
}
