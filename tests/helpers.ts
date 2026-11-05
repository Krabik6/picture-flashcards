import type { Card, DeckSettings } from '../src/core/types';

export const settings: DeckSettings = { language: 'ja', imageStyle: 'flat', newCardsPerDay: 20 };

export const card = (over: Partial<Card> = {}): Card => ({
  id: 'a1', status: 'ready', word: '猫', reading: 'ねこ', kind: 'noun',
  explanation: 'x', example: 'y', scene: 'z', customPrompt: null,
  media: { image: '_media/a1-image-1.png', wordAudio: null, exampleAudio: null },
  schedule: { due: '2026-11-05T00:00:00.000Z', fsrs: {}, firstReviewedAt: null },
  lastError: null, createdAt: '2026-11-05T00:00:00.000Z', ...over,
});
