'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowRight, BookOpen, Check, ChevronRight, List, Loader2, RefreshCw } from 'lucide-react';
import { useRequireAuth } from 'components/auth/session-provider';
import { PageHeader } from 'components/navigation/page-header';
import { buttonClass } from 'components/ui/button';
import { ProgressBar } from 'components/ui/progress-bar';
import { LoadingBlock, StatusView } from 'components/ui/states';
import { Pronunciation } from 'components/words/pronunciation';
import type { ApiError } from 'lib/contracts/errors';
import type { StudySnapshot } from 'lib/contracts/study';
import { formatCount } from 'lib/format';
import { completeWord, getStudySnapshot, visitStudy } from 'lib/api';

type Phase = 'loading' | 'visiting' | 'visit-error' | 'ready' | 'saving' | 'loading-next' | 'next-error' | 'error';

export default function LearnPage({ params }: { params: { bookId: string } }) {
  const { bookId } = params;
  const router = useRouter();
  const { status, user, onUnauthenticated } = useRequireAuth();
  const [ownedSnapshot, setOwnedSnapshot] = useState<{ owner: string; data: StudySnapshot } | null>(null);
  const snapshot = user && ownedSnapshot?.owner === user.id ? ownedSnapshot.data : null;
  const [phase, setPhase] = useState<Phase>('loading');
  const [error, setError] = useState<ApiError | null>(null);
  const [notice, setNotice] = useState('');
  const mounted = useRef(false);
  const request = useRef(0);
  const locked = useRef(false);
  const userId = useRef(user?.id);
  const latest = useRef(snapshot);
  userId.current = user?.id;
  latest.current = snapshot;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      request.current += 1;
    };
  }, []);

  const load = useCallback(async (registerVisit: boolean, loadingNext = false) => {
    if (!user?.id) return;
    const owner = user.id;
    const sequence = ++request.current;
    locked.current = true;
    setPhase(loadingNext ? 'loading-next' : 'loading');
    setError(null);
    const result = await getStudySnapshot(bookId);
    if (!mounted.current || sequence !== request.current || owner !== userId.current) return;
    if (!result.ok) {
      locked.current = false;
      if (result.error.code === 'UNAUTHENTICATED') return onUnauthenticated();
      setError(result.error);
      setPhase(loadingNext ? 'next-error' : 'error');
      return;
    }
    if (result.data.state === 'completed') {
      router.replace(`/learn/${encodeURIComponent(bookId)}/complete`);
      return;
    }
    const previousRevision = latest.current?.progress?.revision;
    if (previousRevision !== undefined && result.data.progress?.revision !== previousRevision) {
      setNotice('学习进度已更新');
    }
    setOwnedSnapshot({ owner, data: result.data });
    setPhase(registerVisit ? 'visiting' : 'ready');
    locked.current = registerVisit;
  }, [bookId, onUnauthenticated, router, user?.id]);

  useEffect(() => {
    setOwnedSnapshot(null);
    setNotice('');
    if (status === 'authenticated') void load(true);
    return () => {
      request.current += 1;
      locked.current = false;
    };
  }, [load, status]);

  // Register a visit only after the current card has been rendered.
  useEffect(() => {
    if (phase !== 'visiting' || snapshot?.state !== 'learning' || !user?.id) return;
    const owner = user.id;
    const sequence = request.current;
    let cancelled = false;
    void visitStudy(bookId, {
      wordId: snapshot.currentWord.id,
      bookVersion: snapshot.book.bookVersion,
      expectedRevision: snapshot.progress?.revision ?? 0,
    }).then((result) => {
      if (cancelled || !mounted.current || sequence !== request.current || owner !== userId.current) return;
      locked.current = false;
      if (!result.ok) {
        if (result.error.code === 'UNAUTHENTICATED') return onUnauthenticated();
        if (result.error.code === 'PROGRESS_CONFLICT') {
          setNotice('学习进度已更新');
          void load(true);
          return;
        }
        setError(result.error);
        setPhase('visit-error');
        return;
      }
      setOwnedSnapshot({ owner, data: { ...snapshot, progress: result.data } });
      setPhase('ready');
    });
    return () => { cancelled = true; };
  }, [bookId, load, onUnauthenticated, phase, snapshot, user?.id]);

  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === 'visible' && !locked.current && phase === 'ready') void load(false);
    };
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, [load, phase]);

  async function advance() {
    if (locked.current || phase !== 'ready' || snapshot?.state !== 'learning' || !user?.id) return;
    locked.current = true;
    const owner = user.id;
    const sequence = ++request.current;
    setPhase('saving');
    setError(null);
    setNotice('');
    const result = await completeWord(bookId, {
      wordId: snapshot.currentWord.id,
      bookVersion: snapshot.book.bookVersion,
      expectedRevision: snapshot.progress?.revision ?? 0,
    });
    if (!mounted.current || sequence !== request.current || owner !== userId.current) return;
    if (!result.ok) {
      locked.current = false;
      if (result.error.code === 'UNAUTHENTICATED') return onUnauthenticated();
      if (result.error.code === 'PROGRESS_CONFLICT') {
        setNotice('学习进度已更新');
        void load(false);
        return;
      }
      setError(result.error);
      setPhase(result.error.retryable ? 'ready' : 'error');
      return;
    }
    if (result.data.state === 'completed') {
      router.replace(`/learn/${encodeURIComponent(bookId)}/complete`);
      return;
    }
    setOwnedSnapshot({ owner, data: { ...snapshot, progress: result.data.progress } });
    if (!result.data.nextWord) {
      locked.current = false;
      setPhase('next-error');
      setNotice('进度已保存');
      return;
    }
    setOwnedSnapshot({ owner, data: { ...snapshot, progress: result.data.progress, currentWord: result.data.nextWord } });
    locked.current = false;
    setPhase('ready');
  }

  const learning = snapshot?.state === 'learning' ? snapshot : null;
  const learned = snapshot?.progress?.learnedCount ?? 0;
  const total = snapshot?.book.wordCount ?? 0;
  const showCard = learning && !['loading', 'error', 'loading-next', 'next-error'].includes(phase);
  const waiting = status !== 'authenticated' || phase === 'loading' || (!snapshot && phase !== 'error');
  const isLast = !!learning && learning.currentWord.orderIndex === total - 1;
  const currentOrdinal = phase === 'next-error' || phase === 'loading-next'
    ? Math.min(learned + 1, total)
    : learning ? learning.currentWord.orderIndex + 1 : total;

  return (
    <div className="min-h-screen bg-[#f6f8f7]">
      <PageHeader
        title={snapshot?.book.title ?? '单词学习'}
        fallback="/"
        right={snapshot && (
          <Link href={`/books/${encodeURIComponent(bookId)}`} title="全部单词" aria-label="全部单词" className="flex h-11 w-11 items-center justify-center text-[#66766e] hover:text-emerald-700">
            <List className="h-5 w-5" />
          </Link>
        )}
      />
      <main className="px-5 pb-[calc(128px+env(safe-area-inset-bottom))] pt-6">
        {waiting ? <LoadingBlock rows={2} label="正在加载单词" /> : phase === 'error' ? (
          <StatusView
            title={error?.message ?? '单词加载失败'}
            actions={[
              ...(error?.retryable ? [{ label: '重试', onClick: () => void load(true) }] : []),
              { label: '返回首页', href: '/' },
            ]}
          />
        ) : snapshot && (
          <>
            <div className="mb-3 flex items-center justify-between gap-3 text-xs text-[#76847d]">
              <p>当前 <span className="ml-1 text-base font-semibold tabular-nums text-[#263d32]">{formatCount(currentOrdinal)}</span><span className="mx-1">/</span>{formatCount(total)}</p>
              <p className="flex items-center gap-1.5"><Check className="h-3.5 w-3.5 text-emerald-600" />已学 {formatCount(learned)} 词</p>
            </div>
            <ProgressBar learned={learned} total={total} label="本书学习进度" />
            {notice && <p role="status" className="mt-4 text-center text-sm text-emerald-700">{notice}</p>}
            {showCard && (
              <article className="mt-7 overflow-hidden rounded-lg border border-[#e6ebe8] bg-white px-5 pb-8 pt-8 shadow-[0_3px_14px_rgba(29,41,37,0.025)]">
                <div className="mb-8 flex items-center gap-2 text-[10px] font-medium text-[#8a9990]">
                  <BookOpen className="h-3.5 w-3.5" />单词 {String(learning.currentWord.orderIndex + 1).padStart(2, '0')}
                </div>
                <Link href={`/books/${encodeURIComponent(bookId)}/words/${learning.currentWord.id}`} className="group block py-2 text-center" aria-label={`查看 ${learning.currentWord.headWord} 的详情`}>
                  <div className="flex min-w-0 items-center justify-center gap-1.5">
                    <h2 className="min-w-0 break-words text-[30px] font-semibold leading-[1.35] text-[#1d2925] [overflow-wrap:anywhere]">{learning.currentWord.headWord}</h2>
                    <ChevronRight className="h-4 w-4 shrink-0 text-[#a4b0a9] transition-transform group-hover:translate-x-0.5" />
                  </div>
                  {learning.currentWord.phonetic && <p className="mt-3 break-words text-sm text-[#8a9690] [overflow-wrap:anywhere]">/{learning.currentWord.phonetic}/</p>}
                </Link>
                <Pronunciation key={learning.currentWord.id} word={learning.currentWord.headWord} centered />
                <p className="mt-6 break-words text-center text-base leading-7 text-[#34483d]">
                  {learning.currentWord.definition.pos && <span className="mr-2 font-serif italic text-[#8a9690]">{learning.currentWord.definition.pos}</span>}
                  {learning.currentWord.definition.text}
                </p>
                {learning.currentWord.example && (
                  <div className="mt-10 border-t border-[#edf0ee] pt-6">
                    <p className="mb-3 text-[10px] font-semibold text-[#9aa69f]">例句</p>
                    <p className="break-words text-[16px] leading-7 text-[#36483f] [overflow-wrap:anywhere]">{learning.currentWord.example.en}</p>
                    {learning.currentWord.example.zh && <p className="mt-3 break-words text-sm leading-6 text-[#89958e]">{learning.currentWord.example.zh}</p>}
                  </div>
                )}
              </article>
            )}
            {(phase === 'loading-next' || phase === 'next-error') && (
              <div className="mt-7 rounded-lg border border-[#e6ebe8] bg-white px-5 py-10">
                <div className="mx-auto mb-4 flex h-11 w-11 items-center justify-center rounded-full bg-emerald-50 text-emerald-600"><Check className="h-5 w-5" /></div>
                <StatusView compact title={phase === 'loading-next' ? '正在加载下一个单词' : '下一个单词加载失败'} description="当前学习进度已保存" />
              </div>
            )}
          </>
        )}
      </main>
      {status === 'authenticated' && phase !== 'error' && (
        <div className="fixed inset-x-0 bottom-0 z-20 mx-auto max-w-[480px] border-t border-[#e6ebe8] bg-white px-5 pb-[calc(20px+env(safe-area-inset-bottom))] pt-4">
          {error && phase !== 'next-error' && <p role="alert" className="mb-3 text-center text-sm text-red-600">{phase === 'visit-error' ? '学习记录保存失败，请重试' : '进度保存失败，请重试'}</p>}
          <button
            type="button"
            disabled={waiting || phase === 'visiting' || phase === 'saving' || phase === 'loading-next'}
            onClick={() => {
              if (phase === 'next-error') void load(false, true);
              else if (phase === 'visit-error') void load(true);
              else void advance();
            }}
            className={buttonClass('primary', 'h-12 w-full gap-2')}
          >
            {phase === 'saving' || phase === 'visiting' || phase === 'loading-next' || waiting ? (
              <><Loader2 className="h-4 w-4 animate-spin" />{phase === 'saving' ? '保存中…' : '加载中…'}</>
            ) : phase === 'next-error' || phase === 'visit-error' ? (
              <><RefreshCw className="h-4 w-4" />{phase === 'next-error' ? '重新加载' : '重试'}</>
            ) : (
              <>{isLast ? '完成本书' : '下一个'}{isLast ? <Check className="h-4 w-4" /> : <ArrowRight className="h-4 w-4" />}</>
            )}
          </button>
        </div>
      )}
    </div>
  );
}
