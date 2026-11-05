# Picture Flashcards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Плагин для Обсидиана: человек вводит слово, ИИ делает карточку с картинкой, озвучкой и пояснением, а карточки возвращаются по кривой запоминания.

**Architecture:** Две части. `src/core` и `src/ai` не импортируют `obsidian` и покрыты автотестами, файлы и сеть в них подменяются. `src/obsidian` - тонкая оболочка: окна, чтение и запись файлов, настройки. Вся колода лежит в одной заметке, картинки и звук в подпапке `_media`.

**Tech Stack:** TypeScript, esbuild, vitest, `ts-fsrs` v5, API Обсидиана (`obsidian` на npm).

**Spec:** `docs/superpowers/specs/2026-11-05-picture-flashcards-design.md`

## Global Constraints

- `src/core` и `src/ai` не импортируют `obsidian`. Проверка: `grep -rn "from 'obsidian'" src/core src/ai` ничего не находит.
- `isDesktopOnly: false`, `minAppVersion: "1.11.4"` (с этой версии есть `app.secretStorage`). Модули Node запрещены. Сеть только через `requestUrl` из Обсидиана.
- Ключи лежат только в `app.secretStorage`, id секретов `picture-flashcards-gemini` и `picture-flashcards-vertex`. В заметки и `data.json` ключи не попадают.
- Весь текст интерфейса на русском и лежит в `src/ui/strings.ts`. Длинное тире запрещено, только дефис.
- Родной язык на карточке не появляется. На картинке нет текста.
- Запасного перехода между сервисами нет: используется только выбранный.
- Модели только в `src/ai/models.ts`: `gemini-3.8-flash`, `gemini-3.1-flash-image`, `gemini-3.8-flash-tts`.
- Шаг «Commit» выполняется, только если Лев прямо разрешил коммиты. Без разрешения пропустить шаг и идти дальше. Пуш только по отдельной просьбе.
- Формат коммита: `feat(core): текст на русском`, в конце строка `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

- Заметку поправили руками и сломали один блок: плагин показывает остальные карточки, сообщает о сломанном блоке и не стирает его при следующей записи.
- Карточка дозаписывается из очереди, пока идёт повторение той же колоды: ни одно из двух изменений не теряется.
- Файл картинки удалили или он ещё не доехал через синхронизацию: карточка не роняет окно, не идёт в повторение и показана как требующая внимания.
- Фраза с кавычками, тройными обратными кавычками, переводом строки или на языке с письмом справа налево: сохраняется и читается без искажений, а имена файлов от слова не зависят.
- ИИ вернул не тот формат или ответ без картинки: карточка остаётся черновиком с понятным сообщением, уже сделанное не теряется.

---

### Task 0: Проверить картинки и озвучку без номера проекта

Временный скрипт лежит в папке для временных файлов, в репозиторий не попадает.

**Files:**
- Modify: `docs/superpowers/specs/2026-11-05-picture-flashcards-design.md` (абзац «Проверено 2026-11-05»)

- [ ] **Step 1: Отправить в Vertex запрос на картинку без номера проекта**

Адрес `https://aiplatform.googleapis.com/v1/publishers/google/models/gemini-3.1-flash-image:generateContent`, заголовок `x-goog-api-key: $VERTEX_API_KEY`, `generationConfig.responseModalities: ["TEXT","IMAGE"]`. В zsh писать `${M}:generateContent` с фигурными скобками, иначе двоеточие ломает адрес.
Expected: HTTP 200, в ответе часть `inlineData` с `mimeType` `image/*`.

- [ ] **Step 2: Отправить такой же запрос на озвучку**

Модель `gemini-3.8-flash-tts`, `responseModalities: ["AUDIO"]`, `speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName: "Kore"`.
Expected: HTTP 200, часть `inlineData` с `audio/*`.

- [ ] **Step 3: Записать результат в описание проекта и сообщить Льву**

Если оба запроса прошли, поле номера проекта не нужно. Если нет, добавить в Task 3 и Task 6 необязательный параметр `project` и адрес `.../v1/projects/{project}/locations/global/publishers/google/models/...`.

---

### Task 1: Заготовка проекта и формат заметки-колоды

**Files:**
- Create: `package.json`, `tsconfig.json`, `esbuild.config.mjs`, `manifest.json`, `.gitignore`, `vitest.config.ts`
- Create: `src/core/types.ts`, `src/core/deckFormat.ts`
- Test: `tests/core/deckFormat.test.ts`

