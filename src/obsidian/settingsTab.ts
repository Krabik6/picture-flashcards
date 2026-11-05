import { PluginSettingTab, Setting } from 'obsidian';
import type PictureFlashcardsPlugin from '../main';
import { S } from '../ui/strings';
import { SECRET_IDS, type Backend } from './settings';

export class FlashcardsSettingTab extends PluginSettingTab {
  constructor(private plugin: PictureFlashcardsPlugin) {
    super(plugin.app, plugin);
  }

  private keySetting(name: string, backend: Backend) {
    new Setting(this.containerEl).setName(name).setDesc(S.settingsKeyHint).addText((text) => {
      text.inputEl.type = 'password';
      text.inputEl.autocomplete = 'off';
      text.setPlaceholder(S.settingsKeyPlaceholder);
      text.setValue(this.app.secretStorage.getSecret(SECRET_IDS[backend]) ?? '');
      text.onChange((value) => this.app.secretStorage.setSecret(SECRET_IDS[backend], value.trim()));
    });
  }

  display(): void {
    this.containerEl.empty();
    const { settings } = this.plugin;
    new Setting(this.containerEl).setName(S.settingsBackend).setDesc(S.settingsBackendHint).addDropdown((dropdown) =>
      dropdown.addOption('gemini', 'Gemini').addOption('vertex', 'Vertex').setValue(settings.backend).onChange(async (value) => {
        settings.backend = value as Backend;
        await this.plugin.saveSettings();
      }));
    this.keySetting(S.settingsGeminiKey, 'gemini');
    this.keySetting(S.settingsVertexKey, 'vertex');
    new Setting(this.containerEl).setName(S.settingsStyle).setDesc(S.settingsStyleHint).addTextArea((text) =>
      text.setValue(settings.defaultImageStyle).onChange(async (value) => {
        settings.defaultImageStyle = value;
        await this.plugin.saveSettings();
      }));
    new Setting(this.containerEl).setName(S.settingsAudio).setDesc(S.settingsAudioHint).addToggle((toggle) =>
      toggle.setValue(settings.autoPlayAudio).onChange(async (value) => {
        settings.autoPlayAudio = value;
        await this.plugin.saveSettings();
      }));
    new Setting(this.containerEl).setName(S.settingsFolder).setDesc(S.settingsFolderHint).addText((text) =>
      text.setValue(settings.decksFolder).onChange(async (value) => {
        settings.decksFolder = value.trim() || 'Flashcards';
        await this.plugin.saveSettings();
      }));
  }
}
