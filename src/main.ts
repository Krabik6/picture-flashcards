import { MarkdownView, normalizePath, Notice, Plugin, type TFile, type WorkspaceLeaf } from 'obsidian';
import type { CreationDeps } from './core/cardCreation';
import { CreationQueue } from './core/creationQueue';
import { createDeckText } from './core/deckFormat';
import { createScheduler, selectDueCards } from './core/scheduler';
import { AddModal } from './obsidian/addModal';
import { ObsidianDeckStore } from './obsidian/deckStore';
import { DeckView, VIEW_TYPE_DECK } from './obsidian/deckView';
import { obsidianPost } from './obsidian/http';
import { ReviewView, VIEW_TYPE_REVIEW, type ReviewItem } from './obsidian/reviewView';
import { DEFAULT_SETTINGS, resolveProvider, type PluginSettings } from './obsidian/settings';
import { FlashcardsSettingTab } from './obsidian/settingsTab';
import { S } from './ui/strings';

const DECK_MARKER = 'picture-flashcards';

export default class PictureFlashcardsPlugin extends Plugin {
  settings: PluginSettings = DEFAULT_SETTINGS;
  store!: ObsidianDeckStore;
  deps!: CreationDeps;
  queue!: CreationQueue;
  private knownDecks = new Set<string>();
  private textModePath: string | null = null;
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

    this.registerView(VIEW_TYPE_DECK, (leaf) => new DeckView(leaf, this));
    this.registerView(VIEW_TYPE_REVIEW, (leaf) => new ReviewView(leaf, this));
    this.addRibbonIcon('images', S.review, () => void this.openReview());
    this.addCommand({ id: 'add-card', name: S.addCard, callback: () => this.openAdd() });
    this.addCommand({ id: 'start-review', name: S.review, callback: () => void this.openReview() });
    this.addSettingTab(new FlashcardsSettingTab(this));

    this.registerEvent(this.app.workspace.on('file-open', (file) => this.onFileOpen(file)));
    this.registerEvent(this.app.workspace.on('layout-change', () => this.redirectDeckNotes()));
    this.app.workspace.onLayoutReady(() => this.redirectDeckNotes());
  }

  onunload() {
    this.stopMedia();
  }

  async saveSettings() {
    await this.saveData(this.settings);
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

  openAdd(deckPath?: string) {
    new AddModal(this, deckPath).open();
  }

  private async revealLeafOf(type: string): Promise<WorkspaceLeaf> {
    const { workspace } = this.app;
    const existing = workspace.getLeavesOfType(type)[0];
    const leaf = existing ?? workspace.getLeaf('tab');
    if (!existing) await leaf.setViewState({ type, active: true });
    await workspace.revealLeaf(leaf);
    workspace.setActiveLeaf(leaf, { focus: true });
    return leaf;
  }

  async openReview(deckPath?: string) {
    const leaf = await this.revealLeafOf(VIEW_TYPE_REVIEW);
    const view = leaf.view;
    if (view instanceof ReviewView) {
      if (deckPath) await view.start(deckPath);
      else await view.renderStart();
    }
  }

  async openDeck(path: string) {
    const leaf = this.app.workspace.getLeaf(false);
    await leaf.setViewState({ type: VIEW_TYPE_DECK, state: { file: path }, active: true });
  }

  async showAsText(leaf: WorkspaceLeaf, path: string) {
    this.textModePath = path;
    await leaf.setViewState({ type: 'markdown', state: { file: path, mode: 'source' }, active: true });
    if (leaf.view instanceof MarkdownView) this.addDeckAction(leaf.view, path);
  }

  private addDeckAction(view: MarkdownView, path: string) {
    const action = view.addAction('images', S.openAsDeck, () => {
      this.textModePath = null;
      action.remove();
      void view.leaf.setViewState({ type: VIEW_TYPE_DECK, state: { file: path }, active: true });
    });
  }

  private onFileOpen(file: TFile | null) {
    if (this.textModePath && file?.path !== this.textModePath) this.textModePath = null;
    this.redirectDeckNotes();
  }

  /** A deck note opens as the plugin's window. Other notes are not touched. */
  private redirectDeckNotes() {
    this.app.workspace.iterateAllLeaves((leaf) => {
      const { view } = leaf;
      if (!(view instanceof MarkdownView) || !view.file) return;
      if (view.file.path === this.textModePath || !this.isDeckFile(view.file)) return;
      void leaf.setViewState({ type: VIEW_TYPE_DECK, state: { file: view.file.path }, active: leaf === this.app.workspace.getMostRecentLeaf() });
    });
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
