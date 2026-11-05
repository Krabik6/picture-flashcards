import { ItemView, Notice, type WorkspaceLeaf } from 'obsidian';
import { regenerateImage } from '../core/cardCreation';
import { nextDueAt, type Grade } from '../core/scheduler';
import type { Card } from '../core/types';
import type PictureFlashcardsPlugin from '../main';
import { buildDeckOverview, relativeDue } from '../ui/deckOverview';
import { keyToAction, ReviewSession } from '../ui/reviewSession';
import { countCards, countDrafts, errorText, S } from '../ui/strings';
import { iconButton, renderCardBack, textButton } from './cardBack';

export const VIEW_TYPE_REVIEW = 'picture-flashcards-review';
const NARROW_WIDTH = 640;

export interface ReviewItem {
  deckPath: string;
  card: Card;
}

export class ReviewView extends ItemView {
  private session: ReviewSession<ReviewItem> | null = null;
  private rootEl: HTMLElement | null = null;
  private answerEl: HTMLElement | null = null;
  private swapButton: HTMLButtonElement | null = null;

  constructor(leaf: WorkspaceLeaf, private plugin: PictureFlashcardsPlugin) {
    super(leaf);
  }

  getViewType() {
    return VIEW_TYPE_REVIEW;
  }
  getDisplayText() {
    return S.review;
  }
  getIcon() {
    return 'images';
  }

  async onOpen() {
    this.contentEl.addClass('pf-root');
    this.registerDomEvent(document, 'keydown', (event) => this.onKey(event));
    await this.renderStart();
  }

  onResize() {
    this.rootEl?.toggleClass('pf-narrow', this.contentEl.clientWidth < NARROW_WIDTH);
  }

  private onKey(event: KeyboardEvent) {
    if (!this.session || event.metaKey || event.ctrlKey || event.altKey) return;
    if (this.app.workspace.getActiveViewOfType(ReviewView) !== this) return;
    if (document.querySelector('.modal-container')) return;
    const target = event.target as HTMLElement | null;
    if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
    const action = keyToAction(event.key, this.session.revealed());
    if (!action) return;
    event.preventDefault();
    if (action === 'reveal') this.reveal();
    else if (action === 'replay') this.replay();
    else void this.rate(action);
  }

  /** deckPath null means all decks. */
  async start(deckPath: string | null) {
    const items = await this.plugin.dueItems(deckPath);
    if (!items.length) {
      await this.renderStart();
      return;
    }
    this.session = new ReviewSession(items, async (item, grade) => {
      await this.plugin.store.updateCard(item.deckPath, item.card.id, (c) => ({
        ...c, schedule: this.plugin.deps.scheduler.grade(c.schedule, grade, new Date()),
      }));
    });
    this.renderCard();
  }

  async renderStart() {
    this.session = null;
    const root = this.contentEl;
    root.empty();
    const page = root.createDiv({ cls: 'pf-page' });
    const head = page.createDiv({ cls: 'pf-head' });
    const titles = head.createDiv({ cls: 'pf-titles' });
    titles.createEl('h1', { text: S.review });
    const subtitle = titles.createEl('p');
    const actions = head.createDiv({ cls: 'pf-actions' });
    textButton(actions, S.addCard, () => this.plugin.openAdd());
    const all = textButton(actions, S.reviewAll, () => void this.start(null), true);
    const decks = this.plugin.listDecks();
    if (!decks.length) page.createEl('p', { cls: 'pf-muted', text: S.noDecks });
    const now = new Date();
    let total = 0;
    for (const entry of decks) {
      const deck = await this.plugin.store.readDeck(entry.path);
      const missing = new Set(deck.cards.filter((c) => c.status === 'ready' && !this.plugin.store.resourceUrl(entry.path, c.media.image)).map((c) => c.id));
      const overview = buildDeckOverview(deck, missing, now);
      total += overview.dueToday;
      const row = page.createDiv({ cls: 'pf-deck-row' });
      const thumbs = row.createDiv({ cls: 'pf-thumbs' });
      for (const card of overview.ready.slice(0, 3)) {
        const url = this.plugin.store.resourceUrl(entry.path, card.media.image);
        if (url) thumbs.createEl('img', { attr: { src: url, alt: '' } });
      }
      const info = row.createDiv({ cls: 'pf-deck-info' });
      const link = info.createEl('button', { cls: 'pf-deck-name', text: entry.name });
      link.addEventListener('click', () => void this.plugin.openDeck(entry.path));
      const parts = [overview.dueToday ? `${overview.dueToday} на сегодня` : S.dueNone];
      if (overview.drafts.length) parts.push(countDrafts(overview.drafts.length));
      info.createEl('p', { text: parts.join(', ') });
      textButton(row, S.reviewVerb, () => void this.start(entry.path)).disabled = overview.dueToday === 0;
    }
    all.disabled = total === 0;
    subtitle.setText(total ? `Сегодня ${countCards(total)}` : 'Сегодня карточек больше нет');
  }

