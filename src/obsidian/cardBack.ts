import { setIcon } from 'obsidian';
import type { Card } from '../core/types';
import { S } from '../ui/strings';

export function iconButton(parent: HTMLElement, icon: string, label: string, onClick: () => void): HTMLButtonElement {
  const button = parent.createEl('button', { cls: 'clickable-icon pf-icon-button', attr: { 'aria-label': label } });
  setIcon(button, icon);
  button.addEventListener('click', (event) => {
    event.stopPropagation();
    onClick();
  });
  return button;
}

export function textButton(parent: HTMLElement, text: string, onClick: () => void, cta = false): HTMLButtonElement {
  const button = parent.createEl('button', { text, cls: cta ? 'mod-cta' : '' });
  button.addEventListener('click', onClick);
  return button;
}

export function renderCardBack(parent: HTMLElement, card: Card, play: (relativePath: string | null) => void): void {
  const word = parent.createDiv({ cls: 'pf-word' });
  word.createEl('h2', { text: card.word });
  iconButton(word, 'volume-2', S.listen, () => play(card.media.wordAudio));
  if (card.reading) parent.createDiv({ cls: 'pf-reading', text: card.reading });
  if (card.kind) parent.createDiv({ cls: 'pf-kind', text: card.kind });
  parent.createEl('p', { cls: 'pf-explanation', text: card.explanation });
  const example = parent.createDiv({ cls: 'pf-example' });
  example.createSpan({ text: card.example });
  iconButton(example, 'volume-2', S.listenExample, () => play(card.media.exampleAudio));
}
