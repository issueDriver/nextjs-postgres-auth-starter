'use client';

import { useEffect } from 'react';

const DEPTH_KEY = '__vocabDepth';

type HistoryWithPatch = History & { __vocabPatched?: boolean };

function currentDepth(): number {
  const depth = (window.history.state as Record<string, unknown> | null)?.[DEPTH_KEY];
  return typeof depth === 'number' ? depth : 0;
}

/**
 * 在每个 history 条目上记录站内深度，用于判断返回按钮是否有站内来源。
 * pushState 深度 +1，replaceState 保持当前深度；刷新后 history.state 仍保留。
 */
export function HistoryDepthTracker() {
  useEffect(() => {
    const history = window.history as HistoryWithPatch;
    if (history.__vocabPatched) return;
    history.__vocabPatched = true;
    const push = history.pushState.bind(history);
    const replace = history.replaceState.bind(history);
    history.pushState = (state, unused, url) =>
      push({ ...(state ?? {}), [DEPTH_KEY]: currentDepth() + 1 }, unused, url);
    history.replaceState = (state, unused, url) =>
      replace({ ...(state ?? {}), [DEPTH_KEY]: currentDepth() }, unused, url);
  }, []);
  return null;
}

/** 当前条目之前是否还有站内页面。 */
export function hasInAppHistory(): boolean {
  return typeof window !== 'undefined' && currentDepth() > 0;
}
