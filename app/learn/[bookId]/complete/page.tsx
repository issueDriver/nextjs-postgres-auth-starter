'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { ArrowRight, BookOpen, Check, Home, Trophy } from 'lucide-react';
import { useRequireAuth } from 'components/auth/session-provider';
import { PageHeader } from 'components/navigation/page-header';
import { buttonClass } from 'components/ui/button';
import { ProgressBar } from 'components/ui/progress-bar';
import { LoadingBlock, StatusView } from 'components/ui/states';
import type { ApiError } from 'lib/contracts/errors';
import type { StudySnapshot } from 'lib/contracts/study';
import { formatCount, formatStudyTime } from 'lib/format';
import { getStudySnapshot } from 'lib/api';

export default function CompletePage({ params }: { params: { bookId: string } }) {
  const { bookId } = params;
  const router = useRouter();
  const { status, user, onUnauthenticated } = useRequireAuth();
  const [ownedSnapshot, setOwnedSnapshot] = useState<{ owner: string; data: Extract<StudySnapshot, { state: 'completed' }> } | null>(null);
  const snapshot = user && ownedSnapshot?.owner === user.id ? ownedSnapshot.data : null;
  const [error, setError] = useState<ApiError | null>(null);
  const [attempt, setAttempt] = useState(0);
  const owner = useRef(user?.id);
  owner.current = user?.id;

  useEffect(() => {
    if (status !== 'authenticated' || !user?.id) return;
    const userId = user.id;
    let cancelled = false;
    setOwnedSnapshot(null);
    setError(null);
    void getStudySnapshot(bookId).then((result) => {
      if (cancelled || owner.current !== userId) return;
      if (!result.ok) {
        if (result.error.code === 'UNAUTHENTICATED') return onUnauthenticated();
        setError(result.error);
      } else if (result.data.state !== 'completed') {
        router.replace(`/learn/${encodeURIComponent(bookId)}`);
      } else {
        setOwnedSnapshot({ owner: userId, data: result.data });
      }
    });
    return () => { cancelled = true; };
  }, [attempt, bookId, onUnauthenticated, router, status, user?.id]);

  return (
    <div className="min-h-screen bg-white">
      <PageHeader title="学习结果" fallback="/" />
      <main className="px-6 pb-[calc(32px+env(safe-area-inset-bottom))] pt-8">
        {status !== 'authenticated' || (!snapshot && !error) ? <LoadingBlock rows={2} label="正在读取学习结果" /> : error ? (
          <StatusView title={error.message} actions={[
            ...(error.retryable ? [{ label: '重试', onClick: () => setAttempt((value) => value + 1) }] : []),
            { label: '返回首页', href: '/' },
          ]} />
        ) : snapshot && (
          <>
            <div className="pt-6 text-center">
              <div className="relative mx-auto flex h-24 w-24 items-center justify-center rounded-full border border-[#dcece2] bg-[#f0f7f2] text-emerald-700">
                <Trophy className="h-10 w-10" strokeWidth={1.5} />
                <span className="absolute -bottom-0.5 right-0 flex h-7 w-7 items-center justify-center rounded-full border-4 border-white bg-emerald-600 text-white"><Check className="h-3.5 w-3.5" strokeWidth={3} /></span>
              </div>
              <p className="mt-7 text-xs font-medium text-emerald-700">本书已完成</p>
              <h1 className="mt-3 text-[26px] font-semibold leading-tight text-[#1d2925]">每一步，都算数。</h1>
              <p className="mt-4 break-words text-sm leading-6 text-[#839087]">{snapshot.book.title}</p>
            </div>
            <section aria-label="完成进度" className="mt-10 border-y border-[#e6ebe8] py-7">
              <div className="flex items-end justify-between gap-4">
                <div>
                  <p className="text-xs text-[#8a9690]">已学单词</p>
                  <p className="mt-2 text-[34px] font-semibold leading-none tabular-nums text-[#263c31]">{formatCount(snapshot.progress.learnedCount)}<span className="ml-2 text-sm font-normal text-[#8a9690]">词</span></p>
                </div>
                <p className="text-sm font-semibold text-emerald-700">100%</p>
              </div>
              <div className="mt-5"><ProgressBar learned={snapshot.progress.learnedCount} total={snapshot.book.wordCount} label="本书已全部学完" /></div>
              <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-xs text-[#8a9690]">
                <span>已学 {formatCount(snapshot.progress.learnedCount)} / {formatCount(snapshot.book.wordCount)} 词</span>
                {snapshot.progress.completedAt && <span>完成于 {formatStudyTime(snapshot.progress.completedAt)}</span>}
              </div>
            </section>
            <div className="mt-9 space-y-3">
              <Link href={`/books/${encodeURIComponent(bookId)}`} className={buttonClass('primary', 'h-12 w-full gap-2')}><BookOpen className="h-4 w-4" />全部单词<ArrowRight className="ml-auto h-4 w-4" /></Link>
              <Link href="/" className={buttonClass('secondary', 'h-12 w-full gap-2')}><Home className="h-4 w-4" />返回首页</Link>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
