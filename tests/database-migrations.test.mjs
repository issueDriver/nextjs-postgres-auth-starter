import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const fixtureUrl = new URL('./fixtures/legacy-schema.sql', import.meta.url);
const migrationsUrl = new URL('../migrations/', import.meta.url);
const passwordHash = '$2b$10$' + 'a'.repeat(53);
const bookA = 'test-book-a';
const bookB = 'test-book-b';
const largeWordId = '9007199254740993';

async function applyMigration(db, name) {
  const sql = await readFile(new URL(name, migrationsUrl), 'utf8');
  await db.exec('BEGIN');
  try {
    await db.exec(sql);
    await db.exec('COMMIT');
  } catch (error) {
    await db.exec('ROLLBACK');
    throw error;
  }
}

async function migrate(db) {
  await applyMigration(db, '0001_auth_and_study_schema.sql');
  await applyMigration(db, '0002_initialize_study_order.sql');
}

async function legacyDatabase(t) {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(await readFile(fixtureUrl, 'utf8'));
  return db;
}

async function seedBooks(db) {
  for (const bookId of [bookA, bookB, 'empty-book']) {
    await db.query(
      'INSERT INTO public.books (title, "bookId", "coverUrl", "wordCount", status) VALUES ($1, $1, $2, 999, $3)',
      [bookId, '', 'published'],
    );
  }
}

async function seedWords(db) {
  const rows = [
    ['101', 2, 'column-wins', { word: { wordHead: 'ignored', content: {} } }, bookA],
    ['102', 1, 'first-ranked', null, bookA],
    ['103', 1, null, { word: { wordHead: 'enveloped', wordId: 'source-id', content: {} } }, bookA],
    ['104', null, null, { wordHead: 'word-object', content: { trans: [] } }, bookA],
    ['105', null, null, { trans: [] }, bookA],
    ['106', 3, ' ', { word: { wordHead: 123, content: {} } }, bookA],
    ['107', 3, null, { wordHead: false, content: {} }, bookA],
    ['108', 3, null, { word: { wordHead: { value: 'invalid' }, content: {} } }, bookA],
    ['109', null, null, { wordHead: '  ', content: {} }, bookA],
    ['110', null, 'valid-without-content', null, bookA],
    [largeWordId, 4, 'large-primary-key', { trans: [] }, bookA],
    ['201', 1, 'other-book-word', { trans: [] }, bookB],
    ['301', 1, 'orphan-word', null, null],
  ];
  for (const [id, rank, headWord, content, bookId] of rows) {
    await db.query(
      'INSERT INTO public.words (id, "wordRank", "headWord", content, "bookId") VALUES ($1::bigint, $2, $3, $4::json, $5)',
      [id, rank, headWord, content === null ? null : JSON.stringify(content), bookId],
    );
  }
}

async function seedUsers(db) {
  await db.query(
    'INSERT INTO public."User" (id, email, password) VALUES (7, $1, $2), (8, $3, $2)',
    [' Legacy.User@example.test ', passwordHash, 'second@example.test'],
  );
}

async function wordSnapshot(db) {
  const result = await db.query(
    'SELECT id::text, "wordRank", "headWord", content::text AS content, "bookId" FROM public.words ORDER BY id',
  );
  return result.rows;
}

async function progressInsert(db, overrides = {}) {
  const values = {
    user_id: 8,
    book_id: bookA,
    book_version: 1,
    total_words: 6,
    learned_count: 0,
    last_completed_word_id: null,
    revision: 0,
    completed_at: null,
    ...overrides,
  };
  return db.query(
    `INSERT INTO public.user_book_progress (
      user_id, book_id, book_version, total_words, learned_count,
      last_completed_word_id, revision, completed_at
    ) VALUES ($1, $2, $3, $4, $5, $6::bigint, $7, $8::timestamptz)`,
    Object.values(values),
  );
}

function postgresError(code) {
  return error => {
    assert.equal(error.code, code);
    return true;
  };
}

