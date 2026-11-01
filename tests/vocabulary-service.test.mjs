import './support/typescript-hook.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { loadMigrations, runMigrations } from '../scripts/lib/migrations.mjs';

const { createVocabularyService } = await import('../lib/services/vocabulary-core.ts');
const BOOK = 'service-book-a';
const OTHER_BOOK = 'service-book-b';
const LARGE_ID = '9007199254740993';
const LAST_ID = '9007199254740994';
const firstRequest = { wordId: '101', bookVersion: 1, expectedRevision: 0 };

// PGlite executes the production SQL against a disposable PostgreSQL engine.
// It does not replace multi-connection PostgreSQL locking or concurrency tests.
function taggedDatabase(db) {
  class Query {
    constructor(strings, values) { this.strings = strings; this.values = values; }
    compile(parameters) {
      return this.strings.reduce((sql, part, index) => {
        if (index === this.strings.length - 1) return sql + part;
        const value = this.values[index];
        if (value instanceof Query) return sql + part + value.compile(parameters);
        parameters.push(value);
        return sql + part + `$${parameters.length}`;
      }, '');
    }
    then(resolve, reject) {
      const parameters = [];
      return db.query(this.compile(parameters), parameters).then(result => result.rows).then(resolve, reject);
    }
  }
  const sql = (strings, ...values) => new Query(strings, values);
  sql.array = values => values;
  sql.begin = (isolation, callback) => db.transaction(async transaction => {
    await transaction.exec(`SET TRANSACTION ${isolation}`);
    return callback(taggedDatabase(transaction));
  });
  return sql;
}

function migrationDatabase(db) {
  return {
    query: async (sql, values = []) => (await db.query(sql, values)).rows,
    execute: sql => db.exec(sql),
    transaction: callback => db.transaction(transaction => callback(migrationDatabase(transaction))),
  };
}

async function fixture(t) {
  const db = new PGlite();
  t.after(() => db.close());
  await runMigrations(migrationDatabase(db), await loadMigrations());
  await db.exec(`
    INSERT INTO public."User" (id, email, password) VALUES
      (1, 'first@example.test', 'test-hash'), (2, 'second@example.test', 'test-hash');
    INSERT INTO public.books ("bookId", title, "coverUrl", tags, status, "sortOrder", "wordCount") VALUES
      ('${BOOK}', 'Database fixture A', 'https://example.test/a.jpg', ARRAY['词汇'], 'published', 10, 3),
      ('${OTHER_BOOK}', 'Database fixture B', '', ARRAY[]::text[], 'published', 10, 1),
      ('service-empty', 'Empty fixture', '', ARRAY[]::text[], 'published', 20, 0),
      ('service-draft', 'Draft fixture', '', ARRAY[]::text[], 'draft', 0, 0);
  `);
  const words = [
    ['101', BOOK, 0, 'fetch', { word: { wordHead: 'fetch', content: {
      ukphone: 'fetʃ', trans: [{ pos: 'v', tranCn: '取回' }],
      sentence: { sentences: [{ sContent: 'Fetch a towel.', sCn: '取一条毛巾。' }] },
    } } }],
    [LARGE_ID, BOOK, 1, 'second', null],
    [LAST_ID, BOOK, 2, 'last', { wordHead: 'last', content: { trans: [{ pos: 'adj', tranCn: '最后的' }] } }],
    ['201', OTHER_BOOK, 0, 'other', { trans: [{ pos: 'adj', tranCn: '其他的' }] }],
  ];
  for (const [id, bookId, order, headWord, content] of words) {
    await db.query(`INSERT INTO public.words (id, "bookId", "studyOrder", "headWord", content)
      VALUES ($1::bigint, $2, $3, $4, $5::json)`, [id, bookId, order, headWord, content === null ? null : JSON.stringify(content)]);
  }
  return { db, service: createVocabularyService(taggedDatabase(db)) };
}

function errorCode(code) {
  return error => { assert.equal(error.code, code); return true; };
}

async function persisted(db) {
  return (await db.query(`SELECT user_id, book_id, learned_count, last_completed_word_id::text, revision, completed_at
    FROM public.user_book_progress ORDER BY user_id, book_id`)).rows;
}

