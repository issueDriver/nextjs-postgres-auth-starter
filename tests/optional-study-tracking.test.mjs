import assert from 'node:assert/strict';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { loadMigrations, runMigrations } from '../scripts/lib/migrations.mjs';

const bookA = 'optional-book-a';
const bookB = 'optional-book-b';
const largeWordId = '9007199254740993';
const startedAt = '2026-01-01T12:00:00Z';
const endedAt = '2026-01-01T12:05:00Z';

function databaseAdapter(db) {
  return {
    query: async (sql, values = []) => (await db.query(sql, values)).rows,
    execute: sql => db.exec(sql),
    transaction: callback => db.transaction(transaction => callback(databaseAdapter(transaction))),
  };
}

async function databaseBeforeOptionalMigration(t) {
  const db = new PGlite();
  t.after(() => db.close());
  const adapter = databaseAdapter(db);
  const migrations = await loadMigrations();
  await runMigrations(adapter, migrations.filter(migration => migration.version === '0001'));
  await db.exec(`
    INSERT INTO public."User" (id, email, password)
      VALUES (1, 'first@example.test', 'test-hash'), (2, 'second@example.test', 'test-hash');
    INSERT INTO public.books (title, "coverUrl", "bookId", status)
      VALUES ('Book A', '', '${bookA}', 'published'), ('Book B', '', '${bookB}', 'published');
    INSERT INTO public.words (id, "headWord", "bookId")
      VALUES (101, 'first', '${bookA}'), (${largeWordId}, 'second', '${bookA}'),
        (201, 'other', '${bookB}');
  `);
  await runMigrations(adapter, migrations.filter(migration => migration.version <= '0002'));
  return { db, adapter, migrations };
}

async function createDatabase(t) {
  const context = await databaseBeforeOptionalMigration(t);
  await runMigrations(context.adapter, context.migrations);
  return context;
}

async function insertRow(db, table, values) {
  const columns = Object.keys(values).map(name => `"${name}"`).join(', ');
  const placeholders = Object.keys(values).map((_, index) => `$${index + 1}`).join(', ');
  const result = await db.query(
    `INSERT INTO public.${table} (${columns}) VALUES (${placeholders}) RETURNING *`,
    Object.values(values),
  );
  return result.rows[0];
}

function insertSession(db, values = {}) {
  return insertRow(db, 'study_sessions', { user_id: 1, book_id: bookA, book_version: 1, ...values });
}

function insertWordProgress(db, values = {}) {
  return insertRow(db, 'user_word_progress', {
    user_id: 1, book_id: bookA, word_id: largeWordId, book_version: 1, ...values,
  });
}

function insertEvent(db, values = {}) {
  return insertRow(db, 'study_events', {
    user_id: 1, book_id: bookA, book_version: 1, event_type: 'session_started', ...values,
  });
}

function postgresError(code) {
  return error => {
    assert.equal(error.code, code);
    return true;
  };
}

async function countRows(db, table) {
  return (await db.query(`SELECT count(*)::integer AS count FROM public.${table}`)).rows[0].count;
}

test('optional tracking migration preserves existing learning data and starts with empty tables', async t => {
  const { db, adapter, migrations } = await databaseBeforeOptionalMigration(t);
  await db.exec(`
    INSERT INTO public.user_book_progress (
      user_id, book_id, book_version, total_words, learned_count, last_completed_word_id, revision
    ) VALUES (1, '${bookA}', 1, 2, 1, 101, 1);
  `);
  const originalTables = ['"User"', 'books', 'words', 'user_book_progress'];
  const snapshots = new Map();
  for (const table of originalTables) {
    snapshots.set(table, (await db.query(`SELECT row_to_json(t)::text AS snapshot FROM public.${table} AS t ORDER BY 1`)).rows);
  }
  const history = (await db.query('SELECT * FROM public._schema_migrations ORDER BY version')).rows;

  assert.deepEqual(await runMigrations(adapter, migrations), ['0003_optional_study_tracking.sql']);

  for (const table of originalTables) {
    assert.deepEqual(
      (await db.query(`SELECT row_to_json(t)::text AS snapshot FROM public.${table} AS t ORDER BY 1`)).rows,
      snapshots.get(table),
    );
  }
  for (const table of ['user_word_progress', 'study_sessions', 'study_events']) {
    assert.equal(await countRows(db, table), 0);
  }
  assert.deepEqual(
    (await db.query("SELECT * FROM public._schema_migrations WHERE version <= '0002' ORDER BY version")).rows,
    history,
  );
  assert.deepEqual(await runMigrations(adapter, migrations), []);
});

