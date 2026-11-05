import type { AiProvider, BinaryFile, CardText } from '../../src/ai/provider';

export class FakeProvider implements AiProvider {
  textCalls: { word: string; language: string; customPrompt: string | null }[] = [];
  imageCalls: { scene: string; style: string }[] = [];
  speechCalls: string[] = [];
  failOn: 'text' | 'image' | 'speech' | null = null;
  gate: Promise<void> | null = null;
  text: CardText = { reading: null, kind: 'noun', explanation: 'explain', example: 'example', scene: 'scene' };

  private async step(kind: 'text' | 'image' | 'speech') {
    if (this.gate) await this.gate;
    if (this.failOn === kind) throw new Error(`${kind} failed`);
  }
  private file(extension: string): BinaryFile {
    return { bytes: new ArrayBuffer(1), extension };
  }
  async generateCardText(input: { word: string; language: string; customPrompt: string | null }) {
    this.textCalls.push(input);
    await this.step('text');
    return this.text;
  }
  async generateImage(input: { scene: string; style: string }) {
    this.imageCalls.push(input);
    await this.step('image');
    return this.file('png');
  }
  async generateSpeech(input: { text: string }) {
    this.speechCalls.push(input.text);
    await this.step('speech');
    return this.file('wav');
  }
}
