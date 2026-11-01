'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Volume2 } from 'lucide-react';
import { pronunciationUrl, type PronunciationAccent } from 'lib/words/pronunciation';

const accents = [{ value: 'uk', label: '英音' }, { value: 'us', label: '美音' }] as const;
type Playback = { accent: PronunciationAccent | null; phase: 'idle' | 'loading' | 'playing' | 'error'; error?: string };
const idle: Playback = { accent: null, phase: 'idle' };

export function Pronunciation({ word, phonetics, centered = false }: {
  word: string;
  phonetics?: { uk: string | null; us: string | null };
  centered?: boolean;
}) {
  const [playback, setPlayback] = useState<Playback>(idle);
  const active = useRef<{ audio: HTMLAudioElement; dispose: () => void } | null>(null);

  const stop = useCallback(() => {
    const previous = active.current;
    active.current = null;
    previous?.dispose();
  }, []);

  useEffect(() => {
    stop();
    setPlayback(idle);
    return stop;
  }, [stop, word]);

  function play(accent: PronunciationAccent) {
    stop();
    setPlayback({ accent, phase: 'loading' });
    let audio: HTMLAudioElement;
    try {
      audio = new Audio();
    } catch {
      setPlayback({ accent, phase: 'error', error: '无法播放发音，请重试' });
      return;
    }
    audio.preload = 'none';
    audio.src = pronunciationUrl(word, accent);
    let timeout: ReturnType<typeof setTimeout>;
    const isCurrent = () => active.current?.audio === audio;
    const fail = (error?: unknown) => {
      if (!isCurrent()) return;
      stop();
      setPlayback({
        accent, phase: 'error',
        error: error instanceof DOMException && error.name === 'NotAllowedError'
          ? '无法播放发音，请重试' : '发音加载失败，请重试',
      });
    };
    const waiting = () => {
      if (!isCurrent()) return;
      clearTimeout(timeout);
      setPlayback({ accent, phase: 'loading' });
      timeout = setTimeout(fail, 10_000);
    };
    const playing = () => {
      if (!isCurrent()) return;
      clearTimeout(timeout);
      setPlayback({ accent, phase: 'playing' });
    };
    const finish = () => {
      if (!isCurrent()) return;
      stop();
      setPlayback(idle);
    };
    audio.addEventListener('playing', playing);
    audio.addEventListener('waiting', waiting);
    audio.addEventListener('ended', finish);
    audio.addEventListener('pause', finish);
    audio.addEventListener('error', fail);
    active.current = {
      audio,
      dispose: () => {
        clearTimeout(timeout);
        audio.removeEventListener('playing', playing);
        audio.removeEventListener('waiting', waiting);
        audio.removeEventListener('ended', finish);
        audio.removeEventListener('pause', finish);
        audio.removeEventListener('error', fail);
        audio.pause();
        audio.removeAttribute('src');
        audio.load();
      },
    };
    waiting();
    try {
      // Start inside the click handler so mobile browsers retain the user gesture.
      void audio.play().catch(fail);
    } catch (error) {
      fail(error);
    }
  }

  return (
    <div className="mt-2 min-w-0">
      <div role="group" aria-label={`${word} 发音`} className={`flex flex-wrap items-center gap-x-5 gap-y-1 ${centered ? 'justify-center' : ''}`}>
        {accents.map(({ value, label }) => {
          const selected = playback.accent === value;
          const loading = selected && playback.phase === 'loading';
          const playing = selected && playback.phase === 'playing';
          return (
            <div key={value} className="flex min-w-0 max-w-full items-center gap-1 text-sm text-[#7c8781]">
              <button
                type="button"
                aria-label={`播放 ${word} 的${label}`}
                title={`播放${label}`}
                aria-busy={loading}
                disabled={!word.trim()}
                onClick={() => play(value)}
                className={`inline-flex h-11 shrink-0 items-center justify-center gap-1.5 rounded-md px-2 text-xs transition-colors hover:bg-emerald-50 hover:text-emerald-700 disabled:opacity-40 ${loading || playing ? 'bg-emerald-50 text-emerald-700' : 'text-[#7c8781]'}`}
              >
                <span>{label}</span>
                {loading ? <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" /> : <Volume2 aria-hidden="true" className="h-4 w-4" />}
              </button>
              {phonetics?.[value] && <span lang="en" className="min-w-0 break-all">/{phonetics[value]}/</span>}
            </div>
          );
        })}
      </div>
      {playback.phase === 'error' && <p role="alert" className={`mt-1 text-xs leading-5 text-red-600 ${centered ? 'text-center' : ''}`}>{playback.error}</p>}
      <span role="status" className="sr-only">
        {playback.phase === 'playing' && `${playback.accent === 'uk' ? '英音' : '美音'}正在播放`}
      </span>
    </div>
  );
}