test('public book pages use real database metadata and stable ordering, excluding drafts', async t => {
  const { service } = await fixture(t);
  const first = await service.listBooks({ limit: 1 });
  const second = await service.listBooks({ limit: 1, cursor: first.nextCursor });
  const third = await service.listBooks({ limit: 1, cursor: second.nextCursor });
  assert.deepEqual([...first.books, ...second.books, ...third.books].map(book => book.bookId), [BOOK, OTHER_BOOK, 'service-empty']);
  assert.equal(third.nextCursor, null);
  assert.deepEqual(first.books[0], {
    bookId: BOOK, title: 'Database fixture A', wordCount: 3,
    coverUrl: 'https://example.test/a.jpg', tags: ['词汇'], bookVersion: 1,
  });
  for (const limit of [0, -1, 101, 1.5]) await assert.rejects(service.listBooks({ limit }), errorCode('VALIDATION_FAILED'));
  await assert.rejects(service.listBooks({ cursor: 'invalid' }), errorCode('VALIDATION_FAILED'));
});

test('catalog, detail and snapshot are read-only and preserve bigint IDs and dictionary content', async t => {
  const { db, service } = await fixture(t);
  const catalog = await service.getCatalog(1, BOOK, { limit: 1 });
  assert.equal(catalog.progress, null);
  assert.equal(catalog.items[0].headWord, 'fetch');
  assert.deepEqual(catalog.items[0].shortDefinition, { pos: 'v.', text: '取回' });
  assert.equal(catalog.items[0].isLearned, false);
  const next = await service.getCatalog(1, BOOK, { limit: 1, cursor: catalog.nextCursor });
  assert.equal(next.items[0].id, LARGE_ID);
  assert.equal(next.items[0].shortDefinition.text, '暂无释义');
  const detail = await service.getWordDetail(1, BOOK, '101');
  assert.equal(detail.word.examples[0].en, 'Fetch a towel.');
  const snapshot = await service.getStudySnapshot(1, BOOK);
  assert.equal(snapshot.currentWord.id, '101');
  assert.equal(snapshot.progress, null);
  assert.deepEqual(await persisted(db), []);
  await assert.rejects(service.getCatalog(1, OTHER_BOOK, { cursor: catalog.nextCursor }), errorCode('VALIDATION_FAILED'));
});

test('visit creates one zero-progress record and confirmation is sequential and idempotent', async t => {
  const { db, service } = await fixture(t);
  await assert.rejects(service.completeWord(1, BOOK, firstRequest), errorCode('PROGRESS_CONFLICT'));
  const visited = await service.visitStudy(1, BOOK, firstRequest);
  assert.equal(visited.learnedCount, 0);
  assert.equal(visited.lastCompletedWordId, null);
  await service.visitStudy(1, BOOK, firstRequest);
  assert.equal((await persisted(db)).length, 1);
  const saved = await service.completeWord(1, BOOK, firstRequest);
  assert.equal(saved.progress.learnedCount, 1);
  assert.equal(saved.nextWord.id, LARGE_ID);
  const retry = await service.completeWord(1, BOOK, firstRequest);
  assert.equal(retry.progress.learnedCount, 1);
  assert.equal(retry.progress.revision, 1);
  await assert.rejects(service.completeWord(1, BOOK, { wordId: LAST_ID, bookVersion: 1, expectedRevision: 1 }), errorCode('PROGRESS_CONFLICT'));
  await assert.rejects(service.completeWord(1, BOOK, { wordId: LARGE_ID, bookVersion: 1, expectedRevision: 0 }), error => {
    assert.equal(error.code, 'PROGRESS_CONFLICT');
    assert.equal(error.latestProgress.learnedCount, 1);
    return true;
  });
  assert.equal((await persisted(db))[0].learned_count, 1);
});

test('only final confirmation completes a book and each account owns its own progress', async t => {
  const { service } = await fixture(t);
  await service.visitStudy(1, BOOK, firstRequest);
  for (const [index, wordId] of ['101', LARGE_ID, LAST_ID].entries()) {
    const response = await service.completeWord(1, BOOK, { wordId, bookVersion: 1, expectedRevision: index });
    assert.equal(response.state, index === 2 ? 'completed' : 'learning');
    assert.equal(response.progress.isCompleted, index === 2);
  }
  const completed = await service.getStudySnapshot(1, BOOK);
  assert.equal(completed.state, 'completed');
  assert.equal(completed.progress.lastCompletedWordId, LAST_ID);
  assert.ok(completed.progress.completedAt);
  assert.deepEqual((await service.getMyProgress(1)).summary, { totalLearned: 3, learningBooks: 0, completedBooks: 1 });
  assert.deepEqual((await service.getMyProgress(2)).summary, { totalLearned: 0, learningBooks: 0, completedBooks: 0 });
  assert.equal((await service.getStudySnapshot(2, BOOK)).currentWord.id, '101');
  assert.equal((await service.getBooksProgress(2, [BOOK]))[0].progress, null);
  assert.equal((await service.getCatalog(1, BOOK)).items.every(word => word.isLearned), true);
  await service.visitStudy(2, BOOK, firstRequest);
  assert.equal((await service.getMyProgress(2)).summary.learningBooks, 1);
});

