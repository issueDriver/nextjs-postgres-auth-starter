import { expect, test, type APIResponse, type Page } from '@playwright/test';
import type { BookDTO, BookPage } from '../../lib/contracts/books';
import type { ApiResult } from '../../lib/contracts/errors';

async function publishedBooks(page: Page): Promise<BookDTO[]> {
  const books: BookDTO[] = [];
  let cursor: string | null = null;
  do {
    const response: APIResponse = await page.request.get('/api/books', { params: { limit: 100, ...(cursor ? { cursor } : {}) } });
    expect(response.ok()).toBe(true);
    const result: ApiResult<BookPage> = await response.json();
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    books.push(...result.data.books);
    cursor = result.data.nextCursor;
  } while (cursor);
  return books;
}

test('published database books render their real titles, counts and available covers', async ({ page }, testInfo) => {
  const books = await publishedBooks(page);
  test.skip(books.length === 0, 'The connected database has no published vocabulary books.');
  const first = books[0];
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  for (const width of [320, 375, 390, 430, 1440]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/');
    await expect(page.getByRole('heading', { name: first.title, exact: true })).toBeVisible();
    await expect(page.getByRole('navigation', { name: '主导航' })).toBeVisible();
    await expect(page.getByText('最近学习', { exact: true })).toHaveCount(0);
    const firstBook = page.locator('.book-row').first();
    await expect(firstBook).toContainText(new Intl.NumberFormat('zh-CN').format(first.wordCount));
    await expect(firstBook.getByRole('img', { name: `${first.title}封面` })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect((await page.locator('.app-shell').boundingBox())?.width).toBe(Math.min(width, 480));
    const renderedCover = firstBook.locator('.book-cover img');
    if (await renderedCover.count()) {
      expect(new URL(await renderedCover.getAttribute('src') ?? '').protocol).toBe('https:');
      expect(new URL(await renderedCover.getAttribute('src') ?? '').href).toBe(new URL(first.coverUrl.trim()).href);
    }
    await expect.poll(async () => await renderedCover.count() === 0 || await renderedCover.evaluate((image) => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`real-home-${width}.png`), fullPage: true });
  }
  expect(errors).toEqual([]);
});

test('guest selection and direct protected routes open login with a real book target', async ({ page }) => {
  const books = await publishedBooks(page);
  test.skip(books.length === 0, 'The connected database has no published vocabulary books.');
  const book = books[0];
  await page.goto('/');
  await expect(page.getByRole('heading', { name: book.title, exact: true })).toBeVisible();
  await page.locator('.book-main').first().click();
  await expect(page.getByRole('dialog', { name: '登录', exact: true })).toBeVisible();
  expect(new URL(page.url()).searchParams.get('returnTo')).toBe(`/learn/${encodeURIComponent(book.bookId)}`);
  await page.getByRole('button', { name: '关闭登录弹窗', exact: true }).click();
  await expect(page.getByRole('heading', { name: '未登录', exact: true })).toBeVisible();
  await page.goto(`/books/${encodeURIComponent(book.bookId)}`);
  await expect(page.getByRole('dialog', { name: '登录', exact: true })).toBeVisible();
  expect(new URL(page.url()).searchParams.get('returnTo')).toBe(`/books/${encodeURIComponent(book.bookId)}`);
  for (const endpoint of [
    '/api/me/progress',
    `/api/books/${encodeURIComponent(book.bookId)}/words`,
    `/api/books/${encodeURIComponent(book.bookId)}/study`,
  ]) {
    const denied = await page.request.get(endpoint);
    expect(denied.status()).toBe(401);
    const result: ApiResult<unknown> = await denied.json();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('UNAUTHENTICATED');
  }
});
