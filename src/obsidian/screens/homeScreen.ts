import { setIcon, type EventRef } from 'obsidian';
import { buildDeckOverview } from '../../ui/deckOverview';
import { countDrafts, countDue, S } from '../../ui/strings';
import { SECRET_IDS } from '../settings';
import { textButton } from '../cardBack';
import type { FlashcardsPopup, ScreenView } from '../popup';
import { AddBar } from './addBar';

export class HomeScreen implements ScreenView {
  private plugin = this.popup.plugin;
  private bar: AddBar | null = null;
  private topEl!: HTMLElement;
  private decksEl!: HTMLElement;
  private offQueue: (() => void) | null = null;
  private modifyRef: EventRef | null = null;
  private timer: number | null = null;

  constructor(private popup: FlashcardsPopup) {}

  async render(body: HTMLElement) {
    this.popup.setBarTitle(S.appTitle);
    this.popup.addAction('settings', S.openSettings, () => this.plugin.openPluginSettings());
    const hasKey = this.plugin.app.secretStorage.getSecret(SECRET_IDS[this.plugin.settings.backend]);
    if (!hasKey) {
      const note = body.createDiv({ cls: 'pf-note' });
      note.createSpan({ text: S.needKey });
      textButton(note, S.openSettings, () => this.plugin.openPluginSettings());
    }
    this.topEl = body.createDiv({ cls: 'pf-home-top' });
    if (this.plugin.listDecks().length) {
      this.bar = new AddBar(this.popup, null);
      this.bar.render(body);
    }
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

  private schedule() {
    if (this.timer !== null) return;
    this.timer = window.setTimeout(() => {
      this.timer = null;
      void this.refresh();
    }, 200);
  }

  private async refresh() {
    if (!this.decksEl.isConnected) return;
    const decks = this.plugin.listDecks();
    const now = new Date();
    const rows = [];
    let total = 0;
    for (const entry of decks) {
      const deck = await this.plugin.store.readDeck(entry.path);
      const missing = new Set(deck.cards.filter((c) => c.status === 'ready' && !this.plugin.store.resourceUrl(entry.path, c.media.image)).map((c) => c.id));
      const overview = buildDeckOverview(deck, missing, now);
      total += overview.dueToday;
      rows.push({ entry, overview, count: deck.cards.length });
    }
    this.topEl.empty();
    if (!decks.length) {
      this.topEl.createEl('p', { cls: 'pf-muted', text: S.firstDeckHint });
      textButton(this.topEl, S.newDeck, () => this.popup.go({ name: 'newDeck' }), true).addClass('pf-wide');
    } else {
      const review = textButton(this.topEl, total ? S.reviewNow(total) : S.reviewNone, () => this.popup.go({ name: 'review', deckPath: null }), true);
      review.addClass('pf-wide');
      review.disabled = total === 0;
    }
    this.decksEl.empty();
    if (!decks.length) return;
    this.decksEl.createDiv({ cls: 'pf-section', text: S.decks });
    for (const { entry, overview, count } of rows) {
      const row = this.decksEl.createEl('button', { cls: 'pf-deckrow' });
      row.addEventListener('click', () => this.popup.go({ name: 'deck', path: entry.path }));
      const cover = overview.ready[0];
      const url = cover ? this.plugin.store.resourceUrl(entry.path, cover.media.image) : null;
      if (url) row.createEl('img', { attr: { src: url, alt: '' } });
      else row.createDiv({ cls: 'pf-deckrow-empty' });
      const text = row.createDiv({ cls: 'pf-deckrow-text' });
      text.createEl('strong', { text: entry.name });
      const parts = [overview.dueToday ? countDue(overview.dueToday) : `Всего ${count}`];
      if (overview.drafts.length) parts.push(countDrafts(overview.drafts.length));
      text.createEl('small', { text: parts.join(', ') });
      setIcon(row.createDiv({ cls: 'pf-chevron' }), 'chevron-right');
    }
    const add = this.decksEl.createEl('button', { cls: 'pf-deckrow pf-deckrow-add' });
    add.addEventListener('click', () => this.popup.go({ name: 'newDeck' }));
    setIcon(add.createDiv({ cls: 'pf-deckrow-empty' }), 'plus');
    add.createEl('span', { text: S.newDeck });
  }
}
