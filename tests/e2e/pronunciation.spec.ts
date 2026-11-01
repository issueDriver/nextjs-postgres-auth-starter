import { expect, test, type Page } from '@playwright/test';
import { loadEnvConfig } from '@next/env';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import type { BookDTO } from '../../lib/contracts/books';
import type { ProgressDTO } from '../../lib/contracts/study';
import type { WordCardDTO, WordDetailDTO } from '../../lib/contracts/words';

interface AudioProbe extends EventTarget {
  src: string;
  preload: string;
  pauses: number;
  loads: number;
  plays: { src: string; preload: string }[];
  resolvePlay: () => void;
  rejectPlay: (name: string) => void;
}

declare global {
  interface Window {
    __pronunciationAudio: { instances: AudioProbe[] };
  }
}

const BOOK_ID = 'fixture-pronunciation';
const USER_ID = '2147483000';
const LEARN_PATH = `/learn/${BOOK_ID}`;
const BOOK_API = `/api/books/${BOOK_ID}`;

async function pronunciationFixture(page: Page, baseURL: string | undefined, options: { word?: string; noPhonetics?: boolean } = {}) {
  loadEnvConfig(process.cwd(), true, { info: () => {}, error: () => {} });
  const secret = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET;
  if (!secret) throw new Error('A local Auth.js secret is required to sign the isolated test session.');
  const origin = new URL(baseURL ?? 'http://127.0.0.1:3001').origin;
  const secure = origin.startsWith('https:');
  const cookieName = `${secure ? '__Secure-' : ''}authjs.session-token`;
  const requireProject = createRequire(`${process.cwd()}/package.json`);
  const authPackage = pathToFileURL(requireProject.resolve('next-auth/package.json'));
  const { encode } = await import(new URL('../@auth/core/jwt.js', authPackage).href) as {
    encode: (params: { secret: string; salt: string; token: Record<string, string>; maxAge: number }) => Promise<string>;
  };
  const token = await encode({
    secret,
    salt: cookieName,
    token: { sub: USER_ID, email: 'pronunciation-fixture@example.test' },
    maxAge: 3600,
  });
  await page.context().addCookies([{ name: cookieName, value: token, url: origin, httpOnly: true, sameSite: 'Lax', secure }]);

  await page.addInitScript(() => {
    const instances: AudioProbe[] = [];
    class ControlledAudio extends EventTarget implements AudioProbe {
      src = '';
      preload = 'auto';
      pauses = 0;
      loads = 0;
      plays: { src: string; preload: string }[] = [];
      private pending: { resolve: () => void; reject: (error: DOMException) => void }[] = [];

      constructor(src?: string) {
        super();
        this.src = src ?? '';
        instances.push(this);
      }

      play() {
        this.plays.push({ src: this.src, preload: this.preload });
        return new Promise<void>((resolve, reject) => this.pending.push({ resolve, reject }));
      }

      pause() { this.pauses += 1; }
      load() { this.loads += 1; }
      removeAttribute(name: string) { if (name === 'src') this.src = ''; }
      resolvePlay() { this.pending.shift()?.resolve(); }
      rejectPlay(name: string) { this.pending.shift()?.reject(new DOMException('Controlled audio failure', name)); }
    }
    window.__pronunciationAudio = { instances };
    window.Audio = ControlledAudio as unknown as typeof Audio;
  });

  const book: BookDTO = { bookId: BOOK_ID, title: '发音隔离测试词书', wordCount: 3, coverUrl: '', tags: [], bookVersion: 1 };
  const words: WordCardDTO[] = [options.word ?? 'fetch', 'resume', 'finish'].map((headWord, orderIndex) => ({
    id: String(801 + orderIndex),
    bookId: BOOK_ID,
    orderIndex,
    headWord,
    phonetic: options.noPhonetics || orderIndex > 0 ? null : 'fetʃ',
    definition: { pos: 'v.', text: orderIndex === 0 ? '取回' : '继续' },
    example: null,
  }));
  let learned = 0;
  const unexpected: string[] = [];
  const writes: { path: string; wordId: string }[] = [];
  const progress = (): ProgressDTO => ({
    bookId: BOOK_ID, bookVersion: 1, totalWords: words.length, learnedCount: learned,
    lastCompletedIndex: learned === 0 ? null : learned - 1,
    lastCompletedWordId: learned === 0 ? null : words[learned - 1].id,
    revision: learned, isCompleted: learned === words.length,
    progressPercent: learned / words.length * 100,
    startedAt: '2026-11-01T08:00:00.000Z', lastStudiedAt: '2026-11-01T08:00:00.000Z',
    completedAt: learned === words.length ? '2026-11-01T08:00:00.000Z' : null,
  });
  const details = (word: WordCardDTO): WordDetailDTO => ({
    id: word.id, bookId: BOOK_ID, orderIndex: word.orderIndex, headWord: word.headWord, sourceWordId: null,
    phonetics: { uk: word.phonetic, us: word.phonetic ? 'fɛtʃ' : null, general: null },
    translations: [{ pos: 'v.', zh: word.definition.text, en: null }],
    examples: [], examExamples: [], phrases: [], synonyms: [], relatedWords: [],
  });

  // Block every API request unless it has an explicit fixture response.
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const method = request.method();
    const respond = (data: unknown) => route.fulfill({ json: { ok: true, data, requestId: 'pronunciation-fixture' } });
    if (path === '/api/auth/session' && method === 'GET') {
      await route.fulfill({ json: { user: { id: USER_ID, email: 'pronunciation-fixture@example.test' }, expires: '2099-01-01T00:00:00.000Z' } });
    } else if (path === `${BOOK_API}/study` && method === 'GET') {
      await respond(learned < words.length
        ? { state: 'learning', book, progress: progress(), currentWord: words[learned] }
        : { state: 'completed', book, progress: progress(), currentWord: null });
    } else if ((path === `${BOOK_API}/study/visit` || path === `${BOOK_API}/study/complete-word`) && method === 'POST') {
      const body = request.postDataJSON() as { wordId?: string; bookVersion?: number; expectedRevision?: number };
      writes.push({ path, wordId: body.wordId ?? '' });
      expect(body.bookVersion).toBe(1);
      expect(body.wordId).toBe(words[learned]?.id);
      expect(body.expectedRevision).toBe(learned);
      if (path.endsWith('/visit')) await respond(progress());
      else {
        learned += 1;
        await respond({ state: learned === words.length ? 'completed' : 'learning', progress: progress(), nextWord: words[learned] ?? null });
      }
    } else if (path.startsWith(`${BOOK_API}/words/`) && method === 'GET') {
      const word = words.find((item) => item.id === path.split('/').pop());
      if (word) await respond({ book, word: details(word) });
      else { unexpected.push(`${method} ${path}`); await route.abort('blockedbyclient'); }
    } else {
      unexpected.push(`${method} ${path}`);
      await route.abort('blockedbyclient');
    }
  });
  await page.route('https://dict.youdao.com/**', async (route) => {
    unexpected.push(`Unexpected real audio request: ${route.request().url()}`);
    await route.abort('blockedbyclient');
  });
  return { book, words, unexpected, writes };
}