**Interfaces:**
- Produces, `src/core/types.ts`:

```ts
export type CardStatus = 'draft' | 'ready';
export interface CardMedia { image: string | null; wordAudio: string | null; exampleAudio: string | null } // пути относительно папки колоды
export interface ScheduleState { due: string; fsrs: Record<string, unknown>; firstReviewedAt: string | null } // даты в ISO
export interface Card {
  id: string; status: CardStatus; word: string; reading: string | null; kind: string;
  explanation: string; example: string; scene: string; customPrompt: string | null;
  media: CardMedia; schedule: ScheduleState; lastError: string | null; createdAt: string;
}
export interface DeckSettings { language: string; imageStyle: string; newCardsPerDay: number }
export interface ParsedDeck { settings: DeckSettings; cards: Card[]; brokenBlocks: number }
```

- Produces, `src/core/deckFormat.ts`:
  - `createDeckText(settings: DeckSettings): string`
  - `parseDeck(text: string): ParsedDeck`
  - `upsertCard(text: string, card: Card): string`
  - `removeCard(text: string, cardId: string): string`
  - `updateSettings(text: string, settings: DeckSettings): string`
  - `findDuplicate(cards: Card[], word: string): Card | null`

Формат заметки:

````markdown
---
picture-flashcards: deck
---

```picture-flashcards-deck
{ "language": "ja", "imageStyle": "...", "newCardsPerDay": 20 }
```

## 猫
```picture-flashcard
{ ...карточка, JSON с отступами... }
```
````

- [ ] **Step 1: Создать заготовку и установить зависимости**

`npm i -D obsidian esbuild typescript vitest`, `npm i ts-fsrs`. `manifest.json`: `id: "picture-flashcards"`, `name: "Picture Flashcards"`, `isDesktopOnly: false`, `minAppVersion: "1.11.4"`. esbuild: `platform: "browser"`, `external: ["obsidian"]`, выход `main.js`. Если `tsc` версии 7 не работает с типами Обсидиана, поставить последнюю 5.x. Если коммиты разрешены: `git init`, `git remote add origin https://github.com/Krabik6/picture-flashcards.git`.

- [ ] **Step 2: Написать падающие тесты**

```ts
const settings = { language: 'ja', imageStyle: 'flat', newCardsPerDay: 20 };
const card = (over: Partial<Card> = {}): Card => ({ id: 'a1', status: 'ready', word: '猫', reading: 'ねこ', kind: 'noun',
  explanation: 'x', example: 'y', scene: 'z', customPrompt: null,
  media: { image: '_media/a1-image-1.png', wordAudio: null, exampleAudio: null },
  schedule: { due: '2026-11-05T00:00:00.000Z', fsrs: {}, firstReviewedAt: null }, lastError: null, createdAt: '2026-11-05T00:00:00.000Z', ...over });

test('round trip', () => {
  const text = upsertCard(createDeckText(settings), card());
  expect(parseDeck(text)).toEqual({ settings, cards: [card()], brokenBlocks: 0 });
});
test('upsert changes only own block', () => {
  const two = upsertCard(upsertCard(createDeckText(settings), card()), card({ id: 'b2', word: 'b' }));
  const changed = upsertCard(two, card({ explanation: 'new' }));
  expect(changed.slice(changed.indexOf('## b'))).toBe(two.slice(two.indexOf('## b')));
  expect(parseDeck(changed).cards[0].explanation).toBe('new');
});
test('tricky text survives', () => {
  const word = 'a "b" ```\nשלום';
  expect(parseDeck(upsertCard(createDeckText(settings), card({ word }))).cards[0].word).toBe(word);
});
test('broken block is counted and kept', () => {
  const text = upsertCard(createDeckText(settings), card()) + '\n## bad\n```picture-flashcard\n{oops\n```\n';
  expect(parseDeck(text).brokenBlocks).toBe(1);
  expect(parseDeck(text).cards).toHaveLength(1);
  expect(upsertCard(text, card({ id: 'c3' }))).toContain('{oops');
});
test('remove keeps others', () => {
  const two = upsertCard(upsertCard(createDeckText(settings), card()), card({ id: 'b2', word: 'b' }));
  expect(parseDeck(removeCard(two, 'a1')).cards.map(c => c.id)).toEqual(['b2']);
});
test('duplicate ignores case and spaces', () => {
  expect(findDuplicate([card({ word: 'Cat' })], '  cat ')?.id).toBe('a1');
  expect(findDuplicate([card({ word: 'Cat' })], 'dog')).toBeNull();
});
test('hand-edited heading does not break parsing', () => {
  const text = upsertCard(createDeckText(settings), card()).replace('## 猫', '## кот');
  expect(parseDeck(text).cards[0].word).toBe('猫');
});
```

- [ ] **Step 2a: Запустить тесты и убедиться, что падают**

Run: `npx vitest run tests/core/deckFormat.test.ts`
Expected: FAIL, функции не определены.

- [ ] **Step 3: Написать `src/core/types.ts` и `src/core/deckFormat.ts`**

Блок ищется по строке-открытию и первой строке, равной трём обратным кавычкам. JSON держит перевод строки как `\n`, поэтому такая строка внутри значения невозможна. Заголовок `## ` собирается из первой строки слова. Источник данных - JSON, заголовок на разбор не влияет.

