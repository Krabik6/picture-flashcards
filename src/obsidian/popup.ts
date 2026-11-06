import { Modal, setIcon } from 'obsidian';
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

export interface MenuEntry {
  icon: string;
  label: string;
  danger?: boolean;
  onClick: () => void;
}

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
  private titleHintEl!: HTMLElement;
  private ambientEl!: HTMLElement;
  private ambientUrl: string | null = null;
  private actionsEl!: HTMLElement;
  private bodyEl!: HTMLElement;
  private renderToken = 0;
  private menuEl: HTMLElement | null = null;
  private onOutsideClick = (event: MouseEvent) => {
    if (!this.menuEl?.contains(event.target as Node)) this.hideMenu();
  };
  private onDocumentKey = (event: KeyboardEvent) => this.handleKey(event);

  constructor(readonly plugin: PictureFlashcardsPlugin, first: Screen) {
    super(plugin.app);
    this.stack = new ScreenStack(first);
    this.modalEl.addClass('pf-popup');
  }

  onOpen(): void {
    this.ambientEl = this.modalEl.createDiv({ cls: 'pf-ambient' });
    this.modalEl.prepend(this.ambientEl);
    const bar = this.contentEl.createDiv({ cls: 'pf-bar' });
    this.backEl = iconButton(bar, 'chevron-left', S.back, () => this.back());
    const title = bar.createDiv({ cls: 'pf-bar-title' });
    this.titleTextEl = title.createSpan();
    this.titleHintEl = title.createSpan({ cls: 'pf-bar-hint' });
    this.actionsEl = bar.createDiv({ cls: 'pf-bar-actions' });
    this.bodyEl = this.contentEl.createDiv({ cls: 'pf-body' });
    document.addEventListener('keydown', this.onDocumentKey);
    void this.showCurrent();
  }

  onClose(): void {
    document.removeEventListener('keydown', this.onDocumentKey);
    this.hideMenu();
    this.view?.dispose?.();
    this.view = null;
    this.plugin.stopMedia();
    this.plugin.popupClosed(this);
    this.contentEl.empty();
    this.ambientEl.remove();
    this.modalEl.querySelectorAll('.pf-ghost').forEach((ghost) => ghost.remove());
  }

  /** Esc steps back through screens, the cross closes the popup. */
  close(): void {
    const event = window.event;
    if (event instanceof KeyboardEvent && event.key === 'Escape') {
      if (this.menuEl) {
        this.hideMenu();
        return;
      }
      if (this.stack.canGoBack()) {
        this.back();
        return;
      }
    }
    super.close();
  }

  go(screen: Screen): void {
    this.stack.push(screen);
    void this.showCurrent('forward');
  }

  replace(screen: Screen): void {
    this.stack.replace(screen);
    void this.showCurrent('none');
  }

  back(): void {
    if (this.stack.back()) void this.showCurrent('back');
    else super.close();
  }

  setBarTitle(text: string, hint?: string): void {
    this.titleTextEl.setText(text);
    this.titleHintEl.setText(hint ?? '');
  }

  addAction(icon: string, label: string, onClick: (event: MouseEvent) => void): HTMLElement {
    return iconButton(this.actionsEl, icon, label, onClick);
  }

  /** A small menu under a button in the top bar. */
  showMenu(anchor: HTMLElement, entries: MenuEntry[]): void {
    if (this.menuEl) {
      this.hideMenu();
      return;
    }
    const menu = this.modalEl.createDiv({ cls: 'pf-menu', attr: { role: 'menu' } });
    for (const entry of entries) {
      const item = menu.createEl('button', { cls: entry.danger ? 'pf-menu-item is-danger' : 'pf-menu-item', attr: { role: 'menuitem' } });
      setIcon(item.createSpan(), entry.icon);
      item.createSpan({ text: entry.label });
      item.addEventListener('click', () => {
        this.hideMenu();
        entry.onClick();
      });
    }
    const box = anchor.getBoundingClientRect();
    const host = this.modalEl.getBoundingClientRect();
    menu.style.top = `${box.bottom - host.top + 4}px`;
    menu.style.right = `${host.right - box.right}px`;
    this.menuEl = menu;
    // The click that opened the menu is still travelling, so listening starts after it.
    window.setTimeout(() => document.addEventListener('click', this.onOutsideClick, true), 0);
  }

  private hideMenu(): void {
    document.removeEventListener('click', this.onOutsideClick, true);
    this.menuEl?.remove();
    this.menuEl = null;
  }

  /** The current picture, blurred, colours the whole popup. Null removes it. */
  setAmbient(url: string | null): void {
    if (url === this.ambientUrl) return;
    this.ambientUrl = url;
    const previous = [...this.ambientEl.children];
    for (const old of previous) {
      old.addClass('is-leaving');
      window.setTimeout(() => old.remove(), 500);
    }
    if (url) this.ambientEl.createEl('img', { attr: { src: url, alt: '' } });
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

  private async showCurrent(direction: 'forward' | 'back' | 'none' = 'none') {
    const token = ++this.renderToken;
    this.view?.dispose?.();
    this.plugin.stopMedia();
    this.bodyEl.empty();
    this.actionsEl.empty();
    this.setFixedBody(false);
    this.setAmbient(null);
    this.hideMenu();
    this.modalEl.querySelectorAll('.pf-ghost').forEach((ghost) => ghost.remove());
    this.bodyEl.removeClass('pf-enter-forward', 'pf-enter-back');
    this.backEl.toggleClass('pf-invisible', !this.stack.canGoBack());
    const view = this.createView(this.stack.current());
    this.view = view;
    await view.render(this.bodyEl);
    if (token !== this.renderToken) {
      view.dispose?.();
      return;
    }
    if (direction !== 'none') this.bodyEl.addClass(`pf-enter-${direction}`);
    this.releaseBarFocus();
  }

  /**
   * A modal focuses its first button when it opens. In the top bar that draws a ring around
   * an icon for no reason, and pressing Space on the review screen would also press that icon.
   */
  private releaseBarFocus() {
    window.setTimeout(() => {
      const active = activeDocument.activeElement;
      if (active instanceof HTMLElement && active.closest('.pf-bar')) active.blur();
    }, 0);
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