function accentButton(page: Page, word: string, accent: '英音' | '美音') {
  return page.getByRole('button', { name: `播放 ${word} 的${accent}`, exact: true });
}

async function emitAudio(page: Page, index: number, event: string) {
  await page.evaluate(({ index, event }) => window.__pronunciationAudio.instances[index].dispatchEvent(new Event(event)), { index, event });
}

async function playedAudio(page: Page, index: number) {
  return page.evaluate((index) => {
    const audio = window.__pronunciationAudio.instances[index];
    return { plays: audio.plays, pauses: audio.pauses, loads: audio.loads, src: audio.src };
  }, index);
}

test('pronunciation maps accents to Youdao URLs and follows playing and ended events', async ({ page, baseURL }) => {
  const fixture = await pronunciationFixture(page, baseURL, { word: 'ice cream & tea' });
  const word = fixture.words[0];
  await page.goto(`/books/${BOOK_ID}/words/${word.id}`);
  const uk = accentButton(page, word.headWord, '英音');
  const us = accentButton(page, word.headWord, '美音');
  await expect(uk).toBeVisible();
  expect(await page.evaluate(() => window.__pronunciationAudio.instances.length)).toBe(0);
  await uk.click();
  await expect(uk).toHaveAttribute('aria-busy', 'true');
  const first = await playedAudio(page, 0);
  const url = new URL(first.plays[0].src);
  expect(url.origin + url.pathname).toBe('https://dict.youdao.com/dictvoice');
  expect(url.searchParams.get('audio')).toBe(word.headWord);
  expect(url.searchParams.get('type')).toBe('1');
  expect(first.plays[0].preload).toBe('none');
  await page.evaluate(() => window.__pronunciationAudio.instances[0].resolvePlay());
  await expect(uk).toHaveAttribute('aria-busy', 'true');
  await emitAudio(page, 0, 'playing');
  await expect(page.getByRole('status').filter({ hasText: '英音正在播放' })).toHaveCount(1);
  await expect(uk).toHaveAttribute('aria-busy', 'false');
  await emitAudio(page, 0, 'ended');
  await expect(page.getByRole('status').filter({ hasText: '正在播放' })).toHaveCount(0);
  expect((await playedAudio(page, 0)).pauses).toBeGreaterThan(0);
  await us.click();
  const second = await playedAudio(page, 1);
  expect(new URL(second.plays[0].src).searchParams.get('type')).toBe('2');
  expect(second.plays[0].preload).toBe('none');
  await emitAudio(page, 1, 'playing');
  await expect(page.getByRole('status').filter({ hasText: '美音正在播放' })).toHaveCount(1);
  await emitAudio(page, 1, 'pause');
  await expect(page.getByRole('status').filter({ hasText: '正在播放' })).toHaveCount(0);
  expect((await playedAudio(page, 1)).pauses).toBeGreaterThan(0);
  expect((await playedAudio(page, 1)).src).toBe('');
  expect(fixture.writes).toEqual([]);
  expect(fixture.unexpected).toEqual([]);
});

