import { ItemView, type TAbstractFile, type ViewStateResult, type WorkspaceLeaf } from 'obsidian';
import type { Card } from '../core/types';
import type PictureFlashcardsPlugin from '../main';
import { buildDeckOverview, relativeDue } from '../ui/deckOverview';
import { countCards, S } from '../ui/strings';
import { iconButton, textButton } from './cardBack';
import { CardModal } from './cardModal';
import { DeckSettingsModal } from './deckSettingsModal';

export const VIEW_TYPE_DECK = 'picture-flashcards-deck';

export class DeckView extends ItemView {
  private path: string | null = null;
  private timer: number | null = null;

  constructor(leaf: WorkspaceLeaf, private plugin: PictureFlashcardsPlugin) {
    super(leaf);
    this.navigation = true;
  }

  getViewType() {
    return VIEW_TYPE_DECK;
  }
  getIcon() {
    return 'images';
  }
  getDisplayText() {
    return this.path ? this.app.vault.getFileByPath(this.path)?.basename ?? S.deck : S.deck;
  }

  getState() {
    return { file: this.path };
  }

  async setState(state: { file?: string }, result: ViewStateResult) {
    this.path = state.file ?? null;
    await super.setState(state, result);
    this.updateTitle();
    await this.render();
  }

  private updateTitle() {
    // Not in the public typings, but it is the only way to refresh the tab title.
    (this.leaf as unknown as { updateHeader?: () => void }).updateHeader?.();
    this.containerEl.querySelector('.view-header-title')?.setText(this.getDisplayText());
  }

  async onOpen() {
    const changed = (file: TAbstractFile) => {
      if (file.path === this.path) this.schedule();
    };
    this.registerEvent(this.app.vault.on('modify', changed));
    this.registerEvent(this.app.vault.on('rename', (file, oldPath) => {
      if (oldPath === this.path) {
        this.path = file.path;
        this.updateTitle();
        this.schedule();
      }
    }));
    this.registerEvent(this.app.vault.on('delete', (file) => {
      if (file.path === this.path) this.leaf.detach();
    }));
  }

  private schedule() {
    if (this.timer !== null) return;
    this.timer = window.setTimeout(() => {
      this.timer = null;
      void this.render();
    }, 120);
  }

  private async render() {
    const path = this.path;
    if (!path || !this.app.vault.getFileByPath(path)) return;
    const deck = await this.plugin.store.readDeck(path);
    const missing = new Set(deck.cards.filter((c) => c.status === 'ready' && !this.plugin.store.resourceUrl(path, c.media.image)).map((c) => c.id));
    const now = new Date();
    const overview = buildDeckOverview(deck, missing, now);
    const root = this.contentEl;
    const scroll = root.scrollTop;
    root.empty();
    root.addClass('pf-root');
    const page = root.createDiv({ cls: 'pf-page' });
    const head = page.createDiv({ cls: 'pf-head' });
    const titles = head.createDiv({ cls: 'pf-titles' });
    titles.createEl('h1', { text: this.getDisplayText() });
    titles.createEl('p', { text: `${countCards(deck.cards.length)}, ${overview.dueToday ? `${overview.dueToday} на сегодня` : 'на сегодня всё'}` });
    const actions = head.createDiv({ cls: 'pf-actions' });
    const review = textButton(actions, S.reviewVerb, () => void this.plugin.openReview(path), true);
    review.disabled = overview.dueToday === 0;
    textButton(actions, S.add, () => this.plugin.openAdd(path));
    iconButton(actions, 'settings', S.deckSettings, () => new DeckSettingsModal(this.plugin, path, deck.settings).open());
    iconButton(actions, 'file-text', S.showAsText, () => void this.plugin.showAsText(this.leaf, path));

    if (overview.brokenBlocks) page.createDiv({ cls: 'pf-warning', text: S.brokenBlocks(overview.brokenBlocks) });
    if (overview.needsAttention.length) page.createDiv({ cls: 'pf-warning', text: S.needsAttention(overview.needsAttention.length) });
    if (overview.drafts.length) page.createDiv({ cls: 'pf-warning', text: S.draftsWaiting(overview.drafts.length) });

    if (!deck.cards.length) page.createEl('p', { cls: 'pf-muted', text: `В колоде пока пусто. Нажмите «${S.add}».` });
    const grid = page.createDiv({ cls: 'pf-grid' });
    for (const card of [...overview.drafts, ...overview.needsAttention, ...overview.ready]) this.renderTile(grid, path, card, now);
    root.scrollTop = scroll;
  }

  private renderTile(grid: HTMLElement, path: string, card: Card, now: Date) {
    const tile = grid.createEl('button', { cls: 'pf-tile' });
    tile.addEventListener('click', () => new CardModal(this.plugin, path, card.id).open());
    const url = this.plugin.store.resourceUrl(path, card.media.image);
    if (url) tile.createEl('img', { attr: { src: url, alt: '' } });
    else tile.createDiv({ cls: 'pf-draft-picture', text: card.status === 'draft' ? S.noImage : S.missingFile });
    tile.createEl('strong', { text: card.word });
    if (card.status === 'draft') tile.createEl('small', { cls: 'pf-error', text: S.draft });
    else {
      const when = relativeDue(card.schedule.due, now);
      tile.createEl('small', { text: when, cls: when === 'сегодня' ? 'pf-due' : '' });
    }
  }
}
