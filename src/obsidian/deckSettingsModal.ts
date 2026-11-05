import { Modal, Notice, Setting } from 'obsidian';
import { updateSettings } from '../core/deckFormat';
import type { DeckSettings } from '../core/types';
import type PictureFlashcardsPlugin from '../main';
import { errorText, S } from '../ui/strings';

export class DeckSettingsModal extends Modal {
  constructor(private plugin: PictureFlashcardsPlugin, private deckPath: string, private settings: DeckSettings) {
    super(plugin.app);
  }

  onOpen(): void {
    this.titleEl.setText(S.deckSettings);
    const draft = { ...this.settings };
    new Setting(this.contentEl).setName(S.language).setDesc(S.languageHint).addText((t) =>
      t.setValue(draft.language).onChange((v) => { draft.language = v.trim(); }));
    new Setting(this.contentEl).setName(S.imageStyle).addTextArea((t) =>
      t.setValue(draft.imageStyle).onChange((v) => { draft.imageStyle = v; }));
    new Setting(this.contentEl).setName(S.newPerDay).addText((t) => {
      t.inputEl.type = 'number';
      t.inputEl.min = '0';
      t.setValue(String(draft.newCardsPerDay)).onChange((v) => {
        const n = parseInt(v, 10);
        if (n >= 0) draft.newCardsPerDay = n;
      });
    });
    new Setting(this.contentEl).addButton((b) => b.setButtonText(S.save).setCta().onClick(async () => {
      try {
        const file = this.app.vault.getFileByPath(this.deckPath);
        if (file) await this.app.vault.process(file, (text) => updateSettings(text, draft));
        this.close();
      } catch (error) {
        new Notice(errorText(error));
      }
    }));
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
