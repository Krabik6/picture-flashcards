import { Platform, setIcon, type EventRef } from 'obsidian';
import { buildDeckOverview, orderedCards, relativeDue, type DeckOverview } from '../../ui/deckOverview';
import { nextDueAt } from '../../core/scheduler';
import type { Card } from '../../core/types';
import { countCards, S } from '../../ui/strings';
import { keyHint, textButton } from '../cardBack';
import type { FlashcardsPopup, ScreenView } from '../popup';
import { AddBar } from './addBar';
import { renderKeyBanner } from './keyBanner';

interface DeckRow {
  path: string;
  name: string;
  overview: DeckOverview;
  cards: Card[];
}

export class HomeScreen implements ScreenView {
  private plugin = this.popup.plugin;
  private bar: AddBar | null = null;
  private heroEl!: HTMLElement;
  private decksEl!: HTMLElement;
  private offQueue: (() => void) | null = null;
  private modifyRef: EventRef | null = null;
  private timer: number | null = null;
  private drawn = '';

  constructor(private popup: FlashcardsPopup) {}

  async render(body: HTMLElement) {
    this.popup.setBarTitle(S.appTitle);
    this.popup.addAction('settings', S.openSettings, () => this.plugin.openPluginSettings());
    if (!this.plugin.listDecks().length) {
      this.renderFirstRun(body);
      return;
    }
    renderKeyBanner(body, this.popup, () => this.bar?.focus());
    this.heroEl = body.createDiv({ cls: 'pf-hero' });
    this.bar = new AddBar(this.popup, null, { onEmptyEnter: () => this.startReview() });
    this.bar.render(body);
    this.decksEl = body.createDiv({ cls: 'pf-decks' });
    await this.refresh();
    this.offQueue = this.plugin.queue.subscribe(() => this.schedule());
    this.modifyRef = this.plugin.app.vault.on('modify', () => this.schedule());
  }

  dispose() {
    this.bar?.dispose();
    this.offQueue?.();
    if (this.modifyRef) this.plugin.app.vault.offref(this.modifyRef);
    if (this.timer !== null) window.clearTimeout(this.timer);
  }

  private renderFirstRun(body: HTMLElement) {
    renderKeyBanner(body, this.popup, () => {});
    const page = body.createDiv({ cls: 'pf-first' });
    const fan = page.createDiv({ cls: 'pf-fan is-blank' });
    for (let i = 0; i < 3; i++) setIcon(fan.createDiv({ cls: 'pf-print pf-fan-card' }).createDiv({ cls: 'pf-print-pic pf-blank' }), 'image');
    page.createEl('h2', { text: S.firstDeckTitle });
    page.createEl('p', { text: S.firstDeckHint });
    textButton(page, S.newDeck, () => this.popup.go({ name: 'newDeck' }), true).addClass('pf-cta');
  }

  private startReview() {
    this.popup.go({ name: 'review', deckPath: null });
  }

  private schedule() {
    if (this.timer !== null) return;
    this.timer = window.setTimeout(() => {
      this.timer = null;
      void this.refresh();
    }, 200);
  }

  private async refresh() {
    if (!this.decksEl.isConnected) return;
    const now = new Date();
    const rows: DeckRow[] = [];
    for (const { path, name } of this.plugin.listDecks()) {
      const deck = await this.plugin.store.readDeck(path);
      const missing = new Set(deck.cards.filter((c) => c.status === 'ready' && !this.plugin.store.resourceUrl(path, c.media.image)).map((c) => c.id));
      rows.push({ path, name, overview: buildDeckOverview(deck, missing, now), cards: deck.cards });
    }
    // Drawn again only when something visible changed, so pictures do not blink.
    const key = JSON.stringify(rows.map((r) => [r.path, r.overview.dueToday, r.cards.length, r.overview.drafts.length, orderedCards(r.overview).slice(0, 3).map((c) => c.media.image)]));
    if (key === this.drawn) return;
    this.drawn = key;
    this.renderHero(rows, now);
    this.renderDecks(rows);
  }

  private renderHero(rows: DeckRow[], now: Date) {
    const hero = this.heroEl;
    hero.empty();
    const total = rows.reduce((sum, r) => sum + r.overview.dueToday, 0);
    const pictures = rows
      .flatMap((r) => orderedCards({ ...r.overview, drafts: [], needsAttention: [] }).slice(0, 3).map((c) => this.plugin.store.resourceUrl(r.path, c.media.image)))
      .filter((url): url is string => !!url);
    // Takes pictures from different decks first, so the fan looks alive.
    const perDeck = rows.map((r) => this.plugin.store.resourceUrl(r.path, r.overview.ready[0]?.media.image ?? null)).filter((url): url is string => !!url);
    const fanned = [...new Set([...perDeck, ...pictures])].slice(0, 3);
    const fan = hero.createDiv({ cls: 'pf-fan' });
    if (!total) fan.addClass('is-rest');
    for (const url of fanned) {
      fan.createDiv({ cls: 'pf-print pf-fan-card' }).createDiv({ cls: 'pf-print-pic' }).createEl('img', { attr: { src: url, alt: '' } });
    }
    const text = hero.createDiv({ cls: 'pf-hero-text' });
    if (total) {
      text.createEl('h2', { text: S.todayTitle(total) });
      text.createEl('p', { text: rows.filter((r) => r.overview.dueToday).map((r) => `${r.name} ${r.overview.dueToday}`).join(', ') });
      const start = textButton(text, S.start, () => this.startReview(), true);
      start.addClass('pf-cta');
      if (!Platform.isPhone) keyHint(start, 'Enter');
      return;
    }
    const all = rows.flatMap((r) => r.cards);
    const next = nextDueAt(all, now);
    text.createEl('h2', { text: S.doneTitle });
    text.createEl('p', { text: next ? S.nextIn(relativeDue(next.toISOString(), now)) : S.nothingYet });
  }

  private renderDecks(rows: DeckRow[]) {
    const root = this.decksEl;
    root.empty();
    const head = root.createDiv({ cls: 'pf-decks-head' });
    head.createSpan({ text: S.decks });
    const add = head.createEl('button', { cls: 'pf-link' });
    add.addEventListener('click', () => this.popup.go({ name: 'newDeck' }));
    setIcon(add.createSpan({ cls: 'pf-link-icon' }), 'plus');
    add.createSpan({ text: S.newDeck });
    const grid = root.createDiv({ cls: 'pf-deck-grid' });
    for (const row of rows) {
      const button = grid.createEl('button', { cls: 'pf-deck' });
      button.addEventListener('click', () => this.popup.go({ name: 'deck', path: row.path }));
      const sheets = row.cards.length > 1 ? 'pf-stack has-sheets' : 'pf-stack';
      const stack = button.createDiv({ cls: sheets });
      const print = stack.createDiv({ cls: 'pf-print' });
      const pic = print.createDiv({ cls: 'pf-print-pic' });
      const url = this.plugin.store.resourceUrl(row.path, row.overview.ready[0]?.media.image ?? null);
      if (url) pic.createEl('img', { attr: { src: url, alt: '' } });
      else {
        pic.addClass('pf-blank');
        setIcon(pic, 'image');
      }
      const cap = print.createDiv({ cls: 'pf-print-cap' });
      cap.createEl('strong', { text: row.name });
      cap.createEl('small', { text: countCards(row.cards.length) });
      if (row.overview.dueToday) stack.createDiv({ cls: 'pf-badge', text: String(row.overview.dueToday), attr: { 'aria-label': `${row.overview.dueToday} на сегодня` } });
    }
    this.bar?.focus();
  }
}
