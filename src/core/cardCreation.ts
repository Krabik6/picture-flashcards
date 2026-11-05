import type { AiProvider, BinaryFile } from '../ai/provider';
import { errorText } from '../ui/strings';
import type { Scheduler } from './scheduler';
import type { DeckStore, MediaKind } from './store';
import type { Card } from './types';

export interface CreationDeps {
  store: DeckStore;
  provider: AiProvider;
  scheduler: Scheduler;
  now: () => Date;
  newId: () => string;
}

const CARD_GONE = 'Карточка больше не существует.';

async function loadCard(deps: CreationDeps, deckPath: string, cardId: string) {
  const deck = await deps.store.readDeck(deckPath);
  return { card: deck.cards.find((c) => c.id === cardId) ?? null, settings: deck.settings };
}

export async function addDraft(deps: CreationDeps, deckPath: string, word: string): Promise<Card> {
  const now = deps.now();
  const card: Card = {
    id: deps.newId(), status: 'draft', word: word.trim(), reading: null, kind: '', explanation: '', example: '', scene: '',
    customPrompt: null, media: { image: null, wordAudio: null, exampleAudio: null },
    schedule: deps.scheduler.newState(now), lastError: null, createdAt: now.toISOString(),
  };
  await deps.store.saveCard(deckPath, card);
  return card;
}

/** Makes whatever the card is still missing and saves after each step, so a failure loses nothing. */
export async function fillCard(deps: CreationDeps, deckPath: string, cardId: string): Promise<Card | null> {
  const { store, provider } = deps;
  const written: string[] = [];
  const loaded = await loadCard(deps, deckPath, cardId);
  let card = loaded.card;
  if (!card) return null;
  const abandon = async () => {
    await Promise.all(written.map((path) => store.removeMedia(deckPath, path)));
    return null;
  };
  const saveMedia = async (kind: MediaKind, field: keyof Card['media'], file: BinaryFile) => {
    const path = await store.writeMedia(deckPath, cardId, kind, file);
    written.push(path);
    return store.updateCard(deckPath, cardId, (c) => ({ ...c, media: { ...c.media, [field]: path } }));
  };
  try {
    if (!card.explanation) {
      const text = await provider.generateCardText({ word: card.word, language: loaded.settings.language, customPrompt: card.customPrompt });
      card = await store.updateCard(deckPath, cardId, (c) => ({ ...c, ...text }));
      if (!card) return await abandon();
    }
    if (!card.media.image) {
      card = await saveMedia('image', 'image', await provider.generateImage({ scene: card.scene, style: loaded.settings.imageStyle }));
      if (!card) return await abandon();
    }
    if (!card.media.wordAudio) {
      card = await saveMedia('word-audio', 'wordAudio', await provider.generateSpeech({ text: card.reading ?? card.word }));
      if (!card) return await abandon();
    }
    if (!card.media.exampleAudio) {
      card = await saveMedia('example-audio', 'exampleAudio', await provider.generateSpeech({ text: card.example }));
      if (!card) return await abandon();
    }
    return await store.updateCard(deckPath, cardId, (c) => ({ ...c, status: 'ready', lastError: null }));
  } catch (error) {
    return store.updateCard(deckPath, cardId, (c) => ({ ...c, status: 'draft', lastError: errorText(error) }));
  }
}

export async function regenerateImage(deps: CreationDeps, deckPath: string, cardId: string, customPrompt: string | null): Promise<Card> {
  const { store, provider } = deps;
  const { card, settings } = await loadCard(deps, deckPath, cardId);
  if (!card) throw new Error(CARD_GONE);
  const file = await provider.generateImage({ scene: customPrompt ?? card.scene, style: settings.imageStyle });
  const path = await store.writeMedia(deckPath, cardId, 'image', file);
  const updated = await store.updateCard(deckPath, cardId, (c) => ({ ...c, customPrompt, media: { ...c.media, image: path } }));
  if (!updated) {
    await store.removeMedia(deckPath, path);
    throw new Error(CARD_GONE);
  }
  if (card.media.image) await store.removeMedia(deckPath, card.media.image);
  return updated;
}

/** All or nothing: the old card stays untouched until every new part is ready. */
export async function regenerateAll(deps: CreationDeps, deckPath: string, cardId: string, customPrompt: string | null): Promise<Card> {
  const { store, provider } = deps;
  const { card, settings } = await loadCard(deps, deckPath, cardId);
  if (!card) throw new Error(CARD_GONE);
  const written: string[] = [];
  const write = async (kind: MediaKind, file: BinaryFile) => {
    const path = await store.writeMedia(deckPath, cardId, kind, file);
    written.push(path);
    return path;
  };
  try {
    const text = await provider.generateCardText({ word: card.word, language: settings.language, customPrompt });
    const image = await write('image', await provider.generateImage({ scene: text.scene, style: settings.imageStyle }));
    const wordAudio = await write('word-audio', await provider.generateSpeech({ text: text.reading ?? card.word }));
    const exampleAudio = await write('example-audio', await provider.generateSpeech({ text: text.example }));
    const updated = await store.updateCard(deckPath, cardId, (c) => ({
      ...c, ...text, customPrompt, status: 'ready', lastError: null, media: { image, wordAudio, exampleAudio },
    }));
    if (!updated) throw new Error(CARD_GONE);
    const old = [card.media.image, card.media.wordAudio, card.media.exampleAudio].filter((p): p is string => p !== null);
    await Promise.all(old.map((path) => store.removeMedia(deckPath, path)));
    return updated;
  } catch (error) {
    await Promise.all(written.map((path) => store.removeMedia(deckPath, path)));
    throw error;
  }
}
