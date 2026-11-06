import { Notice, Platform, setIcon, type EventRef } from 'obsidian';
import { regenerateImage } from '../../core/cardCreation';
import { updateSettings } from '../../core/deckFormat';
import type { Card, DeckSettings } from '../../core/types';
import { progressLabel, progressStep } from '../../ui/addFlow';
import { buildDeckOverview, matchesQuery, orderedCards, relativeDue } from '../../ui/deckOverview';
import { countCards, errorText, S } from '../../ui/strings';
import { iconButton, keyHint, renderMaking, textButton } from '../cardBack';
import type { FlashcardsPopup, ScreenView } from '../popup';
import { AddBar } from './addBar';
import { field, languageField, styleField } from './deckForm';
import { renderKeyBanner } from './keyBanner';

interface Tile {
  el: HTMLElement;
  signature: string;
  image: string | null;
  card: Card;
}

export class DeckScreen implements ScreenView {
  private plugin = this.popup.plugin;
  private bar: AddBar | null = null;
  private topEl!: HTMLElement;
  private notesEl!: HTMLElement;
  private sectionEl!: HTMLElement;
  private gridEl!: HTMLElement;
  private noMatchEl!: HTMLElement;
  private tiles = new Map<string, Tile>();
  private busy = new Set<string>();
  private query = '';
  private dueToday = 0;
  private modifyRef: EventRef | null = null;
  private offQueue: (() => void) | null = null;
  private timer: number | null = null;

  constructor(private popup: FlashcardsPopup, private path: string) {}

  async render(body: HTMLElement) {
    const file = this.plugin.app.vault.getFileByPath(this.path);
    this.popup.setBarTitle(file?.basename ?? S.deck);
    this.popup.addAction('file-text', S.showAsText, () => this.plugin.showAsText(this.path));
    this.popup.addAction('settings', S.deckSettings, () => this.popup.go({ name: 'deckSettings', path: this.path }));
    renderKeyBanner(body, this.popup, () => this.bar?.focus());
    this.topEl = body.createDiv({ cls: 'pf-deck-top' });
    this.bar = new AddBar(this.popup, this.path, {
      onEmptyEnter: () => { if (this.dueToday) this.startReview(); },
      onType: (text) => this.applyFilter(text),
    });
    this.bar.render(body);
    this.notesEl = body.createDiv();
    this.sectionEl = body.createDiv({ cls: 'pf-section' });
    this.gridEl = body.createDiv({ cls: 'pf-grid' });
    this.noMatchEl = body.createDiv({ cls: 'pf-empty-line pf-invisible', text: S.noMatch });
    await this.refresh();
    this.bar.focus();
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

  private startReview() {
    this.popup.go({ name: 'review', deckPath: this.path });
  }

  private schedule() {
    if (this.timer !== null) return;
    this.timer = window.setTimeout(() => {
      this.timer = null;
      void this.refresh();
    }, 150);
  }

  private async refresh() {
    if (!this.gridEl.isConnected) return;
    const deck = await this.plugin.store.readDeck(this.path);
    const missing = new Set(deck.cards.filter((c) => c.status === 'ready' && !this.plugin.store.resourceUrl(this.path, c.media.image)).map((c) => c.id));
    const now = new Date();
    const overview = buildDeckOverview(deck, missing, now);

    if (overview.dueToday !== this.dueToday || !this.topEl.hasChildNodes()) {
      this.dueToday = overview.dueToday;
      this.topEl.empty();
      if (overview.dueToday) {
        const start = textButton(this.topEl, S.reviewNow(overview.dueToday), () => this.startReview(), true);
        start.addClass('pf-cta');
        start.addClass('pf-wide');
        if (!Platform.isPhone) keyHint(start, 'Enter');
      }
    }
    this.notesEl.empty();
    if (overview.brokenBlocks) this.notesEl.createDiv({ cls: 'pf-note', text: S.brokenBlocks(overview.brokenBlocks) });
    if (overview.needsAttention.length) this.notesEl.createDiv({ cls: 'pf-note', text: S.needsAttention(overview.needsAttention.length) });
    this.sectionEl.setText(deck.cards.length ? countCards(deck.cards.length) : S.emptyDeck);

    const order = orderedCards(overview);
    const seen = new Set<string>();
    for (const card of order) {
      seen.add(card.id);
      let tile = this.tiles.get(card.id);
      if (!tile) {
        tile = { el: createDiv({ cls: 'pf-tile' }), signature: '', image: card.media.image, card };
        this.tiles.set(card.id, tile);
      }
      tile.card = card;
      const item = this.plugin.queue.items().find((x) => x.cardId === card.id);
      const working = item?.state === 'waiting' || item?.state === 'working';
      const signature = JSON.stringify([card.status, card.word, card.media.image, card.lastError, card.explanation, relativeDue(card.schedule.due, now), working, this.busy.has(card.id)]);
      if (signature !== tile.signature) {
        tile.signature = signature;
        this.renderTile(tile, working, now);
      }
      // Moving an element does not reload its picture.
      this.gridEl.appendChild(tile.el);
    }
    for (const [id, tile] of this.tiles) {
      if (seen.has(id)) continue;
      tile.el.remove();
      this.tiles.delete(id);
    }
    this.applyFilter(this.query);
  }

  private applyFilter(text: string) {
    this.query = text;
    let visible = 0;
    for (const tile of this.tiles.values()) {
      const match = matchesQuery(tile.card, text);
      tile.el.toggleClass('pf-invisible', !match);
      if (match) visible++;
    }
    this.noMatchEl.toggleClass('pf-invisible', !text.trim() || visible > 0);
  }

  private renderTile(tile: Tile, working: boolean, now: Date) {
    const { el, card } = tile;
    el.empty();
    const main = el.createEl('button', { cls: 'pf-tile-main' });
    main.addEventListener('click', () => this.popup.go({ name: 'card', path: this.path, id: card.id }));
    const print = main.createDiv({ cls: 'pf-print' });
    const pic = print.createDiv({ cls: 'pf-print-pic' });
    const url = this.plugin.store.resourceUrl(this.path, card.media.image);
    if (url) {
      const img = pic.createEl('img', { attr: { src: url, alt: '' } });
      if (tile.image !== card.media.image) img.addClass('pf-develop');
    } else {
      pic.addClass('pf-blank');
      if (working) pic.addClass('is-working');
      else setIcon(pic, card.status === 'draft' ? 'triangle-alert' : 'image-off');
    }
    tile.image = card.media.image;
    if (url && this.busy.has(card.id)) pic.addClass('is-working');
    const cap = print.createDiv({ cls: 'pf-print-cap' });
    cap.createEl('strong', { text: card.word });
    if (working) renderMaking(cap, progressStep(card), progressLabel(card));
    else if (card.status === 'draft') cap.createEl('small', { cls: 'pf-paper-error', text: S.tryAgain });
    else if (!url) cap.createEl('small', { cls: 'pf-paper-error', text: S.missingFile });
    else {
      const when = relativeDue(card.schedule.due, now);
      const small = cap.createEl('small', { text: when });
      if (when === 'сегодня') small.addClass('is-due');
    }
    if (working) return;
    if (card.status === 'draft') {
      iconButton(el, 'rotate-cw', S.retry, () => this.plugin.queue.retry(this.path, card.id, card.word)).addClass('pf-tile-action', 'is-shown');
    } else if (url && !this.busy.has(card.id)) {
      iconButton(el, 'refresh-cw', S.otherImage, () => void this.swap(card)).addClass('pf-tile-action');
    }
  }

  private async swap(card: Card) {
    this.busy.add(card.id);
    await this.refresh();
    try {
      await regenerateImage(this.plugin.deps, this.path, card.id, null);
    } catch (error) {
      new Notice(errorText(error));
    }
    this.busy.delete(card.id);
    await this.refresh();
  }
}

export class DeckSettingsScreen implements ScreenView {
  private plugin = this.popup.plugin;

