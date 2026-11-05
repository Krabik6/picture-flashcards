import { Modal, Notice, Setting } from 'obsidian';
import { regenerateAll, regenerateImage } from '../core/cardCreation';
import type { Card } from '../core/types';
import type PictureFlashcardsPlugin from '../main';
import { progressLabel } from '../ui/addFlow';
import { relativeDue } from '../ui/deckOverview';
import { errorText, S } from '../ui/strings';
import { renderCardBack, textButton } from './cardBack';

export class CardModal extends Modal {
  private prompt = '';
  private busy: string | null = null;
  private confirmingDelete = false;
  private offQueue: (() => void) | null = null;

  constructor(private plugin: PictureFlashcardsPlugin, private deckPath: string, private cardId: string) {
    super(plugin.app);
    this.modalEl.addClass('pf-card-modal');
  }

  async onOpen(): Promise<void> {
    this.offQueue = this.plugin.queue.subscribe(() => void this.render());
    await this.render();
  }

  onClose(): void {
    this.offQueue?.();
    this.contentEl.empty();
  }

  private async run(label: string, work: () => Promise<unknown>) {
    this.busy = label;
    await this.render();
    try {
      await work();
    } catch (error) {
      new Notice(errorText(error));
    }
    this.busy = null;
    await this.render();
  }

  private isWorking() {
    const item = this.plugin.queue.items().find((x) => x.cardId === this.cardId);
    return item?.state === 'waiting' || item?.state === 'working';
  }

  private async render() {
    const deck = await this.plugin.store.readDeck(this.deckPath);
    const card = deck.cards.find((c) => c.id === this.cardId);
    const { contentEl } = this;
    if (!card) {
      this.close();
      return;
    }
    contentEl.empty();
    if (card.status === 'draft') this.renderDraft(card);
    else this.renderReady(card);
    this.renderDelete(card);
  }

  private renderDraft(card: Card) {
    const { contentEl } = this;
    contentEl.createEl('h2', { text: card.word });
    contentEl.createDiv({ cls: 'pf-draft-picture', text: S.noImage });
    if (this.isWorking()) {
      const row = contentEl.createDiv({ cls: 'pf-progress' });
      row.createSpan({ cls: 'pf-spinner' });
      row.createSpan({ text: progressLabel(card) });
      return;
    }
    if (card.lastError) contentEl.createEl('p', { cls: 'pf-error', text: card.lastError });
    textButton(contentEl, S.retry, () => this.plugin.queue.retry(this.deckPath, card.id, card.word), true);
  }

  private renderReady(card: Card) {
    const grid = this.contentEl.createDiv({ cls: 'pf-card-grid' });
    const left = grid.createDiv();
    const url = this.plugin.store.resourceUrl(this.deckPath, card.media.image);
    if (url) left.createEl('img', { cls: 'pf-card-picture', attr: { src: url, alt: '' } });
    else left.createDiv({ cls: 'pf-draft-picture', text: S.missingFile });
    new Setting(left).setClass('pf-prompt').setName(S.ownPrompt).setDesc(S.ownPromptHint).addTextArea((t) =>
      t.setValue(this.prompt).onChange((v) => { this.prompt = v; }));
    const tools = left.createDiv({ cls: 'pf-actions' });
    const prompt = () => this.prompt.trim() || null;
    const image = textButton(tools, this.busy === 'image' ? 'Рисую...' : S.otherImage, () =>
      void this.run('image', () => regenerateImage(this.plugin.deps, this.deckPath, card.id, prompt())));
    const all = textButton(tools, this.busy === 'all' ? 'Пересоздаю...' : S.remakeAll, () =>
      void this.run('all', () => regenerateAll(this.plugin.deps, this.deckPath, card.id, prompt())));
    image.disabled = all.disabled = this.busy !== null;
    const right = grid.createDiv();
    renderCardBack(right, card, (path) => this.plugin.playMedia(this.deckPath, path));
    right.createEl('p', { cls: 'pf-muted', text: `Следующий показ: ${relativeDue(card.schedule.due, new Date())}` });
  }

  private renderDelete(card: Card) {
    const box = this.contentEl.createDiv({ cls: 'pf-delete' });
    if (!this.confirmingDelete) {
      textButton(box, S.delete, () => {
        this.confirmingDelete = true;
        void this.render();
      }).addClass('mod-warning');
      return;
    }
    box.createSpan({ text: S.confirmDelete });
    textButton(box, S.delete, async () => {
      try {
        await this.plugin.store.deleteCard(this.deckPath, card.id);
        this.close();
      } catch (error) {
        new Notice(errorText(error));
      }
    }).addClass('mod-warning');
    textButton(box, S.cancel, () => {
      this.confirmingDelete = false;
      void this.render();
    });
  }
}