test('database write failures roll back and a saved word survives unavailable next-card content', async t => {
  const { db, service } = await fixture(t);
  await service.visitStudy(1, BOOK, firstRequest);
  await db.exec(`
    CREATE FUNCTION reject_fixture_save() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'isolated test failure'; END;
    $$;
    CREATE TRIGGER reject_fixture_save BEFORE UPDATE OF learned_count ON public.user_book_progress
      FOR EACH ROW EXECUTE FUNCTION reject_fixture_save();
  `);
  await assert.rejects(service.completeWord(1, BOOK, firstRequest), /isolated test failure/);
  assert.equal((await persisted(db))[0].learned_count, 0);
  await db.exec('DROP TRIGGER reject_fixture_save ON public.user_book_progress;');
  await db.query('UPDATE public.words SET content = $1::json WHERE id = $2::bigint', ['[]', LARGE_ID]);
  const saved = await service.completeWord(1, BOOK, firstRequest);
  assert.equal(saved.progress.learnedCount, 1);
  assert.equal(saved.nextWord, null);
  assert.equal((await persisted(db))[0].last_completed_word_id, '101');
  await db.query('UPDATE public.words SET content = NULL WHERE id = $1::bigint', [LARGE_ID]);
  const recovered = await service.getStudySnapshot(1, BOOK);
  assert.equal(recovered.progress.learnedCount, 1);
  assert.equal(recovered.currentWord.id, LARGE_ID);
});

test('empty, hidden, mismatched and invalid requests cannot fabricate progress', async t => {
  const { db, service } = await fixture(t);
  await assert.rejects(service.getStudySnapshot(1, 'service-empty'), errorCode('EMPTY_BOOK'));
  await assert.rejects(service.getStudySnapshot(1, 'service-draft'), errorCode('NOT_FOUND'));
  await assert.rejects(service.getWordDetail(1, OTHER_BOOK, '101'), errorCode('NOT_FOUND'));
  await assert.rejects(service.getWordDetail(1, BOOK, '9223372036854775808'), errorCode('VALIDATION_FAILED'));
  await assert.rejects(service.getCatalog(0, BOOK), errorCode('UNAUTHENTICATED'));
  await assert.rejects(service.visitStudy(1, BOOK, { ...firstRequest, bookVersion: 2 }), errorCode('BOOK_VERSION_CHANGED'));
  await assert.rejects(service.visitStudy(1, BOOK, { ...firstRequest, wordId: '201' }), errorCode('VALIDATION_FAILED'));
  assert.deepEqual(await persisted(db), []);
  await service.visitStudy(1, BOOK, firstRequest);
  await db.query('UPDATE public.books SET "studyVersion" = 2 WHERE "bookId" = $1', [BOOK]);
  await assert.rejects(service.getStudySnapshot(1, BOOK), errorCode('BOOK_VERSION_CHANGED'));
  assert.equal((await service.getBooksProgress(1, [BOOK]))[0].available, false);
  assert.equal((await service.getMyProgress(1)).books.length, 0);
});

test('literal JSON null is supported while sequence gaps and stale cursors are rejected', async t => {
  const { db, service } = await fixture(t);
  await db.query('UPDATE public.words SET content = $1::json WHERE id = $2::bigint', ['null', LARGE_ID]);
  const catalog = await service.getCatalog(1, BOOK, { limit: 1 });
  const second = await service.getCatalog(1, BOOK, { cursor: catalog.nextCursor, limit: 1 });
  assert.equal(second.items[0].headWord, 'second');
  assert.equal(second.items[0].shortDefinition.text, '暂无释义');
  await db.query('UPDATE public.words SET "studyOrder" = NULL WHERE id = $1::bigint', [LARGE_ID]);
  await assert.rejects(service.getCatalog(1, BOOK), errorCode('BOOK_DATA_INVALID'));
  await db.query('UPDATE public.books SET "studyVersion" = 2 WHERE "bookId" = $1', [BOOK]);
  await assert.rejects(service.getCatalog(1, BOOK, { cursor: catalog.nextCursor }), errorCode('BOOK_VERSION_CHANGED'));
});
