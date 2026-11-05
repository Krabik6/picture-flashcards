import { Modal } from 'obsidian';
import type PictureFlashcardsPlugin from '../main';
import { ScreenStack } from '../ui/screenStack';
import { S } from '../ui/strings';
import { iconButton } from './cardBack';
import { CardScreen } from './screens/cardScreen';
import { DeckScreen, DeckSettingsScreen, NewDeckScreen } from './screens/deckScreens';
import { HomeScreen } from './screens/homeScreen';
import { ReviewScreen } from './screens/reviewScreen';

export type Screen =
  | { name: 'home' }
  | { name: 'deck'; path: string }
  | { name: 'card'; path: string; id: string }
  | { name: 'deckSettings'; path: string }
  | { name: 'newDeck' }
  | { name: 'review'; deckPath: string | null };

export interface ScreenView {
  render(body: HTMLElement): void | Promise<void>;
  onKey?(event: KeyboardEvent): boolean;
  dispose?(): void;
}

/** The plugin's only window. Everything happens inside it, screen by screen. */
export class FlashcardsPopup extends Modal {
  /** Words added while this popup is open, so their progress stays visible on every screen. */
  readonly added = new Set<string>();
  private stack: ScreenStack<Screen>;
  private view: ScreenView | null = null;
  private backEl!: HTMLElement;
  private titleTextEl!: HTMLElement;
  private actionsEl!: HTMLElement;
  private bodyEl!: HTMLElement;
  private renderToken = 0;
  private onDocumentKey = (event: KeyboardEvent) => this.handleKey(event);

  constructor(readonly plugin: PictureFlashcardsPlugin, first: Screen) {
    super(plugin.app);
    this.stack = new ScreenStack(first);
    this.modalEl.addClass('pf-popup');
  }

  onOpen(): void {
    const bar = this.contentEl.createDiv({ cls: 'pf-bar' });
    this.backEl = iconButton(bar, 'chevron-left', S.back, () => this.back());
    this.titleTextEl = bar.createDiv({ cls: 'pf-bar-title' });
    this.actionsEl = bar.createDiv({ cls: 'pf-bar-actions' });
    this.bodyEl = this.contentEl.createDiv({ cls: 'pf-body' });
    document.addEventListener('keydown', this.onDocumentKey);
    void this.showCurrent();
  }

  onClose(): void {
    document.removeEventListener('keydown', this.onDocumentKey);
    this.view?.dispose?.();
    this.view = null;
    this.plugin.stopMedia();
    this.plugin.popupClosed(this);
    this.contentEl.empty();
  }

  /** Esc steps back through screens, the cross closes the popup. */
  close(): void {
    const event = window.event;
    if (event instanceof KeyboardEvent && event.key === 'Escape' && this.stack.canGoBack()) {
      this.back();
      return;
    }
    super.close();
  }

  go(screen: Screen): void {
    this.stack.push(screen);
    void this.showCurrent();
  }

  replace(screen: Screen): void {
    this.stack.replace(screen);
    void this.showCurrent();
  }

  back(): void {
    if (this.stack.back()) void this.showCurrent();
    else super.close();
  }

  setBarTitle(text: string): void {
    this.titleTextEl.setText(text);
  }

  addAction(icon: string, label: string, onClick: () => void): HTMLElement {
    return iconButton(this.actionsEl, icon, label, onClick);
  }

  clearActions(): void {
    this.actionsEl.empty();
  }

  setFixedBody(fixed: boolean): void {
    this.bodyEl.toggleClass('is-fixed', fixed);
  }

  private createView(screen: Screen): ScreenView {
    switch (screen.name) {
      case 'home': return new HomeScreen(this);
      case 'deck': return new DeckScreen(this, screen.path);
      case 'card': return new CardScreen(this, screen.path, screen.id);
      case 'deckSettings': return new DeckSettingsScreen(this, screen.path);
      case 'newDeck': return new NewDeckScreen(this);
      case 'review': return new ReviewScreen(this, screen.deckPath);
    }
  }

  private async showCurrent() {
    const token = ++this.renderToken;
    this.view?.dispose?.();
    this.plugin.stopMedia();
    this.bodyEl.empty();
    this.actionsEl.empty();
    this.setFixedBody(false);
    this.backEl.toggleClass('pf-invisible', !this.stack.canGoBack());
    const view = this.createView(this.stack.current());
    this.view = view;
    await view.render(this.bodyEl);
    if (token !== this.renderToken) view.dispose?.();
  }

  private handleKey(event: KeyboardEvent) {
    if (event.metaKey || event.ctrlKey || event.altKey || !this.view?.onKey) return;
    const target = event.target as HTMLElement | null;
    if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
    if (this.view.onKey(event)) {
      event.preventDefault();
      event.stopPropagation();
    }
  }
}

