import type { Sql } from 'postgres';
import type { BookDTO, BookPage } from 'lib/contracts/books';
import type {
  AdvanceResult,
  BookProgressLookup,
  MyProgress,
  ProgressDTO,
  StudySnapshot,
  StudyWriteRequest,
} from 'lib/contracts/study';
import type { CatalogPage, WordDetailResult } from 'lib/contracts/words';
import { toCatalogItem, toWordCard, toWordDetail, type WordRow } from 'lib/words/normalize';
import { ServiceError } from './errors';

interface BookRecord {
  bookId: string;
  title: string;
  wordCount: number;
  coverUrl: string;
  tags: string[];
  studyVersion: number;
  sortOrder: number;
}

interface ProgressRecord {
  user_id: number;
  book_id: string;
  book_version: number;
  total_words: number;
  learned_count: number;
  last_completed_word_id: string | null;
  revision: number;
  started_at: Date | string;
  last_studied_at: Date | string;
  completed_at: Date | string | null;
}

type PageParams = { cursor?: string | null; limit?: number };
type BookCursor = { v: 1; kind: 'books'; sortOrder: number; bookId: string };
type CatalogCursor = { v: 1; kind: 'catalog'; bookId: string; bookVersion: number; afterOrder: number };

function validateBookId(bookId: string) {
  if (typeof bookId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(bookId)) {
    throw new ServiceError('VALIDATION_FAILED');
  }
}

function validateUserId(userId: number) {
  if (!Number.isInteger(userId) || userId < 1 || userId > 2_147_483_647) {
    throw new ServiceError('UNAUTHENTICATED');
  }
}

function validateWordId(wordId: string) {
  if (typeof wordId !== 'string' || !/^[1-9]\d{0,18}$/.test(wordId) || BigInt(wordId) > BigInt('9223372036854775807')) {
    throw new ServiceError('VALIDATION_FAILED');
  }
}

function pageLimit(params: PageParams) {
  const limit = params.limit ?? 50;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new ServiceError('VALIDATION_FAILED');
  return limit;
}