- [ ] **Step 4: Запустить тесты**

Run: `npx vitest run tests/core/deckFormat.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(core): добавить заготовку плагина и формат заметки-колоды"
```

---

### Task 2: Кривая запоминания и выбор карточек

**Files:**
- Create: `src/core/scheduler.ts`
- Test: `tests/core/scheduler.test.ts`

**Interfaces:**
- Consumes: `Card`, `ScheduleState` из Task 1.
- Produces:
  - `type Grade = 'forgot' | 'hard' | 'easy'`
  - `interface Scheduler { newState(now: Date): ScheduleState; grade(state: ScheduleState, grade: Grade, now: Date): ScheduleState }`
  - `createScheduler(): Promise<Scheduler>`
  - `selectDueCards(cards: Card[], newPerDay: number, now: Date): Card[]`
  - `nextDueAt(cards: Card[], now: Date): Date | null`

Оценки: `forgot` = `Rating.Again`, `hard` = `Rating.Hard`, `easy` = `Rating.Good`. Кнопка `Rating.Easy` не используется: при трёх кнопках обычное «вспомнил» должно идти как Good, иначе интервалы растут слишком быстро.

- [ ] **Step 1: Написать падающие тесты**

```ts
const now = new Date('2026-11-05T12:00:00.000Z');
test('easy pushes further than forgot', async () => {
  const s = await createScheduler();
  const st = s.newState(now);
  expect(new Date(s.grade(st, 'easy', now).due).getTime()).toBeGreaterThan(new Date(s.grade(st, 'forgot', now).due).getTime());
});
test('state survives JSON', async () => {
  const s = await createScheduler();
  const st = s.grade(s.newState(now), 'hard', now);
  const later = new Date('2026-11-20T12:00:00.000Z');
  expect(s.grade(JSON.parse(JSON.stringify(st)), 'easy', later)).toEqual(s.grade(st, 'easy', later));
});
test('first grade sets firstReviewedAt once', async () => {
  const s = await createScheduler();
  const a = s.grade(s.newState(now), 'easy', now);
  expect(a.firstReviewedAt).toBe(now.toISOString());
  expect(s.grade(a, 'easy', new Date('2026-11-20T12:00:00.000Z')).firstReviewedAt).toBe(now.toISOString());
});
test('drafts are never selected', () => { /* карточка status: draft с прошедшим due не попадает в результат */ });
test('card without image is never selected', () => { /* status: ready, media.image: null не попадает */ });
test('new limit counts cards already started today', () => { /* limit 2, одна новая уже начата сегодня, три новых ждут: вернуть одну */ });
test('due reviews go before new cards', () => { /* начатые просроченные идут раньше новых */ });
test('nextDueAt returns earliest future due or null', () => { /* две будущие: ближайшая; пустой список: null */ });
```

Последние пять тестов написать полностью по комментариям, с карточками через помощник `card()` из Task 1.

- [ ] **Step 2: Запустить тесты и убедиться, что падают**

Run: `npx vitest run tests/core/scheduler.test.ts`
Expected: FAIL.

- [ ] **Step 3: Написать `src/core/scheduler.ts`**

`const scheduler = await DefaultScheduler()`, затем `scheduler.newCard({ now })` и `scheduler.review({ card, grade, now }).card`. Состояние `fsrs` хранит карточку библиотеки, при чтении поля-даты восстанавливаются из строк. Новая карточка: `firstReviewedAt === null`. «Сегодня» считается по местному дню устройства.

- [ ] **Step 4: Запустить тесты**

