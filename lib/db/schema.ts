import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  foreignKey,
  index,
  integer,
  json,
  jsonb,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

export const users = pgTable(
  'User',
  {
    id: serial('id').primaryKey(),
    email: varchar('email', { length: 64 }).notNull(),
    password: varchar('password', { length: 64 }).notNull(),
  },
  (table) => ({
    emailNonempty: check('user_email_nonempty', sql`btrim(${table.email}) <> ''`),
    // Drizzle 0.29 cannot represent the normalized email expression index.
    // user_email_normalized_unique is created and maintained by SQL migrations.
  })
);

export const books = pgTable(
  'books',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    title: text('title').notNull(),
    wordCount: integer('wordCount').notNull().default(0),
    coverUrl: text('coverUrl').notNull(),
    bookId: text('bookId').notNull().unique('books_bookId_unique'),
    tags: text('tags').array().notNull().default(sql`'{}'::text[]`),
    status: text('status').$type<'published' | 'draft'>().notNull().default('draft'),
    createdAt: timestamp('createdAt', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updatedAt', { withTimezone: true }).notNull().defaultNow(),
    studyVersion: integer('studyVersion').notNull().default(1),
    sortOrder: integer('sortOrder').notNull().default(0),
  },
  (table) => ({
    statusCheck: check(
      'books_status_check',
      sql`${table.status} = ANY (ARRAY['published'::text, 'draft'::text])`
    ),
    wordCountCheck: check('books_word_count_check', sql`${table.wordCount} >= 0`),
    studyVersionPositive: check(
      'books_study_version_positive',
      sql`${table.studyVersion} >= 1`
    ),
    publishedOrderIndex: index('books_published_order_idx')
      .on(table.sortOrder, table.bookId)
      .where(sql`${table.status} = 'published'`),
  })
);

export const words = pgTable(
  'words',
  {
    // The identity default is managed by SQL; this Drizzle version has no identity builder.
    id: bigint('id', { mode: 'bigint' }).primaryKey(),
    wordRank: integer('wordRank'),
    headWord: text('headWord'),
    content: json('content').$type<unknown>(),
    bookId: text('bookId'),
    studyOrder: integer('studyOrder'),
  },
  (table) => ({
    bookForeignKey: foreignKey({
      name: 'words_bookId_books_bookId_fk',
      columns: [table.bookId],
      foreignColumns: [books.bookId],
    })
      .onUpdate('cascade')
      .onDelete('restrict'),
    studyOrderNonnegative: check(
      'words_study_order_nonnegative',
      sql`${table.studyOrder} IS NULL OR ${table.studyOrder} >= 0`
    ),
    bookStudyOrderUnique: uniqueIndex('words_book_study_order_unique').on(
      table.bookId,
      table.studyOrder
    ),
    bookWordUnique: uniqueIndex('words_book_word_unique').on(table.bookId, table.id),
  })
);

