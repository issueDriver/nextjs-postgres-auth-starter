export type PronunciationAccent = 'uk' | 'us';

export function pronunciationUrl(word: string, accent: PronunciationAccent): string {
  const url = new URL('https://dict.youdao.com/dictvoice');
  url.searchParams.set('audio', word.trim());
  url.searchParams.set('type', accent === 'uk' ? '1' : '2');
  return url.href;
}
