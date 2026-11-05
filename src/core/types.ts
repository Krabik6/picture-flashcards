export type CardStatus = 'draft' | 'ready';

/** Paths are relative to the deck folder, so renaming the folder keeps them valid. */
export interface CardMedia {
  image: string | null;
  wordAudio: string | null;
  exampleAudio: string | null;
}

export interface ScheduleState {
  due: string;
  fsrs: Record<string, unknown>;
  firstReviewedAt: string | null;
}

export interface Card {
  id: string;
  status: CardStatus;
  word: string;
  reading: string | null;
  kind: string;
  explanation: string;
  example: string;
  scene: string;
  customPrompt: string | null;
  media: CardMedia;
  schedule: ScheduleState;
  lastError: string | null;
  createdAt: string;
}

export interface DeckSettings {
  language: string;
  imageStyle: string;
  newCardsPerDay: number;
}

export interface ParsedDeck {
  settings: DeckSettings;
  cards: Card[];
  brokenBlocks: number;
}