test('empty databases receive the complete schema without losing identity types', async t => {
  const db = new PGlite();
  t.after(() => db.close());
  await migrate(db);

  const tables = await db.query(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name",
  );
  assert.deepEqual(tables.rows.map(row => row.table_name), [
    'User', 'books', 'user_book_progress', 'words',
  ]);

  const columns = await db.query(
    `SELECT column_name, data_type, is_identity FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'words'
       AND column_name IN ('id', 'content', 'studyOrder')
     ORDER BY column_name`,
  );
  assert.deepEqual(columns.rows, [
    { column_name: 'content', data_type: 'json', is_identity: 'NO' },
    { column_name: 'id', data_type: 'bigint', is_identity: 'YES' },
    { column_name: 'studyOrder', data_type: 'integer', is_identity: 'NO' },
  ]);
  assert.deepEqual((await db.query('SELECT count(*)::integer AS count FROM public.user_book_progress')).rows, [{ count: 0 }]);
});

test('legacy data is preserved and learning order is deterministic', async t => {
  const db = await legacyDatabase(t);
  await seedBooks(db);
  await seedWords(db);
  await seedUsers(db);
  const beforeWords = await wordSnapshot(db);
  const beforeUsers = (await db.query('SELECT id, email, password FROM public."User" ORDER BY id')).rows;
  const beforeBooks = (await db.query('SELECT id::text, title, "bookId", "coverUrl", tags, status, "createdAt" FROM public.books ORDER BY "bookId"')).rows;

  await migrate(db);

  assert.deepEqual(await wordSnapshot(db), beforeWords);
  assert.deepEqual((await db.query('SELECT id, email, password FROM public."User" ORDER BY id')).rows, beforeUsers);
  assert.deepEqual((await db.query('SELECT id::text, title, "bookId", "coverUrl", tags, status, "createdAt" FROM public.books ORDER BY "bookId"')).rows, beforeBooks);

  const ordered = await db.query(
    'SELECT id::text, "studyOrder" FROM public.words WHERE "bookId" = $1 AND "studyOrder" IS NOT NULL ORDER BY "studyOrder"',
    [bookA],
  );
  assert.deepEqual(ordered.rows, [
    { id: '102', studyOrder: 0 },
    { id: '103', studyOrder: 1 },
    { id: '101', studyOrder: 2 },
    { id: largeWordId, studyOrder: 3 },
    { id: '104', studyOrder: 4 },
    { id: '110', studyOrder: 5 },
  ]);
  const excluded = await db.query(
    'SELECT id::text FROM public.words WHERE "studyOrder" IS NULL ORDER BY id',
  );
  assert.deepEqual(excluded.rows.map(row => row.id), ['105', '106', '107', '108', '109', '301']);
  const counts = await db.query('SELECT "bookId", "wordCount", "studyVersion", "sortOrder" FROM public.books ORDER BY "bookId"');
  assert.deepEqual(counts.rows, [
    { bookId: 'empty-book', wordCount: 0, studyVersion: 1, sortOrder: 0 },
    { bookId: bookA, wordCount: 6, studyVersion: 1, sortOrder: 0 },
    { bookId: bookB, wordCount: 1, studyVersion: 1, sortOrder: 0 },
  ]);
});

