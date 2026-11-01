/**
 * 登录后恢复目标的白名单解析（tech.md 9.4）。
 * 解析并重新生成路径，不能只检查 startsWith('/')。
 */
export type ReturnTarget =
  | { kind: 'learn'; bookId: string }
  | { kind: 'complete'; bookId: string }
  | { kind: 'catalog'; bookId: string }
  | { kind: 'detail'; bookId: string; wordId: string };

const SEGMENT = /^[A-Za-z0-9_-]{1,64}$/;
const WORD_ID = /^\d{1,19}$/;

function decodeSegment(segment: string): string | null {
  try {
    const decoded = decodeURIComponent(segment);
    return SEGMENT.test(decoded) ? decoded : null;
  } catch {
    return null;
  }
}

export function parseReturnTo(raw: string | null | undefined): ReturnTarget | null {
  if (!raw || raw.length > 256) return null;
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\')) return null;
  const path = raw.split(/[?#]/)[0];
  const parts = path.split('/').slice(1);
  const [first, rawBookId, third, rawWordId, ...rest] = parts;
  const bookId = rawBookId ? decodeSegment(rawBookId) : null;
  if (!bookId || rest.length > 0) return null;

  if (first === 'learn' && third === undefined) return { kind: 'learn', bookId };
  if (first === 'learn' && third === 'complete' && rawWordId === undefined) return { kind: 'complete', bookId };
  if (first === 'books' && third === undefined) return { kind: 'catalog', bookId };
  if (first === 'books' && third === 'words' && rawWordId && WORD_ID.test(rawWordId)) {
    return { kind: 'detail', bookId, wordId: rawWordId };
  }
  return null;
}

export function targetPath(target: ReturnTarget): string {
  const bookId = encodeURIComponent(target.bookId);
  switch (target.kind) {
    case 'learn':
      return `/learn/${bookId}`;
    case 'complete':
      return `/learn/${bookId}/complete`;
    case 'catalog':
      return `/books/${bookId}`;
    case 'detail':
      return `/books/${bookId}/words/${target.wordId}`;
  }
}

/** 受限入口跳转到「我的」并自动打开登录弹窗。 */
export function loginHref(returnTo: string): string {
  const target = parseReturnTo(returnTo);
  const query = new URLSearchParams({ auth: 'login' });
  if (target) query.set('returnTo', targetPath(target));
  return `/me?${query.toString()}`;
}
