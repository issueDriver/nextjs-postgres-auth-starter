'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowRight, Check, ChevronDown, ChevronRight, LoaderCircle } from 'lucide-react';
import { ACCOUNT_CACHE_PREFIX, useRequireAuth } from 'components/auth/session-provider';
import { BookCover } from 'components/books/book-cover';
import { PageHeader } from 'components/navigation/page-header';
import { buttonClass } from 'components/ui/button';
import { LoadingBlock, StatusView } from 'components/ui/states';
import { ProgressBar } from 'components/ui/progress-bar';
import type { ApiError } from 'lib/contracts/errors';
import type { CatalogPage } from 'lib/contracts/words';
import { formatCount, formatPercent } from 'lib/format';
import { getCatalog } from 'lib/api';

const PAGE_SIZE = 10;

interface CatalogCache {
  page: CatalogPage;
  scrollY: number;
}

function cacheKey(userId: string, bookId: string) {
  return `${ACCOUNT_CACHE_PREFIX}${userId}:catalog:${bookId}`;
}

function readCache(key: string): CatalogCache | null {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const cache = JSON.parse(raw) as CatalogCache;
    return Array.isArray(cache.page?.items) && typeof cache.scrollY === 'number' ? cache : null;
  } catch {
    return null;
  }
}

export default function Catalog({ params }: { params: { bookId: string } }) {
  const { status, user, onUnauthenticated } = useRequireAuth();
  const userId = user?.id ?? null;
  const { bookId } = params;
  const [result, setResult] = useState<{ owner: string; page: CatalogPage } | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [moreError, setMoreError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [retry, setRetry] = useState(0);
  const request = useRef(0);
  const loadingMoreLock = useRef(false);
  const activeOwner = useRef(userId);
  activeOwner.current = userId;
  const page = result?.owner === userId ? result?.page : null;

  useEffect(() => {
    if (status !== 'authenticated' || !userId) return;
    const currentRequest = ++request.current;
    const cached = readCache(cacheKey(userId, bookId));
    const valid = () => currentRequest === request.current && activeOwner.current === userId;
    setError(null);
    setMoreError(false);
    setLoadingMore(false);
    loadingMoreLock.current = false;
    setLoading(true);

    async function load() {
      const targetCount = Math.max(PAGE_SIZE, cached?.page.items.length ?? 0);
      let nextPage: CatalogPage | null = null;
      const loadedItems: CatalogPage['items'] = [];
      do {
        const response = await getCatalog(bookId, {
          cursor: nextPage?.nextCursor,
          limit: PAGE_SIZE,
        });
        if (!valid()) return;
        if (!response.ok) {
          if (response.error.code === 'UNAUTHENTICATED') onUnauthenticated();
          else setError(response.error);
          setLoading(false);
          return;
        }
        loadedItems.push(...response.data.items);
        nextPage = {
          ...response.data,
          items: [...loadedItems],
        };
      } while (nextPage.nextCursor && nextPage.items.length < targetCount);
      if (!valid()) return;
      setResult({ owner: userId!, page: nextPage });
      setLoading(false);
      if (cached) {
        requestAnimationFrame(() => {
          if (valid()) window.scrollTo({ top: cached.scrollY, behavior: 'instant' });
        });
      }
    }

    void load();
    return () => { request.current += 1; };
  }, [bookId, userId, status, retry, onUnauthenticated]);

  const rememberPosition = useCallback(() => {
    if (!userId || !page) return;
    try {
      sessionStorage.setItem(cacheKey(userId, bookId), JSON.stringify({ page, scrollY: window.scrollY }));
    } catch {
      // The directory remains usable when browser storage is unavailable.
    }
  }, [userId, bookId, page]);

  async function loadMore() {
    if (!page?.nextCursor || !userId || loadingMoreLock.current) return;
    loadingMoreLock.current = true;
    setLoadingMore(true);
    setMoreError(false);
    const currentRequest = request.current;
    const response = await getCatalog(bookId, { cursor: page.nextCursor, limit: PAGE_SIZE });
    if (currentRequest !== request.current || activeOwner.current !== userId) return;
    loadingMoreLock.current = false;
    setLoadingMore(false);
    if (!response.ok) {
      if (response.error.code === 'UNAUTHENTICATED') onUnauthenticated();
      else setMoreError(true);
      return;
    }
    setResult({ owner: userId, page: { ...response.data, items: [...page.items, ...response.data.items] } });
  }

  const learned = page?.progress?.learnedCount ?? 0;
  const completed = page?.progress?.isCompleted ?? false;

  return (
    <>
      <PageHeader title={page?.book.title ?? '单词目录'} fallback="/" />
      <main className="pb-10">
        {status !== 'authenticated' || loading ? (
          <div className="px-6 py-6"><LoadingBlock rows={5} label="正在加载单词目录" /></div>
        ) : error ? (
          <StatusView
            title={error.code === 'NOT_FOUND' ? '内容暂不可用' : '单词目录加载失败'}
            description={error.message}
            actions={[
              ...(error.retryable ? [{ label: '重试', onClick: () => setRetry((value) => value + 1) }] : []),
              { label: '返回首页', href: '/' },
            ]}
          />
        ) : page ? (
          <>
            <section className="border-b border-[#e6ebe8] px-6 pb-7 pt-7">
              <div className="flex items-center gap-5">
                <BookCover book={page.book} size="md" />
                <div className="min-w-0 flex-1">
                  <p className="mb-2 text-xs font-medium text-[#16886b]">{page.book.tags.join(' · ') || '单词书'}</p>
                  <h2 className="break-words text-xl font-semibold leading-relaxed text-[#1d2925]">{page.book.title}</h2>
                  <p className="mt-2 text-sm text-[#7c8781]">共 {formatCount(page.book.wordCount)} 个单词</p>
                </div>
              </div>
              <div className="mb-3 mt-6 flex items-center justify-between gap-3 text-xs">
                <p className="text-[#7c8781]">已学 <span className="font-medium text-[#1d2925]">{formatCount(learned)}</span> / {formatCount(page.book.wordCount)}</p>
                <span className="font-medium text-[#16886b]">{formatPercent(learned, page.book.wordCount)}</span>
              </div>
              <ProgressBar learned={learned} total={page.book.wordCount} label="本书学习进度" />
              {page.book.wordCount > 0 ? (
                <Link
                  href={`/learn/${encodeURIComponent(bookId)}${completed ? '/complete' : ''}`}
                  className={buttonClass('primary', 'mt-5 w-full gap-2')}
                >
                  {completed ? '已完成 · 查看学习结果' : page.progress ? '继续学习' : '开始学习'}
                  {completed ? <Check className="h-4 w-4" /> : <ArrowRight className="h-4 w-4" />}
                </Link>
              ) : (
                <button type="button" disabled className={buttonClass('primary', 'mt-5 w-full')}>暂无单词</button>
              )}
            </section>
            <section className="px-6 pt-6" aria-labelledby="all-words-heading">
              <div className="mb-2 flex items-center justify-between gap-3">
                <h2 id="all-words-heading" className="text-base font-semibold text-[#1d2925]">全部单词</h2>
                <span className="text-xs text-[#9aa39e]">{formatCount(page.book.wordCount)} 词</span>
              </div>
              {page.items.length === 0 ? (
                <StatusView title="本书暂无单词" compact actions={[{ label: '返回书库', href: '/' }]} />
              ) : (
                <ol className="divide-y divide-[#edf0ee]">
                  {page.items.map((word) => (
                    <li key={word.id}>
                      <Link
                        href={`/books/${encodeURIComponent(bookId)}/words/${word.id}`}
                        onClick={rememberPosition}
                        className="group flex min-h-[82px] items-center gap-3 py-4 transition-colors hover:bg-[#f6f8f7]"
                      >
                        <span className="w-7 shrink-0 self-start pt-1 text-xs tabular-nums text-[#a5ada9]">{String(word.orderIndex + 1).padStart(2, '0')}</span>
                        <div className="min-w-0 flex-1">
                          <p lang="en" className="break-words text-[17px] font-medium leading-6 text-[#1d2925]">{word.headWord}</p>
                          <p className="mt-1 break-words text-[13px] leading-5 text-[#7c8781]">
                            {word.shortDefinition.pos && <span className="mr-1.5 font-serif italic text-[#9aa39e]">{word.shortDefinition.pos}</span>}
                            {word.shortDefinition.text}
                          </p>
                        </div>
                        {word.isLearned ? (
                          <span className="flex shrink-0 items-center gap-1 text-[11px] text-[#16886b]"><Check className="h-3.5 w-3.5" />已学</span>
                        ) : (
                          <ChevronRight className="h-4 w-4 shrink-0 text-[#a5ada9] transition-transform group-hover:translate-x-0.5" />
                        )}
                      </Link>
                    </li>
                  ))}
                </ol>
              )}
              {moreError && <p role="alert" className="mb-3 mt-4 text-center text-sm text-[#be5d4e]">加载失败，请重试</p>}
              {page.nextCursor ? (
                <button type="button" onClick={loadMore} disabled={loadingMore} className={buttonClass('secondary', 'mt-5 w-full gap-2')}>
                  {loadingMore ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <ChevronDown className="h-4 w-4" />}
                  {loadingMore ? '加载中' : moreError ? '重新加载' : '加载更多单词'}
                </button>
              ) : page.items.length > 0 ? (
                <p className="pt-7 text-center text-xs text-[#a5ada9]">已显示全部 {formatCount(page.items.length)} 个单词</p>
              ) : null}
            </section>
          </>
        ) : null}
      </main>
    </>
  );
}