test('switching accents, replaying, advancing a word and navigating stop the previous audio', async ({ page, baseURL }) => {
  const fixture = await pronunciationFixture(page, baseURL);
  await page.goto(LEARN_PATH);
  await expect(page.getByRole('button', { name: '下一个', exact: true })).toBeEnabled();
  await accentButton(page, 'fetch', '英音').click();
  await accentButton(page, 'fetch', '美音').click();
  expect((await playedAudio(page, 0)).pauses).toBeGreaterThan(0);
  expect((await playedAudio(page, 0)).src).toBe('');
  await emitAudio(page, 1, 'playing');
  await page.evaluate(() => window.__pronunciationAudio.instances[0].rejectPlay('NotAllowedError'));
  await emitAudio(page, 0, 'error');
  await expect(page.getByRole('status').filter({ hasText: '美音正在播放' })).toHaveCount(1);
  await expect(page.getByText('无法播放发音，请重试', { exact: true })).toHaveCount(0);
  await expect(page.getByText('发音加载失败，请重试', { exact: true })).toHaveCount(0);
  await accentButton(page, 'fetch', '美音').click();
  expect((await playedAudio(page, 1)).pauses).toBeGreaterThan(0);
  await emitAudio(page, 2, 'playing');
  await page.getByRole('button', { name: '下一个', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'resume', exact: true })).toBeVisible();
  expect((await playedAudio(page, 2)).pauses).toBeGreaterThan(0);
  expect((await playedAudio(page, 2)).src).toBe('');
  await accentButton(page, 'resume', '英音').click();
  await emitAudio(page, 3, 'playing');
  await page.getByRole('link', { name: '查看 resume 的详情', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/books/${BOOK_ID}/words/802$`));
  await expect(accentButton(page, 'resume', '美音')).toBeVisible();
  expect((await playedAudio(page, 3)).pauses).toBeGreaterThan(0);
  expect((await playedAudio(page, 3)).src).toBe('');
  expect(fixture.writes.filter((write) => write.path.endsWith('/complete-word'))).toEqual([{ path: `${BOOK_API}/study/complete-word`, wordId: '801' }]);
  expect(fixture.unexpected).toEqual([]);
});

test('audio errors, rejected play and the loading timeout show retryable Chinese feedback', async ({ page, baseURL }) => {
  const fixture = await pronunciationFixture(page, baseURL);
  await page.goto(`/books/${BOOK_ID}/words/801`);
  const uk = accentButton(page, 'fetch', '英音');
  await expect(uk).toBeVisible();
  await page.clock.install();
  await uk.click();
  await page.evaluate(() => window.__pronunciationAudio.instances[0].rejectPlay('NotAllowedError'));
  await expect(page.getByText('无法播放发音，请重试', { exact: true })).toBeVisible();
  await uk.click();
  await emitAudio(page, 1, 'error');
  await expect(page.getByText('发音加载失败，请重试', { exact: true })).toBeVisible();
  await accentButton(page, 'fetch', '美音').click();
  await page.evaluate(() => window.__pronunciationAudio.instances[2].rejectPlay('NotSupportedError'));
  await expect(page.getByText('发音加载失败，请重试', { exact: true })).toBeVisible();
  await uk.click();
  await expect(uk).toHaveAttribute('aria-busy', 'true');
  await page.clock.fastForward(10_001);
  await expect(page.getByText('发音加载失败，请重试', { exact: true })).toBeVisible();
  expect((await playedAudio(page, 3)).pauses).toBeGreaterThan(0);
  await uk.click();
  await emitAudio(page, 4, 'playing');
  await expect(page.getByRole('status').filter({ hasText: '英音正在播放' })).toHaveCount(1);
  await expect(page.getByText('发音加载失败，请重试', { exact: true })).toHaveCount(0);
  expect(fixture.writes).toEqual([]);
  expect(fixture.unexpected).toEqual([]);
});

test('both pages keep accent controls reachable without phonetics across mobile and desktop widths', async ({ page, baseURL }, testInfo) => {
  test.setTimeout(60_000);
  const fixture = await pronunciationFixture(page, baseURL, { word: 'internationalization', noPhonetics: true });
  for (const width of [320, 375, 390, 430, 1440]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto(LEARN_PATH);
    await expect(page.getByRole('button', { name: '下一个', exact: true })).toBeEnabled();
    for (const accent of ['英音', '美音'] as const) {
      const button = accentButton(page, fixture.words[0].headWord, accent);
      await expect(button).toBeVisible();
      const bounds = await button.boundingBox();
      expect(bounds?.width).toBeGreaterThanOrEqual(44);
      expect(bounds?.height).toBeGreaterThanOrEqual(44);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`pronunciation-learn-${width}.png`), fullPage: true, scale: 'css' });
    await page.getByRole('link', { name: `查看 ${fixture.words[0].headWord} 的详情`, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/books/${BOOK_ID}/words/${fixture.words[0].id}$`));
    await expect(page.getByRole('heading', { name: '单词详情', level: 1, exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: fixture.words[0].headWord, level: 1, exact: true })).toBeVisible();
    await expect(accentButton(page, fixture.words[0].headWord, '英音')).toBeVisible();
    await expect(accentButton(page, fixture.words[0].headWord, '美音')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`pronunciation-detail-${width}.png`), fullPage: true, scale: 'css' });
  }
  expect(fixture.writes.every((write) => write.path.endsWith('/visit'))).toBe(true);
  expect(fixture.unexpected).toEqual([]);
});
