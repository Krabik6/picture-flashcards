import { Notice, Setting, type EventRef } from 'obsidian';
import { updateSettings } from '../../core/deckFormat';
import type { Card, DeckSettings } from '../../core/types';
import { buildDeckOverview, relativeDue } from '../../ui/deckOverview';
import { countCards, errorText, S } from '../../ui/strings';
import { textButton } from '../cardBack';
import type { FlashcardsPopup, ScreenView } from '../popup';
import { AddBar } from './addBar';

export class DeckScreen implements ScreenView {
  private plugin = this.popup.plugin;
  private bar: AddBar | null = null;
  private topEl!: HTMLElement;
  private contentEl!: HTMLElement;
  private modifyRef: EventRef | null = null;
  private offQueue: (() => void) | null = null;
  private timer: number | null = null;

  constructor(private popup: FlashcardsPopup, private path: string) {}

  async render(body: HTMLElement) {
    const file = this.plugin.app.vault.getFileByPath(this.path);
    this.popup.setBarTitle(file?.basename ?? S.deck);
    this.popup.addAction('file-text', S.showAsText, () => this.plugin.showAsText(this.path));
    this.popup.addAction('settings', S.deckSettings, () => this.popup.go({ name: 'deckSettings', path: this.path }));
    this.topEl = body.createDiv();
    this.bar = new AddBar(this.popup, this.path);
    this.bar.render(body);
    this.contentEl = body.createDiv();
    await this.refresh();
    this.modifyRef = this.plugin.app.vault.on('modify', (changed) => {
      if (changed.path === this.path) this.schedule();
    });
    this.offQueue = this.plugin.queue.subscribe(() => this.schedule());
  }

  dispose() {
    this.bar?.dispose();
    this.offQueue?.();
    if (this.modifyRef) this.plugin.app.vault.offref(this.modifyRef);
    if (this.timer !== null) window.clearTimeout(this.timer);
  }

  private schedule() {
    if (this.timer !== null) return;
    this.timer = window.setTimeout(() => {
      this.timer = null;
      void this.refresh();
    }, 200);
  }

  private async refresh() {
    if (!this.contentEl.isConnected) return;
    const deck = await this.plugin.store.readDeck(this.path);
    const missing = new Set(deck.cards.filter((c) => c.status === 'ready' && !this.plugin.store.resourceUrl(this.path, c.media.image)).map((c) => c.id));
    const now = new Date();
    const overview = buildDeckOverview(deck, missing, now);
    const root = this.contentEl;
    root.empty();
    this.topEl.empty();
    if (overview.dueToday) {
      textButton(this.topEl, S.reviewNow(overview.dueToday), () => this.popup.go({ name: 'review', deckPath: this.path }), true).addClass('pf-wide');
    }
    if (overview.brokenBlocks) root.createDiv({ cls: 'pf-note', text: S.brokenBlocks(overview.brokenBlocks) });
    if (overview.needsAttention.length) root.createDiv({ cls: 'pf-note', text: S.needsAttention(overview.needsAttention.length) });
    if (!deck.cards.length) {
      root.createEl('p', { cls: 'pf-muted', text: S.emptyDeck });
      return;
    }
    root.createDiv({ cls: 'pf-section', text: countCards(deck.cards.length) });
    const grid = root.createDiv({ cls: 'pf-grid' });
    for (const card of [...overview.drafts, ...overview.needsAttention, ...overview.ready]) this.renderTile(grid, card, now);
  }

  private renderTile(grid: HTMLElement, card: Card, now: Date) {
    const tile = grid.createEl('button', { cls: 'pf-tile' });
    tile.addEventListener('click', () => this.popup.go({ name: 'card', path: this.path, id: card.id }));
    const url = this.plugin.store.resourceUrl(this.path, card.media.image);
    if (url) tile.createEl('img', { attr: { src: url, alt: '' } });
    else tile.createDiv({ cls: 'pf-tile-empty', text: card.status === 'draft' ? S.noImage : S.missingFile });
    tile.createEl('strong', { text: card.word });
    if (card.status === 'draft') tile.createEl('small', { cls: 'pf-error', text: S.draft });
    else tile.createEl('small', { text: relativeDue(card.schedule.due, now) });
  }
}

export class DeckSettingsScreen implements ScreenView {
  private plugin = this.popup.plugin;

  constructor(private popup: FlashcardsPopup, private path: string) {}

  async render(body: HTMLElement) {
    this.popup.setBarTitle(S.deckSettings);
    const deck = await this.plugin.store.readDeck(this.path);
    const draft: DeckSettings = { ...deck.settings };
    new Setting(body).setName(S.language).setDesc(S.languageHint).addText((t) =>
      t.setValue(draft.language).onChange((v) => { draft.language = v.trim(); }));
    new Setting(body).setName(S.imageStyle).addTextArea((t) =>
      t.setValue(draft.imageStyle).onChange((v) => { draft.imageStyle = v; }));
    new Setting(body).setName(S.newPerDay).addText((t) => {
      t.inputEl.type = 'number';
      t.inputEl.min = '0';
      t.setValue(String(draft.newCardsPerDay)).onChange((v) => {
        const n = parseInt(v, 10);
        if (n >= 0) draft.newCardsPerDay = n;
      });
    });
    textButton(body, S.save, async () => {
      try {
        const file = this.plugin.app.vault.getFileByPath(this.path);
        if (file) await this.plugin.app.vault.process(file, (text) => updateSettings(text, draft));
        this.popup.back();
      } catch (error) {
        new Notice(errorText(error));
      }
    }, true).addClass('pf-wide');
  }
}

export class NewDeckScreen implements ScreenView {
  private plugin = this.popup.plugin;

  constructor(private popup: FlashcardsPopup) {}

  render(body: HTMLElement) {
    this.popup.setBarTitle(S.newDeck);
    const draft = { name: '', language: '', style: this.plugin.settings.defaultImageStyle };
    new Setting(body).setName(S.deckName).addText((t) => {
      t.setPlaceholder(S.deckNamePlaceholder).onChange((v) => { draft.name = v.trim(); });
      window.setTimeout(() => t.inputEl.focus(), 0);
    });
    new Setting(body).setName(S.language).setDesc(S.languageHint).addText((t) =>
      t.setPlaceholder(S.languagePlaceholder).onChange((v) => { draft.language = v.trim(); }));
    new Setting(body).setName(S.imageStyle).addTextArea((t) => t.setValue(draft.style).onChange((v) => { draft.style = v; }));
    textButton(body, S.createDeck, async () => {
      if (!draft.name || !draft.language) {
        new Notice(S.fillDeckFields);
        return;
      }
      try {
        const path = await this.plugin.createDeck(draft.name, draft.language, draft.style);
        this.plugin.settings.lastDeckPath = path;
        await this.plugin.saveSettings();
        this.popup.replace({ name: 'deck', path });
      } catch (error) {
        new Notice(errorText(error));
      }
    }, true).addClass('pf-wide');
  }
}
