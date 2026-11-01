'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowRight, Eye, EyeOff, Mail, X } from 'lucide-react';
import { useSession } from './session-provider';
import { buttonClass } from 'components/ui/button';
import { login, register } from 'lib/api';

interface AuthSheetProps {
  initialMode: 'login' | 'register';
  onClose: () => void;
  onAuthenticated: () => Promise<void>;
}

type FormError = { field?: 'email' | 'password'; message: string } | null;

export function AuthSheet({ initialMode, onClose, onAuthenticated }: AuthSheetProps) {
  const { refresh } = useSession();
  const [mode, setMode] = useState(initialMode);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<FormError>(null);
  const [success, setSuccess] = useState('');
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(true);
  const overlayRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const sequence = useRef(0);
  const submitting = useRef(false);
  const historyEntryCreated = useRef(false);
  const callbacks = useRef({ onClose, onAuthenticated });
  callbacks.current = { onClose, onAuthenticated };

  useEffect(() => {
    let active = true;
    void refresh().then(async (session) => {
      if (!active) return;
      if (session) {
        consumeHistory();
        await callbacks.current.onAuthenticated();
      } else {
        setChecking(false);
      }
    }).catch(() => { if (active) setChecking(false); });
    return () => { active = false; sequence.current += 1; };
  }, [refresh]);

  useEffect(() => {
    if (!checking) emailRef.current?.focus();
  }, [checking]);

  useEffect(() => {
    const focused = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const inertElements = Array.from(document.body.children).filter(
      (element) => !element.contains(overlayRef.current) && !['SCRIPT', 'STYLE'].includes(element.tagName)
    ).map((element) => ({ element, inert: element.hasAttribute('inert'), hidden: element.getAttribute('aria-hidden') }));
    inertElements.forEach(({ element }) => { element.setAttribute('inert', ''); element.setAttribute('aria-hidden', 'true'); });

    // A dedicated history entry makes Back close the sheet even on a direct URL.
    if (!historyEntryCreated.current) {
      historyEntryCreated.current = true;
      const cleanUrl = new URL(window.location.href);
      cleanUrl.searchParams.delete('auth');
      const modalUrl = new URL(cleanUrl);
      modalUrl.searchParams.set('auth', initialMode);
      window.history.replaceState(window.history.state, '', cleanUrl.pathname + cleanUrl.search);
      window.history.pushState({ ...window.history.state, __vocabAuthSheet: true }, '', modalUrl.pathname + modalUrl.search);
    }

    const onPop = () => {
      sequence.current += 1;
      callbacks.current.onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
      }
      if (event.key !== 'Tab') return;
      const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), [tabindex="0"]') ?? []);
      if (!focusable.length) { event.preventDefault(); dialogRef.current?.focus(); return; }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault(); first.focus();
      }
    };
    window.addEventListener('popstate', onPop);
    document.addEventListener('keydown', onKeyDown);
    dialogRef.current?.focus();

    return () => {
      document.body.style.overflow = overflow;
      inertElements.forEach(({ element, inert, hidden }) => {
        if (!inert) element.removeAttribute('inert');
        if (hidden === null) element.removeAttribute('aria-hidden');
        else element.setAttribute('aria-hidden', hidden);
      });
      window.removeEventListener('popstate', onPop);
      document.removeEventListener('keydown', onKeyDown);
      if (focused?.isConnected && focused !== document.body) focused.focus();
      else document.querySelector<HTMLElement>('[data-auth-trigger]')?.focus();
    };
    // The entry belongs to this sheet instance and is not recreated on form changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function consumeHistory() {
    const url = new URL(window.location.href);
    url.searchParams.delete('auth');
    const state = { ...window.history.state, __vocabAuthSheet: false };
    window.history.replaceState(state, '', url.pathname + url.search);
  }

  function close() {
    sequence.current += 1;
    setPassword('');
    callbacks.current.onClose();
    if (window.history.state?.__vocabAuthSheet) window.history.back();
    else consumeHistory();
  }

  function switchMode() {
    if (submitting.current) return;
    setMode((value) => value === 'login' ? 'register' : 'login');
    setPassword('');
    setShowPassword(false);
    setError(null);
    setSuccess('');
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current || checking) return;
    const normalizedEmail = email.trim();
    setEmail(normalizedEmail);
    setError(null);
    setSuccess('');
    if (!normalizedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      setError({ field: 'email', message: '请输入有效的邮箱地址' });
      emailRef.current?.focus();
      return;
    }
    if (normalizedEmail.length > 64) { setError({ field: 'email', message: '邮箱不能超过 64 个字符' }); return; }
    if (!password) { setError({ field: 'password', message: '请输入密码' }); return; }
    if (mode === 'register' && password.length < 8) { setError({ field: 'password', message: '密码至少需要 8 个字符' }); return; }
    if (mode === 'register' && new TextEncoder().encode(password).length > 72) {
      setError({ field: 'password', message: '密码过长，请控制在 72 字节以内' });
      return;
    }

    submitting.current = true;
    setBusy(true);
    const current = ++sequence.current;
    try {
      const result = await (mode === 'login' ? login(normalizedEmail, password) : register(normalizedEmail, password));
      if (result.ok && mode === 'login') {
        const session = await refresh();
        if (current !== sequence.current) return;
        if (!session) { setError({ message: '登录失败，请重试' }); return; }
        consumeHistory();
        await callbacks.current.onAuthenticated();
      } else if (current === sequence.current) {
        if (result.ok) {
          setMode('login');
          setEmail(result.email);
          setPassword('');
          setShowPassword(false);
          setSuccess('注册成功，请登录');
        } else setError(result);
      }
    } catch {
      if (current === sequence.current) setError({ message: mode === 'login' ? '登录失败，请重试' : '注册失败，请重试' });
    } finally {
      submitting.current = false;
      if (current === sequence.current) setBusy(false);
    }
  }

  const title = mode === 'login' ? '登录' : '注册';
  return createPortal(
    <div ref={overlayRef} className="fixed inset-0 z-50 flex items-end justify-center bg-[#12251c]/45 px-0 backdrop-blur-[2px]" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="auth-title" tabIndex={-1} className="max-h-[92vh] max-h-[92dvh] w-full max-w-[480px] overflow-y-auto rounded-t-lg bg-white px-6 pb-[calc(24px+env(safe-area-inset-bottom))] pt-5 shadow-2xl outline-none">
        <div className="mx-auto mb-5 h-1 w-9 rounded-full bg-[#dfe6e1]" aria-hidden="true" />
        <div className="mb-7 flex items-center justify-between gap-3">
          <h2 id="auth-title" className="text-[24px] font-semibold text-[#1d2925]">{title}</h2>
          <button type="button" onClick={close} title="关闭" aria-label="关闭登录弹窗" className="flex h-11 w-11 items-center justify-center rounded-lg text-[#6e7b73] hover:bg-[#f1f5f2]"><X size={22} /></button>
        </div>
        <form onSubmit={submit} noValidate aria-busy={busy || checking}>
          <div className="mb-5">
            <label htmlFor="auth-email" className="mb-2 block text-sm font-medium text-[#35443a]">邮箱</label>
            <div className="relative">
              <Mail size={18} className="pointer-events-none absolute left-3.5 top-[17px] text-[#91a096]" />
              <input ref={emailRef} id="auth-email" name="email" type="email" inputMode="email" autoComplete="email" placeholder="name@example.com" value={email} disabled={busy || checking} onChange={(event) => { setEmail(event.target.value); setError(null); }} aria-invalid={error?.field === 'email'} aria-describedby={error ? 'auth-error' : undefined} className={`h-[52px] w-full rounded-lg border bg-[#fafcfb] pl-11 pr-4 text-base text-[#1d2925] outline-none transition-colors placeholder:text-[#acb6af] focus:border-[#16886b] focus:ring-2 focus:ring-[#16886b]/10 disabled:opacity-60 ${error?.field === 'email' ? 'border-[#c97864]' : 'border-[#dfe6e1]'}`} />
            </div>
          </div>
          <div className="mb-3">
            <label htmlFor="auth-password" className="mb-2 block text-sm font-medium text-[#35443a]">密码</label>
            <div className="relative">
              <input id="auth-password" name="password" type={showPassword ? 'text' : 'password'} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} placeholder="请输入密码" value={password} disabled={busy || checking} onChange={(event) => { setPassword(event.target.value); setError(null); }} aria-invalid={error?.field === 'password'} aria-describedby={error ? 'auth-error' : undefined} className={`h-[52px] w-full rounded-lg border bg-[#fafcfb] pl-4 pr-12 text-base text-[#1d2925] outline-none transition-colors placeholder:text-[#acb6af] focus:border-[#16886b] focus:ring-2 focus:ring-[#16886b]/10 disabled:opacity-60 ${error?.field === 'password' ? 'border-[#c97864]' : 'border-[#dfe6e1]'}`} />
              <button type="button" disabled={busy || checking} onClick={() => setShowPassword((value) => !value)} title={showPassword ? '隐藏密码' : '显示密码'} aria-label={showPassword ? '隐藏密码' : '显示密码'} aria-pressed={showPassword} className="absolute right-1 top-1 flex h-11 w-11 items-center justify-center rounded-lg text-[#91a096] hover:text-[#16886b]">
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </div>
          <div className="mb-2 min-h-[36px] py-1">
            {error && <p id="auth-error" role="alert" className="break-words text-sm text-[#b75c45]">{error.message}</p>}
            {success && <p role="status" className="text-sm text-[#16886b]">{success}</p>}
          </div>
          <button type="submit" disabled={busy || checking} className={buttonClass('primary', 'h-[50px] w-full gap-3')}>
            {checking ? '确认登录状态中…' : busy ? (mode === 'login' ? '登录中…' : '注册中…') : title}
            {!busy && !checking && <ArrowRight size={18} />}
          </button>
          <div className="mt-4 flex min-h-[44px] items-center justify-center gap-1 text-sm text-[#819087]">
            <span>{mode === 'login' ? '没有账号？' : '已有账号？'}</span>
            <button type="button" disabled={busy || checking} onClick={switchMode} className="min-h-[44px] px-2 font-medium text-[#16886b] disabled:opacity-50">{mode === 'login' ? '注册' : '登录'}</button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
}
