import { Notice, setIcon } from 'obsidian';
import { regenerateImage } from '../../core/cardCreation';
import { nextDueAt, type Grade } from '../../core/scheduler';
import type { Card } from '../../core/types';
import { formatInterval, relativeDue } from '../../ui/deckOverview';
import { keyToAction, ReviewSession } from '../../ui/reviewSession';
import { errorText, S } from '../../ui/strings';
import { renderCardBack, textButton } from '../cardBack';
import type { FlashcardsPopup, ScreenView } from '../popup';
import type { ReviewItem } from '../../main';

export class ReviewScreen implements ScreenView {
  private plugin = this.popup.plugin;
  private session: ReviewSession<ReviewItem> | null = null;
  private total = 0;
  private bodyEl!: HTMLElement;
  private rootEl: HTMLElement | null = null;
  private answerEl: HTMLElement | null = null;
  private barEl: HTMLElement | null = null;
  private imgEl: HTMLImageElement | null = null;
  private swapEl: HTMLElement | null = null;

  constructor(private popup: FlashcardsPopup, private deckPath: string | null) {}

  async render(body: HTMLElement) {
    this.bodyEl = body;
    this.popup.setFixedBody(true);
    const items = await this.plugin.dueItems(this.deckPath);
    this.total = items.length;
    this.session = new ReviewSession(items, async (item, grade) => {
      await this.plugin.store.updateCard(item.deckPath, item.card.id, (c) => ({
        ...c, schedule: this.plugin.deps.scheduler.grade(c.schedule, grade, new Date()),
      }));
    });
    this.renderCard();
  }

  onKey(event: KeyboardEvent): boolean {
    const session = this.session;
    if (!session?.current()) return false;
    const action = keyToAction(event.key, session.revealed());
    if (!action) return false;
    if (action === 'reveal') this.reveal();
    else if (action === 'replay') this.replay();
    else void this.rate(action);
    return true;
  }

  private renderCard() {
    const session = this.session;
    const item = session?.current();
    const body = this.bodyEl;
    body.empty();
    this.popup.clearActions();
    if (!session || !item) {
      void this.renderDone();
      return;
    }
    const finished = Math.max(0, this.total - session.remaining());
    this.popup.setBarTitle(S.progress(Math.min(finished + 1, this.total), this.total));
    const root = body.createDiv({ cls: 'pf-review' });
    this.rootEl = root;
    const line = root.createDiv({ cls: 'pf-review-line' }).createDiv();
    line.style.width = `${(finished / this.total) * 100}%`;
    const stage = root.createDiv({ cls: 'pf-review-stage' });
    stage.addEventListener('click', () => this.reveal());
    this.imgEl = stage.createEl('img', { attr: { src: this.plugin.store.resourceUrl(item.deckPath, item.card.media.image) ?? '', alt: '' } });
    this.answerEl = root.createDiv({ cls: 'pf-review-answer' });
    this.barEl = root.createDiv({ cls: 'pf-review-bar' });
    this.swapEl = null;
    textButton(this.barEl, S.reveal, () => this.reveal(), true).addClass('pf-review-reveal');
    if (!session.revealed()) return;
    this.showAnswer(item);
  }

  private reveal() {
    const session = this.session;
    const item = session?.current();
    if (!session || !item || session.revealed()) return;
    session.reveal();
    this.showAnswer(item);
    if (this.plugin.settings.autoPlayAudio) this.replay();
  }

  private showAnswer(item: ReviewItem) {
    this.rootEl?.addClass('is-back');
    if (!this.answerEl || !this.barEl) return;
    this.answerEl.empty();
    renderCardBack(this.answerEl.createDiv({ cls: 'pf-card-face' }), item.card, (path) => this.plugin.playMedia(item.deckPath, path));
    this.swapEl = this.popup.addAction('refresh-cw', S.otherImage, () => void this.swapImage());
    const bar = this.barEl;
    bar.empty();
    bar.addClass('is-grades');
    const waits = this.plugin.deps.scheduler.preview(item.card.schedule, new Date());
    const grade = (label: string, value: Grade, key: string) => {
      const button = bar.createEl('button', { cls: `pf-grade pf-grade-${value}`, attr: { title: `Клавиша ${key}` } });
      button.createEl('strong', { text: label });
      button.createEl('small', { text: formatInterval(waits[value]) });
      button.addEventListener('click', () => void this.rate(value));
    };
    grade(S.forgot, 'forgot', '1');
    grade(S.hard, 'hard', '2');
    grade(S.easy, 'easy', '3');
  }

  private replay() {
    const item = this.session?.current();
    if (item) this.plugin.playMedia(item.deckPath, item.card.media.wordAudio);
  }

  private async rate(grade: Grade) {
    const session = this.session;
    if (!session) return;
    const before = session.current();
    await session.rate(grade);
    if (session.error()) {
      new Notice(session.error() ?? '');
      return;
    }
    if (session.current() === before && session.remaining() > 1) return;
    this.plugin.stopMedia();
    this.renderCard();
  }

  private async swapImage() {
    const session = this.session;
    const item = session?.current();
    const button = this.swapEl;
    if (!session || !item || !button) return;
    button.addClass('is-busy');
    button.empty();
    button.createSpan({ cls: 'pf-spinner' });
    try {
      const card = await regenerateImage(this.plugin.deps, item.deckPath, item.card.id, null);
      session.replaceCurrent({ deckPath: item.deckPath, card });
      const url = this.plugin.store.resourceUrl(item.deckPath, card.media.image);
      if (url && this.imgEl) this.imgEl.src = url;
    } catch (error) {
      new Notice(errorText(error));
    }
    button.removeClass('is-busy');
    button.empty();
    setIcon(button, 'refresh-cw');
  }

  private async renderDone() {
    const body = this.bodyEl;
    this.popup.setBarTitle(S.review);
    this.popup.setFixedBody(false);
    const page = body.createDiv({ cls: 'pf-done' });
    const icon = page.createDiv({ cls: 'pf-done-icon' });
    setIcon(icon, 'check');
    page.createEl('h2', { text: S.doneTitle });
    const now = new Date();
    const all: Card[] = [];
    for (const deck of this.plugin.listDecks()) all.push(...(await this.plugin.store.readDeck(deck.path)).cards);
    const next = nextDueAt(all, now);
    page.createEl('p', { text: next ? S.nextCards(relativeDue(next.toISOString(), now)) : S.addMore });
    textButton(page, S.toDecks, () => this.popup.replace({ name: 'home' }), true);
  }
}
