import { Notice } from 'obsidian';
import { S } from '../../ui/strings';
import { textButton } from '../cardBack';
import type { FlashcardsPopup } from '../popup';
import { SECRET_IDS, type Backend } from '../settings';

const BACKENDS: { id: Backend; label: string }[] = [
  { id: 'gemini', label: 'Gemini' },
  { id: 'vertex', label: 'Vertex' },
];

export function hasKey(popup: FlashcardsPopup): boolean {
  const { plugin } = popup;
  return !!plugin.app.secretStorage.getSecret(SECRET_IDS[plugin.settings.backend]);
}

/** The first thing a new user needs, right where it is needed: no trip to the settings. */
export function renderKeyBanner(parent: HTMLElement, popup: FlashcardsPopup, onSaved: () => void): void {
  if (hasKey(popup)) return;
  const { plugin } = popup;
  const box = parent.createDiv({ cls: 'pf-key' });
  box.createDiv({ cls: 'pf-key-title', text: S.keyTitle });
  const row = box.createDiv({ cls: 'pf-key-row' });
  const segment = row.createDiv({ cls: 'pf-segment' });
  const input = row.createEl('input', { type: 'password', cls: 'pf-key-input', attr: { placeholder: S.keyPlaceholder, autocomplete: 'off', 'aria-label': S.keyPlaceholder } });
  const hint = box.createDiv({ cls: 'pf-key-hint' });

  const drawHint = () => {
    hint.empty();
    if (plugin.settings.backend === 'gemini') {
      hint.createEl('a', { text: S.keyWhereGemini, href: 'https://aistudio.google.com/apikey' });
    } else {
      hint.setText(S.keyHintVertex);
    }
  };
  const drawSegment = () => {
    segment.empty();
    for (const { id, label } of BACKENDS) {
      const button = segment.createEl('button', { text: label, cls: id === plugin.settings.backend ? 'is-on' : '' });
      button.addEventListener('click', async () => {
        plugin.settings.backend = id;
        await plugin.saveSettings();
        if (hasKey(popup)) {
          box.remove();
          onSaved();
          return;
        }
        drawSegment();
        drawHint();
        input.focus();
      });
    }
  };
  const save = () => {
    const key = input.value.trim();
    if (!key) {
      input.focus();
      return;
    }
    plugin.app.secretStorage.setSecret(SECRET_IDS[plugin.settings.backend], key);
    new Notice(S.keySaved);
    box.remove();
    onSaved();
  };
  input.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    event.stopPropagation();
    save();
  });
  textButton(row, S.save, save, true);
  drawSegment();
  drawHint();
}