test('schema constraints reject invalid progress, cross-book words and duplicate positions', async t => {
  const db = await legacyDatabase(t);
  await seedBooks(db);
  await seedWords(db);
  await seedUsers(db);
  await migrate(db);

  for (const [name, values] of [
    ['negative count', { learned_count: -1 }],
    ['count above total', { learned_count: 7, last_completed_word_id: '110' }],
    ['empty book', { total_words: 0 }],
    ['zero progress with a last word', { last_completed_word_id: '102' }],
    ['learned progress without a last word', { learned_count: 1 }],
    ['completed count without completed time', { learned_count: 6, last_completed_word_id: '110' }],
    ['partial count with completed time', { learned_count: 1, last_completed_word_id: '102', completed_at: '2026-01-01T00:00:00Z' }],
    ['negative revision', { revision: -1 }],
    ['invalid version', { book_version: 0 }],
  ]) {
    await t.test(name, async () => {
      await assert.rejects(progressInsert(db, values), postgresError('23514'));
    });
  }

  await t.test('last word must belong to the same book', async () => {
    await assert.rejects(
      progressInsert(db, { learned_count: 1, last_completed_word_id: '201' }),
      postgresError('23503'),
    );
  });
  await t.test('nonexistent users and books cannot own progress', async () => {
    await assert.rejects(progressInsert(db, { user_id: 999 }), postgresError('23503'));
    await assert.rejects(progressInsert(db, { book_id: 'missing-book' }), postgresError('23503'));
  });
  await t.test('learning positions are unique within one book', async () => {
    await assert.rejects(
      db.query('INSERT INTO public.words ("headWord", "bookId", "studyOrder") VALUES ($1, $2, 0)', ['duplicate-position', bookA]),
      postgresError('23505'),
    );
    await assert.rejects(
      db.query('INSERT INTO public.words ("headWord", "bookId", "studyOrder") VALUES ($1, $2, -1)', ['negative-position', bookA]),
      postgresError('23514'),
    );
  });
  await t.test('normalized emails remain unique for legacy accounts', async () => {
    await assert.rejects(
      db.query('INSERT INTO public."User" (email, password) VALUES ($1, $2)', ['legacy.user@EXAMPLE.TEST', passwordHash]),
      postgresError('23505'),
    );
  });
  await t.test('one progress row per user and book', async () => {
    await progressInsert(db);
    await assert.rejects(progressInsert(db), postgresError('23505'));
    await progressInsert(db, { user_id: 7 });
    assert.equal((await db.query('SELECT count(*)::integer AS count FROM public.user_book_progress')).rows[0].count, 2);
  });
  await t.test('valid completion and last-word delete restriction', async () => {
    await db.query(
      `UPDATE public.user_book_progress SET learned_count = 6,
       last_completed_word_id = $1::bigint, revision = 6, completed_at = now()
       WHERE user_id = 7 AND book_id = $2`,
      ['110', bookA],
    );
    const completed = (await db.query('SELECT learned_count, completed_at IS NOT NULL AS completed FROM public.user_book_progress WHERE user_id = 7')).rows;
    assert.deepEqual(completed, [{ learned_count: 6, completed: true }]);
    await assert.rejects(db.query('DELETE FROM public.words WHERE id = 110'), error => {
      assert.ok(['23001', '23503'].includes(error.code));
      return true;
    });
  });
});

test('unsafe legacy accounts stop migration without exposing or mutating credentials', async t => {
  const db = await legacyDatabase(t);
  const sensitiveEmail = 'private-address@example.test';
  await db.query(
    'INSERT INTO public."User" (id, email, password) VALUES (1, $1, $2), (2, $3, $2)',
    [sensitiveEmail, passwordHash, ' PRIVATE-ADDRESS@example.test '],
  );

  async function expectPrivateAuditFailure() {
    await assert.rejects(applyMigration(db, '0001_auth_and_study_schema.sql'), error => {
      assert.ok(!error.message.toLowerCase().includes(sensitiveEmail));
      assert.ok(!error.message.includes(passwordHash));
      return true;
    });
    const columns = await db.query(
      "SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'books' AND column_name = 'studyVersion'",
    );
    assert.deepEqual(columns.rows, []);
    assert.equal((await db.query('SELECT count(*)::integer AS count FROM public."User"')).rows[0].count, 2);
  }

  await expectPrivateAuditFailure();
  await db.query('UPDATE public."User" SET email = $1, password = NULL WHERE id = 2', ['repaired@example.test']);
  await expectPrivateAuditFailure();
  await db.query('UPDATE public."User" SET password = $1 WHERE id = 2', ['']);
  await expectPrivateAuditFailure();
  await db.query('UPDATE public."User" SET email = $1, password = $2 WHERE id = 2', [' ', passwordHash]);
  await expectPrivateAuditFailure();
  await db.query('UPDATE public."User" SET email = $1 WHERE id = 2', ['repaired@example.test']);
  await migrate(db);
  assert.equal((await db.query('SELECT count(*)::integer AS count FROM public."User"')).rows[0].count, 2);
});

test('learning-order initialization refuses to rewrite books with saved progress', async t => {
  const db = await legacyDatabase(t);
  await seedBooks(db);
  await seedWords(db);
  await seedUsers(db);
  await migrate(db);
  await progressInsert(db, { learned_count: 1, last_completed_word_id: '102', revision: 1 });
  const beforeOrder = (await db.query('SELECT id::text, "studyOrder" FROM public.words ORDER BY id')).rows;
  const beforeProgress = (await db.query('SELECT * FROM public.user_book_progress')).rows;

  await assert.rejects(applyMigration(db, '0002_initialize_study_order.sql'), postgresError('23514'));

  assert.deepEqual((await db.query('SELECT id::text, "studyOrder" FROM public.words ORDER BY id')).rows, beforeOrder);
  assert.deepEqual((await db.query('SELECT * FROM public.user_book_progress')).rows, beforeProgress);
});