test('optional records have useful defaults and support word and book level events', async t => {
  const { db } = await createDatabase(t);
  const session = await insertSession(db);
  assert.match(session.id, /^[a-f0-9-]{36}$/);
  assert.equal(session.status, 'active');
  assert.equal(session.learned_count, 0);
  assert.equal(session.ended_at, null);
  assert.ok(session.started_at && session.created_at && session.updated_at);

  const progress = await insertWordProgress(db);
  assert.equal(progress.status, 'new');
  assert.equal(progress.study_count, 0);
  assert.equal(progress.first_studied_at, null);
  assert.equal(progress.last_studied_at, null);
  assert.equal(progress.learned_at, null);
  assert.ok(progress.created_at && progress.updated_at);
  assert.equal(
    (await db.query('SELECT word_id::text AS word_id FROM public.user_word_progress')).rows[0].word_id,
    largeWordId,
  );

  const bookEvent = await insertEvent(db);
  assert.match(bookEvent.id, /^[a-f0-9-]{36}$/);
  assert.equal(bookEvent.word_id, null);
  assert.equal(bookEvent.session_id, null);
  assert.deepEqual(bookEvent.payload, {});
  assert.ok(bookEvent.occurred_at && bookEvent.created_at);
  await insertEvent(db, {
    event_type: 'word_completed', word_id: largeWordId, session_id: session.id,
    payload: JSON.stringify({ source: 'card' }),
  });
  await db.query(
    `UPDATE public.user_word_progress SET status = 'learned', study_count = 1,
      first_studied_at = $1, last_studied_at = $2, learned_at = $2`,
    [startedAt, endedAt],
  );
  await db.query(
    "UPDATE public.study_sessions SET status = 'completed', ended_at = started_at, learned_count = 1 WHERE id = $1",
    [session.id],
  );
  assert.equal(await countRows(db, 'study_events'), 2);
  assert.equal(await countRows(db, 'user_book_progress'), 0);
});

test('tracking checks reject invalid statuses, counters, timestamps and event payloads', async t => {
  const { db } = await createDatabase(t);
  const cases = [
    ['session version', () => insertSession(db, { book_version: 0 })],
    ['session status', () => insertSession(db, { status: 'invalid' })],
    ['session counter', () => insertSession(db, { learned_count: -1 })],
    ['active session with an end', () => insertSession(db, { started_at: startedAt, ended_at: endedAt })],
    ['completed session without an end', () => insertSession(db, { status: 'completed' })],
    ['abandoned session without an end', () => insertSession(db, { status: 'abandoned' })],
    ['session end before start', () => insertSession(db, { status: 'completed', started_at: endedAt, ended_at: startedAt })],
    ['word version', () => insertWordProgress(db, { book_version: 0 })],
    ['word status', () => insertWordProgress(db, { status: 'invalid' })],
    ['word counter', () => insertWordProgress(db, { study_count: -1 })],
    ['first studied without last', () => insertWordProgress(db, { first_studied_at: startedAt })],
    ['last studied without first', () => insertWordProgress(db, { last_studied_at: endedAt })],
    ['last studied before first', () => insertWordProgress(db, { first_studied_at: endedAt, last_studied_at: startedAt })],
    ['learned word without learned time', () => insertWordProgress(db, { status: 'learned' })],
    ['learned time without studied times', () => insertWordProgress(db, { status: 'learned', learned_at: endedAt })],
    ['learning word with learned time', () => insertWordProgress(db, { status: 'learning', first_studied_at: startedAt, last_studied_at: endedAt, learned_at: endedAt })],
    ['learned time before first studied', () => insertWordProgress(db, { status: 'learned', first_studied_at: endedAt, last_studied_at: endedAt, learned_at: startedAt })],
    ['event version', () => insertEvent(db, { book_version: 0 })],
    ['empty event type', () => insertEvent(db, { event_type: '' })],
    ['blank event type', () => insertEvent(db, { event_type: '  ' })],
    ['array payload', () => insertEvent(db, { payload: '[]' })],
    ['JSON null payload', () => insertEvent(db, { payload: 'null' })],
  ];
  for (const [name, insert] of cases) {
    await t.test(name, async () => {
      await assert.rejects(insert(), postgresError('23514'));
    });
  }
});