Run: `npx vitest run tests/core/scheduler.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(core): добавить расписание повторений и выбор карточек"
```

---

### Task 3: Запросы к Gemini и Vertex

**Files:**
- Create: `src/ai/models.ts`, `src/ai/provider.ts`, `src/ai/google.ts`, `src/ai/wav.ts`
- Test: `tests/ai/google.test.ts`

**Interfaces:**
- Produces, `src/ai/provider.ts`:

```ts
export interface BinaryFile { bytes: ArrayBuffer; extension: string }
export interface CardText { reading: string | null; kind: string; explanation: string; example: string; scene: string }
export interface AiProvider {
  generateCardText(input: { word: string; language: string; customPrompt: string | null }): Promise<CardText>;
  generateImage(input: { scene: string; style: string }): Promise<BinaryFile>;
  generateSpeech(input: { text: string }): Promise<BinaryFile>;
}
export type AiErrorKind = 'no-key' | 'bad-key' | 'overloaded' | 'network' | 'blocked' | 'bad-response';
export class AiError extends Error { constructor(public kind: AiErrorKind, message: string) { super(message); } }
export type HttpPost = (url: string, headers: Record<string, string>, body: string) => Promise<{ status: number; text: string }>;
```

- Produces, `src/ai/google.ts`: `createGoogleProvider(opts: { backend: 'gemini' | 'vertex'; apiKey: string; post: HttpPost }): AiProvider`

Адреса: Gemini `https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent`, Vertex `https://aiplatform.googleapis.com/v1/publishers/google/models/{model}:generateContent` (результат Task 0 может это изменить). Заголовок `x-goog-api-key`.

- [ ] **Step 1: Написать падающие тесты с подменённым `post`**

```ts
test('uses the chosen backend only', async () => { /* backend vertex и status 500: post вызван один раз, адрес aiplatform */ });
test('text prompt demands target language and no translation', async () => {
  /* тело запроса содержит язык колоды, запрет родного языка и customPrompt, если он задан */
});
test('scene instructions forbid text in the image', async () => { /* тело запроса на картинку содержит "no text" и стиль */ });
test('image response becomes BinaryFile', async () => { /* inlineData image/png: extension png, байты совпадают */ });
test('speech PCM is wrapped into WAV', async () => { /* audio/L16;rate=24000: extension wav, начало байтов RIFF */ });
test.each([[401, 'bad-key'], [403, 'bad-key'], [429, 'overloaded'], [503, 'overloaded']])('status %i maps to %s', async (status, kind) => { /* ... */ });
test('response without image is bad-response', async () => { /* только текстовая часть: AiError bad-response */ });
test('text that is not valid JSON is bad-response', async () => { /* ... */ });
test('safety block maps to blocked', async () => { /* promptFeedback.blockReason: AiError blocked */ });
test('network failure maps to network', async () => { /* post бросает ошибку: AiError network */ });
```

Написать каждый тест полностью по комментарию.

- [ ] **Step 2: Запустить тесты и убедиться, что падают**

Run: `npx vitest run tests/ai/google.test.ts`
Expected: FAIL.

- [ ] **Step 3: Написать `models.ts`, `wav.ts`, `google.ts`**

Текст: `responseMimeType: "application/json"`. Промпт текста требует: всё на языке колоды, родной язык не использовать, для абстрактного слова описать сценку, картинка должна быть нарочито понятной и указывать именно на это слово, поле `reading` заполнять только если письмо языка его требует. Заголовок запроса и формат ответа как в `gm.py` из навыка `gemini-media`. Повторов при ошибке нет.

- [ ] **Step 4: Запустить тесты**

Run: `npx vitest run tests/ai/google.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(ai): добавить запросы к Gemini и Vertex"
```

---

### Task 4: Создание и пересоздание карточки

**Files:**
- Create: `src/core/store.ts`, `src/core/cardCreation.ts`
- Create: `tests/fakes/memoryStore.ts`, `tests/fakes/fakeProvider.ts`
- Test: `tests/core/cardCreation.test.ts`

**Interfaces:**
- Consumes: `Card`, `ParsedDeck` (Task 1), `Scheduler` (Task 2), `AiProvider`, `BinaryFile`, `AiError` (Task 3).
- Produces, `src/core/store.ts`:

```ts
export type MediaKind = 'image' | 'word-audio' | 'example-audio';
export interface DeckStore {
  readDeck(deckPath: string): Promise<ParsedDeck>;
  saveCard(deckPath: string, card: Card): Promise<void>;
  deleteCard(deckPath: string, cardId: string): Promise<void>; // блок и файлы
  writeMedia(deckPath: string, cardId: string, kind: MediaKind, file: BinaryFile): Promise<string>; // новый путь относительно папки колоды, всегда новое имя
  removeMedia(deckPath: string, relativePath: string): Promise<void>; // в корзину
  mediaExists(deckPath: string, relativePath: string): Promise<boolean>;
}
```

- Produces, `src/core/cardCreation.ts`:

```ts
export interface CreationDeps { store: DeckStore; provider: AiProvider; scheduler: Scheduler; now: () => Date; newId: () => string }
export function addDraft(deps: CreationDeps, deckPath: string, word: string): Promise<Card>;
export function fillCard(deps: CreationDeps, deckPath: string, cardId: string): Promise<Card>;   // также кнопка «Повторить»
export function regenerateImage(deps: CreationDeps, deckPath: string, cardId: string, customPrompt: string | null): Promise<Card>;
export function regenerateAll(deps: CreationDeps, deckPath: string, cardId: string, customPrompt: string | null): Promise<Card>;
```

- [ ] **Step 1: Написать падающие тесты**

```ts
test('draft is saved before any AI call', async () => { /* provider никогда не отвечает: addDraft всё равно записал карточку status draft */ });
test('fill makes a ready card', async () => { /* все шаги прошли: status ready, все три media заполнены, lastError null */ });
test('failed step keeps what is done', async () => { /* generateImage падает: status draft, текст сохранён, lastError заполнен */ });
test('retry does only the missing parts', async () => { /* после сбоя картинки fillCard не вызывает generateCardText повторно */ });
test('card without image never becomes ready', async () => { /* generateSpeech прошёл, картинки нет: status draft */ });
test('regenerateImage with prompt replaces scene only', async () => {
  /* generateImage получил customPrompt как сцену; word, explanation и озвучка не изменились; старый файл удалён */
});
test('regenerateAll passes prompt to text and keeps schedule', async () => { /* schedule не изменился, текст и файлы новые, старые файлы удалены */ });
test('regenerateAll failure leaves old card intact', async () => { /* сбой на озвучке: карточка как была, новые файлы удалены */ });
test('fill rereads the deck before saving', async () => {
  /* пока идёт генерация, в хранилище изменили другую карточку: её изменение на месте */
});
```

Написать каждый тест полностью по комментарию, через `memoryStore` и `fakeProvider`.

- [ ] **Step 2: Запустить тесты и убедиться, что падают**

Run: `npx vitest run tests/core/cardCreation.test.ts`
Expected: FAIL.

- [ ] **Step 3: Написать `store.ts`, `cardCreation.ts`, подмены для тестов**

Перед каждым `saveCard` карточка читается заново из `readDeck`, поля обновляются только свои. Текст ошибки в `lastError` берётся из `strings.ts` по `AiErrorKind`, поэтому в этой задаче создать и `src/ui/strings.ts` (файл без импорта `obsidian`).

- [ ] **Step 4: Запустить тесты**

Run: `npx vitest run tests/core/cardCreation.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(core): добавить создание и пересоздание карточек"
```

---

### Task 5: Очередь добавления

**Files:**
- Create: `src/core/creationQueue.ts`
- Test: `tests/core/creationQueue.test.ts`

**Interfaces:**
- Consumes: `addDraft`, `fillCard`, `CreationDeps` (Task 4).
- Produces:

```ts
export interface QueueItem { deckPath: string; cardId: string; word: string; state: 'waiting' | 'working' | 'done' | 'failed'; error: string | null }
export class CreationQueue {
  constructor(deps: CreationDeps, maxParallel?: number); // по умолчанию 2
  add(deckPath: string, word: string): Promise<QueueItem>;
  items(): QueueItem[];
  subscribe(listener: () => void): () => void;
}
```

Очередь живёт в плагине, а не в окне: при закрытии окна работа продолжается. После перезапуска Обсидиана незаконченные карточки остаются черновиками, сами они не возобновляются.

- [ ] **Step 1: Написать падающие тесты**

```ts
test('add returns before generation finishes', async () => { /* fillCard не завершён, но add уже вернул элемент */ });
test('no more than two run at once', async () => { /* пять слов: одновременно работает не больше двух */ });
test('one failure does not stop the rest', async () => { /* сбой на первом: второй done */ });
test('listeners hear every change and can unsubscribe', async () => { /* ... */ });
```

