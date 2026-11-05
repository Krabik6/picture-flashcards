import type { Card, DeckSettings, ParsedDeck } from './types';

const DECK_FENCE = '```picture-flashcards-deck';
const CARD_FENCE = '```picture-flashcard';
const FENCE_END = '```';
const FALLBACK_SETTINGS: DeckSettings = { language: '', imageStyle: '', newCardsPerDay: 20 };

interface Block {
  start: number; // line of the opening fence
  end: number; // line of the closing fence, -1 when the block never closes
  json: string;
}

function findBlocks(lines: string[], fence: string): Block[] {
  const blocks: Block[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trimEnd() !== fence) continue;
    let end = -1;
    for (let j = i + 1; j < lines.length; j++) {
      if (lines[j].trimEnd() === FENCE_END) {
        end = j;
        break;
      }
    }
    blocks.push({ start: i, end, json: end === -1 ? '' : lines.slice(i + 1, end).join('\n') });
    if (end === -1) break;
    i = end;
  }
  return blocks;
}

function readCard(block: Block): Card | null {
  if (block.end === -1) return null;
  try {
    const value = JSON.parse(block.json);
    if (typeof value?.id !== 'string' || typeof value?.word !== 'string') return null;
    return value as Card;
  } catch {
    return null;
  }
}

const heading = (card: Card) => `## ${card.word.split('\n')[0]}`;
const cardLines = (card: Card) => [heading(card), CARD_FENCE, JSON.stringify(card, null, 2), FENCE_END];

/** First line of the block including its heading, when there is one right above the fence. */
const blockTop = (lines: string[], block: Block) =>
  block.start > 0 && lines[block.start - 1].startsWith('## ') ? block.start - 1 : block.start;

export function createDeckText(settings: DeckSettings): string {
  return `---\npicture-flashcards: deck\n---\n\n${DECK_FENCE}\n${JSON.stringify(settings, null, 2)}\n${FENCE_END}\n`;
}

export function parseDeck(text: string): ParsedDeck {
  const lines = text.split('\n');
  let settings = FALLBACK_SETTINGS;
  const deckBlock = findBlocks(lines, DECK_FENCE)[0];
  if (deckBlock && deckBlock.end !== -1) {
    try {
      settings = { ...FALLBACK_SETTINGS, ...JSON.parse(deckBlock.json) };
    } catch {
      // keeps the fallback, the note stays untouched until someone saves settings
    }
  }
  const cards: Card[] = [];
  let brokenBlocks = 0;
  for (const block of findBlocks(lines, CARD_FENCE)) {
    const card = readCard(block);
    if (card) cards.push(card);
    else brokenBlocks++;
  }
  return { settings, cards, brokenBlocks };
}

export function upsertCard(text: string, card: Card): string {
  const lines = text.split('\n');
  const existing = findBlocks(lines, CARD_FENCE).find((b) => readCard(b)?.id === card.id);
  if (existing) {
    const top = blockTop(lines, existing);
    lines.splice(top, existing.end - top + 1, ...cardLines(card));
    return lines.join('\n');
  }
  const base = text.endsWith('\n') ? text : `${text}\n`;
  return `${base}\n${cardLines(card).join('\n')}\n`;
}

export function removeCard(text: string, cardId: string): string {
  const lines = text.split('\n');
  const existing = findBlocks(lines, CARD_FENCE).find((b) => readCard(b)?.id === cardId);
  if (!existing) return text;
  let top = blockTop(lines, existing);
  if (top > 0 && lines[top - 1].trim() === '') top--;
  lines.splice(top, existing.end - top + 1);
  return lines.join('\n');
}

export function updateSettings(text: string, settings: DeckSettings): string {
  const lines = text.split('\n');
  const block = findBlocks(lines, DECK_FENCE)[0];
  const body = [DECK_FENCE, JSON.stringify(settings, null, 2), FENCE_END];
  if (block && block.end !== -1) {
    lines.splice(block.start, block.end - block.start + 1, ...body);
    return lines.join('\n');
  }
  return `${text.endsWith('\n') ? text : `${text}\n`}\n${body.join('\n')}\n`;
}

const normalize = (word: string) => word.normalize('NFC').trim().toLowerCase();

export function findDuplicate(cards: Card[], word: string): Card | null {
  const wanted = normalize(word);
  return cards.find((c) => normalize(c.word) === wanted) ?? null;
}
