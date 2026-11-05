import { createGoogleProvider } from '../ai/google';
import { AiError, type AiProvider, type HttpPost } from '../ai/provider';

export type Backend = 'gemini' | 'vertex';

export interface PluginSettings {
  backend: Backend;
  defaultImageStyle: string;
  autoPlayAudio: boolean;
  lastDeckPath: string | null;
  decksFolder: string;
}

export const DEFAULT_SETTINGS: PluginSettings = {
  backend: 'gemini',
  defaultImageStyle: 'Clean modern illustration, simple shapes, calm harmonious colors',
  autoPlayAudio: true,
  lastDeckPath: null,
  decksFolder: 'Flashcards',
};

export const SECRET_IDS: Record<Backend, string> = {
  gemini: 'picture-flashcards-gemini',
  vertex: 'picture-flashcards-vertex',
};

/** Reads the chosen backend and its key on every call, so changes in settings apply at once. */
export function resolveProvider(getSettings: () => PluginSettings, getSecret: (id: string) => string | null, post: HttpPost): AiProvider {
  const current = (): AiProvider => {
    const { backend } = getSettings();
    const apiKey = getSecret(SECRET_IDS[backend]);
    if (!apiKey) throw new AiError('no-key', backend);
    return createGoogleProvider({ backend, apiKey, post });
  };
  return {
    generateCardText: async (input) => current().generateCardText(input),
    generateImage: async (input) => current().generateImage(input),
    generateSpeech: async (input) => current().generateSpeech(input),
  };
}
