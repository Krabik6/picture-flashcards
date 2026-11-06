import { setIcon } from 'obsidian';
import type { Card } from '../core/types';
import { S } from '../ui/strings';

export function iconButton(parent: HTMLElement, icon: string, label: string, onClick: (event: MouseEvent) => void): HTMLButtonElement {
  const button = parent.createEl('button', { cls: 'clickable-icon pf-icon-button', attr: { 'aria-label': label } });
  setIcon(button, icon);
  button.addEventListener('click', (event) => {
    event.stopPropagation();
    onClick(event);
  });
  return button;
}

export function textButton(parent: HTMLElement, text: string, onClick: () => void, cta = false): HTMLButtonElement {
  const button = parent.createEl('button', { text, cls: cta ? 'mod-cta' : '' });
  button.addEventListener('click', onClick);
  return button;
}

/** A keyboard hint. Hidden on phones by the stylesheet. */
export function keyHint(parent: HTMLElement, key: string): HTMLElement {
  return parent.createEl('kbd', { cls: 'pf-kbd', text: key });
}

/** The word as it is printed on the card itself. */
export function renderCaption(parent: HTMLElement, card: Card, play: (relativePath: string | null) => void): void {
  const word = parent.createDiv({ cls: 'pf-cap-word' });
  word.createEl('h2', { text: card.word, cls: card.word.length > 22 ? 'is-long' : '' });
  iconButton(word, 'volume-2', S.listen, () => play(card.media.wordAudio));
  if (!card.reading && !card.kind) return;
  const line = parent.createDiv({ cls: 'pf-cap-line' });
  if (card.reading) line.createSpan({ cls: 'pf-cap-reading', text: card.reading });
  if (card.kind) line.createEl('em', { text: card.kind });
}

/** The explanation and the example, under the card. */
export function renderDetails(parent: HTMLElement, card: Card, play: (relativePath: string | null) => void): void {
  parent.createEl('p', { cls: 'pf-explanation', text: card.explanation });
  const example = parent.createDiv({ cls: 'pf-example' });
  example.createSpan({ text: card.example });
  iconButton(example, 'volume-2', S.listenExample, () => play(card.media.exampleAudio));
}

/** A card that is still being made: its three steps and what is happening now. */
export function renderMaking(parent: HTMLElement, step: number, label: string): void {
  parent.addClass('pf-making');
  const steps = parent.createDiv({ cls: 'pf-steps' });
  for (let i = 0; i < 3; i++) steps.createSpan({ cls: i < step ? 'is-done' : i === step ? 'is-now' : '' });
  parent.createDiv({ cls: 'pf-making-label', text: label });
}
