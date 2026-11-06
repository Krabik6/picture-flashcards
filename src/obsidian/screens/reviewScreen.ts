import { Notice, Platform, setIcon } from 'obsidian';
import { regenerateImage } from '../../core/cardCreation';
import { nextDueAt, type Grade } from '../../core/scheduler';
import type { Card } from '../../core/types';
import { formatInterval, relativeDue } from '../../ui/deckOverview';
import { keyToAction, ReviewSession } from '../../ui/reviewSession';
import { errorText, S } from '../../ui/strings';
import { keyHint, renderCaption, renderDetails, textButton } from '../cardBack';
import type { FlashcardsPopup, ScreenView } from '../popup';
import type { ReviewItem } from '../../main';

const GRADES: { value: Grade; key: string; label: string }[] = [
  { value: 'forgot', key: '1', label: S.forgot },
  { value: 'hard', key: '2', label: S.hard },
  { value: 'easy', key: '3', label: S.easy },
];

/** Where a card flies after an answer: forgot goes back left, easy goes off to the right. */
const THROW: Record<Grade, string> = {
  forgot: 'translate(-70%, 6%) rotate(-9deg)',
  hard: 'translate(0, 34%) rotate(2deg)',
  easy: 'translate(70%, 6%) rotate(9deg)',
};

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export class ReviewScreen implements ScreenView {
  private plugin = this.popup.plugin;
  private session: ReviewSession<ReviewItem> | null = null;
  private total = 0;
  private bodyEl!: HTMLElement;
  private rootEl: HTMLElement | null = null;
  private printEl: HTMLElement | null = null;
  private picEl: HTMLElement | null = null;
  private captionEl: HTMLElement | null = null;
  private detailsEl: HTMLElement | null = null;
  private barEl: HTMLElement | null = null;
  private imgEl: HTMLImageElement | null = null;
  private swapping = false;
  private doneKeys: (() => void) | null = null;

  constructor(private popup: FlashcardsPopup, private deckPath: string | null) {}

  async render(body: HTMLElement) {
    this.bodyEl = body;
    this.popup.setFixedBody(true);
    const items = await this.plugin.dueItems(this.deckPath);
    this.total = items.length;
    this.session = new ReviewSession<ReviewItem>(
      items,
      async (item, grade) => {
        const card = await this.plugin.store.updateCard(item.deckPath, item.card.id, (c) => ({
          ...c, schedule: this.plugin.deps.scheduler.grade(c.schedule, grade, new Date()),
        }));
        return card ? { deckPath: item.deckPath, card } : undefined;
      },
      async (before) => {
        await this.plugin.store.updateCard(before.deckPath, before.card.id, (c) => ({ ...c, schedule: before.card.schedule }));
      },
    );
    this.renderCard(true);
  }

  onKey(event: KeyboardEvent): boolean {
    const session = this.session;
    if (!session) return false;
    if (!session.current()) {
      if (event.key === 'Enter' && this.doneKeys) {
        this.doneKeys();
        return true;
      }
      if (event.key.toLowerCase() === 'z' || event.key.toLowerCase() === 'я') {
        void this.undo();
        return true;
      }
      return false;
    }
    const action = keyToAction(event.key, session.revealed());
    if (!action) return false;
    if (action === 'reveal') this.reveal();
    else if (action === 'replay') this.replay();
    else if (action === 'undo') void this.undo();
    else void this.rate(action);
    return true;
  }

  private renderCard(first = false) {
    const session = this.session;
    const item = session?.current();
    const body = this.bodyEl;
    body.empty();
    this.popup.clearActions();
    this.doneKeys = null;
    if (!session || !item) {
      void this.renderDone();
      return;
    }
    const finished = Math.max(0, this.total - session.remaining());
    this.popup.setBarTitle(S.review, S.progress(Math.min(finished + 1, this.total), this.total));
    if (session.canUndo()) this.popup.addAction('undo-2', S.undo, () => void this.undo());
    const url = this.plugin.store.resourceUrl(item.deckPath, item.card.media.image);
    this.popup.setAmbient(url);
    this.preloadNext();

    const root = body.createDiv({ cls: 'pf-review' });
    this.rootEl = root;
    const line = root.createDiv({ cls: 'pf-review-line' }).createDiv();
    line.style.width = `${(finished / this.total) * 100}%`;
    const stage = root.createDiv({ cls: 'pf-review-stage' });
    stage.addEventListener('click', () => this.reveal());
    const stack = stage.createDiv({ cls: 'pf-review-card pf-stack' });
    if (session.remaining() > 1) stack.addClass('has-sheets');
    const print = stack.createDiv({ cls: 'pf-print' });
    this.printEl = print;
    this.picEl = print.createDiv({ cls: 'pf-print-pic' });
    this.imgEl = this.picEl.createEl('img', { attr: { src: url ?? '', alt: '' } });
    const capWrap = print.createDiv({ cls: 'pf-print-capwrap' }).createDiv();
    this.captionEl = capWrap.createDiv({ cls: 'pf-print-cap pf-card-cap' });
    const answer = root.createDiv({ cls: 'pf-review-answer' });
    this.detailsEl = answer.createDiv().createDiv({ cls: 'pf-details' });
    this.barEl = root.createDiv({ cls: 'pf-review-bar' });
    const button = textButton(this.barEl, S.reveal, () => this.reveal(), true);
    button.addClass('pf-cta');
    button.addClass('pf-review-reveal');
    if (!Platform.isPhone) keyHint(button, 'Пробел');
    if (!first && !reducedMotion()) {
      stack.animate(
        [{ transform: 'translateY(-10px) scale(.95)', opacity: 0.55 }, { transform: 'none', opacity: 1 }],
        { duration: 300, easing: 'cubic-bezier(.2,.8,.2,1)' },
      );
    }
    if (session.revealed()) this.showAnswer(item);
  }

  private preloadNext() {
    const next = this.session?.next();
    if (!next) return;
    const url = this.plugin.store.resourceUrl(next.deckPath, next.card.media.image);
    if (url) new Image().src = url;
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
    if (!this.captionEl || !this.detailsEl || !this.barEl) return;
    const play = (path: string | null) => this.plugin.playMedia(item.deckPath, path);
    this.captionEl.empty();
    renderCaption(this.captionEl, item.card, play);
    this.detailsEl.empty();
    renderDetails(this.detailsEl, item.card, play);
    this.popup.addAction('refresh-cw', S.otherImage, () => void this.swapImage());
    const bar = this.barEl;
    bar.empty();
    bar.addClass('is-grades');
    const waits = this.plugin.deps.scheduler.preview(item.card.schedule, new Date());
    for (const { value, key, label } of GRADES) {
      const button = bar.createEl('button', { cls: `pf-grade pf-grade-${value}` });
      button.createEl('strong', { text: label });
      button.createEl('small', { text: formatInterval(waits[value]) });
      if (!Platform.isPhone) keyHint(button, key);
      button.addEventListener('click', () => void this.rate(value));
    }
  }

  private replay() {
    const item = this.session?.current();
    if (item) this.plugin.playMedia(item.deckPath, item.card.media.wordAudio);
  }

  private async rate(grade: Grade) {
    const session = this.session;
    if (!session || !session.revealed() || this.swapping) return;
    const before = session.current();
    const ghost = this.makeGhost();
    await session.rate(grade);
    if (session.error()) {
      ghost?.remove();
      new Notice(session.error() ?? '');
      return;
    }
    if (session.current() === before && session.remaining() > 1) {
      ghost?.remove();
      return;
    }
    this.plugin.stopMedia();
    this.renderCard();
    this.throwGhost(ghost, grade);
  }

  /** A copy of the card that stays on screen for a moment and flies away. */
  private makeGhost(): HTMLElement | null {
    if (reducedMotion() || !this.printEl) return null;
    const box = this.printEl.getBoundingClientRect();
    const host = this.popup.modalEl.getBoundingClientRect();
    const ghost = this.printEl.cloneNode(true) as HTMLElement;
    ghost.addClass('pf-ghost');
    ghost.style.left = `${box.left - host.left}px`;
    ghost.style.top = `${box.top - host.top}px`;
    ghost.style.width = `${box.width}px`;
    ghost.style.height = `${box.height}px`;
    return ghost;
  }

  private throwGhost(ghost: HTMLElement | null, grade: Grade) {
    if (!ghost) return;
    this.popup.modalEl.appendChild(ghost);
    const remove = () => ghost.remove();
    const flight = ghost.animate(
      [{ transform: 'none', opacity: 1 }, { transform: THROW[grade], opacity: 0 }],
      { duration: 340, easing: 'cubic-bezier(.3,.7,.3,1)', fill: 'forwards' },
    );
    flight.onfinish = remove;
    window.setTimeout(remove, 600);
  }

  private async undo() {
    const session = this.session;
    if (!session?.canUndo()) return;
    await session.undo();
    if (session.error()) {
      new Notice(session.error() ?? '');
      return;
    }
    this.popup.setFixedBody(true);
    this.renderCard();
  }

  private async swapImage() {
    const session = this.session;
    const item = session?.current();
    if (!session || !item || this.swapping) return;
    this.swapping = true;
    const pic = this.picEl;
    pic?.addClass('is-working');
    const status = pic?.createDiv({ cls: 'pf-pic-status', text: S.drawing });
    try {
      const card = await regenerateImage(this.plugin.deps, item.deckPath, item.card.id, null);
      session.replaceCurrent({ deckPath: item.deckPath, card });
      const url = this.plugin.store.resourceUrl(item.deckPath, card.media.image);
      if (url && this.imgEl?.isConnected) {
        this.imgEl.src = url;
        this.imgEl.addClass('pf-develop');
        this.popup.setAmbient(url);
      }
    } catch (error) {
      new Notice(errorText(error));
    }
    pic?.removeClass('is-working');
    status?.remove();
    this.swapping = false;
  }

  private async renderDone() {
    const body = this.bodyEl;
    const session = this.session;
    const token = this.rootEl = body.createDiv({ cls: 'pf-done' });
    this.popup.setBarTitle(S.review);
    this.popup.setFixedBody(false);
    this.popup.setAmbient(null);
    if (session?.canUndo()) this.popup.addAction('undo-2', S.undo, () => void this.undo());
    const answers = session?.answers() ?? [];

    // Newest answers on top of the fan, each picture once.
    const pictures = [...new Set(answers.map((a) => this.plugin.store.resourceUrl(a.item.deckPath, a.item.card.media.image)))]
      .filter((url): url is string => !!url)
      .slice(-3);
    const fan = token.createDiv({ cls: 'pf-fan is-dealt' });
    if (!pictures.length) {
      setIcon(token.createDiv({ cls: 'pf-done-icon' }), 'check');
      fan.remove();
    }
    for (const url of pictures) {
      fan.createDiv({ cls: 'pf-print pf-fan-card' }).createDiv({ cls: 'pf-print-pic' }).createEl('img', { attr: { src: url, alt: '' } });
    }
    token.createEl('h2', { text: S.doneTitle });
    if (answers.length) {
      token.createEl('p', { text: S.answered(this.total) });
      const tally = token.createDiv({ cls: 'pf-tally' });
      for (const { value, label } of GRADES) {
        const n = answers.filter((a) => a.grade === value).length;
        if (!n) continue;
        const chip = tally.createDiv({ cls: `pf-tally-chip pf-grade-${value}` });
        chip.createSpan({ text: label });
        chip.createEl('strong', { text: String(n) });
      }
    }
    const now = new Date();
    const all: Card[] = [];
    for (const deck of this.plugin.listDecks()) all.push(...(await this.plugin.store.readDeck(deck.path)).cards);
    const next = nextDueAt(all, now);
    token.createEl('p', { cls: 'pf-done-next', text: next ? S.nextCards(relativeDue(next.toISOString(), now)) : S.addMore });
    const actions = token.createDiv({ cls: 'pf-done-actions' });
    const leave = () => this.popup.replace(this.deckPath ? { name: 'deck', path: this.deckPath } : { name: 'home' });
    const main = textButton(actions, this.deckPath ? S.toDeck : S.toDecks, leave, true);
    main.addClass('pf-cta');
    if (!Platform.isPhone) keyHint(main, 'Enter');
    this.doneKeys = leave;
    if (this.deckPath) {
      const rest = await this.plugin.dueItems(null);
      if (rest.length && token.isConnected) {
        textButton(actions, S.moreInOtherDecks(rest.length), () => this.popup.replace({ name: 'review', deckPath: null }));
      }
    }
  }
}
