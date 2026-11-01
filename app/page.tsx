'use client';

import Link from 'next/link';
import { ArrowRight, BookOpen, Check, ChevronRight, Leaf } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useSession } from 'components/auth/session-provider';
import { BookCover } from 'components/books/book-cover';
import { BottomTabs } from 'components/navigation/bottom-tabs';
import { buttonClass } from 'components/ui/button';
import { ProgressBar } from 'components/ui/progress-bar';
import { LoadingBlock, StatusView } from 'components/ui/states';
import { loginHref } from 'lib/auth/safe-return-to';
import type { BookDTO } from 'lib/contracts/books';
import type { MyProgress } from 'lib/contracts/study';
import { formatCount, formatPercent } from 'lib/format';
import { getMyProgress, listBooks } from 'lib/api';

export default function HomePage() {
  const { status, user, setUser } = useSession();
  const [books, setBooks] = useState<BookDTO[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [booksLoading, setBooksLoading] = useState(true);
  const [booksError, setBooksError] = useState(false);
  const [progressResult, setProgressResult] = useState<{ owner: string; data: MyProgress } | null>(null);
  const progress = progressResult?.owner === user?.id ? progressResult?.data : null;
  const [progressError, setProgressError] = useState(false);
  const [progressLoading, setProgressLoading] = useState(false);
  const bookRequest = useRef(0);
  const progressRequest = useRef(0);
  const moreLock = useRef(false);

  const loadBooks = useCallback(async (after: string | null = null) => {
    if (moreLock.current) return;
    moreLock.current = true;
    const request = ++bookRequest.current;
    setBooksLoading(true);
    setBooksError(false);
    const result = await listBooks({ cursor: after, limit: 8 });
    if (request !== bookRequest.current) return;
    if (result.ok) {
      setBooks((previous) => after ? [...previous, ...result.data.books] : result.data.books);
      setCursor(result.data.nextCursor);
    } else setBooksError(true);
    setBooksLoading(false);
    moreLock.current = false;
  }, []);

  useEffect(() => {
    loadBooks();
    return () => { bookRequest.current += 1; moreLock.current = false; };
  }, [loadBooks]);

  const loadProgress = useCallback(async () => {
    const request = ++progressRequest.current;
    const owner = user?.id;
    if (!owner) { setProgressResult(null); setProgressError(false); return; }
    setProgressLoading(true);
    setProgressError(false);
    const result = await getMyProgress();
    if (request !== progressRequest.current) return;
    if (result.ok) setProgressResult({ owner, data: result.data });
    else if (result.error.code === 'UNAUTHENTICATED') setUser(null);
    else setProgressError(true);
    setProgressLoading(false);
  }, [user?.id, setUser]);

  useEffect(() => {
    setProgressResult(null);
    loadProgress();
    const onFocus = () => { loadProgress(); };
    window.addEventListener('focus', onFocus);
    return () => { progressRequest.current += 1; window.removeEventListener('focus', onFocus); };
  }, [loadProgress]);

  const hrefFor = (path: string) => user ? path : loginHref(path);
  const recent = progress?.recent;

  return (
    <div className="tab-page">
      <header className="home-header">
        <div className="brand-row">
          <div className="flex items-center gap-2.5"><span className="brand-mark"><BookOpen size={21} strokeWidth={1.7} /></span><span className="text-xl font-semibold">词间</span></div>
          <span className="brand-english">WORDSPACE</span>
        </div>
        <div className="flex items-end justify-between pb-1 pt-9">
          <div><p className="mb-2 text-xs text-slate-500">在字里行间，看见更大的世界</p><h1 className="text-[28px] font-semibold leading-tight">首页</h1></div>
          <Leaf className="mb-1 text-emerald-700" size={27} strokeWidth={1.4} aria-hidden="true" />
        </div>
      </header>

      <main>
        {user && progressLoading && !progress ? <div className="px-6"><LoadingBlock rows={1} label="学习进度加载中" /></div> : null}
        {user && progressError && <div className="px-6"><StatusView title="学习进度加载失败" compact actions={[{ label: '重试', onClick: loadProgress }]} /></div>}
        {user && recent && !progressError && (
          <section className="recent-study" aria-labelledby="recent-heading">
            <div className="mb-4 flex items-center gap-2 text-emerald-800"><span className="h-1.5 w-1.5 rounded-full bg-emerald-600" /><h2 id="recent-heading" className="text-xs font-medium">最近学习</h2></div>
            <div className="flex items-start gap-4">
              <BookCover book={recent.book} size="sm" />
              <div className="min-w-0 flex-1">
                <h3 className="text-lg font-semibold">{recent.book.title}</h3>
                <p className="mb-3 mt-2 text-xs text-slate-500">已学 <span className="font-medium text-emerald-800">{formatCount(recent.progress.learnedCount)}</span> / {formatCount(recent.book.wordCount)} 词</p>
                <ProgressBar learned={recent.progress.learnedCount} total={recent.book.wordCount} label="最近学习进度" />
                <div className="mt-3 flex items-center justify-between gap-2"><span className="text-xs text-emerald-700">{recent.progress.isCompleted ? '已完成' : formatPercent(recent.progress.learnedCount, recent.book.wordCount)}</span><Link href={`/learn/${recent.book.bookId}${recent.progress.isCompleted ? '/complete' : ''}`} className="inline-flex min-h-[44px] items-center gap-2 text-sm font-medium text-emerald-800">{recent.progress.isCompleted ? '查看学习结果' : '继续学习'}<ArrowRight size={16} /></Link></div>
              </div>
            </div>
          </section>
        )}

        <section className="book-library" aria-labelledby="library-heading">
          <div className="section-heading"><h2 id="library-heading">全部单词书</h2>{!booksLoading && !cursor && <span>{books.length} 本</span>}</div>
          {status === 'loading' || (booksLoading && books.length === 0) ? <LoadingBlock rows={4} label="单词书加载中" /> : books.length === 0 && !booksError ? <StatusView title="暂无单词书" compact /> : (
            <div>{books.map((book) => {
              const saved = progress?.books.find((item) => item.book.bookId === book.bookId)?.progress;
              const complete = saved?.isCompleted;
              const path = `/learn/${book.bookId}${complete ? '/complete' : ''}`;
              const label = user && (progressLoading || progressError || !progress) ? '进入学习' : complete ? '已完成' : saved ? '继续学习' : '开始学习';
              return (
                <article key={book.bookId} className="book-row">
                  <Link href={hrefFor(path)} className="book-main" aria-label={`${label}：${book.title}`}>
                    <BookCover book={book} />
                    <div className="min-w-0 flex-1 py-0.5">
                      <div className="mb-2.5 flex flex-wrap gap-1.5">{book.tags.map((tag) => <span className={`book-tag tag-${book.bookId.split('_')[0].toLowerCase()}`} key={tag}>{tag}</span>)}</div>
                      <h3 className="text-[17px] font-semibold leading-relaxed">{book.title}</h3>
                      <p className="mt-1.5 text-xs leading-relaxed text-slate-500">{saved ? `已学 ${formatCount(saved.learnedCount)} / ${formatCount(book.wordCount)} 词` : `共 ${formatCount(book.wordCount)} 词`}</p>
                      <span className={`mt-4 inline-flex items-center gap-1.5 text-[13px] font-medium ${complete ? 'text-slate-500' : 'text-emerald-700'}`}>{complete ? <Check size={14} /> : null}{label}{!complete && <ArrowRight size={14} />}</span>
                    </div>
                  </Link>
                  <Link href={hrefFor(`/books/${book.bookId}`)} className="catalog-link" aria-label={`${book.title}全部单词`}>全部单词<ChevronRight size={14} /></Link>
                </article>
              );
            })}</div>
          )}
          {booksError && <StatusView title="单词书加载失败" compact actions={[{ label: '重试', onClick: () => loadBooks(books.length ? cursor : null) }]} />}
          {cursor && !booksError && <button type="button" className={buttonClass('secondary', 'mt-5 w-full')} disabled={booksLoading} onClick={() => loadBooks(cursor)}>{booksLoading ? '加载中…' : '加载更多'}</button>}
          {books.length > 0 && !cursor && <div className="library-end"><span />每一个词，都是新的开始<span /></div>}
        </section>
      </main>
      <BottomTabs />
    </div>
  );
}
