import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export class MigrationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'MigrationError';
    this.code = code;
  }
}

const defaultDirectory = fileURLToPath(new URL('../../migrations/', import.meta.url));
const ledger = 'public._schema_migrations';

export async function loadMigrations(directory = defaultDirectory) {
  const entries = (await readdir(directory)).filter(name => name.endsWith('.sql')).sort();
  const versions = new Set();
  const migrations = [];

  for (const name of entries) {
    const match = /^(\d{4})_[a-z0-9_]+\.sql$/.exec(name);
    if (!match || versions.has(match[1])) {
      throw new MigrationError('INVALID_MIGRATION_NAME', 'Migration filenames must have unique four-digit versions.');
    }
    versions.add(match[1]);
    const sql = (await readFile(path.join(directory, name), 'utf8')).replace(/\r\n/g, '\n');
    migrations.push({
      version: match[1],
      name,
      sql,
      checksum: createHash('sha256').update(sql).digest('hex'),
    });
  }

  if (!migrations.length) {
    throw new MigrationError('NO_MIGRATIONS', 'No SQL migrations were found.');
  }

  return migrations;
}

export function validateHistory(migrations, applied) {
  const local = new Map(migrations.map(migration => [migration.version, migration]));

  for (const row of applied) {
    const migration = local.get(row.version);
    if (!migration) {
      throw new MigrationError('MISSING_MIGRATION', 'An applied migration is missing from this checkout.');
    }
    if (migration.name !== row.name || migration.checksum !== row.checksum) {
      throw new MigrationError('MIGRATION_CHANGED', `Applied migration ${migration.version} no longer matches its checksum.`);
    }
  }

  const appliedVersions = new Set(applied.map(row => row.version));
  let pendingSeen = false;
  for (const migration of migrations) {
    if (!appliedVersions.has(migration.version)) pendingSeen = true;
    else if (pendingSeen) {
      throw new MigrationError('INVALID_HISTORY', 'Applied migrations are not a continuous prefix of local migrations.');
    }
  }

  return migrations.filter(migration => !appliedVersions.has(migration.version));
}

export async function migrationStatus(database, migrations) {
  const [table] = await database.query('SELECT to_regclass($1) IS NOT NULL AS exists', [ledger]);
  const applied = table.exists
    ? await database.query(`SELECT version, name, checksum, applied_at FROM ${ledger} ORDER BY version`)
    : [];
  const pending = validateHistory(migrations, applied);
  const pendingVersions = new Set(pending.map(migration => migration.version));

  return migrations.map(migration => ({
    version: migration.version,
    name: migration.name,
    status: pendingVersions.has(migration.version) ? 'pending' : 'applied',
  }));
}

export async function runMigrations(database, migrations) {
  return database.transaction(async transaction => {
    await transaction.execute("SET LOCAL lock_timeout = '10s'; SET LOCAL statement_timeout = '120s';");
    const [lock] = await transaction.query('SELECT pg_try_advisory_xact_lock(1886547812, 1701996900) AS acquired');
    if (!lock.acquired) {
      throw new MigrationError('MIGRATION_BUSY', 'Another migration process is running.');
    }

    await transaction.execute(`
      CREATE TABLE IF NOT EXISTS ${ledger} (
        version text PRIMARY KEY,
        name text NOT NULL UNIQUE,
        checksum text NOT NULL CHECK (checksum ~ '^[a-f0-9]{64}$'),
        applied_at timestamptz NOT NULL DEFAULT now()
      );
      REVOKE ALL ON TABLE ${ledger} FROM PUBLIC;
      DO $permissions$
      DECLARE exposed_role text;
      BEGIN
        FOR exposed_role IN
          SELECT rolname FROM pg_roles WHERE rolname IN ('anon', 'authenticated')
        LOOP
          EXECUTE format('REVOKE ALL ON TABLE ${ledger} FROM %I', exposed_role);
        END LOOP;
      END
      $permissions$;
    `);
    const applied = await transaction.query(`SELECT version, name, checksum FROM ${ledger} ORDER BY version`);
    const pending = validateHistory(migrations, applied);

    for (const migration of pending) {
      await transaction.execute(migration.sql);
      await transaction.query(
        `INSERT INTO ${ledger} (version, name, checksum) VALUES ($1, $2, $3)`,
        [migration.version, migration.name, migration.checksum],
      );
    }

    return pending.map(migration => migration.name);
  });
}