Написать каждый тест полностью по комментарию.

- [ ] **Step 2: Запустить тесты и убедиться, что падают**

Run: `npx vitest run tests/core/creationQueue.test.ts`
Expected: FAIL.

- [ ] **Step 3: Написать `src/core/creationQueue.ts`**

- [ ] **Step 4: Запустить тесты**

Run: `npx vitest run tests/core/creationQueue.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(core): добавить очередь создания карточек"
```

---

### Task 6: Подключение к Обсидиану и настройки

**Files:**
- Create: `src/main.ts`, `src/obsidian/deckStore.ts`, `src/obsidian/http.ts`, `src/obsidian/settingsTab.ts`, `src/obsidian/settings.ts`, `styles.css`
- Test: `tests/obsidian/settings.test.ts`

**Interfaces:**
- Consumes: `DeckStore`, `CreationDeps`, `CreationQueue`, `createGoogleProvider`, `createScheduler`, `AiError`.
- Produces:
  - `src/obsidian/settings.ts`: `interface PluginSettings { backend: 'gemini' | 'vertex'; defaultImageStyle: string; autoPlayAudio: boolean; lastDeckPath: string | null }`, `DEFAULT_SETTINGS`, `SECRET_IDS`, `resolveProvider(settings, getSecret, post): AiProvider`. Если ключа нет, вызовы провайдера бросают `AiError('no-key', ...)`.
  - `class PictureFlashcardsPlugin extends Plugin` с полями `settings`, `store`, `scheduler`, `queue`, `listDecks(): Promise<string[]>`, `createDeck(folderPath: string, settings: DeckSettings): Promise<string>`.
  - `src/obsidian/http.ts`: `obsidianPost: HttpPost` через `requestUrl` с `throw: false`.

- [ ] **Step 1: Написать падающий тест `resolveProvider`**

```ts
test('uses the key of the chosen backend', () => { /* backend vertex: getSecret вызван с SECRET_IDS.vertex */ });
test('missing key gives no-key error on use', async () => { /* getSecret вернул null: generateCardText бросает AiError no-key */ });
```

Написать тесты полностью. Запустить: `npx vitest run tests/obsidian/settings.test.ts`, ожидается FAIL.

- [ ] **Step 2: Написать `settings.ts`, `http.ts`, `deckStore.ts`, `settingsTab.ts`, `main.ts`**

`deckStore`: запись заметки только через `vault.process`, файлы через `vault.createBinary`, удаление через `fileManager.trashFile`. Колода определяется по `picture-flashcards: deck` в свойствах заметки. Настройки: выбор сервиса, два поля ключа через `app.secretStorage`, стиль картинок по умолчанию, автоозвучка. Значение стиля по умолчанию не привязано к аниме. Модуль `settings.ts` импортирует только типы из `obsidian`, чтобы тест мог его запустить.

- [ ] **Step 3: Запустить тесты и сборку**

Run: `npx vitest run && node esbuild.config.mjs production`
Expected: тесты PASS, появился `main.js`.

- [ ] **Step 4: Проверить вручную в Обсидиане**

