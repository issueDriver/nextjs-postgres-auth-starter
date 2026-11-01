'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowRight, BookOpen, Check, LogOut, UserRound } from 'lucide-react';
import { AuthSheet } from 'components/auth/auth-sheet';
import { useSession } from 'components/auth/session-provider';
import { BookCover } from 'components/books/book-cover';
import { BottomTabs } from 'components/navigation/bottom-tabs';
import { TabPageHeader } from 'components/navigation/page-header';
import { buttonClass } from 'components/ui/button';
import { ProgressBar } from 'components/ui/progress-bar';
import { LoadingBlock, StatusView } from 'components/ui/states';
import { parseReturnTo, targetPath, type ReturnTarget } from 'lib/auth/safe-return-to';
import type { MyProgress } from 'lib/contracts/study';
import { formatCount, formatPercent, formatStudyTime } from 'lib/format';
import { getMyProgress, isTargetAvailable, logout } from 'lib/api';

export function MeClient() {
  const router = useRouter();
  const params = useSearchParams();
  const { status, user, setUser, refresh } = useSession();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [initialMode, setInitialMode] = useState<'login' | 'register'>('login');
  const [progressResult, setProgressResult] = useState<{ owner: string; data: MyProgress } | null>(null);
  const progress = progressResult?.owner === user?.id ? progressResult?.data : null;
  const [loading, setLoading] = useState(true);
  const [progressError, setProgressError] = useState(false);
  const [notice, setNotice] = useState('');
  const [loggingOut, setLoggingOut] = useState(false);
  const pendingTarget = useRef<ReturnTarget | null>(null);
  const handledQuery = useRef<string | null>(null);
  const request = useRef(0);
  const authNavigation = useRef(0);
  const mounted = useRef(true);
  const logoutLock = useRef(false);
  const userId = useRef(user?.id);
  userId.current = user?.id;

  const authMode = params.get('auth');
  const returnTo = params.get('returnTo');

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; authNavigation.current += 1; };
  }, []);

  useEffect(() => {
    pendingTarget.current = parseReturnTo(returnTo);
    if (status === 'loading') return;
    if (authMode !== 'login' && authMode !== 'register') {
      handledQuery.current = null;
      return;
    }
    const queryKey = `${authMode}:${returnTo ?? ''}`;
    if (handledQuery.current === queryKey) return;
    handledQuery.current = queryKey;
    if (status === 'unauthenticated') {
      setInitialMode(authMode);
      setSheetOpen(true);
    }
  }, [authMode, returnTo, status]);

  const loadProgress = useCallback(async () => {
    if (!user?.id) return;
    const owner = user.id;
    const sequence = ++request.current;
    setLoading(true);
    setProgressError(false);
    try {
      const result = await getMyProgress();
      if (sequence !== request.current || userId.current !== owner) return;
      if (result.ok) setProgressResult({ owner, data: result.data });
      else if (result.error.code === 'UNAUTHENTICATED') setUser(null);
      else setProgressError(true);
    } catch {
      if (sequence === request.current && userId.current === owner) setProgressError(true);
    } finally {
      if (sequence === request.current && userId.current === owner) setLoading(false);
    }
  }, [user?.id, setUser]);

  useEffect(() => {
    setProgressResult(null);
    setProgressError(false);
    if (status === 'authenticated') void loadProgress();
    else setLoading(false);
    return () => { request.current += 1; };
  }, [status, loadProgress]);

  useEffect(() => {
    const owner = user?.id;
    const onFocus = async () => {
      try {
        const current = await refresh();
        if (current?.id === owner && owner) void loadProgress();
      } catch { /* Keep the current view available until a normal request can retry. */ }
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [refresh, loadProgress, user?.id]);

  const onAuthenticated = useCallback(async () => {
    const navigation = ++authNavigation.current;
    const target = pendingTarget.current;
    pendingTarget.current = null;
    setSheetOpen(false);
    setNotice('');
    if (target) {
      try {
        const available = await isTargetAvailable(target.bookId, target.kind === 'detail' ? target.wordId : undefined);
        if (!mounted.current || navigation !== authNavigation.current) return;
        if (available) {
          router.replace(targetPath(target));
          return;
        }
      } catch { /* The account is still available when its target cannot be loaded. */ }
      if (!mounted.current || navigation !== authNavigation.current) return;
      setNotice('内容暂不可用');
    }
    router.replace('/me');
  }, [router]);

  async function signOut() {
    if (logoutLock.current || !user) return;
    logoutLock.current = true;
    authNavigation.current += 1;
    const owner = user.id;
    setLoggingOut(true);
    setNotice('');
    try {
      const result = await logout();
      if (userId.current !== owner) return;
      if (result.ok) {
        request.current += 1;
        setProgressResult(null);
        pendingTarget.current = null;
        setUser(null);
        router.replace('/me');
      } else setNotice('退出登录失败，请重试');
    } catch {
      if (userId.current === owner) setNotice('退出登录失败，请重试');
    } finally {
      logoutLock.current = false;
      if (mounted.current) setLoggingOut(false);
    }
  }

  return (
    <>
      <div className="tab-page">
        <TabPageHeader title="我的" />
        <main className="px-6 pb-8">
          {status === 'loading' ? <LoadingBlock rows={2} label="正在确认登录状态" /> : status === 'unauthenticated' ? (
            <section className="flex min-h-[390px] flex-col items-center justify-center pb-12 text-center">
              <div className="mb-5 flex h-20 w-20 items-center justify-center rounded-full bg-[#edf4f0] text-[#7f9c8d]">
                <UserRound size={34} strokeWidth={1.5} />
              </div>
              <h2 className="mb-7 text-xl font-semibold text-[#1d2925]">未登录</h2>
              <button
                data-auth-trigger
                type="button"
                className={buttonClass('primary', 'w-full max-w-[240px] gap-3')}
                onClick={() => { setInitialMode('login'); setSheetOpen(true); setNotice(''); }}
              >
                登录 / 注册 <ArrowRight size={17} />
              </button>
            </section>
          ) : (
            <>
              <section aria-label="账号信息" className="flex items-center gap-3 border-b border-[#e6ebe8] pb-7 pt-4">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[#e8f3ed] text-[#16886b]">
                  <UserRound size={23} strokeWidth={1.6} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="mb-1 text-xs text-[#819087]">学习者</p>
                  <p className="break-all text-[15px] font-medium text-[#1d2925]">{user?.email}</p>
                </div>
                <button type="button" onClick={signOut} disabled={loggingOut} title={loggingOut ? '正在退出' : '退出登录'} aria-label="退出登录" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-[#6e7b73] hover:bg-[#f1f5f2] disabled:opacity-40">
                  <LogOut size={19} />
                </button>
              </section>

              <section aria-labelledby="progress-title" className="pt-7">
                <div className="mb-6 flex items-center gap-2">
                  <BookOpen size={18} className="text-[#16886b]" />
                  <h2 id="progress-title" className="text-[17px] font-semibold text-[#1d2925]">学习进度</h2>
                </div>
                {loading ? <LoadingBlock rows={2} label="正在加载学习进度" /> : progressError ? (
                  <StatusView compact title="学习进度加载失败" actions={[{ label: '重试', onClick: () => void loadProgress() }]} />
                ) : progress ? (
                  <>
                    <dl className="mb-5 grid grid-cols-3 border-b border-[#e6ebe8] pb-7">
                      {[
                        { label: '累计已学', value: progress.summary.totalLearned, color: 'text-[#1d2925]' },
                        { label: '学习中', value: progress.summary.learningBooks, color: 'text-[#16886b]' },
                        { label: '已完成', value: progress.summary.completedBooks, color: 'text-[#c97864]' },
                      ].map((stat, index) => (
                        <div key={stat.label} className={`text-center ${index ? 'border-l border-[#e6ebe8]' : ''}`}>
                          <dd className={`mb-2 text-[28px] font-semibold leading-none tabular-nums ${stat.color}`}>{formatCount(stat.value)}</dd>
                          <dt className="text-xs text-[#819087]">{stat.label}</dt>
                        </div>
                      ))}
                    </dl>
                    {progress.books.length === 0 ? (
                      <StatusView title="暂无学习记录" actions={[{ label: '去选书', href: '/' }]} />
                    ) : (
                      <div>
                        {progress.books.map(({ book, progress: item }) => (
                          <article key={book.bookId} className="border-b border-[#e6ebe8] py-5 last:border-b-0">
                            <div className="mb-4 flex items-center gap-4">
                              <BookCover book={book} size="sm" />
                              <div className="min-w-0 flex-1">
                                <h3 className="mb-2 break-words text-[16px] font-semibold text-[#1d2925]">{book.title}</h3>
                                <div className="flex flex-wrap items-center gap-2 text-xs text-[#819087]">
                                  <span>已学 {formatCount(item.learnedCount)} / {formatCount(item.totalWords)}</span>
                                  {item.isCompleted && <span className="inline-flex items-center gap-1 text-[#16886b]"><Check size={13} />已完成</span>}
                                </div>
                              </div>
                              <span className="shrink-0 text-sm font-medium tabular-nums text-[#16886b]">{formatPercent(item.learnedCount, item.totalWords)}</span>
                            </div>
                            <ProgressBar learned={item.learnedCount} total={item.totalWords} label={`${book.title}学习进度`} />
                            <div className="mt-3 flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
                              <p className="text-[11px] text-[#8a968e]">最近学习：{formatStudyTime(item.lastStudiedAt)}</p>
                              <Link href={`/learn/${book.bookId}${item.isCompleted ? '/complete' : ''}`} className="inline-flex min-h-[44px] items-center gap-1 text-sm font-medium text-[#16886b]">
                                {item.isCompleted ? '查看学习结果' : '继续学习'} <ArrowRight size={15} />
                              </Link>
                            </div>
                          </article>
                        ))}
                      </div>
                    )}
                  </>
                ) : null}
              </section>
            </>
          )}
          {notice && <p role="alert" className="mt-4 rounded-lg bg-[#fff2ed] px-4 py-3 text-sm text-[#a25340]">{notice}</p>}
        </main>
        <BottomTabs />
      </div>
      {sheetOpen && <AuthSheet initialMode={initialMode} onClose={() => setSheetOpen(false)} onAuthenticated={onAuthenticated} />}
    </>
  );
}
