import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import {
  loadMigrations,
  inspectDatabase,
  migrationStatus,
  runMigrations,
} from '../scripts/lib/migrations.mjs';

function databaseAdapter(db) {
  return {
    query: async (sql, values = []) => (await db.query(sql, values)).rows,
    execute: sql => db.exec(sql),
    transaction: callback => db.transaction(transaction => callback(databaseAdapter(transaction))),
  };
}

async function createDatabase(t) {
  const db = new PGlite();
  t.after(() => db.close());
  return { db, adapter: databaseAdapter(db) };
}

test('runner status is read-only and applied migrations remain skipped after learning starts', async t => {
  const { db, adapter } = await createDatabase(t);
  const migrations = await loadMigrations();
  const pending = await migrationStatus(adapter, migrations);
  assert.deepEqual(pending.map(row => row.status), migrations.map(() => 'pending'));
  assert.equal((await db.query("SELECT to_regclass('public._schema_migrations') AS ledger")).rows[0].ledger, null);

  assert.deepEqual(await runMigrations(adapter, migrations), migrations.map(migration => migration.name));
  assert.deepEqual((await migrationStatus(adapter, migrations)).map(row => row.status), migrations.map(() => 'applied'));

  await db.exec(`
    INSERT INTO public."User" (id, email, password)
      VALUES (1, 'runner@example.test', 'test-hash');
    INSERT INTO public.books (title, "coverUrl", "bookId", "wordCount", status)
      VALUES ('Runner test', '', 'runner-book', 1, 'published');
    INSERT INTO public.words (id, "headWord", "bookId", "studyOrder")
      VALUES (1, 'sample', 'runner-book', 0);
    INSERT INTO public.user_book_progress (user_id, book_id, book_version, total_words)
      VALUES (1, 'runner-book', 1, 1);
  `);
  const before = (await db.query('SELECT * FROM public.user_book_progress')).rows;

  assert.deepEqual(await runMigrations(adapter, migrations), []);
  assert.deepEqual((await db.query('SELECT * FROM public.user_book_progress')).rows, before);
  assert.equal((await db.query('SELECT count(*)::integer AS count FROM public._schema_migrations')).rows[0].count, migrations.length);

  const inspection = await inspectDatabase(adapter, migrations);
  assert.deepEqual(inspection.contentShapes, [{ shape: 'empty', rows: '1' }]);
  assert.deepEqual(inspection.studySequence, { invalid_books: '0' });
  assert.deepEqual(inspection.accounts, { invalid_rows: '0', duplicate_email_groups: '0' });
  assert.equal(inspection.tables.words.rows, '1');
  await db.exec('UPDATE public.books SET "wordCount" = 2');
  assert.deepEqual((await inspectDatabase(adapter, migrations)).studySequence, { invalid_books: '1' });
});

test('changed migration checksums are rejected before modifying applied history', async t => {
  const { db, adapter } = await createDatabase(t);
  const migrations = await loadMigrations();
  await runMigrations(adapter, migrations);
  const before = (await db.query('SELECT * FROM public._schema_migrations ORDER BY version')).rows;
  const changed = migrations.map((migration, index) => index === 0
    ? { ...migration, checksum: '0'.repeat(64) }
    : migration);

  await assert.rejects(runMigrations(adapter, changed), error => {
    assert.equal(error.code, 'MIGRATION_CHANGED');
    return true;
  });
  assert.deepEqual((await db.query('SELECT * FROM public._schema_migrations ORDER BY version')).rows, before);
});

test('a failed migration rolls back prior pending DDL and the migration ledger', async t => {
  const { db, adapter } = await createDatabase(t);
  const migrations = await loadMigrations();
  const failingSql = 'CREATE TABLE public.migration_failure_probe (id integer); SELECT 1 / 0;';
  const failingVersion = String(Number(migrations.at(-1).version) + 1).padStart(4, '0');
  const failingMigration = {
    version: failingVersion,
    name: `${failingVersion}_failure_probe.sql`,
    sql: failingSql,
    checksum: createHash('sha256').update(failingSql).digest('hex'),
  };

  await assert.rejects(runMigrations(adapter, [...migrations, failingMigration]), error => {
    assert.equal(error.code, '22012');
    return true;
  });
  const tables = await db.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'");
  assert.deepEqual(tables.rows, []);
  assert.deepEqual((await migrationStatus(adapter, migrations)).map(row => row.status), migrations.map(() => 'pending'));
});

test('private tables revoke default browser-role grants without changing word-library access', async t => {
  const { db, adapter } = await createDatabase(t);
  await db.exec(await readFile(new URL('./fixtures/legacy-schema.sql', import.meta.url), 'utf8'));
  await db.exec(`
    CREATE ROLE anon;
    CREATE ROLE authenticated;
    CREATE ROLE public_permission_reader;
    GRANT SELECT, INSERT ON TABLE public.books, public.words TO PUBLIC, anon, authenticated;
    GRANT ALL ON TABLE public."User" TO PUBLIC, anon, authenticated;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public
      GRANT ALL ON TABLES TO PUBLIC, anon, authenticated;
  `);
  const roles = ['anon', 'authenticated', 'public_permission_reader'];
  const permissions = ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'];

  async function privilegesFor(tables) {
    const result = [];
    for (const role of roles) {
      for (const table of tables) {
        for (const permission of permissions) {
          const query = await db.query('SELECT has_table_privilege($1, $2, $3) AS allowed', [role, table, permission]);
          result.push({ role, table, permission, allowed: query.rows[0].allowed });
        }
      }
    }
    return result;
  }

  const beforeLibraryPermissions = await privilegesFor(['public.books', 'public.words']);
  const migrations = await loadMigrations();
  await runMigrations(adapter, migrations);
  assert.deepEqual(await privilegesFor(['public.books', 'public.words']), beforeLibraryPermissions);

  const privateTables = [
    'public."User"', 'public.user_book_progress', 'public._schema_migrations',
    'public.user_word_progress', 'public.study_sessions', 'public.study_events',
  ];
  const privatePermissions = await privilegesFor(privateTables);
  assert.ok(privatePermissions.every(permission => !permission.allowed));

  for (const role of roles) {
    await db.exec(`SET ROLE ${role}`);
    try {
      for (const table of privateTables) {
        await assert.rejects(db.query(`SELECT * FROM ${table} LIMIT 0`), error => {
          assert.equal(error.code, '42501');
          return true;
        });
        await assert.rejects(db.query(`INSERT INTO ${table} DEFAULT VALUES`), error => {
          assert.equal(error.code, '42501');
          return true;
        });
      }
    } finally {
      await db.exec('RESET ROLE');
    }
  }
});
