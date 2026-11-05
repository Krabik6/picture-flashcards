import type PictureFlashcardsPlugin from '../main';
import type { Card } from '../core/types';
import { S } from '../ui/strings';
import { textButton } from './cardBack';

/** In reading view the deck note shows small cards, not raw JSON. */
export function registerNotePreview(plugin: PictureFlashcardsPlugin): void {
  plugin.registerMarkdownCodeBlockProcessor('picture-flashcards-deck', (_source, el, ctx) => {
    textButton(el, S.openDeck, () => plugin.openPopup({ name: 'deck', path: ctx.sourcePath }), true);
  });
  plugin.registerMarkdownCodeBlockProcessor('picture-flashcard', (source, el, ctx) => {
    let card: Card;
    try {
      card = JSON.parse(source) as Card;
    } catch {
      el.createEl('p', { cls: 'pf-error', text: 'Блок карточки повреждён' });
      return;
    }
    const box = el.createDiv({ cls: 'pf-note-card' });
    const url = plugin.store.resourceUrl(ctx.sourcePath, card.media?.image ?? null);
    if (url) box.createEl('img', { attr: { src: url, alt: '' } });
    const text = box.createDiv();
    if (card.explanation) text.createEl('p', { text: card.explanation });
    if (card.example) text.createEl('p', { cls: 'pf-muted', text: card.example });
    if (card.status === 'draft') text.createEl('p', { cls: 'pf-error', text: S.draft });
  });
}
