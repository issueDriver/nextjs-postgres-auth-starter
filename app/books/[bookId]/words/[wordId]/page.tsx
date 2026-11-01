'use client';

import { useEffect, useRef, useState } from 'react';
import { useRequireAuth } from 'components/auth/session-provider';
import { PageHeader } from 'components/navigation/page-header';
import { LoadingBlock, StatusView } from 'components/ui/states';
import { Pronunciation } from 'components/words/pronunciation';
import type { ApiError } from 'lib/contracts/errors';
import type { WordDetailResult } from 'lib/contracts/words';
import { getWordDetail } from 'lib/api';

function DetailSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-[#e6ebe8] py-6">
      <h2 className="mb-5 flex items-center gap-2 text-[15px] font-semibold text-[#1d2925]">
        <span className="h-3.5 w-[3px] rounded-full bg-[#16886b]" aria-hidden="true" />
        {title}
      </h2>
      {children}
    </section>
  );
}

export default function WordDetail({ params }: { params: { bookId: string; wordId: string } }) {
  const { status, user, onUnauthenticated } = useRequireAuth();
  const userId = user?.id ?? null;
  const { bookId, wordId } = params;
  const [result, setResult] = useState<{ owner: string; data: WordDetailResult } | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  const request = useRef(0);
  const activeOwner = useRef(userId);
  activeOwner.current = userId;
  const data = result?.owner === userId ? result.data : null;
  const word = data?.word;

  useEffect(() => {
    if (status !== 'authenticated' || !userId) return;
    const currentRequest = ++request.current;
    setLoading(true);
    setError(null);
    void getWordDetail(bookId, wordId).then((response) => {
      if (currentRequest !== request.current || activeOwner.current !== userId) return;
      setLoading(false);
      if (!response.ok) {
        if (response.error.code === 'UNAUTHENTICATED') onUnauthenticated();
        else setError(response.error);
        return;
      }
      setResult({ owner: userId, data: response.data });
    });
    return () => { request.current += 1; };
  }, [bookId, wordId, userId, status, retry, onUnauthenticated]);

  return (
    <>
      <PageHeader title="单词详情" fallback={`/books/${encodeURIComponent(bookId)}`} />
      <main className="px-6 pb-8">
        {status !== 'authenticated' || loading ? (
          <div className="pt-6"><LoadingBlock rows={4} label="正在加载单词详情" /></div>
        ) : error ? (
          <StatusView
            title={error.code === 'NOT_FOUND' ? '内容暂不可用' : '单词详情加载失败'}
            description={error.message}
            actions={[
              ...(error.retryable ? [{ label: '重试', onClick: () => setRetry((value) => value + 1) }] : []),
              { label: '返回目录', href: `/books/${encodeURIComponent(bookId)}` },
              { label: '返回首页', href: '/' },
            ]}
          />
        ) : word && data ? (
          <>
            <section className="pb-7 pt-8">
              <p className="mb-3 break-words text-xs text-[#929d96]">{data.book.title} <span className="mx-1.5">/</span> 第 {word.orderIndex + 1} 词</p>
              <h1 lang="en" className={`break-words font-semibold leading-[1.35] text-[#1d2925] ${word.headWord.length > 18 ? 'text-[28px]' : 'text-[32px]'}`}>{word.headWord}</h1>
              <Pronunciation key={word.id} word={word.headWord} phonetics={word.phonetics} />
              {word.phonetics.general && <p lang="en" className="mt-1 break-all text-sm text-[#7c8781]">/{word.phonetics.general}/</p>}
            </section>
            <DetailSection title="释义">
              {word.translations.length > 0 ? (
                <div className="space-y-5">
                  {word.translations.map((translation, index) => (
                    <div key={index}>
                      <p className="break-words text-base leading-7 text-[#35473d]">
                        {translation.pos && <span className="mr-2 font-serif italic text-[#16886b]">{translation.pos}</span>}
                        {translation.zh ?? translation.en}
                      </p>
                      {translation.zh && translation.en && <p lang="en" className="mt-1.5 break-words text-sm leading-6 text-[#849087]">{translation.en}</p>}
                    </div>
                  ))}
                </div>
              ) : <p className="text-sm text-[#849087]">暂无释义</p>}
            </DetailSection>
            {word.examples.length > 0 && (
              <DetailSection title="例句">
                <ol className="space-y-6">
                  {word.examples.map((example, index) => (
                    <li key={index} className="flex gap-3">
                      <span className="mt-1 w-4 shrink-0 text-xs tabular-nums text-[#a5ada9]">{String(index + 1).padStart(2, '0')}</span>
                      <div className="min-w-0 flex-1">
                        <p lang="en" className="break-words text-[15px] leading-7 text-[#35473d]">{example.en}</p>
                        {example.zh && <p className="mt-2 break-words text-[13px] leading-6 text-[#849087]">{example.zh}</p>}
                      </div>
                    </li>
                  ))}
                </ol>
              </DetailSection>
            )}
            {word.phrases.length > 0 && (
              <DetailSection title="短语">
                <dl className="space-y-4">
                  {word.phrases.map((phrase, index) => (
                    <div key={index} className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                      <dt lang="en" className="break-words text-[15px] font-medium text-[#35473d]">{phrase.en}</dt>
                      {phrase.zh && <dd className="break-words text-[13px] leading-6 text-[#849087]">{phrase.zh}</dd>}
                    </div>
                  ))}
                </dl>
              </DetailSection>
            )}
            {word.examExamples.length > 0 && (
              <DetailSection title="真题例句">
                <div className="space-y-6">
                  {word.examExamples.map((example, index) => (
                    <div key={index}>
                      <p lang="en" className="break-words text-[15px] leading-7 text-[#35473d]">{example.en}</p>
                      {example.source && <p className="mt-3 break-words text-xs leading-5 text-[#a5ada9]">{example.source}</p>}
                    </div>
                  ))}
                </div>
              </DetailSection>
            )}
            {word.synonyms.length > 0 && (
              <DetailSection title="同近义词">
                <div className="space-y-5">
                  {word.synonyms.map((group, index) => (
                    <div key={index}>
                      {(group.pos || group.tran) && (
                        <p className="mb-2 break-words text-sm leading-6 text-[#849087]">
                          {group.pos && <span className="mr-2 font-serif italic text-[#16886b]">{group.pos}</span>}{group.tran}
                        </p>
                      )}
                      {group.words.length > 0 && <p lang="en" className="break-words text-[15px] leading-7 text-[#35473d]">{group.words.join(' / ')}</p>}
                    </div>
                  ))}
                </div>
              </DetailSection>
            )}
            {word.relatedWords.length > 0 && (
              <DetailSection title="同根词">
                <div className="space-y-5">
                  {word.relatedWords.map((group, index) => (
                    <div key={index}>
                      {group.pos && <p className="mb-2 font-serif text-sm italic text-[#16886b]">{group.pos}</p>}
                      <dl className="space-y-3">
                        {group.words.map((related, relatedIndex) => (
                          <div key={relatedIndex} className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                            <dt lang="en" className="break-words text-[15px] font-medium text-[#35473d]">{related.word}</dt>
                            {related.tran && <dd className="break-words text-[13px] leading-6 text-[#849087]">{related.tran}</dd>}
                          </div>
                        ))}
                      </dl>
                    </div>
                  ))}
                </div>
              </DetailSection>
            )}
          </>
        ) : null}
      </main>
    </>
  );
}