test('foreign keys keep words and sessions scoped to their owner, book and version', async t => {
  const { db } = await createDatabase(t);
  const session = await insertSession(db);
  const cases = [
    ['unknown session user', () => insertSession(db, { user_id: 999 })],
    ['unknown session book', () => insertSession(db, { book_id: 'missing-book' })],
    ['unknown word-progress user', () => insertWordProgress(db, { user_id: 999 })],
    ['unknown word-progress book', () => insertWordProgress(db, { book_id: 'missing-book' })],
    ['unknown event user without a session', () => insertEvent(db, { user_id: 999 })],
    ['unknown event book without a session', () => insertEvent(db, { book_id: 'missing-book' })],
    ['word progress references another book', () => insertWordProgress(db, { word_id: '201' })],
    ['event references another book word', () => insertEvent(db, { word_id: '201' })],
    ['event references another user session', () => insertEvent(db, { user_id: 2, session_id: session.id })],
    ['event references another book session', () => insertEvent(db, { book_id: bookB, word_id: '201', session_id: session.id })],
    ['event references another version session', () => insertEvent(db, { book_version: 2, session_id: session.id })],
    ['event references an absent session', () => insertEvent(db, { session_id: '00000000-0000-0000-0000-000000000000' })],
  ];
  for (const [name, insert] of cases) {
    await t.test(name, async () => {
      await assert.rejects(insert(), postgresError('23503'));
    });
  }
  await insertWordProgress(db);
  await assert.rejects(insertWordProgress(db), postgresError('23505'));
  await insertWordProgress(db, { user_id: 2 });
  await insertEvent(db, { session_id: session.id, word_id: largeWordId });
  assert.equal(await countRows(db, 'user_word_progress'), 2);
  assert.equal(await countRows(db, 'user_book_progress'), 0);
});

test('deletion rules remove private tracking with users and retain referenced library data', async t => {
  const { db } = await createDatabase(t);
  const firstSession = await insertSession(db);
  const secondSession = await insertSession(db, { user_id: 2 });
  await insertWordProgress(db);
  await insertWordProgress(db, { user_id: 2 });
  await insertEvent(db, { session_id: firstSession.id, word_id: largeWordId });
  await insertEvent(db, { user_id: 2, session_id: secondSession.id, word_id: largeWordId });
  await insertEvent(db, { user_id: 2 });

  for (const sql of [
    `DELETE FROM public.books WHERE "bookId" = '${bookA}'`,
    `DELETE FROM public.words WHERE id = ${largeWordId}`,
  ]) {
    await assert.rejects(db.exec(sql), error => {
      assert.ok(['23001', '23503'].includes(error.code));
      return true;
    });
  }
  await db.query('DELETE FROM public.study_sessions WHERE id = $1', [secondSession.id]);
  assert.equal(await countRows(db, 'study_events'), 2);
  assert.equal(await countRows(db, 'user_word_progress'), 2);
  await db.exec('DELETE FROM public."User" WHERE id = 1');
  assert.equal(await countRows(db, 'study_sessions'), 0);
  assert.equal(await countRows(db, 'study_events'), 1);
  assert.equal(await countRows(db, 'user_word_progress'), 1);
  assert.equal(await countRows(db, 'books'), 2);
  assert.equal(await countRows(db, 'words'), 3);
});
