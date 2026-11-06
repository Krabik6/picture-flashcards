import { Notice, setIcon } from 'obsidian';
import { regenerateAll, regenerateImage } from '../../core/cardCreation';
import type { Card } from '../../core/types';
import { progressLabel, progressStep } from '../../ui/addFlow';
import { buildDeckOverview, orderedCards, relativeDue } from '../../ui/deckOverview';
import { errorText, S } from '../../ui/strings';
import { renderCaption, renderDetails, renderMaking, textButton } from '../cardBack';
import type { FlashcardsPopup, ScreenView } from '../popup';

export class CardScreen implements ScreenView {
  private plugin = this.popup.plugin;
  private bodyEl!: HTMLElement;
  private prompt = '';
  private promptOpen = false;
  private busy: 'image' | 'all' | null = null;
  private confirmingDelete = false;
  private offQueue: (() => void) | null = null;
  private neighbours: { prev: string | null; next: string | null } = { prev: null, next: null };
  private shownImage: string | null | undefined;

  constructor(private popup: FlashcardsPopup, private path: string, private id: string) {}

  async render(body: HTMLElement) {
    this.bodyEl = body;
    this.offQueue = this.plugin.queue.subscribe(() => void this.redraw());
    await this.redraw();
  }

  dispose() {
    this.offQueue?.();
  }

  onKey(event: KeyboardEvent): boolean {
    if (event.key === 'ArrowLeft') return this.step(this.neighbours.prev);
    if (event.key === 'ArrowRight') return this.step(this.neighbours.next);
    return false;
  }

  private step(id: string | null): boolean {
    if (!id) return false;
    this.popup.replace({ name: 'card', path: this.path, id });
    return true;
  }

  private isWorking() {
    const item = this.plugin.queue.items().find((x) => x.cardId === this.id);
    return item?.state === 'waiting' || item?.state === 'working';
  }

  private async redraw() {
    if (!this.bodyEl.isConnected) return;
    const deck = await this.plugin.store.readDeck(this.path);
    const card = deck.cards.find((c) => c.id === this.id);
    if (!card) {
      this.popup.back();
      return;
    }
    const missing = new Set(deck.cards.filter((c) => c.status === 'ready' && !this.plugin.store.resourceUrl(this.path, c.media.image)).map((c) => c.id));
    const order = orderedCards(buildDeckOverview(deck, missing, new Date()));
    const index = order.findIndex((c) => c.id === this.id);
    this.neighbours = { prev: order[index - 1]?.id ?? null, next: order[index + 1]?.id ?? null };

    const name = this.plugin.app.vault.getFileByPath(this.path)?.basename ?? S.deck;
    this.popup.setBarTitle(name, order.length > 1 ? S.progress(index + 1, order.length) : undefined);
    this.popup.clearActions();
    if (order.length > 1) {
      this.popup.addAction('arrow-left', S.prevCard, () => this.step(this.neighbours.prev)).toggleAttribute('disabled', !this.neighbours.prev);
      this.popup.addAction('arrow-right', S.nextCard, () => this.step(this.neighbours.next)).toggleAttribute('disabled', !this.neighbours.next);
    }
    const more = this.popup.addAction('more-horizontal', S.more, () => this.openMenu(more, card));

    const scroll = this.bodyEl.scrollTop;
    this.bodyEl.empty();
    this.popup.setAmbient(this.plugin.store.resourceUrl(this.path, card.media.image));
    const page = this.bodyEl.createDiv({ cls: 'pf-card-page' });
    if (card.status === 'draft') this.renderDraft(page, card);
    else this.renderReady(page, card);
    if (this.confirmingDelete) this.renderDelete(page, card);
    this.bodyEl.scrollTop = scroll;
  }

  private openMenu(anchor: HTMLElement, card: Card) {
    const remake = {
      icon: 'sparkles',
      label: S.remakeAll,
      onClick: () => void this.run('all', () => regenerateAll(this.plugin.deps, this.path, card.id, this.prompt.trim() || null)),
    };
    const remove = {
      icon: 'trash-2',
      label: S.delete,
      danger: true,
      onClick: () => {
        this.confirmingDelete = true;
        void this.redraw();
      },
    };
    this.popup.showMenu(anchor, card.status === 'ready' ? [remake, remove] : [remove]);
  }

