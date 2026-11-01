'use client';

import { usePathname, useRouter } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { loginHref } from 'lib/auth/safe-return-to';
import { AUTH_EVENT, getSession } from 'lib/api';
import type { SessionUser } from 'lib/contracts/auth';
import { StatusView } from 'components/ui/states';

type Status = 'loading' | 'authenticated' | 'unauthenticated';

interface SessionContextValue {
  status: Status;
  user: SessionUser | null;
  /** 从服务端重新确认登录态。 */
  refresh: () => Promise<SessionUser | null>;
  /** 登录、退出或接口返回 401 后同步本地状态。 */
  setUser: (user: SessionUser | null) => void;
}

const SessionContext = createContext<SessionContextValue | null>(null);

/** 账号相关的客户端缓存统一使用该前缀，退出或换号时清理。 */
export const ACCOUNT_CACHE_PREFIX = 'vocab:account:';

function clearAccountCache() {
  for (let i = sessionStorage.length - 1; i >= 0; i--) {
    const key = sessionStorage.key(i);
    if (key?.startsWith(ACCOUNT_CACHE_PREFIX)) sessionStorage.removeItem(key);
  }
}

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<Status>('loading');
  const [user, setUserState] = useState<SessionUser | null>(null);
  const [sessionError, setSessionError] = useState(false);
  const userIdRef = useRef<string | null>(null);
  const sessionRequest = useRef(0);

  const setUser = useCallback((next: SessionUser | null) => {
    sessionRequest.current += 1;
    if (userIdRef.current !== (next?.id ?? null)) clearAccountCache();
    userIdRef.current = next?.id ?? null;
    setUserState(next);
    setSessionError(false);
    setStatus(next ? 'authenticated' : 'unauthenticated');
  }, []);

  const refresh = useCallback(async () => {
    const request = ++sessionRequest.current;
    const next = await getSession();
    if (request === sessionRequest.current) setUser(next);
    return next;
  }, [setUser]);

  useEffect(() => {
    const sync = () => { void refresh().catch(() => setSessionError(true)); };
    const channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(AUTH_EVENT);
    if (channel) channel.onmessage = sync;
    sync();
    window.addEventListener(AUTH_EVENT, sync);
    window.addEventListener('focus', sync);
    return () => {
      sessionRequest.current += 1;
      channel?.close();
      window.removeEventListener(AUTH_EVENT, sync);
      window.removeEventListener('focus', sync);
    };
  }, [refresh, setUser]);

  const value = useMemo(() => ({ status, user, refresh, setUser }), [status, user, refresh, setUser]);
  return <SessionContext.Provider value={value}>{status === 'loading' && sessionError ? <StatusView title="登录状态加载失败" actions={[{ label: '重试', onClick: () => { setSessionError(false); void refresh().catch(() => setSessionError(true)); } }]} /> : children}</SessionContext.Provider>;
}

export function useSession() {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession must be used within SessionProvider');
  return value;
}

/**
 * 受限页面守卫：未登录时转到「我的」并打开登录弹窗，保留当前页面为恢复目标。
 * 返回 `onUnauthenticated`，供接口返回 401 时调用。
 */
export function useRequireAuth() {
  const session = useSession();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (session.status === 'unauthenticated') router.replace(loginHref(pathname));
  }, [session.status, router, pathname]);

  const { setUser } = session;
  const onUnauthenticated = useCallback(() => setUser(null), [setUser]);

  return { ...session, onUnauthenticated };
}
