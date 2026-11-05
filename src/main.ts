import { MarkdownView, normalizePath, Notice, Plugin, type TFile } from 'obsidian';
import type { CreationDeps } from './core/cardCreation';
import { CreationQueue } from './core/creationQueue';
import { createDeckText } from './core/deckFormat';
import { createScheduler, selectDueCards } from './core/scheduler';
import type { Card } from './core/types';
import { ObsidianDeckStore } from './obsidian/deckStore';
import { obsidianPost } from './obsidian/http';
import { registerNotePreview } from './obsidian/notePreview';
import { FlashcardsPopup, type Screen } from './obsidian/popup';
import { DEFAULT_SETTINGS, resolveProvider, type PluginSettings } from './obsidian/settings';
import { FlashcardsSettingTab } from './obsidian/settingsTab';
import { S } from './ui/strings';

const DECK_MARKER = 'picture-flashcards';

export interface ReviewItem {
  deckPath: string;
  card: Card;
}

export default class PictureFlashcardsPlugin extends Plugin {
  settings: PluginSettings = DEFAULT_SETTINGS;
  store!: ObsidianDeckStore;
  deps!: CreationDeps;
  queue!: CreationQueue;
  private popup: FlashcardsPopup | null = null;
  private knownDecks = new Set<string>();
  private skipPopupFor: string | null = null;
  private layoutSettled = false;
  private audio: HTMLAudioElement | null = null;

  async onload() {
    this.settings = { ...DEFAULT_SETTINGS, ...(await this.loadData()) };
    this.store = new ObsidianDeckStore(this.app);
    this.deps = {
      store: this.store,
      provider: resolveProvider(() => this.settings, (id) => this.app.secretStorage.getSecret(id), obsidianPost),
      scheduler: createScheduler(),
      now: () => new Date(),
      newId: () => Math.random().toString(36).slice(2, 10),
    };
    this.queue = new CreationQueue(this.deps);

    this.addRibbonIcon('images', S.appTitle, () => this.openPopup({ name: 'home' }));
    this.addCommand({ id: 'open', name: S.appTitle, callback: () => this.openPopup({ name: 'home' }) });
    this.addCommand({ id: 'start-review', name: S.review, callback: () => this.openPopup({ name: 'review', deckPath: null }) });
    this.addSettingTab(new FlashcardsSettingTab(this));
    registerNotePreview(this);

    this.registerEvent(this.app.workspace.on('file-open', (file) => this.onFileOpen(file)));
    // Tabs restored at startup should not throw a popup in the user's face.
    this.app.workspace.onLayoutReady(() => window.setTimeout(() => { this.layoutSettled = true; }, 1500));
  }

  onunload() {
    this.stopMedia();
    this.popup?.close();
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  openPopup(screen: Screen) {
    this.popup?.close();
    this.popup = new FlashcardsPopup(this, screen);
    this.popup.open();
  }

  popupClosed(popup: FlashcardsPopup) {
    if (this.popup === popup) this.popup = null;
  }

  openPluginSettings() {
    this.popup?.close();
    const { setting } = this.app as unknown as { setting: { open(): void; openTabById(id: string): void } };
    setting.open();
    setting.openTabById(this.manifest.id);
  }

  private isDeckFile(file: TFile): boolean {
    if (this.knownDecks.has(file.path)) return true;
    return this.app.metadataCache.getFileCache(file)?.frontmatter?.[DECK_MARKER] === 'deck';
  }

  listDecks(): { path: string; name: string }[] {
    return this.app.vault.getMarkdownFiles()
      .filter((file) => this.isDeckFile(file))
      .map((file) => ({ path: file.path, name: file.basename }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async createDeck(name: string, language: string, imageStyle: string): Promise<string> {
    const clean = name.replace(/[\\/:*?"<>|#^[\]]/g, ' ').trim();
    if (!clean) throw new Error('Такое название колоды не подходит');
    const folder = normalizePath(`${this.settings.decksFolder}/${clean}`);
    const path = `${folder}/${clean}.md`;
    if (this.app.vault.getFileByPath(path)) throw new Error(`Колода «${clean}» уже есть`);
    for (const part of [this.settings.decksFolder, folder]) {
      if (!this.app.vault.getFolderByPath(normalizePath(part))) await this.app.vault.createFolder(normalizePath(part));
    }
    await this.app.vault.create(path, createDeckText({ language, imageStyle, newCardsPerDay: 20 }));
    this.knownDecks.add(path);
    return path;
  }

  async dueItems(deckPath: string | null): Promise<ReviewItem[]> {
    const now = new Date();
    const paths = deckPath ? [deckPath] : this.listDecks().map((d) => d.path);
    const items: ReviewItem[] = [];
    for (const path of paths) {
      const deck = await this.store.readDeck(path);
      const present = deck.cards.filter((c) => this.store.resourceUrl(path, c.media.image));
      for (const card of selectDueCards(present, deck.settings.newCardsPerDay, now)) items.push({ deckPath: path, card });
    }
    return items;
  }

  showAsText(path: string) {
    this.popup?.close();
    this.skipPopupFor = path;
    void this.app.workspace.openLinkText(path, '', false, { state: { mode: 'source', source: true } });
    window.setTimeout(() => { this.skipPopupFor = null; }, 1000);
  }

  /** Opening a deck note shows the popup. The note itself stays readable behind it. */
  private onFileOpen(file: TFile | null) {
    if (!this.layoutSettled || !file || !this.isDeckFile(file)) return;
    if (this.skipPopupFor === file.path || this.popup) return;
    this.skipPopupFor = file.path;
    window.setTimeout(() => { this.skipPopupFor = null; }, 1000);
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (view?.file?.path === file.path && view.getMode() === 'source') {
      const state = view.leaf.getViewState();
      void view.leaf.setViewState({ ...state, state: { ...state.state, mode: 'preview' } });
    }
    this.openPopup({ name: 'deck', path: file.path });
  }

  playMedia(deckPath: string, relativePath: string | null) {
    this.stopMedia();
    const url = this.store.resourceUrl(deckPath, relativePath);
    if (!url) {
      new Notice(S.audioFailed);
      return;
    }
    this.audio = new Audio(url);
    this.audio.play().catch(() => new Notice(S.audioFailed));
  }

  stopMedia() {
    this.audio?.pause();
    this.audio = null;
  }
}