export const userBookProgress = pgTable(
  'user_book_progress',
  {
    userId: integer('user_id').notNull(),
    bookId: text('book_id').notNull(),
    bookVersion: integer('book_version').notNull(),
    totalWords: integer('total_words').notNull(),
    learnedCount: integer('learned_count').notNull().default(0),
    lastCompletedWordId: bigint('last_completed_word_id', { mode: 'bigint' }),
    revision: integer('revision').notNull().default(0),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    lastStudiedAt: timestamp('last_studied_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (table) => ({
    primaryKey: primaryKey({
      name: 'user_book_progress_pkey',
      columns: [table.userId, table.bookId],
    }),
    userForeignKey: foreignKey({
      name: 'user_book_progress_user_fk',
      columns: [table.userId],
      foreignColumns: [users.id],
    })
      .onUpdate('restrict')
      .onDelete('cascade'),
    bookForeignKey: foreignKey({
      name: 'user_book_progress_book_fk',
      columns: [table.bookId],
      foreignColumns: [books.bookId],
    })
      .onUpdate('cascade')
      .onDelete('restrict'),
    lastWordForeignKey: foreignKey({
      name: 'user_book_progress_last_word_fk',
      columns: [table.bookId, table.lastCompletedWordId],
      foreignColumns: [words.bookId, words.id],
    })
      .onUpdate('cascade')
      .onDelete('restrict'),
    versionPositive: check('progress_version_positive', sql`${table.bookVersion} >= 1`),
    totalPositive: check('progress_total_positive', sql`${table.totalWords} > 0`),
    countInRange: check(
      'progress_count_in_range',
      sql`${table.learnedCount} >= 0 AND ${table.learnedCount} <= ${table.totalWords}`
    ),
    revisionNonnegative: check(
      'progress_revision_nonnegative',
      sql`${table.revision} >= 0`
    ),
    lastWordConsistent: check(
      'progress_last_word_consistent',
      sql`(${table.learnedCount} = 0 AND ${table.lastCompletedWordId} IS NULL)
        OR (${table.learnedCount} > 0 AND ${table.lastCompletedWordId} IS NOT NULL)`
    ),
    completionConsistent: check(
      'progress_completion_consistent',
      sql`(${table.learnedCount} < ${table.totalWords} AND ${table.completedAt} IS NULL)
        OR (${table.learnedCount} = ${table.totalWords} AND ${table.completedAt} IS NOT NULL)`
    ),
    // The mixed ASC/DESC recent index is defined in SQL; Drizzle 0.29 only supports
    // a shared direction for every column in an index.
  })
);

export const studySessions = pgTable(
  'study_sessions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: integer('user_id').notNull(),
    bookId: text('book_id').notNull(),
    bookVersion: integer('book_version').notNull(),
    status: text('status').$type<'active' | 'completed' | 'abandoned'>().notNull().default('active'),
    learnedCount: integer('learned_count').notNull().default(0),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    ownerUnique: uniqueIndex('study_sessions_owner_unique').on(
      table.id, table.userId, table.bookId, table.bookVersion
    ),
    userForeignKey: foreignKey({
      name: 'study_sessions_user_fk',
      columns: [table.userId],
      foreignColumns: [users.id],
    }).onUpdate('restrict').onDelete('cascade'),
    bookForeignKey: foreignKey({
      name: 'study_sessions_book_fk',
      columns: [table.bookId],
      foreignColumns: [books.bookId],
    }).onUpdate('cascade').onDelete('restrict'),
    versionPositive: check('study_sessions_version_positive', sql`${table.bookVersion} >= 1`),
    statusCheck: check('study_sessions_status_check', sql`${table.status} IN ('active', 'completed', 'abandoned')`),
    countNonnegative: check('study_sessions_count_nonnegative', sql`${table.learnedCount} >= 0`),
    endConsistent: check('study_sessions_end_consistent', sql`
      (${table.status} = 'active' AND ${table.endedAt} IS NULL)
      OR (${table.status} <> 'active' AND ${table.endedAt} IS NOT NULL
        AND ${table.endedAt} >= ${table.startedAt})
    `),
    // The mixed-direction timeline index is managed by SQL migrations.
  })
);