Скопировать `main.js`, `manifest.json`, `styles.css` в `.obsidian/plugins/picture-flashcards/` тестового хранилища. Плагин включается, настройки открываются, ключ сохраняется и не появляется ни в `data.json`, ни в заметках (`grep -r` по значению ключа в хранилище ничего не находит).

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(plugin): подключить плагин к Обсидиану и добавить настройки"
```

---

### Task 7: Окно добавления

**Files:**
- Create: `src/obsidian/addModal.ts`, `src/ui/cardBack.ts`
- Modify: `src/main.ts`, `styles.css`
- Test: `tests/ui/addFlow.test.ts`

**Interfaces:**
- Consumes: `CreationQueue`, `findDuplicate`, `regenerateImage`, `regenerateAll`, `PictureFlashcardsPlugin`.
- Produces:
  - `decideAdd(input: string, cards: Card[]): { action: 'empty' } | { action: 'duplicate'; existing: Card } | { action: 'add'; word: string }` в `src/ui/addFlow.ts`
  - `type MediaResolver = (relativePath: string) => string | null` (адрес файла для показа, `null` если файла нет)
  - `interface CardBackActions { playAudio(relativePath: string): void }`
  - `renderCardBack(el: HTMLElement, card: Card, media: MediaResolver, actions: CardBackActions): void` в `src/ui/cardBack.ts`, используется и в Task 8, и в Task 9
  - команда `picture-flashcards:add-card`

- [ ] **Step 1: Написать падающий тест `decideAdd`**

```ts
test('blank input is empty', () => expect(decideAdd('   ', []).action).toBe('empty'));
test('trims the word', () => expect(decideAdd(' cat ', [])).toEqual({ action: 'add', word: 'cat' }));
test('finds a duplicate', () => { /* карточка Cat: action duplicate, existing эта карточка */ });
```

Запустить: `npx vitest run tests/ui/addFlow.test.ts`, ожидается FAIL.

- [ ] **Step 2: Написать `addFlow.ts`, `cardBack.ts`, `addModal.ts`**

Окно запоминает последнюю колоду в `lastDeckPath`. Enter добавляет слово в очередь, очищает поле и оставляет фокус в нём. Карточка появляется в списке окна и заполняется по мере готовности. На готовой карточке: «Другая картинка», «Пересоздать всё», поле своего промпта. При сбое: понятный текст и «Повторить». При дубликате: «Открыть» и «Создать вторую». Если ключа нет, сообщение ведёт в настройки, а слово сохранено как черновик. Создание новой колоды тоже в этом окне: название папки, язык, стиль.

- [ ] **Step 3: Запустить тесты и проверить вручную**

Run: `npx vitest run && node esbuild.config.mjs production`
Expected: PASS. В Обсидиане: ввести пять слов подряд без ожидания, закрыть окно на середине, все пять карточек оказались в заметке, незаконченные стали черновиками или дописались.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat(ui): добавить окно добавления карточек с очередью"
```

---

### Task 8: Окно колоды и окно карточки

**Files:**
- Create: `src/obsidian/deckView.ts`, `src/obsidian/cardModal.ts`, `src/obsidian/deckRedirect.ts`, `src/ui/deckOverview.ts`
- Modify: `src/main.ts`, `styles.css`
- Test: `tests/ui/deckOverview.test.ts`

**Interfaces:**
- Consumes: `parseDeck` результат через `store.readDeck`, `selectDueCards`, `renderCardBack`, `regenerateImage`, `regenerateAll`, `fillCard`, `store.deleteCard`.
- Produces:
  - `buildDeckOverview(deck: ParsedDeck, missing: Set<string>, now: Date): { dueToday: number; drafts: Card[]; needsAttention: Card[]; ready: Card[]; brokenBlocks: number }`
  - `VIEW_TYPE_DECK = 'picture-flashcards-deck'`, `class DeckView extends ItemView` с состоянием `{ file: string }`
  - `class CardModal extends Modal`, `new CardModal(app, plugin, deckPath, cardId)`
  - `registerDeckRedirect(plugin): void`, `showAsText(leaf, path): void`

- [ ] **Step 1: Написать падающий тест `buildDeckOverview`**

```ts
test('splits cards by state', () => { /* один draft, одна просроченная, одна будущая: dueToday 1, drafts 1, ready 2 */ });
test('missing image goes to needsAttention, not due', () => { /* id в missing: не считается в dueToday, есть в needsAttention */ });
test('broken blocks are passed through', () => { /* brokenBlocks 2 в deck: 2 в результате */ });
```

Запустить: `npx vitest run tests/ui/deckOverview.test.ts`, ожидается FAIL.

- [ ] **Step 2: Написать `deckOverview.ts`, `deckView.ts`, `cardModal.ts`, `deckRedirect.ts`**

Перехват: `workspace.on('file-open')`. Если у файла `picture-flashcards: deck` и лист показывает заметку, вызвать `leaf.setViewState({ type: VIEW_TYPE_DECK, state: { file: path } })`. Кнопка «Показать как текст» заносит путь в набор исключений и возвращает `markdown`. `DeckView` перерисовывается при `vault.on('modify')` по своему файлу. Окно карточки: оборот, «Другая картинка», «Пересоздать всё», «Повторить» для черновика, «Удалить» с подтверждением. Сломанные блоки показаны предупреждением. В окне колоды есть настройки колоды: язык, стиль картинок и лимит новых карточек в день (`updateSettings` из Task 1, запись через `vault.process`).

- [ ] **Step 3: Запустить тесты и проверить вручную**

