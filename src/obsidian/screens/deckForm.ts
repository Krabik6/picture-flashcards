import { S } from '../../ui/strings';

const LANGUAGES = ['English', 'Español', 'Deutsch', 'Français', 'Italiano', '日本語', '中文', '한국어', 'Русский'];

const STYLES: { label: string; prompt: string }[] = [
  { label: 'Чистая иллюстрация', prompt: 'Clean modern illustration, simple shapes, calm harmonious colors' },
  { label: 'Акварель', prompt: 'Soft watercolor painting, gentle washes of color, visible paper texture' },
  { label: 'Карандаш', prompt: 'Hand-drawn pencil sketch with light color accents on white paper' },
  { label: 'Аниме', prompt: 'Anime style illustration, clean line art, soft cel shading, expressive characters' },
  { label: 'Объёмные фигурки', prompt: 'Soft 3D render, rounded clay-like shapes, gentle studio lighting' },
];

export function field(parent: HTMLElement, label: string, hint?: string): HTMLElement {
  const box = parent.createDiv({ cls: 'pf-field' });
  box.createEl('label', { cls: 'pf-field-label', text: label });
  if (hint) box.createDiv({ cls: 'pf-field-hint', text: hint });
  return box;
}

/** Choosing is faster than typing: common languages are one click, any other can be typed. */
export function languageField(parent: HTMLElement, value: string, onChange: (value: string) => void): HTMLInputElement {
  const box = field(parent, S.language, S.languageHint);
  const input = box.createEl('input', { type: 'text', cls: 'pf-input', attr: { placeholder: S.languagePlaceholder } });
  input.value = value;
  const chips = box.createDiv({ cls: 'pf-chips' });
  const buttons = LANGUAGES.map((language) => {
    const chip = chips.createEl('button', { cls: 'pf-chip', text: language });
    chip.addEventListener('click', () => {
      input.value = language;
      update();
    });
    return { chip, language };
  });
  const update = () => {
    const current = input.value.trim();
    for (const { chip, language } of buttons) chip.toggleClass('is-on', language === current);
    onChange(current);
  };
  input.addEventListener('input', update);
  update();
  return input;
}

/** Ready-made styles carry a good prompt, so nobody has to write one to get a nice picture. */
export function styleField(parent: HTMLElement, value: string, onChange: (value: string) => void): void {
  const box = field(parent, S.imageStyle);
  const chips = box.createDiv({ cls: 'pf-chips' });
  const area = box.createEl('textarea', { cls: 'pf-input pf-textarea', attr: { placeholder: S.ownStylePlaceholder, rows: '3' } });
  let own = !STYLES.some((s) => s.prompt === value);
  let current = value;
  const draw = () => {
    chips.empty();
    for (const style of STYLES) {
      const chip = chips.createEl('button', { cls: 'pf-chip', text: style.label });
      chip.toggleClass('is-on', !own && current === style.prompt);
      chip.addEventListener('click', () => {
        own = false;
        current = style.prompt;
        onChange(current);
        draw();
      });
    }
    const custom = chips.createEl('button', { cls: 'pf-chip', text: S.ownStyle });
    custom.toggleClass('is-on', own);
    custom.addEventListener('click', () => {
      own = true;
      area.value = current;
      draw();
      area.focus();
    });
    area.toggleClass('pf-invisible', !own);
  };
  area.value = current;
  area.addEventListener('input', () => {
    current = area.value;
    onChange(current);
  });
  draw();
}