  private renderCard() {
    const session = this.session;
    const item = session?.current();
    const root = this.contentEl;
    root.empty();
    if (!session || !item) {
      void this.renderDone();
      return;
    }
    const url = this.plugin.store.resourceUrl(item.deckPath, item.card.media.image) ?? '';
    this.rootEl = root.createDiv({ cls: 'pf-review' });
    const stage = this.rootEl.createDiv({ cls: 'pf-stage' });
    const blur = stage.createDiv({ cls: 'pf-blur' });
    blur.style.backgroundImage = `url("${url}")`;
    stage.createEl('img', { cls: 'pf-art', attr: { src: url, alt: '' } });
    const top = stage.createDiv({ cls: 'pf-stage-top' });
    top.createSpan({ text: `Осталось ${session.remaining()}` });
    iconButton(top, 'x', S.finish, () => void this.renderStart());
    const reveal = stage.createEl('button', { cls: 'pf-reveal mod-cta' });
    reveal.createSpan({ text: S.reveal });
    reveal.createEl('kbd', { text: 'пробел' });
    reveal.addEventListener('click', () => this.reveal());
    this.swapButton = stage.createEl('button', { cls: 'pf-swap pf-hidden', text: S.otherImage });
    this.swapButton.addEventListener('click', () => void this.swapImage());
    this.answerEl = this.rootEl.createDiv({ cls: 'pf-answer' });
    this.onResize();
  }

  private reveal() {
    const session = this.session;
    const item = session?.current();
    if (!session || !item || session.revealed() || !this.answerEl) return;
    session.reveal();
    this.rootEl?.addClass('is-back');
    this.swapButton?.removeClass('pf-hidden');
    this.rootEl?.querySelector('.pf-reveal')?.addClass('pf-hidden');
    const body = this.answerEl.createDiv({ cls: 'pf-answer-body' });
    renderCardBack(body, item.card, (path) => this.plugin.playMedia(item.deckPath, path));
    const grades = this.answerEl.createDiv({ cls: 'pf-grades' });
    const grade = (key: string, label: string, value: Grade) => {
      const button = grades.createEl('button', { cls: `pf-grade pf-grade-${value}` });
      button.createSpan({ text: label });
      button.createEl('kbd', { text: key });
      button.addEventListener('click', () => void this.rate(value));
    };
    grade('1', S.forgot, 'forgot');
    grade('2', S.hard, 'hard');
    grade('3', S.easy, 'easy');
    if (this.plugin.settings.autoPlayAudio) this.replay();
  }

  private replay() {
    const item = this.session?.current();
    if (item) this.plugin.playMedia(item.deckPath, item.card.media.wordAudio);
  }

  private async rate(grade: Grade) {
    const session = this.session;
    if (!session) return;
    await session.rate(grade);
    if (session.error()) {
      new Notice(session.error() ?? '');
      return;
    }
    this.plugin.stopMedia();
    this.renderCard();
  }

  private async swapImage() {
    const session = this.session;
    const item = session?.current();
    const button = this.swapButton;
    if (!session || !item || !button) return;
    button.disabled = true;
    button.setText('Рисую...');
    try {
      const card = await regenerateImage(this.plugin.deps, item.deckPath, item.card.id, null);
      session.replaceCurrent({ deckPath: item.deckPath, card });
      const url = this.plugin.store.resourceUrl(item.deckPath, card.media.image) ?? '';
      this.rootEl?.querySelector('.pf-art')?.setAttribute('src', url);
      const blur = this.rootEl?.querySelector<HTMLElement>('.pf-blur');
      if (blur) blur.style.backgroundImage = `url("${url}")`;
    } catch (error) {
      new Notice(errorText(error));
    }
    button.disabled = false;
    button.setText(S.otherImage);
  }

  private async renderDone() {
    this.session = null;
    const root = this.contentEl;
    root.empty();
    const page = root.createDiv({ cls: 'pf-done' });
    page.createEl('h1', { text: S.doneTitle });
    const now = new Date();
    const all: Card[] = [];
    for (const deck of this.plugin.listDecks()) all.push(...(await this.plugin.store.readDeck(deck.path)).cards);
    const next = nextDueAt(all, now);
    page.createEl('p', { text: next ? S.nextCards(relativeDue(next.toISOString(), now)) : S.addMore });
    textButton(page, S.toDecks, () => void this.renderStart(), true);
  }
}