export const userWordProgress = pgTable(
  'user_word_progress',
  {
    userId: integer('user_id').notNull(),
    bookId: text('book_id').notNull(),
    wordId: bigint('word_id', { mode: 'bigint' }).notNull(),
    bookVersion: integer('book_version').notNull(),
    status: text('status').$type<'new' | 'learning' | 'learned'>().notNull().default('new'),
    studyCount: integer('study_count').notNull().default(0),
    firstStudiedAt: timestamp('first_studied_at', { withTimezone: true }),
    lastStudiedAt: timestamp('last_studied_at', { withTimezone: true }),
    learnedAt: timestamp('learned_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    primaryKey: primaryKey({ name: 'user_word_progress_pkey', columns: [table.userId, table.bookId, table.wordId] }),
    userForeignKey: foreignKey({
      name: 'user_word_progress_user_fk', columns: [table.userId], foreignColumns: [users.id],
    }).onUpdate('restrict').onDelete('cascade'),
    bookForeignKey: foreignKey({
      name: 'user_word_progress_book_fk', columns: [table.bookId], foreignColumns: [books.bookId],
    }).onUpdate('cascade').onDelete('restrict'),
    wordForeignKey: foreignKey({
      name: 'user_word_progress_word_fk', columns: [table.bookId, table.wordId], foreignColumns: [words.bookId, words.id],
    }).onUpdate('cascade').onDelete('restrict'),
    versionPositive: check('user_word_progress_version_positive', sql`${table.bookVersion} >= 1`),
    statusCheck: check('user_word_progress_status_check', sql`${table.status} IN ('new', 'learning', 'learned')`),
    countNonnegative: check('user_word_progress_count_nonnegative', sql`${table.studyCount} >= 0`),
    timesConsistent: check('user_word_progress_times_consistent', sql`
      (${table.firstStudiedAt} IS NULL AND ${table.lastStudiedAt} IS NULL)
      OR (${table.firstStudiedAt} IS NOT NULL AND ${table.lastStudiedAt} IS NOT NULL
        AND ${table.lastStudiedAt} >= ${table.firstStudiedAt})
    `),
    learnedConsistent: check('user_word_progress_learned_consistent', sql`
      (${table.status} = 'learned' AND ${table.learnedAt} IS NOT NULL
        AND ${table.firstStudiedAt} IS NOT NULL AND ${table.lastStudiedAt} IS NOT NULL
        AND ${table.learnedAt} BETWEEN ${table.firstStudiedAt} AND ${table.lastStudiedAt})
      OR (${table.status} <> 'learned' AND ${table.learnedAt} IS NULL)
    `),
    wordIndex: index('user_word_progress_word_idx').on(table.bookId, table.wordId),
  })
);

export const studyEvents = pgTable(
  'study_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: integer('user_id').notNull(),
    bookId: text('book_id').notNull(),
    bookVersion: integer('book_version').notNull(),
    sessionId: uuid('session_id'),
    wordId: bigint('word_id', { mode: 'bigint' }),
    eventType: text('event_type').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    userForeignKey: foreignKey({
      name: 'study_events_user_fk', columns: [table.userId], foreignColumns: [users.id],
    }).onUpdate('restrict').onDelete('cascade'),
    bookForeignKey: foreignKey({
      name: 'study_events_book_fk', columns: [table.bookId], foreignColumns: [books.bookId],
    }).onUpdate('cascade').onDelete('restrict'),
    wordForeignKey: foreignKey({
      name: 'study_events_word_fk', columns: [table.bookId, table.wordId], foreignColumns: [words.bookId, words.id],
    }).onUpdate('cascade').onDelete('restrict'),
    sessionForeignKey: foreignKey({
      name: 'study_events_session_fk',
      columns: [table.sessionId, table.userId, table.bookId, table.bookVersion],
      foreignColumns: [studySessions.id, studySessions.userId, studySessions.bookId, studySessions.bookVersion],
    }).onUpdate('cascade').onDelete('cascade'),
    versionPositive: check('study_events_version_positive', sql`${table.bookVersion} >= 1`),
    typeNonempty: check('study_events_type_nonempty', sql`btrim(${table.eventType}) <> ''`),
    payloadObject: check('study_events_payload_object', sql`jsonb_typeof(${table.payload}) = 'object'`),
    sessionIndex: index('study_events_session_occurred_idx')
      .on(table.sessionId, table.occurredAt, table.id).where(sql`${table.sessionId} IS NOT NULL`),
    wordIndex: index('study_events_word_idx').on(table.bookId, table.wordId),
    // The mixed-direction user timeline index is managed by SQL migrations.
  })
);

export type DatabaseUser = typeof users.$inferSelect;
export type Book = typeof books.$inferSelect;
export type Word = typeof words.$inferSelect;
export type UserBookProgress = typeof userBookProgress.$inferSelect;
export type StudySession = typeof studySessions.$inferSelect;
export type UserWordProgress = typeof userWordProgress.$inferSelect;
export type StudyEvent = typeof studyEvents.$inferSelect;