export function postgresDatabase(sql) {
  const connection = {
    query: (text, parameters = []) => sql.unsafe(text, parameters),
    execute: text => sql.unsafe(text).simple(),
  };

  return {
    ...connection,
    transaction: callback => sql.begin(transaction => callback(postgresDatabase(transaction))),
  };
}

export async function inspectDatabase(database, migrations) {
  const [server] = await database.query('SHOW server_version');
  const tables = {};
  for (const name of [
    'books', 'words', 'User', 'user_book_progress',
    'user_word_progress', 'study_sessions', 'study_events',
  ]) {
    const qualifiedName = `public."${name}"`;
    const [table] = await database.query('SELECT to_regclass($1) IS NOT NULL AS exists', [qualifiedName]);
    tables[name] = { exists: table.exists, rows: null };
    if (table.exists) {
      const [count] = await database.query(`SELECT count(*)::text AS count FROM ${qualifiedName}`);
      tables[name].rows = count.count;
    }
  }

  let accounts = null;
  if (tables.User.exists) {
    const [audit] = await database.query(`
      SELECT
        (SELECT count(*)::text FROM public."User"
         WHERE email IS NULL OR btrim(email) = '' OR password IS NULL OR password = '') AS invalid_rows,
        (SELECT count(*)::text FROM (
          SELECT lower(btrim(email)) FROM public."User" WHERE email IS NOT NULL
          GROUP BY lower(btrim(email)) HAVING count(*) > 1
        ) AS duplicates) AS duplicate_email_groups
    `);
    accounts = audit;
  }

  let contentShapes = [];
  let studySequence = null;
  if (tables.words.exists) {
    contentShapes = await database.query(`
      SELECT shape, count(*)::text AS rows FROM (
        SELECT CASE
          WHEN content IS NULL OR jsonb_typeof(content::jsonb) = 'null' THEN 'empty'
          WHEN jsonb_typeof(content::jsonb) <> 'object' THEN 'invalid_type'
          WHEN jsonb_typeof(content::jsonb -> 'word') = 'object' THEN 'wrapped_word'
          WHEN content::jsonb ? 'wordHead' OR content::jsonb ? 'wordId' THEN 'word_object'
          WHEN content::jsonb = '{}'::jsonb OR content::jsonb ?| ARRAY[
            'trans', 'sentence', 'realExamSentence', 'ukphone', 'usphone', 'phone',
            'phrase', 'syno', 'relWord', 'picture', 'speech', 'ukspeech', 'usspeech', 'star'
          ] THEN 'content_object'
          ELSE 'unknown_object'
        END AS shape FROM public.words
      ) AS classified GROUP BY shape ORDER BY shape
    `);
    const [column] = await database.query(`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'words' AND column_name = 'studyOrder'
      ) AS exists
    `);
    if (column.exists && tables.books.exists) {
      const [sequence] = await database.query(`
        SELECT count(*)::text AS invalid_books FROM public.books AS b
        LEFT JOIN (
          SELECT "bookId", count(*) AS word_count,
            min("studyOrder") AS first_order, max("studyOrder") AS last_order,
            count(DISTINCT "studyOrder") AS distinct_orders
          FROM public.words WHERE "studyOrder" IS NOT NULL GROUP BY "bookId"
        ) AS s ON s."bookId" = b."bookId"
        WHERE b."wordCount" <> coalesce(s.word_count, 0)
          OR s.word_count <> s.distinct_orders
          OR (b."wordCount" > 0 AND (s.first_order <> 0 OR s.last_order <> b."wordCount" - 1))
      `);
      studySequence = sequence;
    }
  }

  return {
    serverVersion: server.server_version,
    tables,
    accounts,
    contentShapes,
    studySequence,
    migrations: await migrationStatus(database, migrations),
  };
}