  constructor(private popup: FlashcardsPopup, private path: string) {}

  async render(body: HTMLElement) {
    this.popup.setBarTitle(S.deckSettings);
    const deck = await this.plugin.store.readDeck(this.path);
    const draft: DeckSettings = { ...deck.settings };
    const form = body.createDiv({ cls: 'pf-form' });
    languageField(form, draft.language, (value) => { draft.language = value; });
    styleField(form, draft.imageStyle, (value) => { draft.imageStyle = value; });
    const perDay = field(form, S.newPerDay).createEl('input', { type: 'number', cls: 'pf-input pf-input-short', attr: { min: '0' } });
    perDay.value = String(draft.newCardsPerDay);
    perDay.addEventListener('input', () => {
      const n = parseInt(perDay.value, 10);
      if (n >= 0) draft.newCardsPerDay = n;
    });
    const save = textButton(form, S.save, async () => {
      if (!draft.language) {
        new Notice(S.fillDeckFields);
        return;
      }
      try {
        const file = this.plugin.app.vault.getFileByPath(this.path);
        if (file) await this.plugin.app.vault.process(file, (text) => updateSettings(text, draft));
        this.popup.back();
      } catch (error) {
        new Notice(errorText(error));
      }
    }, true);
    save.addClass('pf-cta');
    save.addClass('pf-wide');
  }
}

export class NewDeckScreen implements ScreenView {
  private plugin = this.popup.plugin;

  constructor(private popup: FlashcardsPopup) {}

  render(body: HTMLElement) {
    this.popup.setBarTitle(S.newDeck);
    const draft = { name: '', language: '', style: this.plugin.settings.defaultImageStyle };
    const form = body.createDiv({ cls: 'pf-form' });
    let update = () => {};
    const name = field(form, S.deckName).createEl('input', { type: 'text', cls: 'pf-input', attr: { placeholder: S.deckNamePlaceholder } });
    const language = languageField(form, '', (value) => { draft.language = value; update(); });
    styleField(form, draft.style, (value) => { draft.style = value; });
    const errorEl = form.createDiv({ cls: 'pf-field-error pf-invisible' });
    const create = textButton(form, S.createDeck, () => void submit(), true);
    create.addClass('pf-cta');
    create.addClass('pf-wide');
    update = () => {
      draft.name = name.value.trim();
      create.disabled = !draft.name || !draft.language;
      errorEl.addClass('pf-invisible');
    };
    const submit = async () => {
      if (create.disabled) return;
      try {
        const path = await this.plugin.createDeck(draft.name, draft.language, draft.style);
        this.plugin.settings.lastDeckPath = path;
        await this.plugin.saveSettings();
        this.popup.replace({ name: 'deck', path });
      } catch (error) {
        errorEl.setText(errorText(error));
        errorEl.removeClass('pf-invisible');
      }
    };
    name.addEventListener('input', () => update());
    for (const input of [name, language]) {
      input.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' || event.isComposing) return;
        event.preventDefault();
        event.stopPropagation();
        void submit();
      });
    }
    update();
    if (!Platform.isMobile) window.setTimeout(() => name.focus(), 0);
  }
}
