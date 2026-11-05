import { AiError, type AiErrorKind } from '../ai/provider';

const AI_ERRORS: Record<AiErrorKind, string> = {
  'no-key': 'Не задан ключ. Вставьте его в настройках плагина.',
  'bad-key': 'Сервис не принял ключ. Проверьте ключ в настройках плагина.',
  overloaded: 'Сервис перегружен. Карточка сохранена как черновик, нажмите «Повторить» чуть позже.',
  network: 'Нет связи с сервисом. Проверьте интернет и нажмите «Повторить».',
  blocked: 'Сервис отказался делать это из-за своих правил. Измените свой промпт и повторите.',
  'bad-response': 'Сервис вернул неожиданный ответ. Нажмите «Повторить».',
};

export function errorText(error: unknown): string {
  if (error instanceof AiError) return AI_ERRORS[error.kind];
  return error instanceof Error ? error.message : String(error);
}

export function plural(n: number, one: string, few: string, many: string): string {
  const m = n % 100;
  const k = n % 10;
  if (m > 10 && m < 20) return many;
  if (k === 1) return one;
  return k > 1 && k < 5 ? few : many;
}

export const countCards = (n: number) => `${n} ${plural(n, 'карточка', 'карточки', 'карточек')}`;
export const countDrafts = (n: number) => `${n} ${plural(n, 'черновик', 'черновика', 'черновиков')}`;

export const S = {
  review: 'Повторение',
  addCard: 'Добавить карточку',
  add: 'Добавить',
  reviewAll: 'Повторить всё',
  reviewVerb: 'Повторить',
  reveal: 'Показать',
  forgot: 'Забыл',
  hard: 'Трудно',
  easy: 'Легко',
  otherImage: 'Другая картинка',
  remakeAll: 'Пересоздать всё',
  retry: 'Повторить',
  delete: 'Удалить',
  cancel: 'Отмена',
  open: 'Открыть',
  save: 'Сохранить',
  close: 'Закрыть',
  listen: 'Послушать',
  listenExample: 'Послушать пример',
  finish: 'Закончить',
  doneTitle: 'На сегодня всё',
  toDecks: 'К колодам',
  noDecks: 'Колод пока нет. Добавьте первую карточку, и колода появится здесь.',
  dueNone: 'На сегодня всё',
  noImage: 'Нет картинки',
  draft: 'Черновик',
  missingFile: 'Файл картинки не найден',
  newCard: 'Новая карточка',
  deck: 'Колода',
  newDeck: 'Новая колода',
  deckName: 'Название колоды',
  deckNameHint: 'Папка с таким именем появится в папке для колод',
  language: 'Язык карточек',
  languageHint: 'На этом языке будут пояснение, пример и озвучка. Например: English, 日本語, Русский',
  imageStyle: 'Стиль картинок',
  newPerDay: 'Новых карточек в день',
  createDeck: 'Создать колоду',
  wordPlaceholder: 'Слово или фраза, затем Enter',
  ownPrompt: 'Свой промпт: что нарисовать',
  ownPromptHint: 'Необязательно. Для другого значения слова нажмите «Пересоздать всё»',
  alreadyInDeck: (word: string) => `«${word}» уже есть в этой колоде.`,
  createSecond: 'Создать вторую',
  confirmDelete: 'Удалить карточку вместе с картинкой и озвучкой?',
  deckSettings: 'Настройки колоды',
  showAsText: 'Показать как текст',
  openAsDeck: 'Открыть как колоду',
  brokenBlocks: (n: number) => `Не удалось прочитать блоков в заметке: ${n}. Они не тронуты, исправьте их в тексте заметки.`,
  draftsWaiting: (n: number) => `Ждут повтора генерации: ${countDrafts(n)}`,
  needsAttention: (n: number) => `Нет файла картинки: ${countCards(n)}. Такие карточки не идут в повторение.`,
  nextCards: (when: string) => `Следующие карточки ${when}.`,
  addMore: 'Добавьте новые слова, чтобы продолжить.',
  audioFailed: 'Не удалось воспроизвести звук',
  settingsBackend: 'Сервис ИИ',
  settingsBackendHint: 'Какой ключ использовать для текста, картинок и озвучки',
  settingsGeminiKey: 'Ключ Gemini',
  settingsVertexKey: 'Ключ Vertex',
  settingsKeyHint: 'Хранится в защищённом хранилище Обсидиана и не попадает в заметки',
  settingsKeyPlaceholder: 'Вставьте ключ',
  settingsStyle: 'Стиль картинок по умолчанию',
  settingsStyleHint: 'Для новых колод. В настройках колоды его можно заменить',
  settingsAudio: 'Озвучивать слово на обороте',
  settingsAudioHint: 'Слово звучит сразу после нажатия «Показать»',
  settingsFolder: 'Папка для колод',
  settingsFolderHint: 'Здесь появляются папки новых колод',
} as const;