Run: `npx vitest run && node esbuild.config.mjs production`
Expected: PASS. В Обсидиане: заметка-колода открывается окном, обычные заметки не затронуты, текст показывается по кнопке, переименование папки не ломает картинки, удалённый файл картинки не роняет окно.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat(ui): добавить окно колоды и окно карточки"
```

---

### Task 9: Повторение и стартовый экран

**Files:**
- Create: `src/obsidian/reviewView.ts`, `src/ui/reviewSession.ts`
- Modify: `src/main.ts`, `styles.css`
- Test: `tests/ui/reviewSession.test.ts`

**Interfaces:**
- Consumes: `selectDueCards`, `nextDueAt`, `Scheduler`, `Grade`, `store`, `renderCardBack`, `buildDeckOverview`, `regenerateImage`.
- Produces:
  - `class ReviewSession { constructor(cards: Card[], grade: (card: Card, g: Grade) => Promise<void>); current(): Card | null; revealed(): boolean; reveal(): void; rate(g: Grade): Promise<void>; remaining(): number }`
  - `keyToAction(key: string, revealed: boolean): 'reveal' | 'forgot' | 'hard' | 'easy' | 'replay' | null`
  - `VIEW_TYPE_REVIEW = 'picture-flashcards-review'`, команда `picture-flashcards:start-review`, значок на боковой панели

- [ ] **Step 1: Написать падающие тесты**

```ts
test('rate before reveal does nothing', async () => { /* rate без reveal: карточка та же, grade не вызван */ });
test('forgotten card returns in the same session', async () => { /* forgot: карточка снова в конце очереди */ });
test('rating moves on', async () => { /* easy: current следующая, remaining меньше */ });
test('failed save keeps the card on screen', async () => { /* grade бросает ошибку: current та же, ошибка доступна */ });
test('keys', () => {
  expect(keyToAction(' ', false)).toBe('reveal');
  expect(keyToAction('1', false)).toBeNull();
  expect(keyToAction('1', true)).toBe('forgot');
  expect(keyToAction('2', true)).toBe('hard');
  expect(keyToAction('3', true)).toBe('easy');
  expect(keyToAction('r', true)).toBe('replay');
});
```

Запустить: `npx vitest run tests/ui/reviewSession.test.ts`, ожидается FAIL.

- [ ] **Step 2: Написать `reviewSession.ts` и `reviewView.ts`**

Стартовый экран: колоды с числом карточек на сегодня и черновиков, запуск по одной колоде или по всем. Лицо: только картинка и «Показать». Оборот: `renderCardBack`, три оценки, «Другая картинка». При показе оборота слово озвучивается, если `autoPlayAudio` включено. Сохранение: заново прочитать карточку и записать только новый `schedule`. Клавиши работают, только если фокус не в поле ввода. Когда карточки закончились, показать, когда будут следующие (`nextDueAt`). На телефоне кнопки достаточно большие для пальца.

- [ ] **Step 3: Запустить тесты и проверить вручную**

Run: `npx vitest run && node esbuild.config.mjs production`
Expected: PASS. В Обсидиане: весь цикл только с клавиатуры, забытая карточка возвращается, данные в заметке обновились только у этой карточки.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat(ui): добавить повторение и стартовый экран"
```

---

### Task 10: Проверка на телефоне и синхронизации

**Files:**
- Create: `README.md`
- Modify: `docs/superpowers/specs/2026-11-05-picture-flashcards-design.md` (итог проверки синхронизации)

- [ ] **Step 1: Прогнать все проверки**

Run: `npx vitest run && node esbuild.config.mjs production && grep -rn "from 'obsidian'" src/core src/ai; grep -rn $'\\u2014' src docs README.md`
Expected: тесты PASS, сборка прошла, оба `grep` ничего не находят.

- [ ] **Step 2: Вместе со Львом проверить на телефоне**

Плагин ставится, ключ вводится, карточка создаётся, картинка показана, звук играет, повторение работает. Отдельно проверить, что `DefaultScheduler` из `ts-fsrs` работает в мобильном Обсидиане. Телефонную проверку делает Лев, Claude даёт список шагов.

- [ ] **Step 3: Проверить синхронизацию одной заметки**

На двух устройствах без связи оценить разные карточки одной колоды, затем включить связь. Записать, что произошло, в описание проекта. Если прогресс теряется, остановиться и обсудить со Львом решение. Не менять формат самостоятельно.

- [ ] **Step 4: Написать `README.md`**

Как поставить плагин, где взять ключ Gemini, что делать при ошибке ключа. На русском.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "docs: добавить инструкцию и итог проверки на устройствах"
```
