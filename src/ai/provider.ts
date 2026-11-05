export interface BinaryFile {
  bytes: ArrayBuffer;
  extension: string;
}

export interface CardText {
  reading: string | null;
  kind: string;
  explanation: string;
  example: string;
  scene: string;
}

export interface AiProvider {
  generateCardText(input: { word: string; language: string; customPrompt: string | null }): Promise<CardText>;
  generateImage(input: { scene: string; style: string }): Promise<BinaryFile>;
  generateSpeech(input: { text: string }): Promise<BinaryFile>;
}

export type AiErrorKind = 'no-key' | 'bad-key' | 'overloaded' | 'network' | 'blocked' | 'bad-response';

export class AiError extends Error {
  constructor(public kind: AiErrorKind, message: string) {
    super(message);
  }
}

export type HttpPost = (url: string, headers: Record<string, string>, body: string) => Promise<{ status: number; text: string }>;
