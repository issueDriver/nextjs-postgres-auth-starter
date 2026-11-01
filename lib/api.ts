'use client';

import { loginAction, logoutAction, registerAction } from 'app/actions/auth';
import type { AuthResult, SessionUser } from 'lib/contracts/auth';
import type { BookPage } from 'lib/contracts/books';
import type { ApiResult } from 'lib/contracts/errors';
import type { AdvanceResult, BookProgressLookup, MyProgress, ProgressDTO, StudySnapshot, StudyWriteRequest } from 'lib/contracts/study';
import type { CatalogPage, WordDetailResult } from 'lib/contracts/words';

export const AUTH_EVENT = 'wordspace:auth';

function failure<T>(): ApiResult<T> {
  return { ok: false, error: { code: 'SERVICE_UNAVAILABLE', message: '网络连接失败，请重试', retryable: true }, requestId: 'network' };
}

async function request<T>(path: string, body?: unknown): Promise<ApiResult<T>> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(path, {
      method: body === undefined ? 'GET' : 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      signal: controller.signal,
      ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
    });
    const data = await response.json() as ApiResult<T>;
    if (!data || typeof data.ok !== 'boolean' || (!data.ok && !data.error)) return failure();
    return data;
  } catch {
    return failure();
  } finally {
    window.clearTimeout(timeout);
  }
}

function query(params: { cursor?: string | null; limit?: number }) {
  const search = new URLSearchParams();
  if (params.cursor) search.set('cursor', params.cursor);
  if (params.limit !== undefined) search.set('limit', String(params.limit));
  return search.size ? `?${search}` : '';
}

function bookPath(bookId: string) { return `/api/books/${encodeURIComponent(bookId)}`; }

function notifyAuthChange() {
  window.dispatchEvent(new Event(AUTH_EVENT));
  if (typeof BroadcastChannel !== 'undefined') {
    const channel = new BroadcastChannel(AUTH_EVENT);
    channel.postMessage('changed');
    channel.close();
  }
}

export async function getSession(): Promise<SessionUser | null> {
  const response = await fetch('/api/auth/session', { credentials: 'same-origin', cache: 'no-store' });
  if (!response.ok) throw new Error('SESSION_UNAVAILABLE');
  const session = await response.json() as { user?: { id?: unknown; email?: unknown } } | null;
  if (!session?.user) return null;
  const { id, email } = session.user;
  if (typeof id !== 'string' || !/^\d+$/.test(id) || typeof email !== 'string') return null;
  return { id, email };
}

export async function login(email: string, password: string): Promise<AuthResult> {
  const result = await loginAction(email, password);
  if (result.ok) notifyAuthChange();
  return result;
}

export function register(email: string, password: string) { return registerAction(email, password); }

export async function logout() {
  const result = await logoutAction();
  if (result.ok) notifyAuthChange();
  return result;
}

export function listBooks(params: { cursor?: string | null; limit?: number } = {}) { return request<BookPage>(`/api/books${query(params)}`); }
export function getMyProgress() { return request<MyProgress>('/api/me/progress'); }
export function getBooksProgress(bookIds: string[]) {
  const search = new URLSearchParams();
  bookIds.forEach((id) => search.append('bookId', id));
  return request<BookProgressLookup[]>(`/api/me/progress/books?${search}`);
}
export function getCatalog(bookId: string, params: { cursor?: string | null; limit?: number } = {}) { return request<CatalogPage>(`${bookPath(bookId)}/words${query(params)}`); }
export function getWordDetail(bookId: string, wordId: string) { return request<WordDetailResult>(`${bookPath(bookId)}/words/${encodeURIComponent(wordId)}`); }
export function getStudySnapshot(bookId: string) { return request<StudySnapshot>(`${bookPath(bookId)}/study`); }
export function visitStudy(bookId: string, body: StudyWriteRequest) { return request<ProgressDTO>(`${bookPath(bookId)}/study/visit`, body); }
export function completeWord(bookId: string, body: StudyWriteRequest) { return request<AdvanceResult>(`${bookPath(bookId)}/study/complete-word`, body); }
export async function isTargetAvailable(bookId: string, wordId?: string): Promise<boolean> {
  const result = wordId ? await getWordDetail(bookId, wordId) : await getCatalog(bookId, { limit: 1 });
  return result.ok;
}