function decodeCursor(raw: string): Record<string, unknown> {
  try {
    if (raw.length > 512 || !/^[A-Za-z0-9_-]+$/.test(raw)) throw new Error();
    const bytes = Buffer.from(raw, 'base64url');
    if (bytes.toString('base64url') !== raw) throw new Error();
    const value: unknown = JSON.parse(bytes.toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value as Record<string, unknown>;
  } catch {
    throw new ServiceError('VALIDATION_FAILED');
  }
}

function encodeCursor(cursor: BookCursor | CatalogCursor) {
  return Buffer.from(JSON.stringify(cursor)).toString('base64url');
}

function bookCursor(raw: string | null | undefined): BookCursor | null {
  if (raw === null || raw === undefined) return null;
  const value = decodeCursor(raw);
  if (value.v !== 1 || value.kind !== 'books' || typeof value.bookId !== 'string' ||
    typeof value.sortOrder !== 'number' || !Number.isInteger(value.sortOrder) ||
    value.sortOrder < -2_147_483_648 || value.sortOrder > 2_147_483_647) {
    throw new ServiceError('VALIDATION_FAILED');
  }
  validateBookId(value.bookId);
  return value as unknown as BookCursor;
}

function catalogCursor(raw: string | null | undefined, book: BookRecord): number {
  if (raw === null || raw === undefined) return -1;
  const value = decodeCursor(raw);
  if (value.v !== 1 || value.kind !== 'catalog' || value.bookId !== book.bookId ||
    typeof value.bookVersion !== 'number' || !Number.isInteger(value.bookVersion) || value.bookVersion < 1 ||
    typeof value.afterOrder !== 'number' || !Number.isInteger(value.afterOrder) ||
    value.afterOrder < 0 || value.afterOrder > 2_147_483_647) {
    throw new ServiceError('VALIDATION_FAILED');
  }
  if (value.bookVersion !== book.studyVersion) throw new ServiceError('BOOK_VERSION_CHANGED');
  if (value.afterOrder >= book.wordCount) throw new ServiceError('VALIDATION_FAILED');
  return value.afterOrder;
}

function toBook(row: BookRecord): BookDTO {
  if (!Number.isInteger(row.wordCount) || row.wordCount < 0 ||
    !Number.isInteger(row.studyVersion) || row.studyVersion < 1) {
    throw new ServiceError('BOOK_DATA_INVALID');
  }
  return {
    bookId: row.bookId,
    title: row.title,
    wordCount: row.wordCount,
    coverUrl: row.coverUrl,
    tags: row.tags,
    bookVersion: row.studyVersion,
  };
}

function iso(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new ServiceError('BOOK_DATA_INVALID');
  return date.toISOString();
}

function toProgress(row: ProgressRecord): ProgressDTO {
  if (!Number.isInteger(row.learned_count) || !Number.isInteger(row.total_words) ||
    row.total_words <= 0 || row.learned_count < 0 || row.learned_count > row.total_words ||
    !Number.isInteger(row.revision) || row.revision < 0) {
    throw new ServiceError('BOOK_DATA_INVALID');
  }
  const completed = row.learned_count === row.total_words;
  return {
    bookId: row.book_id,
    bookVersion: row.book_version,
    totalWords: row.total_words,
    learnedCount: row.learned_count,
    lastCompletedIndex: row.learned_count === 0 ? null : row.learned_count - 1,
    lastCompletedWordId: row.last_completed_word_id,
    revision: row.revision,
    isCompleted: completed,
    progressPercent: (row.learned_count / row.total_words) * 100,
    startedAt: iso(row.started_at),
    lastStudiedAt: iso(row.last_studied_at),
    completedAt: row.completed_at === null ? null : iso(row.completed_at),
  };
}

function assertConsistent(progress: ProgressRecord, book: BookRecord) {
  if (progress.book_version !== book.studyVersion || progress.total_words !== book.wordCount) {
    throw new ServiceError('BOOK_VERSION_CHANGED');
  }
  toProgress(progress);
}

function conflict(progress: ProgressRecord | null): never {
  throw new ServiceError('PROGRESS_CONFLICT', progress ? { latestProgress: toProgress(progress) } : {});
}

function writeRequest(request: StudyWriteRequest) {
  if (!request || !Number.isInteger(request.bookVersion) || request.bookVersion < 1 ||
    request.bookVersion > 2_147_483_647 || !Number.isInteger(request.expectedRevision) ||
    request.expectedRevision < 0 || request.expectedRevision > 2_147_483_647) {
    throw new ServiceError('VALIDATION_FAILED');
  }
  validateWordId(request.wordId);
}

function safeCount(value: string): number {
  const count = Number(value);
  if (!Number.isSafeInteger(count) || count < 0) throw new ServiceError('INTERNAL_ERROR');
  return count;
}

function normalize<T>(read: () => T): T {
  try {
    return read();
  } catch (error) {
    if (error instanceof Error && error.message === 'BOOK_DATA_INVALID') throw new ServiceError('BOOK_DATA_INVALID');
    throw error;
  }
}

export function createVocabularyService(database: Sql) {
  async function readBook(query: Sql, bookId: string, lock = false): Promise<BookRecord> {
    const rows = await query<BookRecord[]>`
      SELECT "bookId", title, "wordCount", "coverUrl", tags, "studyVersion", "sortOrder"
      FROM public.books WHERE "bookId" = ${bookId} AND status = 'published'
      ${lock ? query`FOR SHARE` : query``}
    `;
    if (!rows[0]) throw new ServiceError('NOT_FOUND');
    toBook(rows[0]);
    return rows[0];
  }

  async function readProgress(query: Sql, userId: number, bookId: string, lock = false): Promise<ProgressRecord | null> {
    const rows = await query<ProgressRecord[]>`
      SELECT user_id, book_id, book_version, total_words, learned_count,
        last_completed_word_id::text, revision, started_at, last_studied_at, completed_at
      FROM public.user_book_progress WHERE user_id = ${userId} AND book_id = ${bookId}
      ${lock ? query`FOR UPDATE` : query``}
    `;
    return rows[0] ?? null;
  }

  async function readWordAt(query: Sql, book: BookRecord, order: number): Promise<WordRow> {
    const rows = await query<WordRow[]>`
      SELECT w.id::text, w."wordRank", w."headWord", w.content, w."bookId", w."studyOrder"
      FROM public.words AS w JOIN public.books AS b ON b."bookId" = w."bookId"
      WHERE w."bookId" = ${book.bookId} AND w."studyOrder" = ${order}
        AND b.status = 'published' AND b."studyVersion" = ${book.studyVersion}
        AND b."wordCount" = ${book.wordCount}
    `;
    if (!rows[0]) throw new ServiceError('BOOK_DATA_INVALID');
    return rows[0];
  }

  async function submittedOrder(query: Sql, book: BookRecord, wordId: string): Promise<number> {
    const rows = await query<{ studyOrder: number | null }[]>`
      SELECT "studyOrder" FROM public.words WHERE "bookId" = ${book.bookId} AND id = ${wordId}::bigint
    `;
    const order = rows[0]?.studyOrder;
    if (order === null || order === undefined || order < 0 || order >= book.wordCount) {
      throw new ServiceError('VALIDATION_FAILED');
    }
    return order;
  }

  async function listBooks(params: PageParams = {}): Promise<BookPage> {
    const limit = pageLimit(params);
    const after = bookCursor(params.cursor);
    const rows = await database<BookRecord[]>`
      SELECT "bookId", title, "wordCount", "coverUrl", tags, "studyVersion", "sortOrder"
      FROM public.books WHERE status = 'published'
        AND (${after === null} OR ("sortOrder", "bookId") > (${after?.sortOrder ?? 0}::integer, ${after?.bookId ?? ''}::text))
      ORDER BY "sortOrder" ASC, "bookId" ASC LIMIT ${limit + 1}
    `;
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    return {
      books: page.map(toBook),
      nextCursor: rows.length > limit && last
        ? encodeCursor({ v: 1, kind: 'books', sortOrder: last.sortOrder, bookId: last.bookId })
        : null,
    };
  }

  async function getMyProgress(userId: number): Promise<MyProgress> {
    validateUserId(userId);
    const [summary, rows] = await Promise.all([
      database<{ total_learned: string; learning_books: string; completed_books: string }[]>`
        SELECT coalesce(sum(p.learned_count), 0)::text AS total_learned,
          (count(*) FILTER (WHERE p.learned_count < p.total_words))::text AS learning_books,
          (count(*) FILTER (WHERE p.learned_count = p.total_words))::text AS completed_books
        FROM public.user_book_progress AS p JOIN public.books AS b ON b."bookId" = p.book_id
        WHERE p.user_id = ${userId} AND b.status = 'published'
          AND b."studyVersion" = p.book_version AND b."wordCount" = p.total_words
      `,
      database<(BookRecord & ProgressRecord)[]>`
        SELECT b."bookId", b.title, b."wordCount", b."coverUrl", b.tags, b."studyVersion", b."sortOrder",
          p.user_id, p.book_id, p.book_version, p.total_words, p.learned_count,
          p.last_completed_word_id::text, p.revision, p.started_at, p.last_studied_at, p.completed_at
        FROM public.user_book_progress AS p JOIN public.books AS b ON b."bookId" = p.book_id
        WHERE p.user_id = ${userId} AND b.status = 'published'
          AND b."studyVersion" = p.book_version AND b."wordCount" = p.total_words
        ORDER BY p.last_studied_at DESC, p.book_id ASC
      `,
    ]);
    const books = rows.map((row) => ({ book: toBook(row), progress: toProgress(row) }));
    return {
      summary: {
        totalLearned: safeCount(summary[0].total_learned),
        learningBooks: safeCount(summary[0].learning_books),
        completedBooks: safeCount(summary[0].completed_books),
      },
      recent: books[0] ?? null,
      books,
    };
  }

  async function getBooksProgress(userId: number, bookIds: string[]): Promise<BookProgressLookup[]> {
    validateUserId(userId);
    if (!Array.isArray(bookIds)) throw new ServiceError('VALIDATION_FAILED');
    const ids = Array.from(new Set(bookIds));
    if (ids.length > 20) throw new ServiceError('VALIDATION_FAILED');
    ids.forEach(validateBookId);
    if (!ids.length) return [];
    const rows = await database<(BookRecord & Partial<ProgressRecord>)[]>`
      SELECT b."bookId", b.title, b."wordCount", b."coverUrl", b.tags, b."studyVersion", b."sortOrder",
        p.user_id, p.book_id, p.book_version, p.total_words, p.learned_count,
        p.last_completed_word_id::text, p.revision, p.started_at, p.last_studied_at, p.completed_at
      FROM public.books AS b LEFT JOIN public.user_book_progress AS p
        ON p.book_id = b."bookId" AND p.user_id = ${userId}
      WHERE b.status = 'published' AND b."bookId" = ANY(${database.array(ids)}::text[])
    `;
    const byId = new Map(rows.map((row) => [row.bookId, row]));
    return ids.map((bookId) => {
      const row = byId.get(bookId);
      if (!row) return { bookId, available: false, progress: null };
      if (row.user_id === null || row.user_id === undefined) return { bookId, available: true, progress: null };
      if (row.book_version !== row.studyVersion || row.total_words !== row.wordCount) {
        return { bookId, available: false, progress: null };
      }
      return { bookId, available: true, progress: toProgress(row as BookRecord & ProgressRecord) };
    });
  }

  async function getCatalog(userId: number, bookId: string, params: PageParams = {}): Promise<CatalogPage> {
    validateUserId(userId);
    validateBookId(bookId);
    const limit = pageLimit(params);
    const book = await readBook(database, bookId);
    const afterOrder = catalogCursor(params.cursor, book);
    const progress = await readProgress(database, userId, bookId);
    if (progress) assertConsistent(progress, book);
    const rows = await database<(WordRow & { validContent: boolean })[]>`
      SELECT w.id::text, w."wordRank", w."bookId", w."studyOrder",
        coalesce(nullif(btrim(w."headWord"), ''),
          CASE WHEN jsonb_typeof(w.content::jsonb #> '{word,wordHead}') = 'string'
            THEN nullif(btrim(w.content::jsonb #>> '{word,wordHead}'), '') END,
          CASE WHEN jsonb_typeof(w.content::jsonb -> 'wordHead') = 'string'
            THEN nullif(btrim(w.content::jsonb ->> 'wordHead'), '') END) AS "headWord",
        (w.content IS NULL OR jsonb_typeof(w.content::jsonb) IN ('object', 'null')) AS "validContent",
        jsonb_build_object('trans', CASE
          WHEN jsonb_typeof(w.content::jsonb -> 'word') = 'object' THEN w.content::jsonb #> '{word,content,trans}'
          WHEN w.content::jsonb ? 'wordHead' OR w.content::jsonb ? 'wordId' THEN w.content::jsonb #> '{content,trans}'
          ELSE w.content::jsonb -> 'trans' END) AS content
      FROM public.words AS w JOIN public.books AS b ON b."bookId" = w."bookId"
      WHERE w."bookId" = ${bookId} AND w."studyOrder" > ${afterOrder}
        AND b.status = 'published' AND b."studyVersion" = ${book.studyVersion}
        AND b."wordCount" = ${book.wordCount}
      ORDER BY w."studyOrder" ASC LIMIT ${limit + 1}
    `;
    if (rows.length !== Math.min(limit + 1, book.wordCount - afterOrder - 1) ||
      rows.some((row, index) => !row.validContent || row.studyOrder !== afterOrder + index + 1)) {
      throw new ServiceError('BOOK_DATA_INVALID');
    }
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    return {
      book: toBook(book),
      progress: progress ? toProgress(progress) : null,
      items: page.map((row) => normalize(() => toCatalogItem(row, progress?.learned_count ?? 0))),
      nextCursor: rows.length > limit && last
        ? encodeCursor({ v: 1, kind: 'catalog', bookId, bookVersion: book.studyVersion, afterOrder: last.studyOrder! })
        : null,
    };
  }

  async function getWordDetail(userId: number, bookId: string, wordId: string): Promise<WordDetailResult> {
    validateUserId(userId);
    validateBookId(bookId);
    validateWordId(wordId);
    const book = await readBook(database, bookId);
    const rows = await database<WordRow[]>`
      SELECT w.id::text, w."wordRank", w."headWord", w.content, w."bookId", w."studyOrder"
      FROM public.words AS w JOIN public.books AS b ON b."bookId" = w."bookId"
      WHERE w."bookId" = ${bookId} AND w.id = ${wordId}::bigint
        AND w."studyOrder" IS NOT NULL AND w."studyOrder" < ${book.wordCount}
        AND b.status = 'published' AND b."studyVersion" = ${book.studyVersion}
        AND b."wordCount" = ${book.wordCount}
    `;
    if (!rows[0]) throw new ServiceError('NOT_FOUND');
    return { book: toBook(book), word: normalize(() => toWordDetail(rows[0])) };
  }

  async function getStudySnapshot(userId: number, bookId: string): Promise<StudySnapshot> {
    validateUserId(userId);
    validateBookId(bookId);
    const book = await readBook(database, bookId);
    if (book.wordCount === 0) throw new ServiceError('EMPTY_BOOK');
    const progress = await readProgress(database, userId, bookId);
    if (progress) {
      assertConsistent(progress, book);
      if (progress.learned_count === progress.total_words) {
        return { state: 'completed', book: toBook(book), progress: toProgress(progress), currentWord: null };
      }
    }
    const row = await readWordAt(database, book, progress?.learned_count ?? 0);
    return {
      state: 'learning',
      book: toBook(book),
      progress: progress ? toProgress(progress) : null,
      currentWord: normalize(() => toWordCard(row)),
    };
  }

  async function visitStudy(userId: number, bookId: string, request: StudyWriteRequest): Promise<ProgressDTO> {
    validateUserId(userId);
    validateBookId(bookId);
    writeRequest(request);
    return database.begin('isolation level read committed', async (transaction) => {
      const book = await readBook(transaction, bookId, true);
      if (book.studyVersion !== request.bookVersion) throw new ServiceError('BOOK_VERSION_CHANGED');
      if (book.wordCount === 0) throw new ServiceError('EMPTY_BOOK');
      let progress = await readProgress(transaction, userId, bookId, true);
      const order = await submittedOrder(transaction, book, request.wordId);
      if (!progress) {
        if (order !== 0 || request.expectedRevision !== 0) conflict(null);
        await transaction`
          INSERT INTO public.user_book_progress (user_id, book_id, book_version, total_words)
          VALUES (${userId}, ${bookId}, ${book.studyVersion}, ${book.wordCount})
          ON CONFLICT (user_id, book_id) DO NOTHING
        `;
        progress = await readProgress(transaction, userId, bookId, true);
      }
      if (!progress) throw new ServiceError('INTERNAL_ERROR');
      assertConsistent(progress, book);
      if (order !== progress.learned_count || request.expectedRevision !== progress.revision ||
        progress.learned_count >= progress.total_words) conflict(progress);
      const updated = await transaction<ProgressRecord[]>`
        UPDATE public.user_book_progress SET last_studied_at = now(), updated_at = now()
        WHERE user_id = ${userId} AND book_id = ${bookId}
        RETURNING user_id, book_id, book_version, total_words, learned_count,
          last_completed_word_id::text, revision, started_at, last_studied_at, completed_at
      `;
      return toProgress(updated[0]);
    });
  }

  async function completeWord(userId: number, bookId: string, request: StudyWriteRequest): Promise<AdvanceResult> {
    validateUserId(userId);
    validateBookId(bookId);
    writeRequest(request);
    const committed = await database.begin('isolation level read committed', async (transaction) => {
      const book = await readBook(transaction, bookId, true);
      if (book.studyVersion !== request.bookVersion) throw new ServiceError('BOOK_VERSION_CHANGED');
      if (book.wordCount === 0) throw new ServiceError('EMPTY_BOOK');
      const progress = await readProgress(transaction, userId, bookId, true);
      if (!progress) conflict(null);
      assertConsistent(progress, book);
      const order = await submittedOrder(transaction, book, request.wordId);
      if (order < progress.learned_count) return { book, progress: toProgress(progress) };
      if (order !== progress.learned_count || request.expectedRevision !== progress.revision ||
        progress.learned_count >= progress.total_words) conflict(progress);
      const updated = await transaction<ProgressRecord[]>`
        UPDATE public.user_book_progress SET learned_count = learned_count + 1,
          last_completed_word_id = ${request.wordId}::bigint, revision = revision + 1,
          last_studied_at = now(), updated_at = now(),
          completed_at = CASE WHEN learned_count + 1 = total_words THEN now() ELSE NULL END
        WHERE user_id = ${userId} AND book_id = ${bookId}
          AND revision = ${request.expectedRevision} AND learned_count < total_words
        RETURNING user_id, book_id, book_version, total_words, learned_count,
          last_completed_word_id::text, revision, started_at, last_studied_at, completed_at
      `;
      if (!updated[0]) conflict(progress);
      return { book, progress: toProgress(updated[0]) };
    });
    if (committed.progress.isCompleted) return { state: 'completed', progress: committed.progress, nextWord: null };
    try {
      const row = await readWordAt(database, committed.book, committed.progress.learnedCount);
      return { state: 'learning', progress: committed.progress, nextWord: normalize(() => toWordCard(row)) };
    } catch (error) {
      console.warn('study_next_word_unavailable', {
        bookId,
        code: error instanceof ServiceError ? error.code : 'INTERNAL_ERROR',
      });
      return { state: 'learning', progress: committed.progress, nextWord: null };
    }
  }

  return { listBooks, getMyProgress, getBooksProgress, getCatalog, getWordDetail, getStudySnapshot, visitStudy, completeWord };
}
