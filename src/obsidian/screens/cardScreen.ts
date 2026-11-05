import { Notice } from 'obsidian';
import { regenerateAll, regenerateImage } from '../../core/cardCreation';
import type { Card } from '../../core/types';
import { progressLabel } from '../../ui/addFlow';
import { relativeDue } from '../../ui/deckOverview';
import { errorText, S } from '../../ui/strings';
import { renderCardBack, textButton } from '../cardBack';
import type { FlashcardsPopup, ScreenView } from '../popup';

export class CardScreen implements ScreenView {
  private plugin = this.popup.plugin;
  private bodyEl!: HTMLElement;
  private prompt = '';
  private busy: 'image' | 'all' | null = null;
  private confirmingDelete = false;
  private offQueue: (() => void) | null = null;

  constructor(private popup: FlashcardsPopup, private path: string, private id: string) {}

  async render(body: HTMLElement) {
    this.bodyEl = body;
    this.offQueue = this.plugin.queue.subscribe(() => void this.redraw());
    await this.redraw();
  }

  dispose() {
    this.offQueue?.();
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
    this.popup.setBarTitle(this.plugin.app.vault.getFileByPath(this.path)?.basename ?? S.deck);
    const scroll = this.bodyEl.scrollTop;
    this.bodyEl.empty();
    if (card.status === 'draft') this.renderDraft(card);
    else this.renderReady(card);
    this.renderDelete(card);
    this.bodyEl.scrollTop = scroll;
  }

  private renderDraft(card: Card) {
    const body = this.bodyEl;
    body.createDiv({ cls: 'pf-tile-empty pf-card-empty', text: S.noImage });
    const center = body.createDiv({ cls: 'pf-card-face' });
    center.createEl('h2', { text: card.word });
    if (this.isWorking()) {
      const row = center.createDiv({ cls: 'pf-addrow-status' });
      row.createSpan({ cls: 'pf-spinner' });
      row.createSpan({ text: progressLabel(card) });
      return;
    }
    if (card.lastError) center.createEl('p', { cls: 'pf-error', text: card.lastError });
    textButton(body, S.retry, () => this.plugin.queue.retry(this.path, card.id, card.word), true).addClass('pf-wide');
  }

  private renderReady(card: Card) {
    const body = this.bodyEl;
    const url = this.plugin.store.resourceUrl(this.path, card.media.image);
    if (url) body.createEl('img', { cls: 'pf-card-pic', attr: { src: url, alt: '' } });
    else body.createDiv({ cls: 'pf-tile-empty pf-card-empty', text: S.missingFile });
    const face = body.createDiv({ cls: 'pf-card-face' });
    renderCardBack(face, card, (path) => this.plugin.playMedia(this.path, path));
    face.createEl('small', { cls: 'pf-muted', text: S.nextShow(relativeDue(card.schedule.due, new Date())) });

    const input = body.createEl('input', { type: 'text', cls: 'pf-card-prompt', attr: { placeholder: S.ownPrompt, 'aria-label': S.ownPrompt } });
    input.value = this.prompt;
    input.addEventListener('input', () => { this.prompt = input.value; });
    const tools = body.createDiv({ cls: 'pf-actions pf-card-tools' });
    const prompt = () => this.prompt.trim() || null;
    const image = textButton(tools, this.busy === 'image' ? S.drawing : S.otherImage, () =>
      void this.run('image', () => regenerateImage(this.plugin.deps, this.path, card.id, prompt())));
    const all = textButton(tools, this.busy === 'all' ? S.remaking : S.remakeAll, () =>
      void this.run('all', () => regenerateAll(this.plugin.deps, this.path, card.id, prompt())));
    image.disabled = all.disabled = this.busy !== null;
  }

  private async run(kind: 'image' | 'all', work: () => Promise<unknown>) {
    this.busy = kind;
    await this.redraw();
    try {
      await work();
    } catch (error) {
      new Notice(errorText(error));
    }
    this.busy = null;
    await this.redraw();
  }

  private renderDelete(card: Card) {
    const box = this.bodyEl.createDiv({ cls: 'pf-card-delete' });
    if (!this.confirmingDelete) {
      const link = box.createEl('button', { cls: 'pf-link-danger', text: S.delete });
      link.addEventListener('click', () => {
        this.confirmingDelete = true;
        void this.redraw();
      });
      return;
    }
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
  }
}
