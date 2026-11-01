'use client';

import { useState } from 'react';
import { BookOpen } from 'lucide-react';
import type { BookDTO } from 'lib/contracts/books';
import { coverSource } from './cover-source';

export function BookCover({ book, size = 'md' }: { book: Pick<BookDTO, 'bookId' | 'title' | 'tags' | 'coverUrl'>; size?: 'sm' | 'md' | 'lg' }) {
  const source = coverSource(book.coverUrl);
  const [failedSource, setFailedSource] = useState<string | null>(null);
  const [loadedSource, setLoadedSource] = useState<string | null>(null);
  const showImage = source !== null && source !== failedSource;
  return (
    <div className={`book-cover book-cover-${size} bg-[#eaf1ec]`} role="img" aria-label={`${book.title}封面`}>
      <div aria-hidden="true" className={`flex h-full min-w-0 flex-col justify-between gap-2 px-2.5 py-3 text-[#42614e] ${size === 'sm' ? 'text-[9px]' : size === 'lg' ? 'text-xs' : 'text-[10px]'}`}>
        <BookOpen className="h-4 w-4 shrink-0" strokeWidth={1.5} />
        <span className="line-clamp-3 break-words font-medium leading-relaxed">{book.title}</span>
        {book.tags[0] && <span className="truncate text-[8px] opacity-60">{book.tags[0]}</span>}
      </div>
      {showImage ? (
        // Database cover hosts vary; load in the browser without a server-side image proxy.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={source} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" className={`absolute inset-0 h-full w-full object-cover ${loadedSource === source ? 'opacity-100' : 'opacity-0'}`} onLoad={() => setLoadedSource(source)} onError={() => setFailedSource(source)} />
      ) : null}
      <div className="cover-spine" />
    </div>
  );
}