  private renderDraft(page: HTMLElement, card: Card) {
    const print = page.createDiv({ cls: 'pf-print pf-card-print' });
    const pic = print.createDiv({ cls: 'pf-print-pic pf-blank' });
    const working = this.isWorking();
    if (working) pic.addClass('is-working');
    else setIcon(pic, 'triangle-alert');
    const cap = print.createDiv({ cls: 'pf-print-cap pf-card-cap' });
    cap.createDiv({ cls: 'pf-cap-word' }).createEl('h2', { text: card.word });
    if (working) {
      renderMaking(cap, progressStep(card), progressLabel(card));
      return;
    }
    if (card.lastError) page.createEl('p', { cls: 'pf-card-problem', text: card.lastError });
    const retry = textButton(page, S.retry, () => this.plugin.queue.retry(this.path, card.id, card.word), true);
    retry.addClass('pf-cta');
  }

  private renderReady(page: HTMLElement, card: Card) {
    const url = this.plugin.store.resourceUrl(this.path, card.media.image);
    const print = page.createDiv({ cls: 'pf-print pf-card-print' });
    const pic = print.createDiv({ cls: 'pf-print-pic' });
    if (url) {
      const img = pic.createEl('img', { attr: { src: url, alt: '' } });
      if (this.shownImage !== undefined && this.shownImage !== card.media.image) img.addClass('pf-develop');
      if (this.busy) pic.addClass('is-working');
    } else {
      pic.addClass('pf-blank');
      setIcon(pic, 'image-off');
    }
    this.shownImage = card.media.image;
    if (this.busy) {
      pic.createDiv({ cls: 'pf-pic-status', text: this.busy === 'image' ? S.drawing : S.remaking });
    } else {
      const tools = pic.createDiv({ cls: 'pf-pic-tools' });
      this.picTool(tools, 'refresh-cw', S.otherImage, () =>
        void this.run('image', () => regenerateImage(this.plugin.deps, this.path, card.id, this.prompt.trim() || null)));
      this.picTool(tools, 'pencil', S.ownImage, () => {
        this.promptOpen = !this.promptOpen;
        void this.redraw();
      }, this.promptOpen);
    }
    renderCaption(print.createDiv({ cls: 'pf-print-cap pf-card-cap' }), card, (path) => this.plugin.playMedia(this.path, path));
    if (this.promptOpen && !this.busy) this.renderPrompt(page, card);
    const details = page.createDiv({ cls: 'pf-details' });
    renderDetails(details, card, (path) => this.plugin.playMedia(this.path, path));
    details.createEl('small', { cls: 'pf-next-show', text: S.nextShow(relativeDue(card.schedule.due, new Date())) });
  }

  private picTool(parent: HTMLElement, icon: string, label: string, onClick: () => void, on = false) {
    const button = parent.createEl('button', { cls: on ? 'pf-pic-tool is-on' : 'pf-pic-tool' });
    setIcon(button.createSpan(), icon);
    button.createSpan({ text: label });
    button.addEventListener('click', onClick);
  }

  private renderPrompt(page: HTMLElement, card: Card) {
    const box = page.createDiv({ cls: 'pf-composer pf-card-prompt' });
    const input = box.createEl('input', { type: 'text', cls: 'pf-composer-input', attr: { placeholder: S.ownImageHint, 'aria-label': S.ownImage } });
    input.value = this.prompt;
    input.addEventListener('input', () => { this.prompt = input.value; });
    const draw = () => {
      if (!this.prompt.trim()) {
        input.focus();
        return;
      }
      this.promptOpen = false;
      void this.run('image', () => regenerateImage(this.plugin.deps, this.path, card.id, this.prompt.trim()));
    };
    input.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' || event.isComposing) return;
      event.preventDefault();
      event.stopPropagation();
      draw();
    });
    textButton(box, S.draw, draw, true);
    window.setTimeout(() => input.focus(), 0);
  }

  private async run(kind: 'image' | 'all', work: () => Promise<unknown>) {
    if (this.busy) return;
    this.busy = kind;
    await this.redraw();
    try {
      await work();
      this.prompt = '';
    } catch (error) {
      new Notice(errorText(error));
    }
    this.busy = null;
    await this.redraw();
  }

  private renderDelete(page: HTMLElement, card: Card) {
    const box = page.createDiv({ cls: 'pf-note pf-card-delete' });
    box.createSpan({ text: S.confirmDelete });
    const actions = box.createDiv({ cls: 'pf-actions' });
    textButton(actions, S.delete, async () => {
      try {
        await this.plugin.store.deleteCard(this.path, card.id);
        this.popup.back();
      } catch (error) {
        new Notice(errorText(error));
      }
    }).addClass('mod-warning');
    textButton(actions, S.cancel, () => {
      this.confirmingDelete = false;
      void this.redraw();
    });
    box.scrollIntoView({ block: 'nearest' });
  }
}
